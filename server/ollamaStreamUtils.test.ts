import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeOllamaNdjson,
  isHeavyOllamaModel,
  resolveOllamaNumCtx,
  resolveChatOllamaNumCtx,
  pickWarmUpModel
} from './ollamaStreamUtils';

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

test('resolveChatOllamaNumCtx uses 3072 for 7B/8B+ models and 4096 for 3B models while preserving default 2048 cap', () => {
  assert.equal(isHeavyOllamaModel('qwen2.5:3b'), false);
  assert.equal(isHeavyOllamaModel('llama3.2:1b'), false);
  assert.equal(isHeavyOllamaModel('vai-doc:latest'), false);
  assert.equal(isHeavyOllamaModel('qwen2.5-coder:7b'), true);
  assert.equal(isHeavyOllamaModel('llama3.1:8b-instruct-q4_K_M'), true);
  assert.equal(isHeavyOllamaModel('qwen2.5:14b'), true);

  // Chat-specific tuning: 3072 for 7B/8B+, 4096 for 3B
  assert.equal(resolveChatOllamaNumCtx('qwen2.5:3b'), 4096);
  assert.equal(resolveChatOllamaNumCtx('qwen2.5-coder:7b'), 3072);
  assert.equal(resolveChatOllamaNumCtx('llama3.1:8b-instruct-q4_K_M'), 3072);
  assert.equal(resolveChatOllamaNumCtx('deepseek-r1:14b'), 3072);

  // Studio default cap preserved when heavyCap is omitted
  assert.equal(resolveOllamaNumCtx('qwen2.5:3b', 4096), 4096);
  assert.equal(resolveOllamaNumCtx('vai-doc:latest', 8192), 8192);
  assert.equal(resolveOllamaNumCtx('qwen2.5-coder:7b', 4096), 2048);
  assert.equal(resolveOllamaNumCtx('llama3.1:8b', 8192), 2048);
});

test('pickWarmUpModel picks default 3B model and avoids warming heavy 7B+ or vision models', () => {
  assert.equal(
    pickWarmUpModel(['qwen2.5-coder:7b', 'qwen2.5:3b', 'llama3.2-vision:latest']),
    'qwen2.5:3b'
  );
  assert.equal(
    pickWarmUpModel(['qwen2.5-coder:7b', 'llama3.2-vision:latest', 'nomic-embed-text:latest']),
    null
  );
  assert.equal(
    pickWarmUpModel(['qwen2.5-coder:7b', 'llama3.2:3b']),
    'llama3.2:3b'
  );
});

