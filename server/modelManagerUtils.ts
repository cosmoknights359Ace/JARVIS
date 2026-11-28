/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 cosmoknight — J.A.R.V.I.S Server Model Manager Helpers
 *
 * Host validation and Ollama model management helpers for Express routes.
 */

import {
  isValidOllamaModelTag,
  consumeOllamaPullNdjson,
  computePullPercent
} from '../src/utils/modelManager.ts';

export { isValidOllamaModelTag, consumeOllamaPullNdjson, computePullPercent };

const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434';
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Validates and normalizes an Ollama base URL to prevent SSRF to non-local hosts
 * or cloud metadata endpoints. Permits loopback addresses (`127.0.0.1`, `localhost`,
 * `[::1]`) or an origin explicitly configured via `OLLAMA_HOST`.
 */
export function resolveSafeOllamaHost(
  rawHost?: string | null,
  envHost: string | undefined = process.env.OLLAMA_HOST
): { ok: true; host: string } | { ok: false; error: string } {
  const candidate = (typeof rawHost === 'string' && rawHost.trim()) || envHost?.trim() || DEFAULT_OLLAMA_HOST;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: 'Invalid Ollama host URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Ollama host must use http or https.' };
  }

  const normalizedHostname = parsed.hostname.toLowerCase();
  const isLoopback = LOOPBACK_HOSTNAMES.has(normalizedHostname);

  let matchesConfiguredEnv = false;
  if (envHost && envHost.trim()) {
    try {
      const envParsed = new URL(envHost.trim());
      matchesConfiguredEnv = envParsed.origin.toLowerCase() === parsed.origin.toLowerCase();
    } catch {
      matchesConfiguredEnv = false;
    }
  }

  if (!isLoopback && !matchesConfiguredEnv) {
    return {
      ok: false,
      error: 'Only local Ollama endpoints (localhost / 127.0.0.1) or configured OLLAMA_HOST are allowed.'
    };
  }

  // Normalize localhost -> 127.0.0.1 to avoid IPv6 resolution delays on Windows/Linux
  const hostOut =
    normalizedHostname === 'localhost'
      ? `${parsed.protocol}//127.0.0.1${parsed.port ? `:${parsed.port}` : ''}`
      : parsed.origin;

  return { ok: true, host: hostOut.replace(/\/+$/, '') };
}
