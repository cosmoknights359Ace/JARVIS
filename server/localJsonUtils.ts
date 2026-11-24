/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 cosmoknight — J.A.R.V.I.S Local Model & JSON Utilities
 *
 * Pure, testable helpers for local Ollama / fine-tuned GGUF models (e.g. vai-doc:latest):
 * - Resilient JSON extraction (handles markdown code fences or stray wrapper text)
 * - Missing-fact detection (maps "I don't know." / "[NEEDS INPUT]" cleanly)
 * - Installed-model tag resolution with graceful local fallback
 */

export const DEFAULT_STUDIO_MODEL = 'vai-doc:latest';
export const DEFAULT_STUDIO_NUM_CTX = 8192;

/**
 * Extracts and parses the primary JSON object or array from a local LLM response.
 * Handles raw JSON, ```json fenced blocks, or JSON surrounded by minor prose.
 */
export function extractJsonPayload(raw: string): any | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. Direct parse fast-path
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue to extraction heuristics
  }

  // 2. Strip ```json ... ``` or ``` ... ``` fenced block if present
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // continue
    }
  }

  // 3. Balanced top-level JSON object or array scan
  const firstObj = trimmed.indexOf('{');
  const firstArr = trimmed.indexOf('[');
  let startIdx = -1;
  let openChar = '{';
  let closeChar = '}';

  if (firstObj !== -1 && (firstArr === -1 || firstObj < firstArr)) {
    startIdx = firstObj;
    openChar = '{';
    closeChar = '}';
  } else if (firstArr !== -1) {
    startIdx = firstArr;
    openChar = '[';
    closeChar = ']';
  }

  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        const candidate = trimmed.slice(startIdx, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

/**
 * Returns true when an Xfill answer indicates missing/ungrounded information
 * (including "[NEEDS INPUT]" and vai-doc's tuned "I don't know." response).
 */
export function isMissingFieldAnswer(answer: string): boolean {
  const normalized = String(answer || '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();

  if (!normalized) return true;
  if (/\[needs input\]/i.test(normalized)) return true;

  const exactMissingPatterns = [
    /^i\s+don['’]?t\s+know\.?!*$/i,
    /^i\s+do\s+not\s+know\.?!*$/i,
    /^unknown\.?$/i,
    /^n\/a\.?$/i,
    /^none\s+provided\.?$/i,
    /^not\s+(?:provided|specified|available|found|mentioned)(?:\s+in(?:\s+the)?\s+(?:context|document|memory|notes))?\.?$/i,
    /^missing(?:\s+data|\s+information)?\.?$/i,
    /^cannot\s+be\s+determined(?:\s+from(?:\s+the)?\s+context)?\.?$/i
  ];

  return exactMissingPatterns.some((re) => re.test(normalized));
}

/**
 * Resolves the requested Ollama model against the server's installed model list.
 * - Prefers exact match or implicit `:latest` match for `preferredModel`.
 * - If `installedModels` is non-empty and `preferredModel` isn't installed yet,
 *   falls back to `fallbackModel` (if installed) so local Ollama still works smoothly.
 */
export function resolveAvailableOllamaModel(
  preferredModel: string,
  installedModels: string[],
  fallbackModel = 'qwen2.5:3b'
): string {
  const requested = (preferredModel || DEFAULT_STUDIO_MODEL).trim();
  if (!Array.isArray(installedModels) || installedModels.length === 0) {
    return requested;
  }

  const findMatch = (target: string): string | null => {
    const clean = target.trim();
    if (!clean) return null;
    const exact = installedModels.find((m) => m === clean);
    if (exact) return exact;

    const lower = clean.toLowerCase();
    const ciExact = installedModels.find((m) => m.toLowerCase() === lower);
    if (ciExact) return ciExact;

    const base = lower.endsWith(':latest') ? lower.slice(0, -7) : lower;
    const withLatest = `${base}:latest`;
    const tagMatch = installedModels.find((m) => {
      const ml = m.toLowerCase();
      return ml === base || ml === withLatest;
    });
    return tagMatch || null;
  };

  const direct = findMatch(requested);
  if (direct) return direct;

  const fallback = findMatch(fallbackModel);
  if (fallback) return fallback;

  const installedChatModel = installedModels.find(
    (m) => !/(embed|vision|llava|moondream|bakllava)/i.test(m)
  );
  return installedChatModel || installedModels[0] || requested;
}
