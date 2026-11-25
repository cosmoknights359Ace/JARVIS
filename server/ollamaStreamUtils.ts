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
  doneReason?: string;
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
      const doneReason =
        typeof parsed?.done_reason === 'string' && parsed.done_reason.trim()
          ? parsed.done_reason.trim()
          : undefined;
      if (text || done || doneReason) {
        const chunk: OllamaNdjsonChunk = { text, done };
        if (doneReason) {
          chunk.doneReason = doneReason;
        }
        events.push(chunk);
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
 * VRAM guardrail for Ollama `options.num_ctx`:
 * - Caps 7B, 8B, or larger models to `heavyCap` (default 2048 for studio engines;
 *   chat passes 3072 via `resolveChatOllamaNumCtx`) while preserving `defaultCtx`
 *   (e.g., 4096) for 3B and smaller models.
 */
export function resolveOllamaNumCtx(
  modelName: string,
  defaultCtx = 4096,
  heavyCap = 2048
): number {
  const safeDefault = Number.isFinite(defaultCtx) && defaultCtx > 0 ? Math.round(defaultCtx) : 4096;
  const safeHeavyCap = Number.isFinite(heavyCap) && heavyCap > 0 ? Math.round(heavyCap) : 2048;
  if (isHeavyOllamaModel(modelName)) {
    return Math.min(safeDefault, safeHeavyCap);
  }
  return safeDefault;
}

/**
 * Chat-specific context window tuning:
 * - 3072 tokens for 7B/8B+ models (prevents mid-sentence cutoffs on long code + explanation)
 * - 4096 tokens for 3B and smaller models
 */
export function resolveChatOllamaNumCtx(modelName: string): number {
  return resolveOllamaNumCtx(modelName, 4096, 3072);
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

