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
