import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJsonPayload,
  isMissingFieldAnswer,
  resolveAvailableOllamaModel,
  DEFAULT_STUDIO_MODEL
} from './localJsonUtils';

test('extractJsonPayload parses clean JSON objects and arrays', () => {
  const obj = extractJsonPayload('{"answers":[{"id":"slot_1","answer":"42"}]}');
  assert.deepEqual(obj, { answers: [{ id: 'slot_1', answer: '42' }] });

  const arr = extractJsonPayload('[{"id":"slot_1","answer":"ok"}]');
  assert.deepEqual(arr, [{ id: 'slot_1', answer: 'ok' }]);
});

test('extractJsonPayload strips markdown code fences and surrounding prose', () => {
  const fenced = 'Here is your JSON:\n```json\n{"title":"Deck","slides":[{"title":"Intro"}]}\n```\nDone.';
  assert.deepEqual(extractJsonPayload(fenced), {
    title: 'Deck',
    slides: [{ title: 'Intro' }]
  });

  const wrapped = 'Sure! {"answers": [{"id": "s1", "answer": "Use {braces} safely"}]} Hope this helps.';
  assert.deepEqual(extractJsonPayload(wrapped), {
    answers: [{ id: 's1', answer: 'Use {braces} safely' }]
  });
});

test('extractJsonPayload returns null for empty or invalid JSON', () => {
  assert.equal(extractJsonPayload(''), null);
  assert.equal(extractJsonPayload('not json at all'), null);
  assert.equal(extractJsonPayload('{"unclosed": true'), null);
});

test('isMissingFieldAnswer catches vai-doc "I don\'t know." and [NEEDS INPUT] without false positives', () => {
  assert.equal(isMissingFieldAnswer(''), true);
  assert.equal(isMissingFieldAnswer('[NEEDS INPUT]'), true);
  assert.equal(isMissingFieldAnswer("I don't know."), true);
  assert.equal(isMissingFieldAnswer("I don’t know"), true);
  assert.equal(isMissingFieldAnswer('I do not know.'), true);
  assert.equal(isMissingFieldAnswer('Not provided in context.'), true);
  assert.equal(isMissingFieldAnswer('Unknown'), true);

  // Real factual answers must NOT be flagged as missing
  assert.equal(
    isMissingFieldAnswer('HTTP 429 means Too Many Requests; clients should retry with exponential backoff.'),
    false
  );
  assert.equal(
    isMissingFieldAnswer('When an unknown key is queried, the cache returns null.'),
    false
  );
  assert.equal(isMissingFieldAnswer('J.A.R.V.I.S'), false);
});

test('resolveAvailableOllamaModel prefers installed vai-doc tag and falls back gracefully', () => {
  assert.equal(
    resolveAvailableOllamaModel('vai-doc:latest', ['qwen2.5:3b', 'vai-doc:latest']),
    'vai-doc:latest'
  );
  assert.equal(
    resolveAvailableOllamaModel('vai-doc', ['qwen2.5:3b', 'vai-doc:latest']),
    'vai-doc:latest'
  );
  assert.equal(
    resolveAvailableOllamaModel('vai-doc:latest', ['qwen2.5:3b', 'qwen2.5-coder:7b'], 'qwen2.5:3b'),
    'qwen2.5:3b'
  );
  assert.equal(
    resolveAvailableOllamaModel(
      'qwen2.5:3b',
      ['llama3.2-vision:latest', 'qwen2.5-coder:3b', 'qwen2.5-coder:7b'],
      'qwen2.5:3b'
    ),
    'qwen2.5-coder:3b'
  );
  assert.equal(resolveAvailableOllamaModel(DEFAULT_STUDIO_MODEL, []), 'vai-doc:latest');
});
