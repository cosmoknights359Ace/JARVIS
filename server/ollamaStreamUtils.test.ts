import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeOllamaNdjson } from './ollamaStreamUtils';

test('consumeOllamaNdjson buffers JSON lines split across TCP chunks', () => {
  const step1 = consumeOllamaNdjson('', '{"message":{"content":"def fix"},"done":false}\n{"message":{"con');
  assert.deepEqual(step1.events, [{ text: 'def fix', done: false }]);
  assert.equal(step1.remainder, '{"message":{"con');

  const step2 = consumeOllamaNdjson(step1.remainder, 'tent":"()"},"done":false}\n{"done":true}\n');
  assert.deepEqual(step2.events, [
    { text: '()', done: false },
    { text: undefined, done: true }
  ]);
  assert.equal(step2.remainder, '');
});

test('consumeOllamaNdjson surfaces Ollama error payloads immediately', () => {
  const step = consumeOllamaNdjson('', '{"error":"model requires more system memory"}\n');
  assert.deepEqual(step.events, [{ error: 'model requires more system memory' }]);
});
