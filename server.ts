import express from 'express';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import {
  inspectAndCacheDocument,
  generateSampleDocument,
  solveDocumentSlots,
  exportFilledDocument,
  XfillFileType
} from './server/xfillEngine.ts';
import {
  generateSlideDeck,
  regenerateSingleSlide,
  searchWebImages,
  exportDeckToPptx
} from './server/slidesEngine.ts';
import { resolveAvailableOllamaModel } from './server/localJsonUtils.ts';
import {
  consumeOllamaNdjson,
  pickWarmUpModel,
  resolveChatOllamaNumCtx
} from './server/ollamaStreamUtils.ts';
import {
  initHardwareProfile,
  getCachedHardwareProfile
} from './server/hardwareProbe.ts';
import {
  formatHardwareReadout,
  selectBestModelForTier
} from './src/utils/hardwareTier.ts';
import {
  isValidOllamaModelTag,
  consumeOllamaPullNdjson,
  resolveSafeOllamaHost
} from './server/modelManagerUtils.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_STARTED_AT = Date.now();
const GEMINI_DEFAULT_MODEL = 'gemini-4-hydrogen';
const CREATOR_ATTRIBUTION_HEADER = 'J.A.R.V.I.S (c) 2026 cosmoknight';
const EXPECTED_COPYRIGHT_SEAL = 'ceff726d5d41618b';

function verifyServerAttribution() {
  const licensePath = path.join(__dirname, 'LICENSE');
  const noticePath = path.join(__dirname, 'NOTICE');

  let licenseIntact = false;
  let noticeIntact = false;

  try {
    const licenseText = fs.readFileSync(licensePath, 'utf8');
    licenseIntact =
      licenseText.includes('Copyright (c) 2026 cosmoknight') &&
      licenseText.includes('J.A.R.V.I.S') &&
      licenseText.includes('NOT permitted');
  } catch {
    licenseIntact = false;
  }

  try {
    const noticeText = fs.readFileSync(noticePath, 'utf8');
    noticeIntact =
      noticeText.includes('Copyright (c) 2026 cosmoknight') &&
      noticeText.includes(EXPECTED_COPYRIGHT_SEAL);
  } catch {
    noticeIntact = false;
  }

  const fingerprint = crypto
    .createHash('sha256')
    .update(`${CREATOR_ATTRIBUTION_HEADER}|${EXPECTED_COPYRIGHT_SEAL}|${licenseIntact}|${noticeIntact}`)
    .digest('hex')
    .slice(0, 16);

  return {
    verified: licenseIntact && noticeIntact,
    short: CREATOR_ATTRIBUTION_HEADER,
    seal: EXPECTED_COPYRIGHT_SEAL,
    licenseIntact,
    noticeIntact,
    fingerprint
  };
}

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

interface OllamaInstalledModelDetail {
  name: string;
  size: number | null;
  modifiedAt?: string;
  parameterSize?: string;
  quantizationLevel?: string;
}

async function checkLocalOllamaServer(
  host: string
): Promise<{
  reachable: boolean;
  models: string[];
  modelDetails: OllamaInstalledModelDetail[];
  latencyMs: number;
}> {
  const safeHost = resolveSafeOllamaHost(host);
  const cleanHost = safeHost.ok ? safeHost.host : 'http://127.0.0.1:11434';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  const started = Date.now();

  try {
    const res = await fetch(`${cleanHost}/api/tags`, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeout);
    const latencyMs = Math.max(1, Date.now() - started);
    if (!res.ok) return { reachable: false, models: [], modelDetails: [], latencyMs };
    const data: any = await res.json();
    const rawModels = Array.isArray(data?.models) ? data.models : [];
    const modelDetails: OllamaInstalledModelDetail[] = rawModels
      .filter((m: any) => typeof m?.name === 'string' && m.name.trim())
      .map((m: any) => ({
        name: String(m.name).trim(),
        size: typeof m.size === 'number' && Number.isFinite(m.size) ? m.size : null,
        modifiedAt: typeof m.modified_at === 'string' ? m.modified_at : undefined,
        parameterSize:
          typeof m?.details?.parameter_size === 'string' ? m.details.parameter_size : undefined,
        quantizationLevel:
          typeof m?.details?.quantization_level === 'string'
            ? m.details.quantization_level
            : undefined
      }));
    const models = modelDetails.map((m) => m.name);
    return { reachable: true, models, modelDetails, latencyMs };
  } catch {
    clearTimeout(timeout);
    return {
      reachable: false,
      models: [],
      modelDetails: [],
      latencyMs: Math.max(1, Date.now() - started)
    };
  }
}

type WarmUpPhase = 'idle' | 'warming' | 'ready' | 'skipped' | 'failed';

interface WarmUpState {
  status: WarmUpPhase;
  model: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

let warmUpState: WarmUpState = {
  status: 'idle',
  model: null,
  startedAt: null,
  completedAt: null
};

/**
 * Silent, non-blocking background warm-up for local Ollama on server startup.
 * Loads the default 3B model into memory (keep_alive: "30m", empty prompt) so
 * the user's first chat message avoids a ~25-30s cold-start delay, while
 * tracking live warm-up status for Engine Diagnostics and the chat footer.
 */
async function warmUpLocalOllama(host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'): Promise<void> {
  if (warmUpState.status === 'warming') return;

  const cleanHost = (host || 'http://127.0.0.1:11434')
    .replace(/\/+$/, '')
    .replace('localhost', '127.0.0.1');

  const status = await checkLocalOllamaServer(cleanHost);
  if (!status.reachable) {
    warmUpState = {
      status: 'skipped',
      model: null,
      startedAt: null,
      completedAt: Date.now()
    };
    return;
  }

  const hardware = await initHardwareProfile();
  const targetModel = pickWarmUpModel(status.models, 'qwen2.5:3b', hardware);
  if (!targetModel) {
    warmUpState = {
      status: 'ready',
      model: null,
      startedAt: null,
      completedAt: Date.now()
    };
    return;
  }

  const startedAt = Date.now();
  warmUpState = {
    status: 'warming',
    model: targetModel,
    startedAt,
    completedAt: null
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);
  try {
    const res = await fetch(`${cleanHost}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: targetModel,
        prompt: '',
        stream: false,
        keep_alive: '30m',
        options: {
          num_ctx: resolveChatOllamaNumCtx(targetModel, hardware)
        }
      }),
      signal: controller.signal
    });
    warmUpState = {
      status: res.ok ? 'ready' : 'failed',
      model: targetModel,
      startedAt,
      completedAt: Date.now()
    };
  } catch {
    warmUpState = {
      status: 'failed',
      model: targetModel,
      startedAt,
      completedAt: Date.now()
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // Stamp creator attribution on all API responses (DMCA §1202 CMI)
  app.use(['/api/jarvis', '/api/models'], (_req, res, next) => {
    res.setHeader('X-Creator-Attribution', CREATOR_ATTRIBUTION_HEADER);
    res.setHeader('X-Copyright-Seal', EXPECTED_COPYRIGHT_SEAL);
    next();
  });

  // One-time cached surface-level hardware profile & adaptive VRAM tier
  app.get('/api/system/hardware', async (_req, res) => {
    const profile = await initHardwareProfile();
    res.json({
      gpuName: profile.gpuName,
      vramGb: profile.vramGb,
      systemRamGb: profile.systemRamGb,
      tier: profile.tier,
      recommendedMaxParamsB: profile.recommendedMaxParamsB,
      defaultCtx: profile.defaultCtx
    });
  });

  // Real Server-Side Health, Provider, Latency & Copyright Integrity Endpoint
  app.get('/api/jarvis/health', async (req, res) => {
    const reqStart = Date.now();
    const host = typeof req.query.host === 'string' ? req.query.host : 'http://127.0.0.1:11434';
    const ollamaStatus = await checkLocalOllamaServer(host);
    if (ollamaStatus.reachable && (warmUpState.status === 'skipped' || warmUpState.status === 'idle')) {
      void warmUpLocalOllama(host);
    }
    const geminiAvailable = Boolean(process.env.GEMINI_API_KEY);
    const activeProvider = ollamaStatus.reachable
      ? 'ollama'
      : geminiAvailable
      ? 'gemini'
      : 'offline';
    const attribution = verifyServerAttribution();

    res.json({
      reachable: ollamaStatus.reachable,
      models: ollamaStatus.models,
      modelDetails: ollamaStatus.modelDetails,
      geminiAvailable,
      activeProvider,
      probeLatencyMs: ollamaStatus.reachable ? ollamaStatus.latencyMs : Math.max(1, Date.now() - reqStart),
      serverUptimeSec: Math.floor((Date.now() - SERVER_STARTED_AT) / 1000),
      warmUp: warmUpState,
      attribution
    });
  });

  // ============================================================================
  // In-App Ollama Model Manager Endpoints (Pull Stream + Delete)
  // ============================================================================

  app.post('/api/models/pull', async (req, res) => {
    const rawModel = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
    const rawHost = typeof req.body?.ollamaHost === 'string' ? req.body.ollamaHost : undefined;

    if (!isValidOllamaModelTag(rawModel)) {
      res.status(400).json({
        error: 'Provide a valid Ollama model tag (for example: qwen2.5:3b or gemma4).'
      });
      return;
    }

    const safeHost = resolveSafeOllamaHost(rawHost);
    if (!safeHost.ok) {
      res.status(400).json({ error: safeHost.error });
      return;
    }

    let clientClosed = false;
    const upstreamAbort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        clientClosed = true;
        upstreamAbort.abort();
      }
    });

    const connectTimer = setTimeout(() => {
      upstreamAbort.abort();
    }, 15000);

    try {
      const ollamaRes = await fetch(`${safeHost.host}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: rawModel, stream: true }),
        signal: upstreamAbort.signal
      });
      clearTimeout(connectTimer);

      if (!ollamaRes.ok) {
        let errMessage = `Ollama returned HTTP ${ollamaRes.status} while pulling "${rawModel}".`;
        try {
          const errJson: any = await ollamaRes.json();
          if (typeof errJson?.error === 'string' && errJson.error.trim()) {
            errMessage = errJson.error.trim();
          }
        } catch {
          // ignore non-json error
        }
        res.status(ollamaRes.status >= 400 && ollamaRes.status < 600 ? ollamaRes.status : 502).json({
          error: errMessage
        });
        return;
      }

      if (!ollamaRes.body) {
        res.status(502).json({ error: 'Ollama returned an empty pull stream.' });
        return;
      }

      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const writeLine = (payload: Record<string, unknown>) => {
        if (!clientClosed && !res.writableEnded) {
          res.write(`${JSON.stringify(payload)}\n`);
        }
      };

      const reader = ollamaRes.body.getReader();
      const decoder = new TextDecoder();
      let carry = '';
      let sawTerminal = false;

      while (!clientClosed) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunkText = decoder.decode(value, { stream: true });
        if (carry.length + chunkText.length > 262144) {
          carry = '';
        }
        const { events, remainder } = consumeOllamaPullNdjson(carry, chunkText);
        carry = remainder;

        for (const evt of events) {
          writeLine({
            status: evt.status,
            digest: evt.digest,
            completed: evt.completed,
            total: evt.total,
            percent: evt.percent,
            done: evt.done,
            error: evt.error
          });
          if (evt.done || evt.error) {
            sawTerminal = true;
          }
        }
      }

      if (!clientClosed && carry.trim()) {
        const { events } = consumeOllamaPullNdjson('', `${carry}\n`);
        for (const evt of events) {
          writeLine({
            status: evt.status,
            digest: evt.digest,
            completed: evt.completed,
            total: evt.total,
            percent: evt.percent,
            done: evt.done,
            error: evt.error
          });
          if (evt.done || evt.error) {
            sawTerminal = true;
          }
        }
      }

      reader.cancel().catch(() => {});

      if (!clientClosed && !res.writableEnded) {
        if (!sawTerminal) {
          writeLine({ status: 'success', percent: 100, done: true });
        }
        res.end();
      }
    } catch (err: any) {
      clearTimeout(connectTimer);
      if (clientClosed) return;
      const isAbort = err?.name === 'AbortError';
      const errMsg = isAbort
        ? 'Timed out connecting to local Ollama. Ensure Ollama is running and try again.'
        : 'Local AI Engine (Ollama) is not running. Launch Ollama and try again.';
      if (!res.headersSent) {
        res.status(503).json({ error: errMsg });
      } else if (!res.writableEnded) {
        res.write(`${JSON.stringify({ status: 'error', error: errMsg, done: true })}\n`);
        res.end();
      }
    }
  });

  app.delete('/api/models/delete', async (req, res) => {
    const rawModel = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
    const rawHost = typeof req.body?.ollamaHost === 'string' ? req.body.ollamaHost : undefined;

    if (!isValidOllamaModelTag(rawModel)) {
      res.status(400).json({ error: 'Provide a valid Ollama model tag to delete.' });
      return;
    }

    const safeHost = resolveSafeOllamaHost(rawHost);
    if (!safeHost.ok) {
      res.status(400).json({ error: safeHost.error });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const ollamaRes = await fetch(`${safeHost.host}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: rawModel }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!ollamaRes.ok) {
        let errMessage = `Could not delete model "${rawModel}" (HTTP ${ollamaRes.status}).`;
        try {
          const errJson: any = await ollamaRes.json();
          if (typeof errJson?.error === 'string' && errJson.error.trim()) {
            errMessage = errJson.error.trim();
          }
        } catch {
          // ignore non-json error
        }
        res.status(ollamaRes.status >= 400 && ollamaRes.status < 600 ? ollamaRes.status : 502).json({
          error: errMessage
        });
        return;
      }

      res.json({ deleted: true, model: rawModel });
    } catch {
      clearTimeout(timeout);
      res.status(503).json({
        error: 'Local AI Engine (Ollama) is not running. Launch Ollama before deleting models.'
      });
    }
  });

  // Streaming Chat Endpoint (Local Ollama -> Gemini Cloud via SSE with real latency & abort handling)
  app.post('/api/jarvis/chat', async (req, res) => {
    let clientClosed = false;
    const upstreamAbort = new AbortController();

    // IMPORTANT: In Node.js 18+, `req` emits 'close' as soon as express.json() finishes
    // consuming the POST body. Listen on `res` and check `!res.writableEnded` so we only
    // abort when the client actually disconnects mid-stream (e.g. clicking Stop).
    res.on('close', () => {
      if (!res.writableEnded) {
        clientClosed = true;
        upstreamAbort.abort();
      }
    });

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
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const requestStart = Date.now();

      const writeEvent = (payload: Record<string, unknown>) => {
        if (!clientClosed && !res.writableEnded) {
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
      };

      const endStream = () => {
        if (!clientClosed && !res.writableEnded) {
          res.write('data: [DONE]\n\n');
          res.end();
        }
      };

      // 1. Try local Ollama first (fast /api/tags probe, then generous model-load + stall watchdogs)
      const cleanHost = (ollamaHost || 'http://127.0.0.1:11434')
        .replace(/\/+$/, '')
        .replace('localhost', '127.0.0.1');

      const ollamaProbe = await checkLocalOllamaServer(cleanHost);
      if (ollamaProbe.reachable && !clientClosed) {
        const hardware = getCachedHardwareProfile();
        const requestedModel =
          typeof modelName === 'string' && modelName.trim().toLowerCase() === 'auto'
            ? selectBestModelForTier(ollamaProbe.models, {
                hardware,
                preferredDefault: 'qwen2.5:3b',
                allowUnfitFallback: true
              }) || 'qwen2.5:3b'
            : modelName;
        const effectiveModel = resolveAvailableOllamaModel(
          requestedModel,
          ollamaProbe.models,
          'qwen2.5:3b'
        );

        // Immediately notify client which model is loading/swapping into VRAM and keep SSE alive
        if (!res.writableEnded) {
          res.write(': ollama-stream-init\n\n');
          writeEvent({
            status: {
              phase: 'loading_model',
              provider: 'ollama',
              model: effectiveModel
            }
          });
        }

        const ollamaAbort = new AbortController();
        const onUpstreamAbort = () => ollamaAbort.abort();
        upstreamAbort.signal.addEventListener('abort', onUpstreamAbort, { once: true });

        // 90s timeout for cold-loading 7B models into RAM/VRAM; tightened to 45s per chunk once streaming
        let timedOutReason: string | null = null;
        let stallTimer = setTimeout(() => {
          timedOutReason = `Local Ollama timed out waiting for "${effectiveModel}" to start generating (90s). Check available RAM/VRAM or switch to a smaller model like qwen2.5:3b.`;
          ollamaAbort.abort();
        }, 90000);

        const resetChunkWatchdog = () => {
          clearTimeout(stallTimer);
          stallTimer = setTimeout(() => {
            timedOutReason = `Local Ollama stalled mid-response on "${effectiveModel}" (no tokens for 45s).`;
            ollamaAbort.abort();
          }, 45000);
        };

        try {
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
              model: effectiveModel,
              messages: ollamaMessages,
              stream: true,
              keep_alive: `${keepAliveMinutes}m`,
              options: {
                temperature: Number(temperature) || 0.7,
                num_ctx: resolveChatOllamaNumCtx(effectiveModel, hardware),
                num_predict: -1
              }
            }),
            signal: ollamaAbort.signal
          });

          if (!ollamaRes.ok) {
            let errBody = '';
            try {
              const errJson: any = await ollamaRes.json();
              errBody = errJson?.error || '';
            } catch {
              // ignore non-json error body
            }
            clearTimeout(stallTimer);
            upstreamAbort.signal.removeEventListener('abort', onUpstreamAbort);
            if (!getAiClient()) {
              writeEvent({
                error:
                  errBody ||
                  `Ollama returned HTTP ${ollamaRes.status} for model "${effectiveModel}". Run "ollama list" to confirm it is installed.`
              });
              endStream();
              return;
            }
          } else if (ollamaRes.body) {
            const reader = ollamaRes.body.getReader();
            const decoder = new TextDecoder();
            let ndjsonCarry = '';
            let hasOutput = false;
            let ttftMs: number | null = null;
            let totalChars = 0;
            let streamDone = false;
            let doneReason: string | undefined;
            let ollamaErr: string | null = null;

            while (!clientClosed && !streamDone) {
              const { done, value } = await reader.read();
              if (done) break;
              resetChunkWatchdog();

              const chunkText = decoder.decode(value, { stream: true });
              const { events, remainder } = consumeOllamaNdjson(ndjsonCarry, chunkText);
              ndjsonCarry = remainder;

              for (const evt of events) {
                if (evt.error) {
                  ollamaErr = evt.error;
                  streamDone = true;
                  break;
                }
                if (evt.text) {
                  if (!hasOutput) {
                    hasOutput = true;
                    ttftMs = Math.max(1, Date.now() - requestStart);
                    writeEvent({
                      meta: {
                        provider: 'ollama',
                        model: effectiveModel,
                        ttftMs
                      }
                    });
                  }
                  totalChars += evt.text.length;
                  writeEvent({ text: evt.text });
                }
                if (evt.doneReason) {
                  doneReason = evt.doneReason;
                }
                if (evt.done) {
                  streamDone = true;
                  break;
                }
              }
            }

            // Flush any final line without trailing newline
            if (!clientClosed && !streamDone && ndjsonCarry.trim()) {
              const { events } = consumeOllamaNdjson('', ndjsonCarry + '\n');
              for (const evt of events) {
                if (evt.error) {
                  ollamaErr = evt.error;
                } else {
                  if (evt.text) {
                    if (!hasOutput) {
                      hasOutput = true;
                      ttftMs = Math.max(1, Date.now() - requestStart);
                      writeEvent({
                        meta: { provider: 'ollama', model: effectiveModel, ttftMs }
                      });
                    }
                    totalChars += evt.text.length;
                    writeEvent({ text: evt.text });
                  }
                  if (evt.doneReason) {
                    doneReason = evt.doneReason;
                  }
                }
              }
            }

            clearTimeout(stallTimer);
            upstreamAbort.signal.removeEventListener('abort', onUpstreamAbort);
            reader.cancel().catch(() => {});

            if (clientClosed) return;

            if (ollamaErr) {
              writeEvent({ error: `Local Ollama error (${effectiveModel}): ${ollamaErr}` });
              endStream();
              return;
            }

            if (hasOutput) {
              const elapsedMs = Math.max(1, Date.now() - requestStart);
              const approxTokens = Math.max(1, Math.round(totalChars / 4));
              const tokensPerSec = Number((approxTokens / (elapsedMs / 1000)).toFixed(1));
              writeEvent({
                stats: {
                  provider: 'ollama',
                  model: effectiveModel,
                  ttftMs: ttftMs ?? elapsedMs,
                  elapsedMs,
                  tokensPerSec,
                  doneReason: doneReason || 'stop'
                }
              });
              endStream();
              return;
            }
          }
        } catch (err: any) {
          clearTimeout(stallTimer);
          upstreamAbort.signal.removeEventListener('abort', onUpstreamAbort);
          if (clientClosed) return;
          const failureReason =
            timedOutReason ||
            `Local Ollama request failed for "${effectiveModel}": ${err?.message || 'stream interrupted'}`;
          if (!getAiClient()) {
            writeEvent({ error: failureReason });
            endStream();
            return;
          }
          // Otherwise fall through to Gemini Cloud if configured
        }
      }

      // 2. Stream via Gemini Cloud (gemini-4-hydrogen)
      const ai = getAiClient();
      if (!ai) {
        writeEvent({
          error:
            'Local Ollama is offline and no cloud Gemini API key is configured. Start Ollama locally or configure GEMINI_API_KEY in Settings > Secrets.'
        });
        endStream();
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

      writeEvent({
        status: {
          phase: 'loading_model',
          provider: 'gemini',
          model: GEMINI_DEFAULT_MODEL
        }
      });

      const geminiStart = Date.now();
      const responseStream = await ai.models.generateContentStream({
        model: GEMINI_DEFAULT_MODEL,
        contents,
        config: {
          systemInstruction:
            (systemInstruction ? `${systemInstruction}\n\n` : '') +
            `You are J.A.R.V.I.S (preferred route: ${modelName}), a sharp, concise, and technically accurate personal AI assistant. Answer the user request directly using clear Markdown formatting (headings, lists, tables, and language-tagged fenced code blocks when helpful). When asked for code in a specific language, provide complete, working code in that exact language.`
        }
      });

      let ttftMs: number | null = null;
      let totalChars = 0;
      let geminiDoneReason = 'stop';

      for await (const chunk of responseStream) {
        if (clientClosed) break;
        const c = chunk as GenerateContentResponse;
        const finishReason = c.candidates?.[0]?.finishReason;
        if (typeof finishReason === 'string' && finishReason.toUpperCase().includes('MAX_TOKENS')) {
          geminiDoneReason = 'length';
        }
        const text = c.text;
        if (text) {
          if (ttftMs === null) {
            ttftMs = Math.max(1, Date.now() - geminiStart);
            writeEvent({
              meta: {
                provider: 'gemini',
                model: GEMINI_DEFAULT_MODEL,
                ttftMs
              }
            });
          }
          totalChars += text.length;
          writeEvent({ text });
        }
      }

      if (clientClosed) return;

      const elapsedMs = Math.max(1, Date.now() - geminiStart);
      const approxTokens = Math.max(1, Math.round(totalChars / 4));
      const tokensPerSec = Number((approxTokens / (elapsedMs / 1000)).toFixed(1));
      writeEvent({
        stats: {
          provider: 'gemini',
          model: GEMINI_DEFAULT_MODEL,
          ttftMs: ttftMs ?? elapsedMs,
          elapsedMs,
          tokensPerSec,
          doneReason: geminiDoneReason
        }
      });

      endStream();
    } catch (error: any) {
      if (clientClosed) return;
      console.error('Chat stream error:', error);
      const errMsg = error?.message || 'Failed to generate response from AI engine.';
      if (!res.headersSent) {
        res.status(500).json({ error: errMsg });
      } else {
        res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
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

      // 2. Gemini Cloud Vision (gemini-4-hydrogen)
      const ai = getAiClient();
      if (!ai) {
        res.status(200).json({ summary: null, fallback: true });
        return;
      }

      const response: GenerateContentResponse = await ai.models.generateContent({
        model: GEMINI_DEFAULT_MODEL,
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

  // ============================================================================
  // Xfill Document Auto-Fill Endpoints (DOCX / XLSX / PPTX)
  // ============================================================================

  app.post('/api/jarvis/xfill/inspect', async (req, res) => {
    try {
      const { fileName, fileBase64 } = req.body || {};
      if (!fileName || typeof fileName !== 'string' || !fileBase64 || typeof fileBase64 !== 'string') {
        res.status(400).json({ error: 'fileName and fileBase64 are required.' });
        return;
      }
      const buffer = Buffer.from(fileBase64, 'base64');
      if (buffer.length > 12 * 1024 * 1024) {
        res.status(413).json({ error: 'File exceeds the 12 MB limit.' });
        return;
      }
      const inspected = await inspectAndCacheDocument(fileName, buffer);
      res.json(inspected);
    } catch (error: any) {
      console.error('Xfill inspect error:', error);
      res.status(400).json({ error: error?.message || 'Could not parse the uploaded document.' });
    }
  });

  app.get('/api/jarvis/xfill/sample', async (req, res) => {
    try {
      const rawType = typeof req.query.type === 'string' ? req.query.type.toLowerCase() : 'docx';
      const type: XfillFileType =
        rawType === 'xlsx' || rawType === 'pptx' ? rawType : 'docx';
      const sample = await generateSampleDocument(type);
      const inspected = await inspectAndCacheDocument(sample.fileName, sample.buffer);
      res.json(inspected);
    } catch (error: any) {
      console.error('Xfill sample error:', error);
      res.status(500).json({ error: error?.message || 'Failed to generate sample document.' });
    }
  });

  app.post('/api/jarvis/xfill/solve', async (req, res) => {
    try {
      const {
        docId,
        slotIds,
        memory = {},
        contextNotes = '',
        strictGrounding = false,
        answerStyle = 'concise',
        customInstructions = '',
        modelName = 'vai-doc:latest',
        ollamaHost = 'http://127.0.0.1:11434',
        keepAliveMinutes = 30
      } = req.body || {};

      if (!docId || typeof docId !== 'string') {
        res.status(400).json({ error: 'docId is required.' });
        return;
      }

      const solved = await solveDocumentSlots(
        docId,
        {
          memory,
          contextNotes,
          strictGrounding: Boolean(strictGrounding),
          answerStyle:
            answerStyle === 'detailed' || answerStyle === 'bullets' ? answerStyle : 'concise',
          customInstructions,
          modelName,
          ollamaHost,
          keepAliveMinutes: Number(keepAliveMinutes) || 30,
          slotIds: Array.isArray(slotIds) ? slotIds : undefined
        },
        getAiClient()
      );

      res.json(solved);
    } catch (error: any) {
      console.error('Xfill solve error:', error);
      res.status(500).json({ error: error?.message || 'Failed to solve document fields.' });
    }
  });

  app.post('/api/jarvis/xfill/export', async (req, res) => {
    try {
      const { docId, answers = {} } = req.body || {};
      if (!docId || typeof docId !== 'string') {
        res.status(400).json({ error: 'docId is required.' });
        return;
      }

      const exported = await exportFilledDocument(docId, answers);
      res.setHeader('Content-Type', exported.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${exported.fileName.replace(/"/g, '')}"`
      );
      res.send(exported.buffer);
    } catch (error: any) {
      console.error('Xfill export error:', error);
      res.status(400).json({ error: error?.message || 'Failed to export updated document.' });
    }
  });

  // ============================================================================
  // Slides PPT Generator Endpoints (Local Ollama -> Gemini Cloud + Consent Web Images)
  // ============================================================================

  app.post('/api/jarvis/slides/generate', async (req, res) => {
    try {
      const {
        topic = '',
        slideCount = 8,
        audience = 'executive',
        themeId = 'obsidian-orange',
        contextNotes = '',
        includeMemory = false,
        memory = {},
        modelName = 'vai-doc:latest',
        ollamaHost = 'http://127.0.0.1:11434',
        keepAliveMinutes = 30
      } = req.body || {};

      if (!topic || typeof topic !== 'string' || !topic.trim()) {
        res.status(400).json({ error: 'Presentation topic is required.' });
        return;
      }

      const result = await generateSlideDeck(
        {
          topic: topic.trim(),
          slideCount: Number(slideCount) || 8,
          audience:
            audience === 'technical' || audience === 'educational' || audience === 'pitch'
              ? audience
              : 'executive',
          themeId,
          contextNotes: typeof contextNotes === 'string' ? contextNotes : '',
          includeMemory: Boolean(includeMemory),
          memory: memory && typeof memory === 'object' ? memory : {},
          modelName,
          ollamaHost,
          keepAliveMinutes: Number(keepAliveMinutes) || 30
        },
        getAiClient()
      );

      res.json(result);
    } catch (error: any) {
      console.error('Slides generate error:', error);
      res.status(500).json({ error: error?.message || 'Failed to generate presentation deck.' });
    }
  });

  app.post('/api/jarvis/slides/regenerate-slide', async (req, res) => {
    try {
      const {
        deckTitle = '',
        topic = '',
        audience = 'executive',
        slide,
        slideIndex = 0,
        totalSlides = 1,
        instruction = '',
        contextNotes = '',
        modelName = 'vai-doc:latest',
        ollamaHost = 'http://127.0.0.1:11434',
        keepAliveMinutes = 30
      } = req.body || {};

      if (!slide || typeof slide !== 'object') {
        res.status(400).json({ error: 'slide object is required.' });
        return;
      }

      const result = await regenerateSingleSlide(
        {
          deckTitle,
          topic,
          audience,
          slide,
          slideIndex: Number(slideIndex) || 0,
          totalSlides: Number(totalSlides) || 1,
          instruction,
          contextNotes,
          modelName,
          ollamaHost,
          keepAliveMinutes: Number(keepAliveMinutes) || 30
        },
        getAiClient()
      );

      res.json(result);
    } catch (error: any) {
      console.error('Slides regenerate error:', error);
      res.status(500).json({ error: error?.message || 'Failed to regenerate slide.' });
    }
  });

  app.post('/api/jarvis/slides/image-search', async (req, res) => {
    try {
      const { query = '', consentGranted = false, limit = 6 } = req.body || {};
      if (!consentGranted) {
        res.status(403).json({
          error: 'Explicit user consent is required before accessing web image search.'
        });
        return;
      }
      if (!query || typeof query !== 'string' || !query.trim()) {
        res.status(400).json({ error: 'Search query is required.' });
        return;
      }

      const images = await searchWebImages(query.trim(), true, Math.min(10, Number(limit) || 6));
      res.json({ images });
    } catch (error: any) {
      const code = error?.statusCode === 403 ? 403 : 500;
      console.error('Slides image search error:', error);
      res.status(code).json({ error: error?.message || 'Web image search failed.' });
    }
  });

  app.post('/api/jarvis/slides/export', async (req, res) => {
    try {
      const { deck } = req.body || {};
      if (!deck || !Array.isArray(deck.slides) || deck.slides.length === 0) {
        res.status(400).json({ error: 'A valid slide deck with at least one slide is required.' });
        return;
      }

      const exported = await exportDeckToPptx(deck);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${exported.fileName.replace(/"/g, '')}"`
      );
      res.setHeader('X-Embedded-Images', String(exported.embeddedImages));
      res.send(exported.buffer);
    } catch (error: any) {
      console.error('Slides export error:', error);
      res.status(500).json({ error: error?.message || 'Failed to compile PowerPoint file.' });
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

  const parsedPort = Number(process.env.PORT);
  const PORT = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536 ? parsedPort : 3000;
  const bootAttribution = verifyServerAttribution();
  const bootHardware = await initHardwareProfile();
  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`J.A.R.V.I.S server running on http://0.0.0.0:${PORT}`);
    console.log(
      `[Hardware] ${formatHardwareReadout(bootHardware)} · maxParams<=${bootHardware.recommendedMaxParamsB}B · defaultCtx=${bootHardware.defaultCtx}`
    );
    console.log(
      `[Attribution] ${bootAttribution.short} · Seal ${bootAttribution.seal} · ${
        bootAttribution.verified ? 'VERIFIED' : 'INTEGRITY WARNING (LICENSE/NOTICE modified)'
      }`
    );
    void warmUpLocalOllama();
  });

  const gracefulShutdown = () => {
    httpServer.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.once('SIGTERM', gracefulShutdown);
  process.once('SIGINT', gracefulShutdown);
}

startServer();
