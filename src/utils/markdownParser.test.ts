import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitMarkdownFences,
  tokenizeCodeLine,
  parseInlineTokens
} from './markdownParser.ts';

test('splitMarkdownFences handles closed and unclosed streaming fences safely', () => {
  const streaming = 'Intro $x^2 + y^2$\n```python\ndef solve(x):\n    return x ** 2';
  const segs = splitMarkdownFences(streaming);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].type, 'text');
  assert.equal(segs[1].type, 'code');
  if (segs[1].type === 'code') {
    assert.equal(segs[1].lang, 'python');
    assert.equal(segs[1].closed, false);
    assert.match(segs[1].code, /return x \*\* 2/);
  }
});

test('splitMarkdownFences handles multiple code blocks and 4-backtick fences', () => {
  const md = [
    'Before',
    '````markdown',
    '```ts',
    'const x = 1;',
    '```',
    '````',
    'After'
  ].join('\n');
  const segs = splitMarkdownFences(md);
  assert.equal(segs.length, 3);
  assert.equal(segs[1].type, 'code');
  if (segs[1].type === 'code') {
    assert.equal(segs[1].closed, true);
    assert.ok(segs[1].code.includes('const x = 1;'));
  }
});

test('tokenizeCodeLine completes in linear time on adversarial unclosed quotes & backslashes', () => {
  const nasty = 'const s = "' + '\\'.repeat(1500) + 'unterminated';
  const started = Date.now();
  const tokens = tokenizeCodeLine(nasty, 'typescript');
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 50, `Expected <50ms, took ${elapsed}ms`);
  assert.ok(tokens.some((t) => t.kind === 'keyword' && t.value === 'const'));
  assert.ok(tokens.some((t) => t.kind === 'string'));
});

test('parseInlineTokens handles math symbols ($, ^, \\) and pathological asterisks without hanging', () => {
  const mathLine = 'Given $E = mc^2$ and $\\frac{a^2 + b^2}{c^2}$, check **bold** and `x^n`.';
  const tokens = parseInlineTokens(mathLine);
  assert.ok(tokens.some((t) => t.type === 'bold'));
  assert.ok(tokens.some((t) => t.type === 'code' && t.text === 'x^n'));
  const rebuiltText = tokens
    .filter((t) => t.type === 'text')
    .map((t) => (t.type === 'text' ? t.text : ''))
    .join('');
  assert.ok(rebuiltText.includes('$E = mc^2$'));
  assert.ok(rebuiltText.includes('\\frac{a^2 + b^2}{c^2}'));

  const adversarial = '*'.repeat(2000) + ' $a^2 + b^2$ ' + '\\'.repeat(1000);
  const started = Date.now();
  const res = parseInlineTokens(adversarial);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 50, `Expected <50ms on adversarial input, took ${elapsed}ms`);
  assert.ok(res.length > 0);
});
