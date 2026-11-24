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

const MODEL_PARAM_SIZE_REGEX = /(?:^|[:\-_.\s])(\d+(?:\.\d+)?)b(?=$|[:\-_.\s])/i;

/**
 * Returns true when an Ollama model tag specifies >= 7B parameters
 * (e.g., qwen2.5-coder:7b, llama3.1:8b, qwen2.5:14b) so UI dropdowns can
 * label them as "Heavy" on 4 GB VRAM systems.
 */
export function isHeavyModelName(modelName: string): boolean {
  if (typeof modelName !== 'string' || !modelName.trim()) return false;
  const match = modelName.trim().match(MODEL_PARAM_SIZE_REGEX);
  if (!match) return false;
  const billions = parseFloat(match[1]);
  return Number.isFinite(billions) && billions >= 7;
}

/**
 * Formats a model identifier for <select> option labels, appending a subtle
 * "(Heavy)" indicator for 7B+ models.
 */
export function formatModelOptionLabel(modelName: string, resolvedForAuto?: string): string {
  const clean = (modelName || '').trim();
  if (!clean) return '';
  if (clean === 'auto') {
    if (!resolvedForAuto) return 'auto';
    return `auto (${formatModelOptionLabel(resolvedForAuto)})`;
  }
  return isHeavyModelName(clean) ? `${clean} (Heavy)` : clean;
}

