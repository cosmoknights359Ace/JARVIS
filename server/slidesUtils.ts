/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 cosmoknight — J.A.R.V.I.S Slides Validation & Parsing Utilities
 *
 * Pure, testable helpers for the Xslide PPT pipeline:
 * - Natural-language slide-count override parser (prompt overrides UI preset)
 * - Strict deck JSON validation (exact slide count, non-empty speaker notes,
 *   table headers/rows validation, anti-placeholder checks)
 * - Schema normalization supporting both layout/type and speakerNotes/speaker_notes
 */

import type { SlideItem, SlideLayoutType, SlideTableData } from '../src/types.ts';

export const MIN_SLIDES = 2;
export const MAX_SLIDES = 20;

export const VALID_SLIDE_LAYOUTS: SlideLayoutType[] = [
  'title',
  'bullets',
  'split_image',
  'two_column',
  'stat_highlight',
  'table'
];

export function clampSlideCount(n: number): number {
  if (!Number.isFinite(n)) return 8;
  return Math.max(MIN_SLIDES, Math.min(MAX_SLIDES, Math.round(n)));
}

/**
 * Extracts an explicit slide count from the user's prompt/topic if specified
 * (e.g., "Create a 6-slide presentation", "make 4 slides", "deck of 10 slides").
 * Returns `{ count, overridden }` so the caller knows whether the prompt
 * overrode the UI preset.
 */
export function resolveTargetSlideCount(
  prompt: string,
  presetCount: number
): { count: number; overridden: boolean } {
  const safePreset = clampSlideCount(presetCount);
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return { count: safePreset, overridden: false };
  }

  const patterns = [
    /\b(\d{1,2})\s*[- ]?\s*slides?\b/i,
    /\bslides?\s*(?:count|total)?\s*[:=]\s*(\d{1,2})\b/i,
    /\b(?:deck|presentation|ppt|pptx)\s+(?:of|with)\s+(\d{1,2})\s+slides?\b/i
  ];

  for (const re of patterns) {
    const match = prompt.match(re);
    if (match && match[1]) {
      const parsed = parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed >= MIN_SLIDES && parsed <= MAX_SLIDES) {
        return { count: parsed, overridden: parsed !== safePreset };
      }
    }
  }

  return { count: safePreset, overridden: false };
}

export function sanitizeSlideText(val: unknown, maxLen = 400): string {
  if (typeof val !== 'string') return '';
  return val
    .replace(/\r\n/g, '\n')
    .replace(/```(?:\w+)?\n?/g, '')
    .replace(/```/g, '')
    .trim()
    .slice(0, maxLen);
}

export function sanitizeSlideBullets(val: unknown, maxItems = 6): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .map((item) => sanitizeSlideText(item, 220).replace(/^[\s•\-*]+/, '').trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

export function extractSlideTable(raw: any): SlideTableData | undefined {
  const src = raw?.table && typeof raw.table === 'object' ? raw.table : raw;
  const rawHeaders = Array.isArray(src?.headers) ? src.headers : [];
  const rawRows = Array.isArray(src?.rows) ? src.rows : [];

  const headers = rawHeaders
    .map((h: unknown) => sanitizeSlideText(String(h ?? ''), 60))
    .filter(Boolean)
    .slice(0, 6);

  const colCount = headers.length;
  if (colCount < 2) return undefined;

  const rows: string[][] = rawRows
    .filter((r: unknown) => Array.isArray(r))
    .map((r: unknown[]) => {
      const cells = r.slice(0, colCount).map((c) => sanitizeSlideText(String(c ?? ''), 120));
      while (cells.length < colCount) cells.push('');
      return cells;
    })
    .filter((r: string[]) => r.some(Boolean))
    .slice(0, 8);

  if (rows.length === 0) return undefined;
  return { headers, rows };
}

export function extractSpeakerNotes(raw: any): string {
  const note = sanitizeSlideText(raw?.speaker_notes ?? raw?.speakerNotes ?? '', 900);
  return note;
}

export function detectSlideLayout(raw: any, index: number): SlideLayoutType {
  if (index === 0) return 'title';

  const rawType = String(raw?.layout || raw?.type || '').trim().toLowerCase();
  if (rawType === 'table' || extractSlideTable(raw)) {
    return 'table';
  }
  if ((VALID_SLIDE_LAYOUTS as string[]).includes(rawType)) {
    return rawType as SlideLayoutType;
  }
  return 'bullets';
}

const GENERIC_PLACEHOLDER_PATTERNS = [
  /^core insights on\b/i,
  /^walk the audience through\b/i,
  /^key supporting point\b/i,
  /^placeholder\b/i,
  /^insert .+ here$/i,
  /^lorem ipsum/i
];

export function isPlaceholderText(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return GENERIC_PLACEHOLDER_PATTERNS.some((re) => re.test(t));
}

export interface DeckValidationResult {
  valid: boolean;
  issues: string[];
}

/**
 * Validates raw parsed JSON from Ollama/Gemini against exact slide count,
 * non-empty content, valid table structure, and required speaker notes.
 */
export function validateDeckJson(parsed: any, expectedCount: number): DeckValidationResult {
  const issues: string[] = [];

  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, issues: ['Response is not a JSON object.'] };
  }

  const slides = Array.isArray(parsed.slides) ? parsed.slides : null;
  if (!slides || slides.length === 0) {
    return { valid: false, issues: ['Missing or empty "slides" array.'] };
  }

  if (slides.length !== expectedCount) {
    issues.push(`Expected exactly ${expectedCount} slides, but received ${slides.length}.`);
  }

  slides.forEach((raw: any, idx: number) => {
    const slideNum = idx + 1;
    const title = sanitizeSlideText(raw?.title, 120);
    if (!title || isPlaceholderText(title)) {
      issues.push(`Slide ${slideNum} is missing a meaningful title.`);
    }

    const layout = detectSlideLayout(raw, idx);
    const notes = extractSpeakerNotes(raw);
    if (!notes || notes.length < 15 || isPlaceholderText(notes)) {
      issues.push(`Slide ${slideNum} is missing concrete speaker_notes.`);
    }

    if (layout === 'table') {
      const tbl = extractSlideTable(raw);
      if (!tbl || tbl.headers.length < 2 || tbl.rows.length < 2) {
        issues.push(`Slide ${slideNum} uses table layout but needs >= 2 headers and >= 2 rows.`);
      }
    } else if (layout !== 'title') {
      const bullets = sanitizeSlideBullets(raw?.bullets, 6);
      if (bullets.length === 0 || bullets.every(isPlaceholderText)) {
        issues.push(`Slide ${slideNum} has no real bullet points.`);
      }
    }
  });

  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * Normalizes a single LLM slide object without injecting generic placeholder prose.
 */
export function normalizeSlideItem(
  raw: any,
  index: number,
  topic: string
): SlideItem {
  const layout = detectSlideLayout(raw, index);
  const title = sanitizeSlideText(raw?.title, 120) || (index === 0 ? topic : `Slide ${index + 1}`);
  const kicker =
    sanitizeSlideText(raw?.kicker, 60) ||
    (index === 0 ? 'Presentation Briefing' : `Section ${String(index).padStart(2, '0')}`);
  const subtitle = sanitizeSlideText(raw?.subtitle, 180);

  let bullets = sanitizeSlideBullets(raw?.bullets, 6).filter((b) => !isPlaceholderText(b));
  let secondaryBullets = sanitizeSlideBullets(raw?.secondaryBullets, 5).filter(
    (b) => !isPlaceholderText(b)
  );
  const table = layout === 'table' ? extractSlideTable(raw) : undefined;

  if (layout === 'two_column' && secondaryBullets.length === 0 && bullets.length >= 2) {
    const mid = Math.ceil(bullets.length / 2);
    secondaryBullets = bullets.slice(mid);
    bullets = bullets.slice(0, mid);
  }

  const statVal = sanitizeSlideText(raw?.highlightStat?.value, 24);
  const statLbl = sanitizeSlideText(raw?.highlightStat?.label, 90);
  const highlightStat = statVal
    ? { value: statVal, label: statLbl || title }
    : undefined;

  // Preserve exact LLM speaker notes; if genuinely absent after retry, synthesize from actual slide content (never generic placeholder)
  let speakerNotes = extractSpeakerNotes(raw);
  if (!speakerNotes) {
    if (table) {
      speakerNotes = `${title}: compare ${table.headers.join(', ')} across ${table.rows
        .map((r) => r[0])
        .filter(Boolean)
        .slice(0, 3)
        .join(', ')}.`;
    } else if (bullets.length > 0) {
      speakerNotes = `${title}: ${bullets.slice(0, 2).join(' ')}`;
    } else if (subtitle) {
      speakerNotes = `${title} — ${subtitle}`;
    } else {
      speakerNotes = title;
    }
  }

  const imageQuery =
    sanitizeSlideText(raw?.imageQuery ?? raw?.image_query, 80) ||
    `${topic.split(/\s+/).slice(0, 3).join(' ')} ${title.split(/\s+/).slice(0, 2).join(' ')}`.trim();

  return {
    id: `slide_${Date.now()}_${index + 1}_${Math.random().toString(36).slice(2, 5)}`,
    layout: layout === 'table' && !table ? 'bullets' : layout,
    kicker,
    title,
    subtitle: subtitle || undefined,
    bullets,
    secondaryBullets: secondaryBullets.length > 0 ? secondaryBullets : undefined,
    table,
    highlightStat,
    speakerNotes,
    imageQuery,
    image: null
  };
}
