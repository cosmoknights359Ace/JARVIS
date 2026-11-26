import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHardwareProfile,
  classifyHardwareTier,
  formatHardwareReadout,
  getModelFitBadge,
  parseModelParamsB,
  resolveTierNumCtx,
  selectBestModelForTier
} from './hardwareTier';

test('parseModelParamsB parses integer, decimal, and MoE parameter counts', () => {
  assert.equal(parseModelParamsB('qwen2.5:0.5b'), 0.5);
  assert.equal(parseModelParamsB('qwen2.5:1.5b'), 1.5);
  assert.equal(parseModelParamsB('qwen2.5:3b'), 3);
  assert.equal(parseModelParamsB('phi3:3.8b-mini'), 3.8);
  assert.equal(parseModelParamsB('qwen2.5-coder:7b'), 7);
  assert.equal(parseModelParamsB('llama3.1:8b-instruct-q4_K_M'), 8);
  assert.equal(parseModelParamsB('deepseek-r1:14b'), 14);
  assert.equal(parseModelParamsB('qwen2.5:32b'), 32);
  assert.equal(parseModelParamsB('llama3.3:70b'), 70);
  assert.equal(parseModelParamsB('mixtral:8x7b'), 56);
  assert.equal(parseModelParamsB('vai-doc:latest'), null);
  assert.equal(parseModelParamsB('llama3.2-vision:latest'), null);
});

test('classifyHardwareTier maps VRAM thresholds across all 4 tiers', () => {
  assert.deepEqual(classifyHardwareTier(0), {
    tier: 'CPU / Low VRAM',
    recommendedMaxParamsB: 3,
    defaultCtx: 2048
  });
  assert.deepEqual(classifyHardwareTier(3.9), {
    tier: 'CPU / Low VRAM',
    recommendedMaxParamsB: 3,
    defaultCtx: 2048
  });
  assert.deepEqual(classifyHardwareTier(4), {
    tier: 'Entry GPU',
    recommendedMaxParamsB: 4,
    defaultCtx: 4096
  });
  assert.deepEqual(classifyHardwareTier(6), {
    tier: 'Entry GPU',
    recommendedMaxParamsB: 4,
    defaultCtx: 4096
  });
  assert.deepEqual(classifyHardwareTier(8), {
    tier: 'Mid-Range GPU',
    recommendedMaxParamsB: 14,
    defaultCtx: 8192
  });
  assert.deepEqual(classifyHardwareTier(12), {
    tier: 'Mid-Range GPU',
    recommendedMaxParamsB: 14,
    defaultCtx: 8192
  });
  assert.deepEqual(classifyHardwareTier(16), {
    tier: 'High-End GPU',
    recommendedMaxParamsB: 32,
    defaultCtx: 16384
  });
  assert.deepEqual(classifyHardwareTier(24), {
    tier: 'High-End GPU',
    recommendedMaxParamsB: 32,
    defaultCtx: 16384
  });
});

test('resolveTierNumCtx enforces dynamic context window rules for all 4 tiers', () => {
  const tier1 = buildHardwareProfile('Integrated / CPU', 0, 16);
  const tier2 = buildHardwareProfile('NVIDIA GeForce RTX 3050', 4, 16);
  const tier3 = buildHardwareProfile('NVIDIA GeForce RTX 4060', 8, 32);
  const tier4 = buildHardwareProfile('NVIDIA GeForce RTX 4090', 24, 64);

  // Tier 1: CPU / Low VRAM (< 4 GB)
  assert.equal(resolveTierNumCtx('qwen2.5:3b', tier1), 2048);
  assert.equal(resolveTierNumCtx('qwen2.5-coder:7b', tier1), 1024);
  assert.equal(resolveTierNumCtx('qwen2.5:14b', tier1), 1024);

  // Tier 2: Entry GPU (4-8 GB)
  assert.equal(resolveTierNumCtx('qwen2.5:3b', tier2), 4096);
  assert.equal(resolveTierNumCtx('gemma3:4b', tier2), 4096);
  assert.equal(resolveTierNumCtx('qwen2.5-coder:7b', tier2), 3072);
  assert.equal(resolveTierNumCtx('llama3.1:8b', tier2), 3072);
  assert.equal(resolveTierNumCtx('qwen2.5:14b', tier2), 2048);

  // Tier 3: Mid-Range GPU (8-16 GB)
  assert.equal(resolveTierNumCtx('qwen2.5:3b', tier3), 8192);
  assert.equal(resolveTierNumCtx('llama3.1:8b', tier3), 8192);
  assert.equal(resolveTierNumCtx('deepseek-r1:14b', tier3), 4096);
  assert.equal(resolveTierNumCtx('codestral:22b', tier3), 2048);

  // Tier 4: High-End GPU (>= 16 GB)
  assert.equal(resolveTierNumCtx('qwen2.5:14b', tier4), 16384);
  assert.equal(resolveTierNumCtx('codestral:22b', tier4), 8192);
  assert.equal(resolveTierNumCtx('qwen2.5:32b', tier4), 8192);
});

test('getModelFitBadge dynamically classifies Optimal, Heavy, and Too Heavy per tier', () => {
  const tier1 = buildHardwareProfile('Integrated / CPU', 0, 16);
  const tier2 = buildHardwareProfile('NVIDIA GeForce RTX 3050', 4, 16);
  const tier3 = buildHardwareProfile('NVIDIA GeForce RTX 4060', 8, 32);
  const tier4 = buildHardwareProfile('NVIDIA GeForce RTX 4090', 24, 64);

  // Tier 1 (< 4 GB): <= 3B Optimal, 7B+ Too Heavy
  assert.equal(getModelFitBadge('qwen2.5:3b', tier1), 'Optimal');
  assert.equal(getModelFitBadge('qwen2.5-coder:7b', tier1), 'Too Heavy');
  assert.equal(getModelFitBadge('qwen2.5:14b', tier1), 'Too Heavy');

  // Tier 2 (4-8 GB): <= 4B Optimal, 7B-8B Heavy, 13B+ Too Heavy
  assert.equal(getModelFitBadge('qwen2.5:3b', tier2), 'Optimal');
  assert.equal(getModelFitBadge('gemma3:4b', tier2), 'Optimal');
  assert.equal(getModelFitBadge('qwen2.5-coder:7b', tier2), 'Heavy');
  assert.equal(getModelFitBadge('llama3.1:8b', tier2), 'Heavy');
  assert.equal(getModelFitBadge('llama2:13b', tier2), 'Too Heavy');
  assert.equal(getModelFitBadge('qwen2.5:14b', tier2), 'Too Heavy');

  // Tier 3 (8-16 GB): <= 14B Optimal, 20B+ Heavy
  assert.equal(getModelFitBadge('qwen2.5-coder:7b', tier3), 'Optimal');
  assert.equal(getModelFitBadge('qwen2.5:14b', tier3), 'Optimal');
  assert.equal(getModelFitBadge('codestral:22b', tier3), 'Heavy');
  assert.equal(getModelFitBadge('qwen2.5:32b', tier3), 'Heavy');

  // Tier 4 (>= 16 GB): <= 32B Optimal
  assert.equal(getModelFitBadge('qwen2.5:14b', tier4), 'Optimal');
  assert.equal(getModelFitBadge('qwen2.5:32b', tier4), 'Optimal');
});

test('selectBestModelForTier prefers highest-capability installed model fitting recommendedMaxParamsB', () => {
  const models = [
    'qwen2.5:1.5b',
    'qwen2.5:3b',
    'qwen2.5-coder:7b',
    'llama3.1:8b',
    'qwen2.5:14b',
    'qwen2.5-coder:14b',
    'qwen2.5:32b',
    'llama3.2-vision:latest',
    'nomic-embed-text:latest'
  ];

  const tier1 = buildHardwareProfile('Integrated / CPU', 0, 16);
  const tier2 = buildHardwareProfile('NVIDIA GeForce RTX 3050', 4, 16);
  const tier3 = buildHardwareProfile('NVIDIA GeForce RTX 4060', 12, 32);
  const tier4 = buildHardwareProfile('NVIDIA GeForce RTX 4090', 24, 64);

  assert.equal(selectBestModelForTier(models, { hardware: tier1 }), 'qwen2.5:3b');
  assert.equal(selectBestModelForTier(models, { hardware: tier2 }), 'qwen2.5:3b');
  assert.equal(selectBestModelForTier(models, { hardware: tier3 }), 'qwen2.5:14b');
  assert.equal(
    selectBestModelForTier(models, { hardware: tier3, preferCoding: true }),
    'qwen2.5-coder:14b'
  );
  assert.equal(selectBestModelForTier(models, { hardware: tier4 }), 'qwen2.5:32b');
});

test('formatHardwareReadout formats concise single-line readout with GPU, VRAM, RAM, and tier', () => {
  const rtx = buildHardwareProfile('NVIDIA GeForce RTX 3050 Laptop GPU', 4, 16);
  assert.equal(
    formatHardwareReadout(rtx, { compact: true }),
    'RTX 3050 · 4 GB VRAM · 16 GB RAM · Entry GPU'
  );

  const cpu = buildHardwareProfile('Integrated / CPU', 0, 8);
  assert.equal(
    formatHardwareReadout(cpu, { compact: true }),
    'Integrated / CPU · 0 GB VRAM · 8 GB RAM · CPU / Low VRAM'
  );
});
