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
