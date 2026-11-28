/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 cosmoknight — J.A.R.V.I.S Model Manager & Starter Prompts Utilities
 *
 * Pure, runtime-agnostic helpers for Ollama model tag validation, pull-stream
 * NDJSON progress parsing, byte formatting, curated model catalog, and empty-chat
 * starter prompts.
 */

export interface RecommendedModelSpec {
  tag: string;
  title: string;
  approxSize: string;
  role: 'General' | 'Coding' | 'Reasoning';
  summary: string;
}

export interface StarterPromptChip {
  id: string;
  title: string;
  description: string;
  prompt: string;
}

export interface OllamaPullProgressEvent {
  status: string;
  digest?: string;
  completed?: number;
  total?: number;
  percent: number | null;
  done: boolean;
  error?: string;
}

export const MANAGE_MODELS_SELECT_VALUE = '__manage_models__';

export const RECOMMENDED_OLLAMA_MODELS: RecommendedModelSpec[] = [
  {
    tag: 'qwen2.5:3b',
    title: 'Qwen 2.5 3B',
    approxSize: '1.9 GB',
    role: 'General',
    summary: 'Fast, low-VRAM daily assistant for chat, summaries, and quick answers.'
  },
  {
    tag: 'qwen2.5-coder:3b',
    title: 'Qwen 2.5 Coder 3B',
    approxSize: '1.9 GB',
    role: 'Coding',
    summary: 'Lightweight code generation, refactoring, and debugging for entry GPUs.'
  },
  {
    tag: 'qwen2.5-coder:7b',
    title: 'Qwen 2.5 Coder 7B',
    approxSize: '4.7 GB',
    role: 'Coding',
    summary: 'High-accuracy multi-language coding, architecture, and bug analysis.'
  },
  {
    tag: 'llama3.2:3b',
    title: 'Llama 3.2 3B',
    approxSize: '2.0 GB',
    role: 'General',
    summary: 'Balanced instruction-following assistant from Meta with crisp prose.'
  },
  {
    tag: 'qwen2.5:14b',
    title: 'Qwen 2.5 14B',
    approxSize: '9.0 GB',
    role: 'Reasoning',
    summary: 'Deep technical reasoning and long-form analysis for 8 GB+ VRAM systems.'
  }
];

export const STARTER_PROMPTS: StarterPromptChip[] = [
  {
    id: 'debug-code',
    title: 'Debug & Fix Code',
    description: 'Find bugs and optimize a code snippet I paste.',
    prompt: 'Find bugs and optimize this code snippet:\n\n'
  },
  {
    id: 'explain-simply',
    title: 'Explain Simply',
    description: 'Explain a complex CS or AI topic in simple terms.',
    prompt: 'Explain this CS or AI topic in simple terms: '
  },
  {
    id: 'quick-script',
    title: 'Quick Script',
    description: 'Write a clean Python or Java utility script.',
    prompt: 'Write a clean Python or Java utility script that '
  },
  {
    id: 'use-memory',
    title: 'Use My Memory',
    description: 'Show what you remember about my current projects.',
    prompt: 'Show what you remember about my current projects.'
  }
];

const OLLAMA_MODEL_TAG_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,127}$/;

/**
 * Validates an Ollama model tag (e.g., `qwen2.5:3b`, `gemma4`, `hf.co/org/model:Q4_K_M`).
 * Rejects empty strings, whitespace, traversal segments, and query/fragment chars.
 */
export function isValidOllamaModelTag(model: string): boolean {
  if (typeof model !== 'string') return false;
  const trimmed = model.trim();
  if (!trimmed || trimmed.length > 128) return false;
  if (trimmed.includes('..') || trimmed.includes('//') || trimmed.startsWith('/') || trimmed.endsWith('/')) {
    return false;
  }
  return OLLAMA_MODEL_TAG_REGEX.test(trimmed);
}

/**
 * Normalizes an Ollama model tag for installed-list comparison (`gemma4` matches `gemma4:latest`).
 */
export function normalizeModelTagForMatch(tag: string): string {
  const clean = (tag || '').trim().toLowerCase();
  if (!clean) return '';
  return clean.includes(':') ? clean : `${clean}:latest`;
}

/**
 * Checks whether a target model tag is already present in the installed Ollama models list.
 */
export function isModelTagInstalled(tag: string, installedModels: string[]): boolean {
  const targetNorm = normalizeModelTagForMatch(tag);
  if (!targetNorm || !Array.isArray(installedModels)) return false;
  return installedModels.some((installed) => normalizeModelTagForMatch(installed) === targetNorm);
}

/**
 * Formats byte counts into compact human-readable strings (`1.9 GB`, `512 MB`, `—`).
 */
export function formatModelSizeBytes(bytes?: number | null): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    return '—';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let unitIdx = 0;
  while (val >= 1024 && unitIdx < units.length - 1) {
    val /= 1024;
    unitIdx++;
  }
  if (unitIdx >= 3) {
    return `${val.toFixed(1)} ${units[unitIdx]}`;
  }
  if (unitIdx === 2) {
    return `${Math.round(val)} ${units[unitIdx]}`;
  }
  return `${Math.round(val)} ${units[unitIdx]}`;
}

/**
 * Computes a clamped 0..100 integer progress percentage from completed/total bytes.
 */
export function computePullPercent(completed?: number, total?: number): number | null {
  if (
    typeof completed !== 'number' ||
    typeof total !== 'number' ||
    !Number.isFinite(completed) ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return null;
  }
  const pct = Math.round((Math.max(0, completed) / total) * 100);
  return Math.max(0, Math.min(100, pct));
}

/**
 * Stateful parser for Ollama `/api/pull` NDJSON (and optional `data: ` SSE) progress streams.
 */
export function consumeOllamaPullNdjson(
  carryBuffer: string,
  incomingText: string
): { events: OllamaPullProgressEvent[]; remainder: string } {
  const combined = carryBuffer + incomingText;
  const lines = combined.split('\n');
  const remainder = lines.pop() ?? '';
  const events: OllamaPullProgressEvent[] = [];

  for (const rawLine of lines) {
    let trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('data:')) {
      trimmed = trimmed.slice(5).trim();
    }
    if (!trimmed || trimmed === '[DONE]') continue;

    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed?.error === 'string' && parsed.error.trim()) {
        events.push({
          status: 'error',
          percent: null,
          done: true,
          error: parsed.error.trim()
        });
        continue;
      }

      const status =
        typeof parsed?.status === 'string' && parsed.status.trim()
          ? parsed.status.trim()
          : 'Pulling model...';
      const completed =
        typeof parsed?.completed === 'number' && Number.isFinite(parsed.completed)
          ? parsed.completed
          : undefined;
      const total =
        typeof parsed?.total === 'number' && Number.isFinite(parsed.total)
          ? parsed.total
          : undefined;
      const digest = typeof parsed?.digest === 'string' ? parsed.digest : undefined;
      const done = Boolean(parsed?.done) || status.toLowerCase() === 'success';
      const percent = done ? 100 : computePullPercent(completed, total);

      events.push({
        status,
        digest,
        completed,
        total,
        percent,
        done
      });
    } catch {
      // Ignore malformed line without crashing the pull stream
    }
  }

  return { events, remainder };
}
