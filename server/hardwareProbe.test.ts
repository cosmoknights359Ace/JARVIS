import test from 'node:test';
import assert from 'node:assert/strict';
import { detectHardwareProfile, parseNvidiaSmiCsv } from './hardwareProbe';

test('parseNvidiaSmiCsv parses single and multi-GPU outputs and rounds MiB cleanly', () => {
  assert.deepEqual(
    parseNvidiaSmiCsv('NVIDIA GeForce RTX 3050 Laptop GPU, 4096\n'),
    { gpuName: 'NVIDIA GeForce RTX 3050 Laptop GPU', vramGb: 4 }
  );

  // 8188 MiB on RTX 4060 should normalize to 8 GB (Mid-Range GPU, not 7.99 Entry GPU)
  assert.deepEqual(
    parseNvidiaSmiCsv('NVIDIA GeForce RTX 4060, 8188\n'),
    { gpuName: 'NVIDIA GeForce RTX 4060', vramGb: 8 }
  );

  // Multi-GPU picks highest-VRAM GPU
  assert.deepEqual(
    parseNvidiaSmiCsv(
      'NVIDIA GeForce GTX 1650, 4096\nNVIDIA GeForce RTX 4090, 24564\n'
    ),
    { gpuName: 'NVIDIA GeForce RTX 4090', vramGb: 24 }
  );

  assert.equal(parseNvidiaSmiCsv(''), null);
});

test('detectHardwareProfile handles NVIDIA GPUs on Windows and Linux', async () => {
  const profile = await detectHardwareProfile({
    platform: 'win32',
    arch: 'x64',
    totalMemBytes: () => 16 * 1024 ** 3,
    runNvidiaSmi: async () => 'NVIDIA GeForce RTX 3050, 4096\n'
  });

  assert.deepEqual(profile, {
    gpuName: 'NVIDIA GeForce RTX 3050',
    vramGb: 4,
    systemRamGb: 16,
    tier: 'Entry GPU',
    recommendedMaxParamsB: 4,
    defaultCtx: 4096
  });
});

test('detectHardwareProfile estimates ~70% unified GPU memory on Apple Silicon macOS', async () => {
  const m16 = await detectHardwareProfile({
    platform: 'darwin',
    arch: 'arm64',
    totalMemBytes: () => 16 * 1024 ** 3
  });

  assert.deepEqual(m16, {
    gpuName: 'Apple Silicon Unified GPU',
    vramGb: 11.2,
    systemRamGb: 16,
    tier: 'Mid-Range GPU',
    recommendedMaxParamsB: 14,
    defaultCtx: 8192
  });

  const m32 = await detectHardwareProfile({
    platform: 'darwin',
    arch: 'arm64',
    totalMemBytes: () => 32 * 1024 ** 3
  });

  assert.equal(m32.vramGb, 22.4);
  assert.equal(m32.tier, 'High-End GPU');
  assert.equal(m32.defaultCtx, 16384);
});

test('detectHardwareProfile falls back gracefully to Integrated / CPU when nvidia-smi fails', async () => {
  const fallback = await detectHardwareProfile({
    platform: 'linux',
    arch: 'x64',
    totalMemBytes: () => 8 * 1024 ** 3,
    runNvidiaSmi: async () => {
      throw new Error('ENOENT: nvidia-smi not found');
    }
  });

  assert.deepEqual(fallback, {
    gpuName: 'Integrated / CPU',
    vramGb: 0,
    systemRamGb: 8,
    tier: 'CPU / Low VRAM',
    recommendedMaxParamsB: 3,
    defaultCtx: 2048
  });
});
