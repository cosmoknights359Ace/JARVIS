import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeOllamaNdjson,
  isHeavyOllamaModel,
  resolveOllamaNumCtx,
  resolveChatOllamaNumCtx,
  pickWarmUpModel
} from './ollamaStreamUtils';
import { buildHardwareProfile } from '../src/utils/hardwareTier';

test('consumeOllamaNdjson buffers JSON lines split across TCP chunks and forwards done_reason', () => {
  const step1 = consumeOllamaNdjson('', '{"message":{"content":"def fix"},"done":false}\n{"message":{"con');
  assert.deepEqual(step1.events, [{ text: 'def fix', done: false }]);
  assert.equal(step1.remainder, '{"message":{"con');

  const step2 = consumeOllamaNdjson(
    step1.remainder,
    'tent":"()"},"done":false}\n{"done":true,"done_reason":"length"}\n'
  );
  assert.deepEqual(step2.events, [
    { text: '()', done: false },
    { text: undefined, done: true, doneReason: 'length' }
  ]);
  assert.equal(step2.remainder, '');
});

test('consumeOllamaNdjson surfaces Ollama error payloads immediately', () => {
  const step = consumeOllamaNdjson('', '{"error":"model requires more system memory"}\n');
  assert.deepEqual(step.events, [{ error: 'model requires more system memory' }]);
});

test('resolveChatOllamaNumCtx dynamically scales context window across all 4 VRAM tiers', () => {
  assert.equal(isHeavyOllamaModel('qwen2.5:3b'), false);
  assert.equal(isHeavyOllamaModel('llama3.2:1b'), false);
  assert.equal(isHeavyOllamaModel('vai-doc:latest'), false);
  assert.equal(isHeavyOllamaModel('qwen2.5-coder:7b'), true);
  assert.equal(isHeavyOllamaModel('llama3.1:8b-instruct-q4_K_M'), true);
  assert.equal(isHeavyOllamaModel('qwen2.5:14b'), true);

  const tier1 = buildHardwareProfile('Integrated / CPU', 0, 16);
  const tier2 = buildHardwareProfile('NVIDIA GeForce RTX 3050', 4, 16);
  const tier3 = buildHardwareProfile('NVIDIA GeForce RTX 4060', 8, 32);
  const tier4 = buildHardwareProfile('NVIDIA GeForce RTX 4090', 24, 64);

  // Tier 1 (< 4 GB)
  assert.equal(resolveChatOllamaNumCtx('qwen2.5:3b', tier1), 2048);
  assert.equal(resolveChatOllamaNumCtx('qwen2.5-coder:7b', tier1), 1024);

  // Tier 2 (4-8 GB) and default fallback
  assert.equal(resolveChatOllamaNumCtx('qwen2.5:3b', tier2), 4096);
  assert.equal(resolveChatOllamaNumCtx('qwen2.5-coder:7b', tier2), 3072);
  assert.equal(resolveChatOllamaNumCtx('llama3.1:8b-instruct-q4_K_M'), 3072);

  // Tier 3 (8-16 GB)
  assert.equal(resolveChatOllamaNumCtx('llama3.1:8b', tier3), 8192);
  assert.equal(resolveChatOllamaNumCtx('deepseek-r1:14b', tier3), 4096);

  // Tier 4 (>= 16 GB)
  assert.equal(resolveChatOllamaNumCtx('qwen2.5:14b', tier4), 16384);
  assert.equal(resolveChatOllamaNumCtx('qwen2.5:32b', tier4), 8192);

  // Studio default cap preserved when hardware is omitted
  assert.equal(resolveOllamaNumCtx('qwen2.5:3b', 4096), 4096);
  assert.equal(resolveOllamaNumCtx('vai-doc:latest', 8192), 8192);
  assert.equal(resolveOllamaNumCtx('qwen2.5-coder:7b', 4096), 2048);
  assert.equal(resolveOllamaNumCtx('llama3.1:8b', 8192), 2048);
});

test('pickWarmUpModel prefers highest-capability installed model fitting the detected VRAM tier', () => {
  const tier2 = buildHardwareProfile('NVIDIA GeForce RTX 3050', 4, 16);
  const tier3 = buildHardwareProfile('NVIDIA GeForce RTX 4060', 12, 32);
  const tier4 = buildHardwareProfile('NVIDIA GeForce RTX 4090', 24, 64);

  // Entry GPU: sticks to 3B, avoids 7B/vision/embed
  assert.equal(
    pickWarmUpModel(['qwen2.5-coder:7b', 'qwen2.5:3b', 'llama3.2-vision:latest'], 'qwen2.5:3b', tier2),
    'qwen2.5:3b'
  );
  assert.equal(
    pickWarmUpModel(['qwen2.5-coder:7b', 'llama3.2-vision:latest', 'nomic-embed-text:latest'], 'qwen2.5:3b', tier2),
    null
  );
  assert.equal(
    pickWarmUpModel(['qwen2.5-coder:7b', 'llama3.2:3b'], 'qwen2.5:3b', tier2),
    'llama3.2:3b'
  );

  // Mid-Range GPU: warms up highest model <= 14B
  assert.equal(
    pickWarmUpModel(['qwen2.5:3b', 'llama3.1:8b', 'qwen2.5:14b', 'qwen2.5:32b'], 'qwen2.5:3b', tier3),
    'qwen2.5:14b'
  );

  // High-End GPU: warms up highest model <= 32B
  assert.equal(
    pickWarmUpModel(['qwen2.5:3b', 'qwen2.5:14b', 'qwen2.5:32b', 'llama3.3:70b'], 'qwen2.5:3b', tier4),
    'qwen2.5:32b'
  );
});


