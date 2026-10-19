import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, GenerateContentResponse } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

async function checkLocalOllamaServer(host: string): Promise<{ reachable: boolean; models: string[] }> {
  const cleanHost = (host || 'http://127.0.0.1:11434').replace(/\/+$/, '').replace('localhost', '127.0.0.1');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const res = await fetch(`${cleanHost}/api/tags`, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return { reachable: false, models: [] };
    const data: any = await res.json();
    const models = Array.isArray(data?.models)
      ? data.models.map((m: any) => m.name).filter(Boolean)
      : [];
    return { reachable: true, models };
  } catch {
    clearTimeout(timeout);
    return { reachable: false, models: [] };
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // Clean Server-Side Health & Ollama Probe Endpoint (prevents browser CORS/ERR_CONNECTION_REFUSED errors)
  app.get('/api/jarvis/health', async (req, res) => {
    const host = typeof req.query.host === 'string' ? req.query.host : 'http://127.0.0.1:11434';
    const ollamaStatus = await checkLocalOllamaServer(host);
    res.json({
      reachable: ollamaStatus.reachable,
      models: ollamaStatus.models,
      geminiAvailable: Boolean(process.env.GEMINI_API_KEY)
    });
  });

  // Streaming Chat Endpoint (supports Local Ollama proxy + Gemini 3.8 Flash SSE stream)
  app.post('/api/jarvis/chat', async (req, res) => {
    try {
      const {
        prompt,
        history = [],
        systemInstruction,
        temperature = 0.7,
        modelName = 'qwen2.5:3b',
        ollamaHost = 'http://127.0.0.1:11434',
        keepAliveMinutes = 30,
        maxTokens = 1024
      } = req.body || {};

      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({ error: 'Prompt is required' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');

      // 1. Try local Ollama first if running on user's machine
      const cleanHost = (ollamaHost || 'http://127.0.0.1:11434')
        .replace(/\/+$/, '')
        .replace('localhost', '127.0.0.1');

      try {
        const ollamaCtrl = new AbortController();
        const ollamaTimeout = setTimeout(() => ollamaCtrl.abort(), 1500);

        const ollamaMessages = [
          {
            role: 'system',
            content:
              systemInstruction ||
              'You are J.A.R.V.I.S, a concise and technically accurate personal AI assistant.'
          },
          ...(Array.isArray(history)
            ? history.slice(-6).map((m: any) => ({
                role: m.role === 'user' ? 'user' : 'assistant',
                content: String(m.content || '')
              }))
            : []),
          { role: 'user', content: prompt }
        ];

        const ollamaRes = await fetch(`${cleanHost}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelName,
            messages: ollamaMessages,
            stream: true,
            keep_alive: `${keepAliveMinutes}m`,
            options: {
              temperature: Number(temperature) || 0.7,
              num_predict: Number(maxTokens) || 1024
            }
          }),
          signal: ollamaCtrl.signal
        });

        clearTimeout(ollamaTimeout);

        if (ollamaRes.ok && ollamaRes.body) {
          const reader = ollamaRes.body.getReader();
          const decoder = new TextDecoder();
          let hasOutput = false;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunkText = decoder.decode(value, { stream: true });
            const lines = chunkText.split('\n').filter((l) => l.trim());
            for (const line of lines) {
              try {
                const parsed = JSON.parse(line);
                if (parsed.message?.content) {
                  hasOutput = true;
                  res.write(`data: ${JSON.stringify({ text: parsed.message.content })}\n\n`);
                }
              } catch {
                // partial chunk
              }
            }
          }

          if (hasOutput) {
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
        }
      } catch {
        // Local Ollama not running; proceed to Gemini engine
      }

      // 2. Stream via Gemini 3.8 Flash
      const ai = getAiClient();
      if (!ai) {
        res.write(
          `data: ${JSON.stringify({
            fallback: true,
            error: 'Local Ollama offline and no cloud API key configured.'
          })}\n\n`
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const contents: any[] = [];
      if (Array.isArray(history)) {
        for (const msg of history.slice(-6)) {
          if (msg && msg.content && typeof msg.content === 'string') {
            contents.push({
              role: msg.role === 'user' ? 'user' : 'model',
              parts: [{ text: msg.content }]
            });
          }
        }
      }
      contents.push({
        role: 'user',
        parts: [{ text: prompt }]
      });

      const responseStream = await ai.models.generateContentStream({
        model: 'gemini-3.8-flash',
        contents,
        config: {
          systemInstruction:
            (systemInstruction
              ? `${systemInstruction}\n\n`
              : '') +
            `You are J.A.R.V.I.S (active route: ${modelName}), a sharp, concise, and technically accurate personal AI assistant. Answer the user request directly and accurately. When asked for code in a specific language (such as Java, Python, C++, TypeScript, JavaScript, SQL, Rust, Go, etc.), always write complete, working, well-commented code in that exact requested language inside markdown code fences.`,
          temperature: Number(temperature) || 0.7
        }
      });

      for await (const chunk of responseStream) {
        const c = chunk as GenerateContentResponse;
        const text = c.text;
        if (text) {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error: any) {
      console.error('Chat stream error:', error);
      const errMsg = error?.message || 'Failed to generate response';
      if (!res.headersSent) {
        res.status(500).json({ error: errMsg });
      } else {
        res.write(`data: ${JSON.stringify({ fallback: true, error: errMsg })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }
  });

  // Vision Analysis Endpoint
  app.post('/api/jarvis/vision', async (req, res) => {
    try {
      const {
        prompt = 'Describe this image concisely and list key technical components.',
        imageBase64,
        mimeType = 'image/png',
        visionModel = 'llama3.2-vision:latest',
        ollamaHost = 'http://127.0.0.1:11434'
      } = req.body || {};

      if (!imageBase64) {
        res.status(400).json({ error: 'imageBase64 is required' });
        return;
      }

      // 1. Try local Ollama Vision first
      const cleanHost = (ollamaHost || 'http://127.0.0.1:11434')
        .replace(/\/+$/, '')
        .replace('localhost', '127.0.0.1');

      if (!mimeType.includes('svg')) {
        try {
          const ctrl = new AbortController();
          const tId = setTimeout(() => ctrl.abort(), 2000);
          const ollamaRes = await fetch(`${cleanHost}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: visionModel,
              messages: [{ role: 'user', content: prompt, images: [imageBase64] }],
              stream: false
            }),
            signal: ctrl.signal
          });
          clearTimeout(tId);
          if (ollamaRes.ok) {
            const data: any = await ollamaRes.json();
            if (data?.message?.content) {
              res.json({ summary: data.message.content, source: 'ollama' });
              return;
            }
          }
        } catch {
          // Proceed to Gemini vision
        }
      }

      // 2. Gemini 3.8 Flash Vision
      const ai = getAiClient();
      if (!ai) {
        res.status(200).json({ summary: null, fallback: true });
        return;
      }

      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: imageBase64
              }
            },
            {
              text: prompt
            }
          ]
        }
      });

      res.json({
        summary: response.text || 'Visual analysis complete.',
        source: 'gemini'
      });
    } catch (error: any) {
      console.error('Vision analysis error:', error);
      res.status(200).json({ summary: null, fallback: true, error: error?.message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`J.A.R.V.I.S server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
