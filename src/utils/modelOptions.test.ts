import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStudioModelOptions,
  DEFAULT_STUDIO_MODEL,
  isHeavyModelName,
  formatModelOptionLabel
} from './modelOptions';
import { buildHardwareProfile } from './hardwareTier';

test('buildStudioModelOptions prioritizes activeModel and vai-doc:latest without duplicates', () => {
  const opts = buildStudioModelOptions({
    activeModel: 'vai-doc:latest',
    installedModels: ['qwen2.5:3b', 'vai-doc:latest', 'llama3.2:3b'],
    generalModel: 'qwen2.5:3b',
    codingModel: 'qwen2.5-coder:7b'
  });

  assert.deepEqual(opts, [
    'vai-doc:latest',
    'qwen2.5:3b',
    'llama3.2:3b',
    'qwen2.5-coder:7b'
  ]);
});

test('buildStudioModelOptions preserves custom active model even when Ollama is offline', () => {
  const opts = buildStudioModelOptions({
    activeModel: 'vai-doc:q4_k_m',
    installedModels: [],
    generalModel: 'qwen2.5:3b',
    codingModel: 'qwen2.5-coder:7b'
  });

  assert.equal(opts[0], 'vai-doc:q4_k_m');
  assert.equal(opts[1], DEFAULT_STUDIO_MODEL);
  assert.ok(opts.includes('qwen2.5:3b'));
  assert.ok(opts.includes('qwen2.5-coder:7b'));
});

test('formatModelOptionLabel dynamically tags Optimal, Heavy, and Too Heavy per hardware tier', () => {
  const tier1 = buildHardwareProfile('Integrated / CPU', 0, 16);
  const tier2 = buildHardwareProfile('NVIDIA GeForce RTX 3050', 4, 16);
  const tier3 = buildHardwareProfile('NVIDIA GeForce RTX 4060', 8, 32);
  const tier4 = buildHardwareProfile('NVIDIA GeForce RTX 4090', 24, 64);

  // Tier 1: CPU / Low VRAM
  assert.equal(formatModelOptionLabel('qwen2.5:3b', undefined, tier1), 'qwen2.5:3b (Optimal)');
  assert.equal(formatModelOptionLabel('qwen2.5-coder:7b', undefined, tier1), 'qwen2.5-coder:7b (Too Heavy)');
  assert.equal(isHeavyModelName('qwen2.5-coder:7b', tier1), true);

  // Tier 2: Entry GPU (4 GB)
  assert.equal(formatModelOptionLabel('qwen2.5:3b', undefined, tier2), 'qwen2.5:3b (Optimal)');
  assert.equal(formatModelOptionLabel('qwen2.5-coder:7b', undefined, tier2), 'qwen2.5-coder:7b (Heavy)');
  assert.equal(formatModelOptionLabel('qwen2.5:14b', undefined, tier2), 'qwen2.5:14b (Too Heavy)');
  assert.equal(formatModelOptionLabel('auto', 'qwen2.5:3b', tier2), 'auto (qwen2.5:3b · Optimal)');
  assert.equal(formatModelOptionLabel('auto', 'qwen2.5-coder:7b', tier2), 'auto (qwen2.5-coder:7b · Heavy)');

  // Tier 3: Mid-Range GPU (8 GB) — 7B and 14B are Optimal, 20B+ is Heavy
  assert.equal(formatModelOptionLabel('qwen2.5-coder:7b', undefined, tier3), 'qwen2.5-coder:7b (Optimal)');
  assert.equal(formatModelOptionLabel('qwen2.5:14b', undefined, tier3), 'qwen2.5:14b (Optimal)');
  assert.equal(formatModelOptionLabel('codestral:22b', undefined, tier3), 'codestral:22b (Heavy)');
  assert.equal(isHeavyModelName('qwen2.5-coder:7b', tier3), false);

  // Tier 4: High-End GPU (24 GB) — 32B is Optimal
  assert.equal(formatModelOptionLabel('qwen2.5:32b', undefined, tier4), 'qwen2.5:32b (Optimal)');
  assert.equal(isHeavyModelName('qwen2.5:32b', tier4), false);
});


