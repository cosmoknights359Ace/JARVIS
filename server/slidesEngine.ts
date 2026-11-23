/**
 * J.A.R.V.I.S Slides — Local-First PPT Generator & Consent-Gated Web Image Engine
 *
 * - Outline & single-slide synthesis via Local Ollama first (1.2s probe, 120s JSON chat, T=0.2)
 *   with seamless fallback to Gemini Cloud (gemini-4-hydrogen with strict JSON schema).
 * - Server-side consent-enforced web image search (Wikimedia Commons primary, Openverse fallback).
 * - Deterministic 16:9 PowerPoint (.pptx) compilation via pptxgenjs with offline base64 image
 *   embedding, 4 curated theme palettes, 5 slide layouts, and PowerPoint speaker notes.
 *
 * J.A.R.V.I.S (c) 2026 cosmoknight — creator attribution preserved.
 */

import PptxGenJSModule from 'pptxgenjs';
import { GoogleGenAI, Type } from '@google/genai';
import type {
  SlideAudience,
  SlideDeck,
  SlideImageAsset,
  SlideItem,
  SlideLayoutType,
  SlideThemeId
} from '../src/types.ts';
import {
  DEFAULT_STUDIO_MODEL,
  DEFAULT_STUDIO_NUM_CTX,
  extractJsonPayload,
  resolveAvailableOllamaModel
} from './localJsonUtils.ts';

const PptxGenJS: any = (PptxGenJSModule as any).default || PptxGenJSModule;

const GEMINI_MODEL = 'gemini-4-hydrogen';

export interface SlideThemePalette {
  id: SlideThemeId;
  name: string;
  bg: string;
  surface: string;
  border: string;
  accent: string;
  accentSoft: string;
  text: string;
  muted: string;
  isDark: boolean;
}

export const SLIDE_THEMES: Record<SlideThemeId, SlideThemePalette> = {
  'obsidian-orange': {
    id: 'obsidian-orange',
    name: 'Obsidian & Orange',
    bg: '09090D',
    surface: '14141B',
    border: '27272F',
    accent: 'F97316',
    accentSoft: 'FB923C',
    text: 'F4F4F6',
    muted: 'A1A1AA',
    isDark: true
  },
  'editorial-ivory': {
    id: 'editorial-ivory',
    name: 'Editorial Ivory',
    bg: 'F8F7F4',
    surface: 'FFFFFF',
    border: 'E2E0D8',
    accent: 'C2410C',
    accentSoft: 'EA580C',
    text: '18181B',
    muted: '52525B',
    isDark: false
  },
  'slate-executive': {
    id: 'slate-executive',
    name: 'Slate Executive',
    bg: '0F172A',
    surface: '1E293B',
    border: '334155',
    accent: '38BDF8',
    accentSoft: '7DD3FC',
    text: 'F8FAFC',
    muted: '94A3B8',
    isDark: true
  },
  'emerald-tech': {
    id: 'emerald-tech',
    name: 'Emerald Tech',
    bg: '07110D',
    surface: '0F1F18',
    border: '1F3A2E',
    accent: '10B981',
    accentSoft: '34D399',
    text: 'ECFDF5',
    muted: '86EFAC',
    isDark: true
  }
};

// ============================================================================
// 1. Safe Normalization & Grounded Prompt Builders
// ============================================================================

const VALID_LAYOUTS: SlideLayoutType[] = [
  'title',
  'bullets',
  'split_image',
  'two_column',
  'stat_highlight'
];

function clampSlideCount(n: number): number {
  if (!Number.isFinite(n)) return 8;
  return Math.max(4, Math.min(15, Math.round(n)));
}

function sanitizeText(val: unknown, fallback = '', maxLen = 400): string {
  if (typeof val !== 'string') return fallback;
  return val
    .replace(/\r\n/g, '\n')
    .replace(/```(?:\w+)?\n?/g, '')
    .replace(/```/g, '')
    .trim()
    .slice(0, maxLen);
}

function sanitizeBullets(val: unknown, maxItems = 6): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .map((item) => sanitizeText(item, '', 220).replace(/^[\s•\-*]+/, '').trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeSlide(raw: any, index: number, total: number, topic: string): SlideItem {
  let layout: SlideLayoutType = VALID_LAYOUTS.includes(raw?.layout)
    ? raw.layout
    : index === 0
    ? 'title'
    : index % 2 === 1
    ? 'split_image'
    : 'bullets';

  if (index === 0) layout = 'title';

  const title = sanitizeText(raw?.title, index === 0 ? topic : `Slide ${index + 1}`, 120);
  const kicker = sanitizeText(
    raw?.kicker,
    index === 0 ? 'Presentation Briefing' : `Section ${String(index).padStart(2, '0')}`,
    60
  );
  const subtitle = sanitizeText(raw?.subtitle, '', 180);
  let bullets = sanitizeBullets(raw?.bullets, 6);
  let secondaryBullets = sanitizeBullets(raw?.secondaryBullets, 5);

  if (layout !== 'title' && bullets.length === 0) {
    bullets = [subtitle || `Core insights on ${title}.`];
  }

  if (layout === 'two_column' && secondaryBullets.length === 0 && bullets.length >= 2) {
    const mid = Math.ceil(bullets.length / 2);
    secondaryBullets = bullets.slice(mid);
    bullets = bullets.slice(0, mid);
  }

  const statVal = sanitizeText(raw?.highlightStat?.value, '', 24);
  const statLbl = sanitizeText(raw?.highlightStat?.label, '', 90);
  const highlightStat =
    layout === 'stat_highlight'
      ? {
          value: statVal || `${Math.max(2, total)}x`,
          label: statLbl || title
        }
      : statVal
      ? { value: statVal, label: statLbl }
      : undefined;

  const speakerNotes = sanitizeText(
    raw?.speakerNotes,
    `Walk the audience through ${title}, emphasizing the key factual takeaways.`,
    900
  );

  const imageQuery = sanitizeText(
    raw?.imageQuery,
    `${topic.split(/\s+/).slice(0, 3).join(' ')} ${title.split(/\s+/).slice(0, 2).join(' ')}`.trim(),
    80
  );

  return {
    id: `slide_${Date.now()}_${index + 1}_${Math.random().toString(36).slice(2, 5)}`,
    layout,
    kicker,
    title,
    subtitle: subtitle || undefined,
    bullets,
    secondaryBullets: secondaryBullets.length > 0 ? secondaryBullets : undefined,
    highlightStat,
    speakerNotes,
    imageQuery,
    image: null
  };
}

export interface GenerateDeckRequest {
  topic: string;
  slideCount: number;
  audience: SlideAudience;
  themeId: SlideThemeId;
  contextNotes: string;
  includeMemory: boolean;
  memory: Record<string, string>;
  modelName: string;
  ollamaHost: string;
  keepAliveMinutes: number;
}

function buildDeckPrompt(req: GenerateDeckRequest): { system: string; user: string } {
  const count = clampSlideCount(req.slideCount);
  const audienceStyle: Record<SlideAudience, string> = {
    executive: 'Executive leadership briefing: sharp strategic takeaways, clear business impact, concise phrasing.',
    technical: 'Engineering & architecture audience: concrete technical accuracy, trade-offs, system mechanisms.',
    educational: 'Educational & structured teaching style: progressive concept build-up, clear definitions, memorable examples.',
    pitch: 'Persuasive investor/stakeholder pitch: clear problem framing, solution value, execution roadmap.'
  };

  const system = `You are J.A.R.V.I.S Slides, a precision presentation architect.
Rules:
1. Generate EXACTLY ${count} slides for the user's topic.
2. ${audienceStyle[req.audience] || audienceStyle.executive}
3. Grounding & Anti-Hallucination: Prioritize facts from CONTEXT_NOTES and MEMORY_BANK when provided. Never fabricate fake company revenue, fake citations, or fake statistics. Only use a "stat_highlight" layout if a factual/grounded metric or well-known benchmark applies.
4. Slide 1 MUST use layout "title". Vary remaining slides cleanly across "split_image", "bullets", "two_column", and "stat_highlight" so the deck feels thoughtfully paced (at least half should use "split_image" for strong visual balance).
5. Keep bullets crisp and scannable (max 3–5 bullets per slide, under 18 words each). Never write walls of text.
6. Every slide MUST include helpful, natural presenter "speakerNotes" (2–3 sentences) and a clean 2–5 word English "imageQuery" suitable for searching public photography/diagrams on Wikimedia Commons (concrete visual nouns, no quotes or punctuation).
7. Return ONLY valid JSON matching:
{
  "title": string,
  "subtitle": string,
  "slides": [
    {
      "layout": "title" | "bullets" | "split_image" | "two_column" | "stat_highlight",
      "kicker": string,
      "title": string,
      "subtitle": string,
      "bullets": string[],
      "secondaryBullets": string[],
      "highlightStat": { "value": string, "label": string },
      "speakerNotes": string,
      "imageQuery": string
    }
  ]
}`;

  const memLines = req.includeMemory
    ? Object.entries(req.memory || {}).map(([k, v]) => `- ${k}: ${v}`)
    : [];

  const user = JSON.stringify(
    {
      TOPIC: req.topic.trim(),
      TARGET_SLIDE_COUNT: count,
      AUDIENCE: req.audience,
      CONTEXT_NOTES: req.contextNotes?.trim() || '(none provided)',
      MEMORY_BANK: memLines.length > 0 ? memLines : ['(not included)']
    },
    null,
    2
  );

  return { system, user };
}

// ============================================================================
// 2. Local Ollama Primary + Gemini Cloud Fallback JSON Caller
// ============================================================================

async function callOllamaJson(
  system: string,
  user: string,
  ollamaHost: string,
  modelName: string,
  keepAliveMinutes: number
): Promise<{ data: any; modelUsed: string } | null> {
  const cleanHost = (ollamaHost || 'http://127.0.0.1:11434')
    .replace(/\/+$/, '')
    .replace('localhost', '127.0.0.1');

  // 1. Fast reachability probe (1.2s) + installed model discovery
  let installedModels: string[] = [];
  const probeCtrl = new AbortController();
  const probeTimer = setTimeout(() => probeCtrl.abort(), 1200);
  try {
    const probeRes = await fetch(`${cleanHost}/api/tags`, {
      method: 'GET',
      signal: probeCtrl.signal
    });
    clearTimeout(probeTimer);
    if (!probeRes.ok) return null;
    const tagData: any = await probeRes.json().catch(() => null);
    if (Array.isArray(tagData?.models)) {
      installedModels = tagData.models.map((m: any) => m?.name).filter(Boolean);
    }
  } catch {
    clearTimeout(probeTimer);
    return null;
  }

  const effectiveModel = resolveAvailableOllamaModel(
    modelName || DEFAULT_STUDIO_MODEL,
    installedModels,
    'qwen2.5:3b'
  );

  // 2. Full local generation (120s timeout)
  const chatCtrl = new AbortController();
  const chatTimer = setTimeout(() => chatCtrl.abort(), 120000);
  try {
    const res = await fetch(`${cleanHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: chatCtrl.signal,
      body: JSON.stringify({
        model: effectiveModel,
        stream: false,
        format: 'json',
        keep_alive: `${keepAliveMinutes || 30}m`,
        options: {
          temperature: 0.2,
          num_ctx: DEFAULT_STUDIO_NUM_CTX,
          num_predict: 3500
        },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    });
    clearTimeout(chatTimer);
    if (!res.ok) return null;

    const data: any = await res.json();
    const rawContent = data?.message?.content;
    if (typeof rawContent !== 'string' || !rawContent.trim()) return null;

    const parsed = extractJsonPayload(rawContent);
    if (!parsed) return null;
    return { data: parsed, modelUsed: effectiveModel };
  } catch {
    clearTimeout(chatTimer);
    return null;
  }
}

const GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

async function generateJsonWithGemini(
  aiClient: GoogleGenAI,
  system: string,
  user: string,
  responseSchema: any
): Promise<{ parsed: any; model: string }> {
  const modelsToTry = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL];
  let lastErr: any = null;

  for (const modelName of modelsToTry) {
    try {
      const response = await aiClient.models.generateContent({
        model: modelName,
        contents: user,
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseSchema
        }
      });
      const text = (response.text || '{}').trim();
      return { parsed: JSON.parse(text), model: modelName };
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || '');
      const isTransient =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('429') ||
        msg.includes('high demand');
      if (!isTransient) throw err;
    }
  }

  throw new Error(
    'Cloud AI is temporarily experiencing high demand. Start local Ollama for instant offline generation, or retry in a few seconds.'
  );
}

export async function generateSlideDeck(
  req: GenerateDeckRequest,
  aiClient: GoogleGenAI | null
): Promise<{ deck: SlideDeck; elapsedMs: number }> {
  const topic = req.topic.trim();
  if (!topic) {
    throw new Error('Presentation topic is required.');
  }

  const started = Date.now();
  const count = clampSlideCount(req.slideCount);
  const { system, user } = buildDeckPrompt(req);

  const ollamaOut = await callOllamaJson(
    system,
    user,
    req.ollamaHost,
    req.modelName,
    req.keepAliveMinutes
  );

  let parsed: any = ollamaOut?.data ?? null;
  let provider: 'ollama' | 'gemini' = 'ollama';
  let model = ollamaOut?.modelUsed || req.modelName || DEFAULT_STUDIO_MODEL;

  if (!parsed || !Array.isArray(parsed.slides) || parsed.slides.length === 0) {
    if (!aiClient) {
      throw new Error(
        'Local Ollama is offline and no GEMINI_API_KEY is configured. Start Ollama locally or configure an API key in Settings > Secrets.'
      );
    }

    provider = 'gemini';
    const deckSchema = {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        subtitle: { type: Type.STRING },
        slides: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              layout: { type: Type.STRING },
              kicker: { type: Type.STRING },
              title: { type: Type.STRING },
              subtitle: { type: Type.STRING },
              bullets: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              secondaryBullets: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              highlightStat: {
                type: Type.OBJECT,
                properties: {
                  value: { type: Type.STRING },
                  label: { type: Type.STRING }
                }
              },
              speakerNotes: { type: Type.STRING },
              imageQuery: { type: Type.STRING }
            },
            required: ['layout', 'title', 'bullets', 'speakerNotes', 'imageQuery']
          }
        }
      },
      required: ['title', 'slides']
    };

    const geminiOut = await generateJsonWithGemini(aiClient, system, user, deckSchema);
    parsed = geminiOut.parsed;
    model = geminiOut.model;
  }

  const rawSlides: any[] = Array.isArray(parsed?.slides) ? parsed.slides : [];
  if (rawSlides.length === 0) {
    throw new Error('The AI engine returned an empty slide outline. Please retry.');
  }

  const normalizedSlides = rawSlides
    .slice(0, Math.max(count, 15))
    .map((s, idx) => normalizeSlide(s, idx, rawSlides.length, topic));

  const now = new Date().toISOString();
  const deckTitle = sanitizeText(parsed?.title, normalizedSlides[0]?.title || topic, 120);
  const deckSubtitle = sanitizeText(
    parsed?.subtitle,
    normalizedSlides[0]?.subtitle || `Prepared with J.A.R.V.I.S Slides`,
    180
  );

  const deck: SlideDeck = {
    id: `deck_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: deckTitle,
    subtitle: deckSubtitle,
    topic,
    themeId: SLIDE_THEMES[req.themeId] ? req.themeId : 'obsidian-orange',
    audience: req.audience || 'executive',
    provider,
    model,
    createdAt: now,
    updatedAt: now,
    slides: normalizedSlides
  };

  return {
    deck,
    elapsedMs: Math.max(1, Date.now() - started)
  };
}

export async function regenerateSingleSlide(
  params: {
    deckTitle: string;
    topic: string;
    audience: SlideAudience;
    slide: SlideItem;
    slideIndex: number;
    totalSlides: number;
    instruction: string;
    contextNotes: string;
    modelName: string;
    ollamaHost: string;
    keepAliveMinutes: number;
  },
  aiClient: GoogleGenAI | null
): Promise<{ slide: SlideItem; provider: 'ollama' | 'gemini'; model: string }> {
  const system = `You are J.A.R.V.I.S Slides. Rewrite and improve ONE presentation slide accurately without hallucinations.
Keep bullets concise (3-5 bullets, max 18 words each), preserve factual grounding, provide natural presenter speakerNotes (2-3 sentences), and output a clean 2-5 word English imageQuery for Wikimedia Commons.
Return ONLY valid JSON:
{
  "layout": "title" | "bullets" | "split_image" | "two_column" | "stat_highlight",
  "kicker": string,
  "title": string,
  "subtitle": string,
  "bullets": string[],
  "secondaryBullets": string[],
  "highlightStat": { "value": string, "label": string },
  "speakerNotes": string,
  "imageQuery": string
}`;

  const user = JSON.stringify(
    {
      DECK_TITLE: params.deckTitle,
      TOPIC: params.topic,
      AUDIENCE: params.audience,
      SLIDE_POSITION: `${params.slideIndex + 1} of ${params.totalSlides}`,
      CURRENT_SLIDE: {
        layout: params.slide.layout,
        kicker: params.slide.kicker,
        title: params.slide.title,
        subtitle: params.slide.subtitle || '',
        bullets: params.slide.bullets,
        secondaryBullets: params.slide.secondaryBullets || [],
        speakerNotes: params.slide.speakerNotes
      },
      REFINEMENT_INSTRUCTION:
        params.instruction?.trim() || 'Make this slide sharper, clearer, and more impactful.',
      CONTEXT_NOTES: params.contextNotes?.trim() || '(none)'
    },
    null,
    2
  );

  const ollamaOut = await callOllamaJson(
    system,
    user,
    params.ollamaHost,
    params.modelName,
    params.keepAliveMinutes
  );

  let parsed: any = ollamaOut?.data ?? null;
  let provider: 'ollama' | 'gemini' = 'ollama';
  let model = ollamaOut?.modelUsed || params.modelName || DEFAULT_STUDIO_MODEL;

  if (!parsed || typeof parsed.title !== 'string') {
    if (!aiClient) {
      throw new Error('Local Ollama is offline and no cloud Gemini API key is configured.');
    }
    provider = 'gemini';
    const slideSchema = {
      type: Type.OBJECT,
      properties: {
        layout: { type: Type.STRING },
        kicker: { type: Type.STRING },
        title: { type: Type.STRING },
        subtitle: { type: Type.STRING },
        bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
        secondaryBullets: { type: Type.ARRAY, items: { type: Type.STRING } },
        highlightStat: {
          type: Type.OBJECT,
          properties: {
            value: { type: Type.STRING },
            label: { type: Type.STRING }
          }
        },
        speakerNotes: { type: Type.STRING },
        imageQuery: { type: Type.STRING }
      },
      required: ['layout', 'title', 'bullets', 'speakerNotes', 'imageQuery']
    };
    const geminiOut = await generateJsonWithGemini(aiClient, system, user, slideSchema);
    parsed = geminiOut.parsed;
    model = geminiOut.model;
  }

  const normalized = normalizeSlide(parsed, params.slideIndex, params.totalSlides, params.topic);
  normalized.id = params.slide.id;
  normalized.image = params.slide.image || null;

  return { slide: normalized, provider, model };
}

// ============================================================================
// 3. Consent-Gated Web Image Search (Wikimedia Commons + Openverse Fallback)
// ============================================================================

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

function stripHtmlTags(html: string): string {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSafePublicImageUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function searchWikimediaCommons(query: string, limit = 8): Promise<SlideImageAsset[]> {
  const endpoint = new URL('https://commons.wikimedia.org/w/api.php');
  endpoint.searchParams.set('action', 'query');
  endpoint.searchParams.set('generator', 'search');
  endpoint.searchParams.set('gsrnamespace', '6');
  endpoint.searchParams.set('gsrlimit', String(Math.min(14, limit + 4)));
  endpoint.searchParams.set('gsrsearch', `${query} filetype:bitmap`);
  endpoint.searchParams.set('prop', 'imageinfo');
  endpoint.searchParams.set('iiprop', 'url|mime|size|extmetadata');
  endpoint.searchParams.set('iiurlwidth', '1200');
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('origin', '*');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(endpoint.toString(), {
      headers: {
        'User-Agent': 'JARVIS-Slides/1.0 (https://github.com/jarvis-assistant; educational)'
      },
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!res.ok) return [];

    const data: any = await res.json();
    const pages = Object.values(data?.query?.pages || {}) as any[];
    const results: SlideImageAsset[] = [];

    for (const page of pages) {
      const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
      if (!info) continue;
      const mime = String(info.mime || '').toLowerCase();
      if (!ALLOWED_IMAGE_MIME.has(mime)) continue;

      const width = Number(info.width) || 0;
      const height = Number(info.height) || 0;
      if (width > 0 && width < 280) continue;

      const thumbUrl = info.thumburl || info.url;
      const fullUrl = info.thumburl || info.url;
      if (!thumbUrl || !isSafePublicImageUrl(thumbUrl)) continue;

      const meta = info.extmetadata || {};
      const artist = stripHtmlTags(meta.Artist?.value || '').slice(0, 60);
      const license = stripHtmlTags(meta.LicenseShortName?.value || 'CC / Wikimedia').slice(0, 40);
      const cleanTitle = String(page.title || '')
        .replace(/^File:/i, '')
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/_/g, ' ')
        .trim()
        .slice(0, 80);

      results.push({
        url: fullUrl,
        thumbUrl,
        caption: cleanTitle || query,
        credit: artist ? `${artist} · ${license}` : `Wikimedia Commons · ${license}`,
        source: 'wikimedia',
        width: info.thumbwidth || width || undefined,
        height: info.thumbheight || height || undefined
      });

      if (results.length >= limit) break;
    }

    return results;
  } catch {
    clearTimeout(timer);
    return [];
  }
}

async function searchOpenverse(query: string, limit = 6): Promise<SlideImageAsset[]> {
  const endpoint = new URL('https://api.openverse.org/v1/images/');
  endpoint.searchParams.set('q', query);
  endpoint.searchParams.set('page_size', String(limit));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6500);
  try {
    const res = await fetch(endpoint.toString(), {
      headers: {
        'User-Agent': 'JARVIS-Slides/1.0'
      },
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!res.ok) return [];

    const data: any = await res.json();
    const items = Array.isArray(data?.results) ? data.results : [];
    const results: SlideImageAsset[] = [];

    for (const item of items) {
      const url = typeof item?.url === 'string' ? item.url : '';
      const thumbUrl = typeof item?.thumbnail === 'string' && item.thumbnail ? item.thumbnail : url;
      if (!url || !isSafePublicImageUrl(url) || !isSafePublicImageUrl(thumbUrl)) continue;
      if (/\.svg(\?|$)/i.test(url)) continue;

      const creator = sanitizeText(item?.creator, 'Creator', 50);
      const license = sanitizeText(item?.license, 'CC', 30).toUpperCase();
      results.push({
        url,
        thumbUrl,
        caption: sanitizeText(item?.title, query, 80),
        credit: `${creator} · ${license}`,
        source: 'openverse',
        width: Number(item?.width) || undefined,
        height: Number(item?.height) || undefined
      });

      if (results.length >= limit) break;
    }

    return results;
  } catch {
    clearTimeout(timer);
    return [];
  }
}

export async function searchWebImages(
  query: string,
  consentGranted: boolean,
  limit = 6
): Promise<SlideImageAsset[]> {
  if (!consentGranted) {
    const err: any = new Error(
      'Explicit user consent is required before accessing web image search.'
    );
    err.statusCode = 403;
    throw err;
  }

  const cleanQuery = sanitizeText(query, '', 100);
  if (!cleanQuery) return [];

  const primary = await searchWikimediaCommons(cleanQuery, limit);
  if (primary.length >= Math.min(4, limit)) {
    return primary.slice(0, limit);
  }

  const fallback = await searchOpenverse(cleanQuery, limit - primary.length);
  const seen = new Set(primary.map((i) => i.url));
  const combined = [...primary];
  for (const item of fallback) {
    if (!seen.has(item.url)) {
      seen.add(item.url);
      combined.push(item);
    }
  }
  return combined.slice(0, limit);
}

// ============================================================================
// 4. Deterministic 16:9 PowerPoint (.pptx) Compiler with Offline Image Embedding
// ============================================================================

async function fetchImageAsDataUri(url: string): Promise<string | null> {
  if (!isSafePublicImageUrl(url)) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'JARVIS-Slides/1.0 (https://github.com/jarvis-assistant; educational)'
      },
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const rawMime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    // pptxgenjs reliably embeds PNG and JPEG; skip unsupported types
    const mime =
      rawMime === 'image/png'
        ? 'image/png'
        : rawMime === 'image/jpeg' || rawMime === 'image/jpg'
        ? 'image/jpeg'
        : rawMime === 'image/gif'
        ? 'image/gif'
        : null;

    if (!mime) return null;

    const arrBuf = await res.arrayBuffer();
    if (arrBuf.byteLength === 0 || arrBuf.byteLength > 6 * 1024 * 1024) return null;

    const b64 = Buffer.from(arrBuf).toString('base64');
    return `data:${mime};base64,${b64}`;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function exportDeckToPptx(deck: SlideDeck): Promise<{
  buffer: Buffer;
  fileName: string;
  embeddedImages: number;
}> {
  if (!deck || !Array.isArray(deck.slides) || deck.slides.length === 0) {
    throw new Error('Cannot export an empty slide deck.');
  }

  const theme = SLIDE_THEMES[deck.themeId] || SLIDE_THEMES['obsidian-orange'];
  const pptx = new PptxGenJS();

  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'J.A.R.V.I.S (c) 2026 cosmoknight';
  pptx.company = 'J.A.R.V.I.S';
  pptx.title = deck.title || 'J.A.R.V.I.S Presentation';
  pptx.subject = deck.topic || deck.title || 'Presentation';

  // Fetch all selected images concurrently (safe, bounded, non-fatal if any remote fails)
  const imageDataMap = new Map<string, string>();
  await Promise.all(
    deck.slides.map(async (slide) => {
      const targetUrl = slide.image?.url || slide.image?.thumbUrl;
      if (!targetUrl) return;
      const dataUri = await fetchImageAsDataUri(targetUrl);
      if (dataUri) {
        imageDataMap.set(slide.id, dataUri);
      } else if (slide.image?.thumbUrl && slide.image.thumbUrl !== targetUrl) {
        const thumbUri = await fetchImageAsDataUri(slide.image.thumbUrl);
        if (thumbUri) imageDataMap.set(slide.id, thumbUri);
      }
    })
  );

  const total = deck.slides.length;
  const FONT_DISPLAY = 'Calibri';
  const FONT_BODY = 'Calibri';

  deck.slides.forEach((slide, idx) => {
    const pptSlide = pptx.addSlide();
    pptSlide.background = { color: theme.bg };

    // Top subtle hairline accent bar
    pptSlide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 10,
      h: 0.06,
      fill: { color: theme.accent },
      line: { color: theme.accent, width: 0 }
    });

    const slideNumStr = `${String(idx + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    const imgData = imageDataMap.get(slide.id);

    if (slide.layout === 'title') {
      // Decorative clean horizontal accent rule
      pptSlide.addShape(pptx.ShapeType.rect, {
        x: 0.75,
        y: 1.45,
        w: 1.1,
        h: 0.06,
        fill: { color: theme.accent },
        line: { color: theme.accent, width: 0 }
      });

      if (slide.kicker) {
        pptSlide.addText(slide.kicker.toUpperCase(), {
          x: 0.75,
          y: 1.68,
          w: imgData ? 5.2 : 8.5,
          h: 0.35,
          fontFace: FONT_BODY,
          fontSize: 11,
          bold: true,
          color: theme.accent,
          charSpacing: 2.5
        });
      }

      pptSlide.addText(slide.title, {
        x: 0.75,
        y: 2.1,
        w: imgData ? 5.2 : 8.5,
        h: 1.55,
        fontFace: FONT_DISPLAY,
        fontSize: imgData ? 34 : 40,
        bold: true,
        color: theme.text,
        valign: 'top',
        fit: 'shrink'
      });

      if (slide.subtitle || slide.bullets[0]) {
        pptSlide.addText(slide.subtitle || slide.bullets[0], {
          x: 0.75,
          y: 3.7,
          w: imgData ? 5.1 : 8.0,
          h: 0.9,
          fontFace: FONT_BODY,
          fontSize: 16,
          color: theme.muted,
          valign: 'top',
          fit: 'shrink'
        });
      }

      if (imgData) {
        pptSlide.addShape(pptx.ShapeType.roundRect, {
          x: 6.25,
          y: 0.95,
          w: 3.1,
          h: 3.75,
          fill: { color: theme.surface },
          line: { color: theme.border, width: 1 },
          rectRadius: 0.08
        });
        pptSlide.addImage({
          data: imgData,
          x: 6.35,
          y: 1.05,
          w: 2.9,
          h: 3.25,
          sizing: { type: 'contain', w: 2.9, h: 3.25 }
        });
        if (slide.image?.credit) {
          pptSlide.addText(slide.image.credit, {
            x: 6.35,
            y: 4.35,
            w: 2.9,
            h: 0.28,
            fontFace: FONT_BODY,
            fontSize: 8,
            color: theme.muted,
            align: 'center'
          });
        }
      }
    } else {
      // Standard Header Band for Content Slides
      if (slide.kicker) {
        pptSlide.addText(slide.kicker, {
          x: 0.7,
          y: 0.42,
          w: 8.0,
          h: 0.3,
          fontFace: FONT_BODY,
          fontSize: 11,
          bold: true,
          color: theme.accent
        });
      }

      pptSlide.addText(slide.title, {
        x: 0.7,
        y: 0.74,
        w: 8.6,
        h: 0.65,
        fontFace: FONT_DISPLAY,
        fontSize: 26,
        bold: true,
        color: theme.text,
        fit: 'shrink'
      });

      // Subtle hairline divider beneath title
      pptSlide.addShape(pptx.ShapeType.line, {
        x: 0.7,
        y: 1.46,
        w: 8.6,
        h: 0,
        line: { color: theme.border, width: 1 }
      });

      const makeBulletRuns = (items: string[]) =>
        items.map((text) => ({
          text,
          options: {
            bullet: { code: '2022', color: theme.accent },
            color: theme.text,
            fontFace: FONT_BODY,
            fontSize: 15,
            paraSpaceAfter: 10,
            breakLine: true
          }
        }));

      if (slide.layout === 'split_image' && imgData) {
        pptSlide.addText(makeBulletRuns(slide.bullets), {
          x: 0.7,
          y: 1.72,
          w: 4.75,
          h: 3.25,
          valign: 'top',
          fit: 'shrink'
        });

        pptSlide.addShape(pptx.ShapeType.roundRect, {
          x: 5.75,
          y: 1.72,
          w: 3.55,
          h: 3.1,
          fill: { color: theme.surface },
          line: { color: theme.border, width: 1 },
          rectRadius: 0.08
        });

        pptSlide.addImage({
          data: imgData,
          x: 5.87,
          y: 1.84,
          w: 3.31,
          h: 2.55,
          sizing: { type: 'contain', w: 3.31, h: 2.55 }
        });

        if (slide.image?.credit) {
          pptSlide.addText(slide.image.credit, {
            x: 5.87,
            y: 4.46,
            w: 3.31,
            h: 0.28,
            fontFace: FONT_BODY,
            fontSize: 8.5,
            color: theme.muted,
            align: 'center'
          });
        }
      } else if (slide.layout === 'two_column') {
        const leftBullets = slide.bullets;
        const rightBullets =
          slide.secondaryBullets && slide.secondaryBullets.length > 0
            ? slide.secondaryBullets
            : [];

        pptSlide.addShape(pptx.ShapeType.roundRect, {
          x: 0.7,
          y: 1.72,
          w: 4.1,
          h: 3.2,
          fill: { color: theme.surface },
          line: { color: theme.border, width: 1 },
          rectRadius: 0.08
        });
        pptSlide.addText(makeBulletRuns(leftBullets), {
          x: 0.9,
          y: 1.92,
          w: 3.7,
          h: 2.85,
          valign: 'top',
          fit: 'shrink'
        });

        pptSlide.addShape(pptx.ShapeType.roundRect, {
          x: 5.2,
          y: 1.72,
          w: 4.1,
          h: 3.2,
          fill: { color: theme.surface },
          line: { color: theme.border, width: 1 },
          rectRadius: 0.08
        });
        pptSlide.addText(makeBulletRuns(rightBullets.length > 0 ? rightBullets : leftBullets), {
          x: 5.4,
          y: 1.92,
          w: 3.7,
          h: 2.85,
          valign: 'top',
          fit: 'shrink'
        });
      } else if (slide.layout === 'stat_highlight') {
        // Big metric callout surface on the left, supporting points on the right
        pptSlide.addShape(pptx.ShapeType.roundRect, {
          x: 0.7,
          y: 1.78,
          w: 3.4,
          h: 3.05,
          fill: { color: theme.surface },
          line: { color: theme.accent, width: 1.5 },
          rectRadius: 0.1
        });

        pptSlide.addText(slide.highlightStat?.value || '100%', {
          x: 0.9,
          y: 2.15,
          w: 3.0,
          h: 1.2,
          fontFace: FONT_DISPLAY,
          fontSize: 44,
          bold: true,
          color: theme.accent,
          align: 'center',
          valign: 'middle',
          fit: 'shrink'
        });

        pptSlide.addText(slide.highlightStat?.label || slide.kicker || 'Key Metric', {
          x: 0.95,
          y: 3.45,
          w: 2.9,
          h: 1.0,
          fontFace: FONT_BODY,
          fontSize: 13,
          color: theme.muted,
          align: 'center',
          valign: 'top',
          fit: 'shrink'
        });

        pptSlide.addText(makeBulletRuns(slide.bullets), {
          x: 4.45,
          y: 1.82,
          w: 4.85,
          h: 3.1,
          valign: 'top',
          fit: 'shrink'
        });
      } else {
        // Default full-width bullets (or bullets + image if attached on bullets layout)
        if (imgData) {
          pptSlide.addText(makeBulletRuns(slide.bullets), {
            x: 0.7,
            y: 1.72,
            w: 4.9,
            h: 3.25,
            valign: 'top',
            fit: 'shrink'
          });
          pptSlide.addImage({
            data: imgData,
            x: 5.9,
            y: 1.78,
            w: 3.4,
            h: 2.75,
            sizing: { type: 'contain', w: 3.4, h: 2.75 }
          });
        } else {
          pptSlide.addText(makeBulletRuns(slide.bullets), {
            x: 0.7,
            y: 1.72,
            w: 8.6,
            h: 3.25,
            valign: 'top',
            fit: 'shrink'
          });
        }
      }
    }

    // Clean quiet footer
    pptSlide.addText(deck.title || 'J.A.R.V.I.S Presentation', {
      x: 0.7,
      y: 5.18,
      w: 6.5,
      h: 0.28,
      fontFace: FONT_BODY,
      fontSize: 9,
      color: theme.muted
    });

    pptSlide.addText(slideNumStr, {
      x: 7.8,
      y: 5.18,
      w: 1.5,
      h: 0.28,
      fontFace: FONT_BODY,
      fontSize: 9,
      bold: true,
      color: theme.muted,
      align: 'right'
    });

    // Attach PowerPoint Speaker Notes
    if (slide.speakerNotes && slide.speakerNotes.trim()) {
      pptSlide.addNotes(slide.speakerNotes.trim());
    }
  });

  const outBuf = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  const slug = (deck.title || 'jarvis_presentation')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

  return {
    buffer: Buffer.isBuffer(outBuf) ? outBuf : Buffer.from(outBuf),
    fileName: `${slug || 'jarvis_presentation'}.pptx`,
    embeddedImages: imageDataMap.size
  };
}
