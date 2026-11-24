/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 cosmoknight — J.A.R.V.I.S Safe Linear-Time Markdown Utilities
 *
 * O(n) line-by-line fence parser, bounded inline tokenizer, and linear-time
 * syntax highlighter designed for high-frequency streaming in WebView2 without
 * catastrophic regex backtracking or infinite loops on malformed/math text.
 */

export type MarkdownSegment =
  | { type: 'text'; content: string }
  | { type: 'code'; lang: string; code: string; closed: boolean };

export type CodeTokenKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'type';

export interface CodeToken {
  kind: CodeTokenKind;
  value: string;
}

export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; label: string; href: string }
  | { type: 'bold'; children: InlineToken[] }
  | { type: 'italic'; children: InlineToken[] }
  | { type: 'strike'; children: InlineToken[] };

const CODE_KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'def', 'default',
  'delete', 'do', 'elif', 'else', 'enum', 'export', 'extends', 'false', 'final', 'finally',
  'fn', 'for', 'from', 'func', 'function', 'if', 'implements', 'import', 'in', 'interface',
  'let', 'match', 'mut', 'new', 'None', 'null', 'override', 'package', 'private', 'protected',
  'pub', 'public', 'raise', 'return', 'select', 'SELECT', 'FROM', 'WHERE', 'JOIN', 'INSERT',
  'UPDATE', 'DELETE', 'CREATE', 'TABLE', 'ORDER', 'GROUP', 'BY', 'static', 'struct', 'super',
  'switch', 'this', 'throw', 'true', 'True', 'False', 'try', 'type', 'typeof', 'undefined',
  'use', 'using', 'val', 'var', 'void', 'while', 'with', 'yield'
]);

/**
 * Splits markdown into prose and fenced code blocks in strict O(n) linear time.
 * Safely handles unclosed in-flight streaming fences, backtick counts >= 3, and
 * special characters ($, ^, \) without any regex backtracking.
 */
export function splitMarkdownFences(content: string): MarkdownSegment[] {
  if (!content) return [];

  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const segments: MarkdownSegment[] = [];

  let inCode = false;
  let fenceCharCount = 3;
  let currentLang = '';
  let textLines: string[] = [];
  let codeLines: string[] = [];

  const flushText = () => {
    if (textLines.length > 0) {
      segments.push({ type: 'text', content: textLines.join('\n') });
      textLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedStart = line.trimStart();

    if (!inCode) {
      if (trimmedStart.startsWith('```')) {
        let tickCount = 0;
        while (tickCount < trimmedStart.length && trimmedStart[tickCount] === '`') {
          tickCount++;
        }
        const rest = trimmedStart.slice(tickCount).trim();

        // Single-line fenced snippet like ```js console.log(1) ```
        const closingIdx = rest.indexOf('`'.repeat(tickCount));
        if (tickCount >= 3 && closingIdx !== -1 && rest.slice(closingIdx).trim() === '`'.repeat(tickCount)) {
          flushText();
          const inlineInner = rest.slice(0, closingIdx).trim();
          segments.push({ type: 'code', lang: '', code: inlineInner, closed: true });
          continue;
        }

        // Standard opening fence: language tag must not contain backticks
        if (tickCount >= 3 && !rest.includes('`')) {
          flushText();
          inCode = true;
          fenceCharCount = tickCount;
          currentLang = rest.split(/\s+/)[0] || '';
          codeLines = [];
          continue;
        }
      }

      textLines.push(line);
    } else {
      const trimmed = line.trim();
      let isClosingFence = false;
      if (trimmed.length >= fenceCharCount && trimmed[0] === '`') {
        isClosingFence = true;
        for (let k = 0; k < trimmed.length; k++) {
          if (trimmed[k] !== '`') {
            isClosingFence = false;
            break;
          }
        }
      }

      if (isClosingFence) {
        segments.push({
          type: 'code',
          lang: currentLang,
          code: codeLines.join('\n'),
          closed: true
        });
        inCode = false;
        currentLang = '';
        codeLines = [];
      } else {
        codeLines.push(line);
      }
    }
  }

  if (inCode) {
    // Gracefully emit in-flight unclosed streaming code block
    segments.push({
      type: 'code',
      lang: currentLang,
      code: codeLines.join('\n'),
      closed: false
    });
  } else {
    flushText();
  }

  return segments;
}

function isIdentStart(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function isIdentPart(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    (c >= 48 && c <= 57) ||
    c === 95
  );
}

function isDigit(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c >= 48 && c <= 57;
}

/**
 * Linear-time syntax tokenizer for a single code line.
 * Immune to regex backtracking on unclosed quotes, backslashes, or very long lines.
 */
export function tokenizeCodeLine(line: string, lang: string): CodeToken[] {
  const lowerLang = (lang || '').toLowerCase();
  if (!line || lowerLang === 'text' || lowerLang === 'txt' || lowerLang === 'plain') {
    return line ? [{ kind: 'plain', value: line }] : [];
  }

  // Hard guard for extremely long minified lines so WebView2 never allocates thousands of spans
  if (line.length > 2000) {
    return [{ kind: 'plain', value: line }];
  }

  const tokens: CodeToken[] = [];
  const hashIsComment = !['css', 'html', 'xml', 'c', 'cpp', 'csharp', 'cs'].includes(lowerLang);
  let i = 0;
  let plainStart = 0;

  const flushPlain = (end: number) => {
    if (end > plainStart) {
      tokens.push({ kind: 'plain', value: line.slice(plainStart, end) });
    }
  };

  while (i < line.length) {
    const ch = line[i];
    const next = i + 1 < line.length ? line[i + 1] : '';

    // Single-line comments: // or #
    if ((ch === '/' && next === '/') || (ch === '#' && hashIsComment)) {
      flushPlain(i);
      tokens.push({ kind: 'comment', value: line.slice(i) });
      plainStart = line.length;
      break;
    }

    // Inline block comment /* ... */
    if (ch === '/' && next === '*') {
      flushPlain(i);
      const closeIdx = line.indexOf('*/', i + 2);
      const end = closeIdx === -1 ? line.length : closeIdx + 2;
      tokens.push({ kind: 'comment', value: line.slice(i, end) });
      i = end;
      plainStart = i;
      continue;
    }

    // Quoted strings ("...", '...', `...`) with safe escape handling
    if (ch === '"' || ch === "'" || ch === '`') {
      flushPlain(i);
      const quote = ch;
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '\\') {
          j += 2;
          continue;
        }
        if (line[j] === quote) {
          j++;
          break;
        }
        j++;
      }
      tokens.push({ kind: 'string', value: line.slice(i, Math.min(j, line.length)) });
      i = Math.min(j, line.length);
      plainStart = i;
      continue;
    }

    // Numbers (only when not preceded by an identifier character)
    if (isDigit(ch) && (i === 0 || !isIdentPart(line[i - 1]))) {
      flushPlain(i);
      let j = i + 1;
      while (j < line.length && isDigit(line[j])) j++;
      if (j < line.length && line[j] === '.' && j + 1 < line.length && isDigit(line[j + 1])) {
        j++;
        while (j < line.length && isDigit(line[j])) j++;
      }
      tokens.push({ kind: 'number', value: line.slice(i, j) });
      i = j;
      plainStart = i;
      continue;
    }

    // Keywords & PascalCase Types
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < line.length && isIdentPart(line[j])) j++;
      const word = line.slice(i, j);
      if (CODE_KEYWORDS.has(word)) {
        flushPlain(i);
        tokens.push({ kind: 'keyword', value: word });
        plainStart = j;
      } else if (
        word.length > 1 &&
        word.charCodeAt(0) >= 65 &&
        word.charCodeAt(0) <= 90 &&
        word !== word.toUpperCase()
      ) {
        flushPlain(i);
        tokens.push({ kind: 'type', value: word });
        plainStart = j;
      }
      i = j;
      continue;
    }

    i++;
  }

  flushPlain(line.length);
  return tokens;
}

/**
 * Bounded, linear-time inline Markdown scanner.
 * Immune to regex catastrophic backtracking and treats math/LaTeX symbols
 * ($, ^, \) and unmatched delimiters as safe literal text.
 */
export function parseInlineTokens(text: string, maxDepth = 4): InlineToken[] {
  if (!text) return [];
  if (maxDepth <= 0 || text.length > 8000) {
    return [{ type: 'text', text }];
  }

  const tokens: InlineToken[] = [];
  let i = 0;
  let plainStart = 0;

  const pushPlain = (end: number) => {
    if (end > plainStart) {
      tokens.push({ type: 'text', text: text.slice(plainStart, end) });
    }
  };

  while (i < text.length) {
    const ch = text[i];

    // Escaped markdown punctuation (preserve raw backslash for LaTeX/paths like \frac or C:\Users)
    if (ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === '*' || next === '`' || next === '~' || next === '[' || next === ']') {
        pushPlain(i);
        tokens.push({ type: 'text', text: next });
        i += 2;
        plainStart = i;
        continue;
      }
      i += 2;
      continue;
    }

    // Inline code: `...` (no nested parsing inside code spans)
    if (ch === '`') {
      const closeIdx = text.indexOf('`', i + 1);
      if (closeIdx > i + 1) {
        pushPlain(i);
        tokens.push({ type: 'code', text: text.slice(i + 1, closeIdx) });
        i = closeIdx + 1;
        plainStart = i;
        continue;
      }
    }

    // Safe HTTP(S) Markdown link: [label](https://...)
    if (ch === '[') {
      const closeBracket = text.indexOf(']', i + 1);
      if (closeBracket > i + 1 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen > closeBracket + 2) {
          const href = text.slice(closeBracket + 2, closeParen);
          if (
            (href.startsWith('https://') || href.startsWith('http://')) &&
            !/\s/.test(href)
          ) {
            pushPlain(i);
            tokens.push({
              type: 'link',
              label: text.slice(i + 1, closeBracket),
              href
            });
            i = closeParen + 1;
            plainStart = i;
            continue;
          }
        }
      }
    }

    // Bold: **...**
    if (ch === '*' && text[i + 1] === '*') {
      const closeIdx = text.indexOf('**', i + 2);
      if (closeIdx > i + 2) {
        const inner = text.slice(i + 2, closeIdx);
        if (inner.trim().length > 0) {
          pushPlain(i);
          tokens.push({
            type: 'bold',
            children: parseInlineTokens(inner, maxDepth - 1)
          });
          i = closeIdx + 2;
          plainStart = i;
          continue;
        }
      }
    }

    // Strikethrough: ~~...~~
    if (ch === '~' && text[i + 1] === '~') {
      const closeIdx = text.indexOf('~~', i + 2);
      if (closeIdx > i + 2) {
        const inner = text.slice(i + 2, closeIdx);
        if (inner.trim().length > 0) {
          pushPlain(i);
          tokens.push({
            type: 'strike',
            children: parseInlineTokens(inner, maxDepth - 1)
          });
          i = closeIdx + 2;
          plainStart = i;
          continue;
        }
      }
    }

    // Italic: *...* (must not start/end with space, avoids math like `2 * 3 * 4`)
    if (ch === '*' && text[i + 1] !== '*' && text[i + 1] !== ' ' && i + 1 < text.length) {
      const closeIdx = text.indexOf('*', i + 1);
      if (closeIdx > i + 1 && text[closeIdx - 1] !== ' ') {
        const inner = text.slice(i + 1, closeIdx);
        if (!inner.includes('\n')) {
          pushPlain(i);
          tokens.push({
            type: 'italic',
            children: parseInlineTokens(inner, maxDepth - 1)
          });
          i = closeIdx + 1;
          plainStart = i;
          continue;
        }
      }
    }

    i++;
  }

  pushPlain(text.length);
  return tokens;
}
