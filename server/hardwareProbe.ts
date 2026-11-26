/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 cosmoknight — J.A.R.V.I.S Surface-Level Hardware Probe
 *
 * Performs a fast, one-time, non-invasive hardware detection on server startup
 * and caches the surface-level profile in memory (no continuous polling,
 * no serial numbers or deep telemetry).
 */

import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  buildHardwareProfile,
  HardwareProfile,
  roundGb
} from '../src/utils/hardwareTier.ts';

const execFileAsync = promisify(execFile);

export interface HardwareProbeDeps {
  platform?: NodeJS.Platform;
  arch?: string;
  totalMemBytes?: () => number;
  runNvidiaSmi?: () => Promise<string>;
}

/**
 * Parses `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits`
 * output (MiB) and picks the primary/highest-VRAM GPU.
 */
export function parseNvidiaSmiCsv(stdout: string): { gpuName: string; vramGb: number } | null {
  if (typeof stdout !== 'string' || !stdout.trim()) return null;

  let best: { gpuName: string; vramGb: number; mib: number } | null = null;
  const lines = stdout.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const commaIdx = line.lastIndexOf(',');
    if (commaIdx <= 0) continue;

    const gpuName = line.slice(0, commaIdx).trim();
    const rawMib = line.slice(commaIdx + 1).trim();
    const mib = parseFloat(rawMib);
    if (!gpuName || !Number.isFinite(mib) || mib <= 0) continue;

    const vramGb = roundGb(mib / 1024);
    if (!best || mib > best.mib) {
      best = { gpuName, vramGb, mib };
    }
  }

  return best ? { gpuName: best.gpuName, vramGb: best.vramGb } : null;
}

async function defaultRunNvidiaSmi(): Promise<string> {
  const { stdout } = await execFileAsync(
    'nvidia-smi',
    ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
    {
      timeout: 1500,
      windowsHide: true,
      maxBuffer: 128 * 1024
    }
  );
  return String(stdout || '');
}

/**
 * Surface-level hardware probe:
 * 1. System RAM via `os.totalmem()`.
 * 2. Apple Silicon (`darwin` + `arm64`): estimates usable unified GPU memory as ~70% of RAM.
 * 3. NVIDIA (Windows/Linux): runs `nvidia-smi` with 1500ms timeout and `windowsHide: true`.
 * 4. Fallback (AMD/Intel/CPU-only): returns `{ gpuName: 'Integrated / CPU', vramGb: 0 }`.
 */
export async function detectHardwareProfile(
  deps: HardwareProbeDeps = {}
): Promise<HardwareProfile> {
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const totalBytes = deps.totalMemBytes ? deps.totalMemBytes() : os.totalmem();
  const systemRamGb = roundGb(totalBytes / 1024 ** 3);

  // Apple Silicon unified memory heuristic (~70% usable by GPU)
  if (platform === 'darwin' && arch === 'arm64') {
    const usableVramGb = roundGb(systemRamGb * 0.7);
    return buildHardwareProfile('Apple Silicon Unified GPU', usableVramGb, systemRamGb);
  }

  // NVIDIA discrete GPU probe (Windows / Linux)
  if (platform === 'win32' || platform === 'linux') {
    try {
      const stdout = deps.runNvidiaSmi
        ? await deps.runNvidiaSmi()
        : await defaultRunNvidiaSmi();
      const parsed = parseNvidiaSmiCsv(stdout);
      if (parsed) {
        return buildHardwareProfile(parsed.gpuName, parsed.vramGb, systemRamGb);
      }
    } catch {
      // Gracefully fall back when nvidia-smi is absent, fails, or times out
    }
  }

  return buildHardwareProfile('Integrated / CPU', 0, systemRamGb);
}

let cachedHardwareProfile: HardwareProfile | null = null;
let probePromise: Promise<HardwareProfile> | null = null;

/**
 * Runs the one-time hardware probe at startup and caches the result in memory.
 */
export async function initHardwareProfile(): Promise<HardwareProfile> {
  if (cachedHardwareProfile) return cachedHardwareProfile;
  if (!probePromise) {
    probePromise = detectHardwareProfile()
      .then((profile) => {
        cachedHardwareProfile = profile;
        return profile;
      })
      .catch(() => {
        const fallbackRam = roundGb(os.totalmem() / 1024 ** 3);
        const fallback = buildHardwareProfile('Integrated / CPU', 0, fallbackRam);
        cachedHardwareProfile = fallback;
        return fallback;
      });
  }
  return probePromise;
}

/**
 * Returns the cached hardware profile synchronously (falls back to a safe CPU profile
 * if called before `initHardwareProfile()` resolves).
 */
export function getCachedHardwareProfile(): HardwareProfile {
  if (cachedHardwareProfile) return cachedHardwareProfile;
  const fallbackRam = roundGb(os.totalmem() / 1024 ** 3);
  return buildHardwareProfile('Integrated / CPU', 0, fallbackRam);
}
