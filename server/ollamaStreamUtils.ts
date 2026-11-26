/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 cosmoknight — J.A.R.V.I.S Ollama NDJSON Stream Parser
 *
 * Stateful chunk parser for Ollama `/api/chat` streaming responses.
 * Prevents dropped tokens on TCP packet splits, detects `done: true` cleanly,
 * and surfaces Ollama server errors instead of hanging forever.
 */

import {
  HardwareProfile,
  parseModelParamsB,
  resolveTierNumCtx,
  selectBestModelForTier
} from '../src/utils/hardwareTier.ts';

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

/**
 * Detects 7B, 8B, or larger local models from an Ollama tag name.
 */
export function isHeavyOllamaModel(modelName: string): boolean {
  const billions = parseModelParamsB(modelName);
  return billions !== null && billions >= 7;
}

/**
 * Studio / legacy VRAM guardrail for Ollama `options.num_ctx`:
 * - When `hardware` is supplied, uses dynamic tier rules capped by `defaultCtx`.
 * - Preserves existing 2-arg/3-arg behavior for studio engines (Xfill/Xslide).
 */
export function resolveOllamaNumCtx(
  modelName: string,
  defaultCtx = 4096,
  heavyCap = 2048,
  hardware?: HardwareProfile | null
): number {
  const safeDefault = Number.isFinite(defaultCtx) && defaultCtx > 0 ? Math.round(defaultCtx) : 4096;
  if (hardware) {
    return resolveTierNumCtx(modelName, hardware);
  }
  const safeHeavyCap = Number.isFinite(heavyCap) && heavyCap > 0 ? Math.round(heavyCap) : 2048;
  if (isHeavyOllamaModel(modelName)) {
    return Math.min(safeDefault, safeHeavyCap);
  }
  return safeDefault;
}

/**
 * Dynamic chat context window tuning driven by the detected hardware VRAM tier:
 * - Tier 1 (< 4 GB): 2048 for <= 3B, 1024 for 7B+
 * - Tier 2 (4-8 GB): 4096 for <= 4B, 3072 for 7B-8B
 * - Tier 3 (8-16 GB): 8192 for <= 8B, 4096 for 13B-14B
 * - Tier 4 (>= 16 GB): 16384 for <= 14B, 8192 for 20B+
 */
export function resolveChatOllamaNumCtx(
  modelName: string,
  hardware?: HardwareProfile | null
): number {
  return resolveTierNumCtx(modelName, hardware);
}

/**
 * Selects the highest-capability installed chat model that fits comfortably
 * inside the detected hardware tier's `recommendedMaxParamsB` for startup warm-up.
 * Never warms vision/embedding models or models exceeding the tier limit.
 */
export function pickWarmUpModel(
  installedModels: string[],
  preferredDefault = 'qwen2.5:3b',
  hardware?: HardwareProfile | null
): string | null {
  return selectBestModelForTier(installedModels, {
    hardware,
    preferCoding: false,
    preferredDefault,
    allowUnfitFallback: false
  });
}

