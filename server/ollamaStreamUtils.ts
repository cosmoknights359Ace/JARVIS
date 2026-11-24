/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 cosmoknight — J.A.R.V.I.S Ollama NDJSON Stream Parser
 *
 * Stateful chunk parser for Ollama `/api/chat` streaming responses.
 * Prevents dropped tokens on TCP packet splits, detects `done: true` cleanly,
 * and surfaces Ollama server errors instead of hanging forever.
 */

export interface OllamaNdjsonChunk {
  text?: string;
  done?: boolean;
  error?: string;
}

export function consumeOllamaNdjson(
  carryBuffer: string,
  incomingText: string
): { events: OllamaNdjsonChunk[]; remainder: string } {
  const combined = carryBuffer + incomingText;
  const lines = combined.split('\n');
  const remainder = lines.pop() ?? '';
  const events: OllamaNdjsonChunk[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed?.error === 'string' && parsed.error.trim()) {
        events.push({ error: parsed.error.trim() });
        continue;
      }
      const text =
        typeof parsed?.message?.content === 'string' ? parsed.message.content : undefined;
      const done = Boolean(parsed?.done);
      if (text || done) {
        events.push({ text, done });
      }
    } catch {
      // Ignore malformed/corrupt single line without stalling the stream
    }
  }

  return { events, remainder };
}

const OLLAMA_PARAM_SIZE_REGEX = /(?:^|[:\-_.\s])(\d+(?:\.\d+)?)b(?=$|[:\-_.\s])/i;

/**
 * Detects 7B, 8B, or larger local models from an Ollama tag name.
 */
export function isHeavyOllamaModel(modelName: string): boolean {
  if (typeof modelName !== 'string' || !modelName.trim()) return false;
  const match = modelName.trim().match(OLLAMA_PARAM_SIZE_REGEX);
  if (!match) return false;
  const billions = parseFloat(match[1]);
  return Number.isFinite(billions) && billions >= 7;
}

/**
 * 4 GB VRAM guardrail: automatically caps Ollama `options.num_ctx` to 2048
 * whenever a 7B, 8B, or larger model is selected, while preserving the
 * requested context window (e.g., 4096) for 3B and smaller models.
 */
export function resolveOllamaNumCtx(modelName: string, defaultCtx = 4096): number {
  const safeDefault = Number.isFinite(defaultCtx) && defaultCtx > 0 ? Math.round(defaultCtx) : 4096;
  if (isHeavyOllamaModel(modelName)) {
    return Math.min(safeDefault, 2048);
  }
  return safeDefault;
}

/**
 * Selects the lightweight default 3B model to silently warm up on server boot.
 * Never picks heavy >=7B, vision, or embedding models.
 */
export function pickWarmUpModel(
  installedModels: string[],
  preferredDefault = 'qwen2.5:3b'
): string | null {
  if (!Array.isArray(installedModels) || installedModels.length === 0) {
    return null;
  }

  const normalized = installedModels.map((m) => String(m || '').trim()).filter(Boolean);
  const prefLower = preferredDefault.trim().toLowerCase();

  // 1. Exact or tag-prefix match on the preferred default 3B model
  const exact = normalized.find((m) => m.toLowerCase() === prefLower);
  if (exact) return exact;

  const prefBase = prefLower.split(':')[0];
  const baseMatch = normalized.find(
    (m) => m.toLowerCase().startsWith(`${prefBase}:`) && !isHeavyOllamaModel(m)
  );
  if (baseMatch) return baseMatch;

  // 2. Any installed non-heavy, non-vision, non-embedding chat model
  const smallFallback = normalized.find(
    (m) =>
      !isHeavyOllamaModel(m) &&
      !/vision|embed|minilm|nomic|bge|mxbai/i.test(m)
  );
  return smallFallback || null;
}

