/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 cosmoknight — J.A.R.V.I.S Hardware-Aware VRAM Tiering
 *
 * Pure, runtime-agnostic classification of GPU/VRAM tiers, Ollama model
 * parameter-size parsing, dynamic `num_ctx` guardrails, model fit badges,
 * and tier-aware auto-routing / warm-up model selection.
 */

export type HardwareTier =
  | 'CPU / Low VRAM'
  | 'Entry GPU'
  | 'Mid-Range GPU'
  | 'High-End GPU';

export type ModelFitBadge = 'Optimal' | 'Heavy' | 'Too Heavy';

export interface HardwareProfile {
  gpuName: string;
  vramGb: number;
  systemRamGb: number;
  tier: HardwareTier;
  recommendedMaxParamsB: number;
  defaultCtx: number;
}

const MOE_PARAM_REGEX = /(?:^|[:\-_.\s])(\d+)x(\d+(?:\.\d+)?)b(?=$|[:\-_.\s])/i;
const SINGLE_PARAM_REGEX = /(?:^|[:\-_.\s])(\d+(?:\.\d+)?)b(?=$|[:\-_.\s])/i;
const UTILITY_MODEL_REGEX = /vision|embed|minilm|nomic|bge|mxbai|rerank/i;
const CODER_MODEL_REGEX = /coder|codellama|starcoder|codegemma|codestral|devstral/i;

/**
 * Parses parameter size in billions from an Ollama model identifier
 * (e.g., `qwen2.5:3b` -> 3, `llama3.1:8b-instruct` -> 8, `qwen2.5:14b` -> 14,
 * `mixtral:8x7b` -> 56). Returns `null` if no explicit size tag is present.
 */
export function parseModelParamsB(modelName: string): number | null {
  if (typeof modelName !== 'string' || !modelName.trim()) return null;
  const trimmed = modelName.trim();

  const moeMatch = trimmed.match(MOE_PARAM_REGEX);
  if (moeMatch) {
    const experts = parseInt(moeMatch[1], 10);
    const perExpert = parseFloat(moeMatch[2]);
    if (Number.isFinite(experts) && Number.isFinite(perExpert) && experts > 0 && perExpert > 0) {
      return Number((experts * perExpert).toFixed(1));
    }
  }

  const match = trimmed.match(SINGLE_PARAM_REGEX);
  if (!match) return null;
  const billions = parseFloat(match[1]);
  return Number.isFinite(billions) && billions > 0 ? billions : null;
}

export function isNonChatUtilityModel(modelName: string): boolean {
  return UTILITY_MODEL_REGEX.test(modelName || '');
}

export function isCoderModelName(modelName: string): boolean {
  return CODER_MODEL_REGEX.test(modelName || '');
}

/**
 * Normalizes a numeric GB value to clean display precision (e.g., 8.0 -> 8, 11.2 -> 11.2).
 */
export function roundGb(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const rounded = Math.round(value * 10) / 10;
  return Math.abs(rounded - Math.round(rounded)) < 0.05 ? Math.round(rounded) : rounded;
}

/**
 * Classifies hardware into one of 4 adaptive VRAM tiers.
 */
export function classifyHardwareTier(vramGb: number): {
  tier: HardwareTier;
  recommendedMaxParamsB: number;
  defaultCtx: number;
} {
  const safeVram = Number.isFinite(vramGb) && vramGb > 0 ? vramGb : 0;

  if (safeVram >= 16) {
    return {
      tier: 'High-End GPU',
      recommendedMaxParamsB: 32,
      defaultCtx: 16384
    };
  }
  if (safeVram >= 8) {
    return {
      tier: 'Mid-Range GPU',
      recommendedMaxParamsB: 14,
      defaultCtx: 8192
    };
  }
  if (safeVram >= 4) {
    return {
      tier: 'Entry GPU',
      recommendedMaxParamsB: 4,
      defaultCtx: 4096
    };
  }
  return {
    tier: 'CPU / Low VRAM',
    recommendedMaxParamsB: 3,
    defaultCtx: 2048
  };
}

export function buildHardwareProfile(
  gpuName: string,
  vramGb: number,
  systemRamGb: number
): HardwareProfile {
  const normalizedVram = roundGb(vramGb);
  const normalizedRam = roundGb(systemRamGb);
  const classification = classifyHardwareTier(normalizedVram);

  return {
    gpuName: (gpuName || 'Integrated / CPU').trim() || 'Integrated / CPU',
    vramGb: normalizedVram,
    systemRamGb: normalizedRam,
    ...classification
  };
}

/**
 * Default fallback hardware profile (Entry GPU) when hardware info has not loaded yet.
 */
export const DEFAULT_FALLBACK_HARDWARE: HardwareProfile = buildHardwareProfile(
  'Entry GPU',
  4,
  16
);

/**
 * Dynamic `options.num_ctx` allocation based on detected VRAM tier and model size:
 * - Tier 1 (CPU / Low VRAM, < 4 GB): 2048 for <= 3B, 1536 for 4B-6B, 1024 for 7B+
 * - Tier 2 (Entry GPU, 4-8 GB):      4096 for <= 4B, 3072 for 7B-8B (< 13B), 2048 for 13B+
 * - Tier 3 (Mid-Range GPU, 8-16 GB): 8192 for <= 8B, 4096 for 13B-14B (<= 14B), 2048 for 20B+
 * - Tier 4 (High-End GPU, >= 16 GB): 16384 for <= 14B, 8192 for 20B+ (> 14B)
 */
export function resolveTierNumCtx(
  modelName: string,
  hardware?: Pick<HardwareProfile, 'vramGb' | 'tier'> | null
): number {
  const effective = hardware ?? DEFAULT_FALLBACK_HARDWARE;
  const tier = effective.tier || classifyHardwareTier(effective.vramGb).tier;
  const paramsB = parseModelParamsB(modelName);

  if (tier === 'High-End GPU') {
    if (paramsB === null || paramsB <= 14) return 16384;
    return 8192;
  }

  if (tier === 'Mid-Range GPU') {
    if (paramsB === null || paramsB <= 8) return 8192;
    if (paramsB <= 14) return 4096;
    return 2048;
  }

  if (tier === 'Entry GPU') {
    if (paramsB === null || paramsB <= 4) return 4096;
    if (paramsB < 13) return 3072;
    return 2048;
  }

  // Tier 1: CPU / Low VRAM (< 4 GB)
  if (paramsB === null || paramsB <= 3) return 2048;
  if (paramsB < 7) return 1536;
  return 1024;
}

/**
 * Dynamic model fit badge (`Optimal`, `Heavy`, or `Too Heavy`) for the detected hardware tier.
 */
export function getModelFitBadge(
  modelName: string,
  hardware?: Pick<HardwareProfile, 'vramGb' | 'tier'> | null
): ModelFitBadge {
  const effective = hardware ?? DEFAULT_FALLBACK_HARDWARE;
  const tier = effective.tier || classifyHardwareTier(effective.vramGb).tier;
  const paramsB = parseModelParamsB(modelName);

  // Models without an explicit size tag (e.g., fine-tuned 3B/small GGUF `vai-doc:latest`)
  if (paramsB === null) {
    return 'Optimal';
  }

  if (tier === 'High-End GPU') {
    if (paramsB <= 32) return 'Optimal';
    if (paramsB >= 70 && effective.vramGb < 40) return 'Too Heavy';
    return 'Heavy';
  }

  if (tier === 'Mid-Range GPU') {
    if (paramsB <= 14) return 'Optimal';
    if (paramsB >= 65) return 'Too Heavy';
    return 'Heavy';
  }

  if (tier === 'Entry GPU') {
    if (paramsB <= 4) return 'Optimal';
    if (paramsB >= 13) return 'Too Heavy';
    return 'Heavy';
  }

  // Tier 1: CPU / Low VRAM (< 4 GB)
  if (paramsB <= 3) return 'Optimal';
  if (paramsB >= 7) return 'Too Heavy';
  return 'Heavy';
}

export interface SelectTierModelOptions {
  hardware?: Pick<HardwareProfile, 'vramGb' | 'tier' | 'recommendedMaxParamsB'> | null;
  preferCoding?: boolean;
  preferredDefault?: string;
  /**
   * When true (e.g. active chat auto-routing), if no installed model fits within
   * `recommendedMaxParamsB`, fall back to the smallest installed chat model so chat
   * still works. When false (e.g. startup warm-up), return `null` instead of loading
   * an oversized model into VRAM.
   */
  allowUnfitFallback?: boolean;
}

/**
 * Selects the highest-capability installed chat model that fits comfortably
 * inside the detected hardware tier's `recommendedMaxParamsB`.
 */
export function selectBestModelForTier(
  installedModels: string[],
  options: SelectTierModelOptions = {}
): string | null {
  if (!Array.isArray(installedModels) || installedModels.length === 0) {
    return null;
  }

  const effectiveHw = options.hardware ?? DEFAULT_FALLBACK_HARDWARE;
  const maxParamsB =
    typeof effectiveHw.recommendedMaxParamsB === 'number' && effectiveHw.recommendedMaxParamsB > 0
      ? effectiveHw.recommendedMaxParamsB
      : classifyHardwareTier(effectiveHw.vramGb).recommendedMaxParamsB;

  const preferCoding = Boolean(options.preferCoding);
  const prefLower = (options.preferredDefault || '').trim().toLowerCase();
  const prefBase = prefLower ? prefLower.split(':')[0] : '';

  const candidates = installedModels
    .map((raw, index) => {
      const name = String(raw || '').trim();
      return {
        name,
        lower: name.toLowerCase(),
        paramsB: parseModelParamsB(name),
        isCoder: isCoderModelName(name),
        index
      };
    })
    .filter((item) => Boolean(item.name) && !isNonChatUtilityModel(item.name));

  if (candidates.length === 0) {
    return null;
  }

  // Models with explicit parameter sizes that fit comfortably within the tier
  const sizedFitting = candidates.filter(
    (c) => c.paramsB !== null && c.paramsB <= maxParamsB
  );

  // Untagged chat models (e.g., `llama3:latest` or `vai-doc:latest`)
  const untagged = candidates.filter((c) => c.paramsB === null);

  const pickBestFromPool = (pool: typeof candidates): string | null => {
    if (pool.length === 0) return null;
    const sorted = [...pool].sort((a, b) => {
      // 1. Prefer highest parameter size that still fits inside recommendedMaxParamsB
      const sizeDiff = (b.paramsB ?? 0) - (a.paramsB ?? 0);
      if (sizeDiff !== 0) return sizeDiff;

      // 2. Match coding vs general specialization
      if (preferCoding) {
        if (a.isCoder !== b.isCoder) return a.isCoder ? -1 : 1;
      } else {
        if (a.isCoder !== b.isCoder) return a.isCoder ? 1 : -1;
      }

      // 3. Tie-break on preferredDefault exact/base match
      if (prefLower) {
        const aExact = a.lower === prefLower ? 1 : 0;
        const bExact = b.lower === prefLower ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;

        const aBase = prefBase && a.lower.startsWith(`${prefBase}:`) ? 1 : 0;
        const bBase = prefBase && b.lower.startsWith(`${prefBase}:`) ? 1 : 0;
        if (aBase !== bBase) return bBase - aBase;
      }

      // 4. Preserve original installed order
      return a.index - b.index;
    });
    return sorted[0]?.name ?? null;
  };

  if (sizedFitting.length > 0) {
    if (preferCoding) {
      const fittingCoders = sizedFitting.filter((c) => c.isCoder);
      if (fittingCoders.length > 0) {
        return pickBestFromPool(fittingCoders);
      }
    } else {
      const fittingGeneral = sizedFitting.filter((c) => !c.isCoder);
      if (fittingGeneral.length > 0) {
        return pickBestFromPool(fittingGeneral);
      }
    }
    return pickBestFromPool(sizedFitting);
  }

  if (untagged.length > 0) {
    return pickBestFromPool(untagged);
  }

  if (options.allowUnfitFallback) {
    // Graceful chat fallback when all installed models exceed recommendedMaxParamsB:
    // pick the smallest installed chat model to minimize OOM/swap pressure.
    const smallestFirst = [...candidates].sort((a, b) => {
      const sizeDiff = (a.paramsB ?? Number.POSITIVE_INFINITY) - (b.paramsB ?? Number.POSITIVE_INFINITY);
      if (sizeDiff !== 0) return sizeDiff;
      if (preferCoding && a.isCoder !== b.isCoder) return a.isCoder ? -1 : 1;
      return a.index - b.index;
    });
    return smallestFirst[0]?.name ?? null;
  }

  return null;
}

/**
 * Produces a concise GPU label for compact single-line diagnostics while
 * preserving the recognizable GPU model (e.g., `NVIDIA GeForce RTX 3050 Laptop GPU` -> `RTX 3050`).
 */
export function shortenGpuName(gpuName: string): string {
  const clean = (gpuName || 'Integrated / CPU').trim();
  if (!clean) return 'Integrated / CPU';
  return clean
    .replace(/^NVIDIA\s+GeForce\s+/i, '')
    .replace(/^NVIDIA\s+/i, '')
    .replace(/\s+Laptop\s+GPU$/i, '')
    .replace(/\s+Unified\s+GPU$/i, '')
    .trim();
}

/**
 * Formats the single-line hardware readout showing GPU, VRAM, System RAM, and active tier.
 * Example: `RTX 3050 · 4 GB VRAM · 16 GB RAM · Entry GPU`
 */
export function formatHardwareReadout(
  hardware: HardwareProfile,
  options: { compact?: boolean } = {}
): string {
  const gpuLabel = options.compact ? shortenGpuName(hardware.gpuName) : hardware.gpuName;
  const vramText = `${roundGb(hardware.vramGb)} GB VRAM`;
  const ramText = `${roundGb(hardware.systemRamGb)} GB RAM`;
  return `${gpuLabel} · ${vramText} · ${ramText} · ${hardware.tier}`;
}
