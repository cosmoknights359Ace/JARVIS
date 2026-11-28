import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidOllamaModelTag,
  consumeOllamaPullNdjson,
  computePullPercent,
  resolveSafeOllamaHost
} from './modelManagerUtils.ts';
import {
  RECOMMENDED_OLLAMA_MODELS,
  STARTER_PROMPTS,
  formatModelSizeBytes,
  isModelTagInstalled
} from '../src/utils/modelManager.ts';
import { buildHardwareProfile, getModelFitBadge } from '../src/utils/hardwareTier.ts';

test('isValidOllamaModelTag accepts standard and registry tags and rejects unsafe inputs', () => {
  assert.equal(isValidOllamaModelTag('qwen2.5:3b'), true);
  assert.equal(isValidOllamaModelTag('qwen2.5-coder:7b'), true);
  assert.equal(isValidOllamaModelTag('gemma4'), true);
  assert.equal(isValidOllamaModelTag('hf.co/bartowski/Qwen2.5-3B-GGUF:Q4_K_M'), true);
  assert.equal(isValidOllamaModelTag('vai-doc:latest'), true);

  assert.equal(isValidOllamaModelTag(''), false);
  assert.equal(isValidOllamaModelTag('   '), false);
  assert.equal(isValidOllamaModelTag('qwen 2.5'), false);
  assert.equal(isValidOllamaModelTag('../etc/passwd'), false);
  assert.equal(isValidOllamaModelTag('model?foo=bar'), false);
  assert.equal(isValidOllamaModelTag('model;rm -rf /'), false);
  assert.equal(isValidOllamaModelTag('a'.repeat(129)), false);
});

test('resolveSafeOllamaHost allows loopback and configured OLLAMA_HOST while blocking SSRF', () => {
  const local = resolveSafeOllamaHost('http://localhost:11434', undefined);
  assert.equal(local.ok, true);
  if (local.ok) assert.equal(local.host, 'http://127.0.0.1:11434');

  const ip = resolveSafeOllamaHost('http://127.0.0.1:11434/', undefined);
  assert.equal(ip.ok, true);
  if (ip.ok) assert.equal(ip.host, 'http://127.0.0.1:11434');

  const metadata = resolveSafeOllamaHost('http://169.254.169.254/latest/meta-data/', undefined);
  assert.equal(metadata.ok, false);

  const remote = resolveSafeOllamaHost('https://evil.example.com:11434', undefined);
  assert.equal(remote.ok, false);

  const fileUrl = resolveSafeOllamaHost('file:///etc/passwd', undefined);
  assert.equal(fileUrl.ok, false);

  const allowedEnv = resolveSafeOllamaHost('http://192.168.1.50:11434', 'http://192.168.1.50:11434');
  assert.equal(allowedEnv.ok, true);
  if (allowedEnv.ok) assert.equal(allowedEnv.host, 'http://192.168.1.50:11434');
});

test('consumeOllamaPullNdjson parses split chunks, calculates percent, and detects completion/errors', () => {
  const first = consumeOllamaPullNdjson(
    '',
    '{"status":"pulling manifest"}\n{"status":"pulling sha256:abc","total":1000,"comp'
  );
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].status, 'pulling manifest');
  assert.equal(first.events[0].percent, null);
  assert.equal(first.events[0].done, false);

  const second = consumeOllamaPullNdjson(
    first.remainder,
    'leted":420}\n{"status":"success"}\n'
  );
  assert.equal(second.events.length, 2);
  assert.equal(second.events[0].percent, 42);
  assert.equal(second.events[0].completed, 420);
  assert.equal(second.events[0].total, 1000);
  assert.equal(second.events[1].status, 'success');
  assert.equal(second.events[1].done, true);
  assert.equal(second.events[1].percent, 100);

  const errParse = consumeOllamaPullNdjson('', '{"error":"pull model manifest: file does not exist"}\n');
  assert.equal(errParse.events.length, 1);
  assert.equal(errParse.events[0].error, 'pull model manifest: file does not exist');
  assert.equal(errParse.events[0].done, true);
});

test('formatModelSizeBytes and computePullPercent format edge cases cleanly', () => {
  assert.equal(formatModelSizeBytes(null), '—');
  assert.equal(formatModelSizeBytes(0), '—');
  assert.equal(formatModelSizeBytes(512 * 1024 * 1024), '512 MB');
  assert.equal(formatModelSizeBytes(2 * 1024 * 1024 * 1024), '2.0 GB');
  assert.equal(computePullPercent(1500, 1000), 100);
  assert.equal(computePullPercent(0, 0), null);
});

test('isModelTagInstalled matches bare and :latest tags', () => {
  assert.equal(isModelTagInstalled('gemma4', ['gemma4:latest', 'qwen2.5:3b']), true);
  assert.equal(isModelTagInstalled('qwen2.5:3b', ['qwen2.5:3b']), true);
  assert.equal(isModelTagInstalled('qwen2.5:14b', ['qwen2.5:3b']), false);
});

test('RECOMMENDED_OLLAMA_MODELS and STARTER_PROMPTS include all required entries and hardware fit badges', () => {
  const tags = RECOMMENDED_OLLAMA_MODELS.map((m) => m.tag);
  assert.deepEqual(tags, [
    'qwen2.5:3b',
    'qwen2.5-coder:3b',
    'qwen2.5-coder:7b',
    'llama3.2:3b',
    'qwen2.5:14b'
  ]);

  const entryGpu = buildHardwareProfile('RTX 3050', 4, 16);
  assert.equal(getModelFitBadge('qwen2.5:3b', entryGpu), 'Optimal');
  assert.equal(getModelFitBadge('qwen2.5-coder:7b', entryGpu), 'Heavy');
  assert.equal(getModelFitBadge('qwen2.5:14b', entryGpu), 'Too Heavy');

  assert.equal(STARTER_PROMPTS.length, 4);
  assert.deepEqual(
    STARTER_PROMPTS.map((s) => s.title),
    ['Debug & Fix Code', 'Explain Simply', 'Quick Script', 'Use My Memory']
  );
});
