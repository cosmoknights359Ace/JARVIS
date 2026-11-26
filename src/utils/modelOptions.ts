import {
  getModelFitBadge,
  HardwareProfile,
  ModelFitBadge,
  parseModelParamsB
} from './hardwareTier';

export const DEFAULT_STUDIO_MODEL = 'vai-doc:latest';

/**
 * Builds an ordered, deduplicated list of Ollama model tags for studio selectors
 * (Xfill, Xslide, and Settings), prioritizing the user's active model, vai-doc:latest,
 * installed local models, and configured defaults.
 */
export function buildStudioModelOptions(params: {
  activeModel?: string;
  installedModels?: string[];
  generalModel?: string;
  codingModel?: string;
}): string[] {
  const candidates = [
    params.activeModel,
    DEFAULT_STUDIO_MODEL,
    ...(params.installedModels || []),
    params.generalModel || 'qwen2.5:3b',
    params.codingModel || 'qwen2.5-coder:7b'
  ];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of candidates) {
    const clean = typeof item === 'string' ? item.trim() : '';
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }

  return result;
}

/**
 * Returns true when a model is classified as Heavy or Too Heavy for the given
 * hardware profile (defaults to Entry GPU when hardware is omitted).
 */
export function isHeavyModelName(
  modelName: string,
  hardware?: Pick<HardwareProfile, 'vramGb' | 'tier'> | null
): boolean {
  if (!hardware) {
    const billions = parseModelParamsB(modelName);
    return billions !== null && billions >= 7;
  }
  const badge = getModelFitBadge(modelName, hardware);
  return badge === 'Heavy' || badge === 'Too Heavy';
}

/**
 * Returns the dynamic fit badge (`Optimal`, `Heavy`, or `Too Heavy`) for a model
 * on the user's detected hardware tier.
 */
export function getModelOptionBadge(
  modelName: string,
  hardware?: Pick<HardwareProfile, 'vramGb' | 'tier'> | null
): ModelFitBadge {
  return getModelFitBadge(modelName, hardware);
}

/**
 * Formats a model identifier for <select> option labels, dynamically tagging
 * each model with `(Optimal)`, `(Heavy)`, or `(Too Heavy)` based on the user's
 * detected hardware tier.
 */
export function formatModelOptionLabel(
  modelName: string,
  resolvedForAuto?: string,
  hardware?: Pick<HardwareProfile, 'vramGb' | 'tier'> | null
): string {
  const clean = (modelName || '').trim();
  if (!clean) return '';
  if (clean === 'auto') {
    if (!resolvedForAuto) return 'auto';
    const resolvedClean = resolvedForAuto.trim();
    const badge = getModelFitBadge(resolvedClean, hardware);
    return `auto (${resolvedClean} · ${badge})`;
  }
  const badge = getModelFitBadge(clean, hardware);
  return `${clean} (${badge})`;
}

