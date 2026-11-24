import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStudioModelOptions,
  DEFAULT_STUDIO_MODEL,
  isHeavyModelName,
  formatModelOptionLabel
} from './modelOptions';

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

test('isHeavyModelName and formatModelOptionLabel label 7B+ models as Heavy', () => {
  assert.equal(isHeavyModelName('qwen2.5:3b'), false);
  assert.equal(isHeavyModelName('vai-doc:latest'), false);
  assert.equal(isHeavyModelName('qwen2.5-coder:7b'), true);
  assert.equal(isHeavyModelName('llama3.1:8b'), true);

  assert.equal(formatModelOptionLabel('qwen2.5:3b'), 'qwen2.5:3b');
  assert.equal(formatModelOptionLabel('qwen2.5-coder:7b'), 'qwen2.5-coder:7b (Heavy)');
  assert.equal(formatModelOptionLabel('auto', 'qwen2.5:3b'), 'auto (qwen2.5:3b)');
  assert.equal(
    formatModelOptionLabel('auto', 'qwen2.5-coder:7b'),
    'auto (qwen2.5-coder:7b (Heavy))'
  );
});

