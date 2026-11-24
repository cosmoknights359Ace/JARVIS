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
  'table',
  'key_takeaway'
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

export function detectSlideLayout(raw: any, index: number): SlideLayoutType {
  if (index === 0) return 'title';

  const rawType = String(raw?.layout || raw?.type || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (rawType === 'table' || extractSlideTable(raw)) {
    return 'table';
  }
  if (
    rawType === 'key_takeaway' ||
    rawType === 'takeaway' ||
    rawType === 'summary' ||
    rawType === 'callout' ||
    rawType === 'key_summary'
  ) {
    return 'key_takeaway';
  }
  if (rawType === 'two_column' || rawType === 'comparison' || rawType === 'two_col') {
    return 'two_column';
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

export const GENERIC_NUMBERED_TITLE_REGEX = /^(?:slide|page)\s*#?\d+[:.\-\s]*$/i;
const GENERIC_NUMBERED_KICKER_REGEX = /^(?:slide|page|section|part)\s*#?\d+[:.\-\s]*$/i;
const LEADING_SLIDE_PREFIX_REGEX = /^(?:slide|page)\s*#?\d+\s*[:\-–—\.]+\s*/i;
const LEADING_NOTES_PREFIX_REGEX =
  /^(?:(?:slide|page)\s*#?\d+|speaker\s*notes?|presenter\s*notes?|notes?)\s*[:\-–—\.]+\s*/i;

export function isPlaceholderText(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return GENERIC_PLACEHOLDER_PATTERNS.some((re) => re.test(t));
}

export function isGenericNumberedTitle(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  return GENERIC_NUMBERED_TITLE_REGEX.test(t);
}

/**
 * Keeps an eyebrow/kicker to a concise 1-3 word section tag and omits it if it
 * duplicates the title, is generic ("Slide 2"), or is placeholder copy.
 */
export function normalizeKickerTag(rawKicker: string, title: string): string {
  const cleaned = sanitizeSlideText(rawKicker, 80)
    .replace(/^[\s•\-*]+|[\s:;\-–—]+$/g, '')
    .trim();
  if (!cleaned || isPlaceholderText(cleaned) || isGenericNumberedTitle(cleaned)) {
    return '';
  }
  if (title && cleaned.toLowerCase() === title.trim().toLowerCase()) {
    return '';
  }

  // If the model placed a multi-part phrase in kicker, prefer a short prefix before ":" or "—"
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= 3) {
    return cleaned;
  }

  const head = cleaned.split(/[:—–\-|]/)[0]?.trim() || '';
  const headWords = head.split(/\s+/).filter(Boolean);
  if (headWords.length >= 1 && headWords.length <= 3) {
    return head;
  }

  const trailingStopWords = new Set(['and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'the', 'a', 'an', 'vs']);
  const clipped = words.slice(0, 3);
  while (clipped.length > 1 && trailingStopWords.has(clipped[clipped.length - 1].toLowerCase())) {
    clipped.pop();
  }
  return clipped.join(' ').replace(/[,:;.\-–—]+$/, '').trim();
}

function ensureSentencePunctuation(segment: string): string {
  let s = segment
    .replace(/^[\s•▪◦‣\-*]+/, '')
    .replace(/^\d+[\).]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  if (/^[a-z]/.test(s)) {
    s = s[0].toUpperCase() + s.slice(1);
  }
  if (!/[.!?]["')\]]*$/.test(s)) {
    s = `${s.replace(/[,;:\-–—]+$/, '')}.`;
  }
  return s;
}

/**
 * Strips leading "Slide N:" / "Page N:" / "Speaker Notes:" prefixes, unpacks
 * raw bullet-mashed notes into punctuated presenter sentences, and guarantees
 * clean sentence punctuation.
 */
export function normalizeSpeakerNotesText(rawNotes: string): string {
  let text = sanitizeSlideText(rawNotes, 900);
  if (!text) return '';

  // Repeatedly strip leading "Slide N:" / "Speaker Notes:" prefixes
  let prev = '';
  while (text && text !== prev) {
    prev = text;
    text = text.replace(LEADING_NOTES_PREFIX_REGEX, '').trim();
  }

  if (!text || isPlaceholderText(text)) return '';

  // Split bullet-mashed or multi-line notes into clean punctuated sentences
  const hasBulletMarkers = /(?:^|\s)[•▪◦‣]\s*|\n\s*[-*•]\s*|\n/.test(text);
  if (hasBulletMarkers) {
    const rawParts = text
      .split(/\n+|(?:^|\s)[•▪◦‣]\s*/g)
      .map((part) => part.trim())
      .filter(Boolean);

    const sentences = rawParts
      .map((part) => ensureSentencePunctuation(part))
      .filter(Boolean);

    return sentences.join(' ').slice(0, 900);
  }

  return ensureSentencePunctuation(text).slice(0, 900);
}

export function extractSpeakerNotes(raw: any): string {
  return normalizeSpeakerNotesText(raw?.speaker_notes ?? raw?.speakerNotes ?? '');
}

export interface DeckValidationResult {
  valid: boolean;
  issues: string[];
}

/**
 * Validates raw parsed JSON from Ollama/Gemini against exact slide count,
 * descriptive titles, non-empty content, valid table structure, and presenter
 * speaker notes.
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
    if (!title || isPlaceholderText(title) || isGenericNumberedTitle(title)) {
      issues.push(
        `Slide ${slideNum} is missing a descriptive 3-7 word title (never use generic numbered titles like "Slide ${slideNum}").`
      );
    }

    const layout = detectSlideLayout(raw, idx);
    const rawNotes = sanitizeSlideText(raw?.speaker_notes ?? raw?.speakerNotes ?? '', 900);
    if (LEADING_SLIDE_PREFIX_REGEX.test(rawNotes)) {
      issues.push(
        `Slide ${slideNum} speaker_notes must be natural spoken sentences without a "Slide ${slideNum}:" prefix.`
      );
    }
    const notes = normalizeSpeakerNotesText(rawNotes);
    if (!notes || notes.length < 15 || isPlaceholderText(notes)) {
      issues.push(`Slide ${slideNum} is missing concrete speaker_notes.`);
    }

    if (layout === 'table') {
      const tbl = extractSlideTable(raw);
      if (!tbl || tbl.headers.length < 2 || tbl.rows.length < 2) {
        issues.push(`Slide ${slideNum} uses table layout but needs >= 2 headers and >= 2 rows.`);
      }
    } else if (layout === 'key_takeaway') {
      const takeaway = sanitizeSlideText(raw?.takeaway ?? raw?.summary ?? raw?.callout ?? '', 260);
      const bullets = sanitizeSlideBullets(raw?.bullets, 6);
      const hasTakeaway = Boolean(takeaway && !isPlaceholderText(takeaway));
      const hasBullets = bullets.length > 0 && !bullets.every(isPlaceholderText);
      if (!hasTakeaway && !hasBullets) {
        issues.push(`Slide ${slideNum} uses key_takeaway layout but is missing a core takeaway callout or supporting points.`);
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
 * Deterministically promotes eyebrow/kicker/subtitle when a model emits generic
 * numbered titles ("Slide 2", "Page 3") and cleans speaker notes punctuation.
 */
export function normalizeSlideItem(
  raw: any,
  index: number,
  topic: string
): SlideItem {
  const layout = detectSlideLayout(raw, index);

  let rawTitle = sanitizeSlideText(raw?.title, 120);
  const rawKicker = sanitizeSlideText(raw?.kicker ?? raw?.eyebrow, 120);
  let subtitle = sanitizeSlideText(raw?.subtitle, 180);

  let bullets = sanitizeSlideBullets(raw?.bullets, 6).filter((b) => !isPlaceholderText(b));
  let secondaryBullets = sanitizeSlideBullets(raw?.secondaryBullets, 5).filter(
    (b) => !isPlaceholderText(b)
  );
  const table = layout === 'table' ? extractSlideTable(raw) : undefined;

  // Strip redundant "Slide N: " prefix if substantive heading text follows
  if (rawTitle && !isGenericNumberedTitle(rawTitle) && LEADING_SLIDE_PREFIX_REGEX.test(rawTitle)) {
    const stripped = rawTitle.replace(LEADING_SLIDE_PREFIX_REGEX, '').trim();
    if (stripped.length >= 3) {
      rawTitle = stripped;
    }
  }

  let title = rawTitle;
  let kicker = '';
  const needsTitlePromotion = !title || isPlaceholderText(title) || isGenericNumberedTitle(title);

  if (needsTitlePromotion) {
    const canPromoteKicker =
      Boolean(rawKicker) &&
      !isPlaceholderText(rawKicker) &&
      !GENERIC_NUMBERED_KICKER_REGEX.test(rawKicker);
    const canPromoteSubtitle =
      Boolean(subtitle) &&
      !isPlaceholderText(subtitle) &&
      !isGenericNumberedTitle(subtitle);

    if (canPromoteKicker) {
      title = rawKicker.replace(LEADING_SLIDE_PREFIX_REGEX, '').trim().slice(0, 120);
      kicker = '';
    } else if (canPromoteSubtitle) {
      title = subtitle.replace(LEADING_SLIDE_PREFIX_REGEX, '').trim().slice(0, 120);
      subtitle = '';
      kicker = normalizeKickerTag(rawKicker, title);
    } else if (index === 0 && topic.trim()) {
      title = topic.trim().slice(0, 120);
      kicker = normalizeKickerTag(rawKicker, title);
    } else {
      // Derive concise heading from slide content before falling back to topic
      const derived =
        (table?.headers && table.headers.length >= 2 ? `${table.headers[0]} Comparison` : '') ||
        (bullets[0] ? bullets[0].split(/[:—–\-]/)[0].trim().split(/\s+/).slice(0, 6).join(' ') : '') ||
        topic.trim().slice(0, 80) ||
        `Overview ${index + 1}`;
      title = derived;
      kicker = normalizeKickerTag(rawKicker, title);
    }
  } else {
    kicker = normalizeKickerTag(rawKicker, title);
  }

  if (layout === 'two_column' && secondaryBullets.length === 0 && bullets.length >= 2) {
    const mid = Math.ceil(bullets.length / 2);
    secondaryBullets = bullets.slice(mid);
    bullets = bullets.slice(0, mid);
  }

  const rawLeftTitle = sanitizeSlideText(raw?.leftTitle ?? raw?.left_title, 70);
  const rawRightTitle = sanitizeSlideText(raw?.rightTitle ?? raw?.right_title, 70);
  const leftTitle = rawLeftTitle && !isPlaceholderText(rawLeftTitle) ? rawLeftTitle : undefined;
  const rightTitle = rawRightTitle && !isPlaceholderText(rawRightTitle) ? rawRightTitle : undefined;

  let takeaway = sanitizeSlideText(raw?.takeaway ?? raw?.summary ?? raw?.callout, 260);
  if (takeaway && isPlaceholderText(takeaway)) {
    takeaway = '';
  }
  if (layout === 'key_takeaway' && !takeaway) {
    if (subtitle && !isPlaceholderText(subtitle)) {
      takeaway = subtitle;
    } else if (bullets.length > 0) {
      takeaway = bullets[0];
      bullets = bullets.slice(1);
    }
  }

  const statVal = sanitizeSlideText(raw?.highlightStat?.value, 24);
  const statLbl = sanitizeSlideText(raw?.highlightStat?.label, 90);
  const highlightStat = statVal
    ? { value: statVal, label: statLbl || title }
    : undefined;

  // Preserve & normalize LLM speaker notes; if genuinely absent after retry, compose clean punctuated sentences
  let speakerNotes = extractSpeakerNotes(raw);
  if (!speakerNotes) {
    if (table) {
      const rowLabels = table.rows
        .map((r) => r[0])
        .filter(Boolean)
        .slice(0, 3)
        .join(', ');
      speakerNotes = ensureSentencePunctuation(
        `This comparison examines ${table.headers.join(', ')}${rowLabels ? ` across ${rowLabels}` : ''}. Highlight the primary trade-offs shown in each row`
      );
    } else if (layout === 'key_takeaway' && takeaway) {
      const closingTail = bullets[0] ? ` ${ensureSentencePunctuation(bullets[0])}` : '';
      speakerNotes = `${ensureSentencePunctuation(takeaway)}${closingTail}`.trim();
    } else if (bullets.length > 0) {
      const leadSentences = bullets.slice(0, 2).map((b) => ensureSentencePunctuation(b));
      speakerNotes = leadSentences.join(' ');
    } else if (subtitle) {
      speakerNotes = `${ensureSentencePunctuation(title)} ${ensureSentencePunctuation(subtitle)}`;
    } else {
      speakerNotes = ensureSentencePunctuation(`Introduce ${title} and frame its role in ${topic || 'this presentation'}`);
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
    leftTitle: layout === 'two_column' ? leftTitle : undefined,
    rightTitle: layout === 'two_column' ? rightTitle : undefined,
    takeaway: layout === 'key_takeaway' ? takeaway || undefined : undefined,
    bullets,
    secondaryBullets: secondaryBullets.length > 0 ? secondaryBullets : undefined,
    table,
    highlightStat,
    speakerNotes,
    imageQuery,
    image: null
  };
}
