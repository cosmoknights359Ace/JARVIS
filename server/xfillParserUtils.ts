/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 cosmoknight — J.A.R.V.I.S Xfill Deterministic Parser Utilities
 *
 * Pure, format-agnostic detection and context-binding helpers shared across
 * DOCX, XLSX, and PPTX inspection and write-back.
 */

export const PLACEHOLDER_REGEX =
  /(\{\{[^{}]+\}\}|\[\[(?:[^\]]+)\]\]|\[(?:enter|fill|insert|your|tbd|blank|answer|name|date|title|company|email|role|summary|topic|value|description|notes?|response|details?|presenter|project)[^\]]*\]|_{3,}|<[^<>\s][^<>]{1,40}>)/i;

/**
 * Matches standalone generic answer prefixes (e.g., "A:", "A1:", "Ans:", "Ans.:",
 * "Answer:", "Answer 1:", "Response:", "Reply:", "Solution:", "Explanation:")
 * followed by optional remaining text.
 */
export const GENERIC_ANSWER_LABEL_REGEX =
  /^((?:answer|ans\.?|response|reply|solution|explanation|a)(?:\s*#?\d+)?\s*[:\-]|(?:ans\.?|answer|a\d+)\s*[\).])\s*(.*)$/i;

/**
 * Bare single-letter "A." or "A)" without a colon or digit. Only treated as an
 * answer field when immediately preceded by a question/prompt so outline items
 * do not false-trigger.
 */
const BARE_LETTER_ANSWER_LABEL_REGEX = /^(a\s*[\).])\s*(.*)$/i;

/**
 * Matches already-filled or empty answer lines so backward prompt search never
 * treats a previous answer as the prompt for the next answer field.
 */
const STARTS_WITH_ANSWER_PREFIX_REGEX =
  /^(?:answer|ans\.?|response|reply|solution|explanation|a)(?:\s*#?\d+)?\s*[:\-]/i;

/**
 * Matches specific labelled form fields whose own label is the prompt
 * (e.g., "Name:", "Project Title:", "Key Takeaway:").
 */
export const SPECIFIC_FIELD_LABEL_REGEX =
  /^((?:result|summary|notes?|name|full name|email|date|title|project|project name|role|department|company|organization|author|presenter|topic|badge id|employee id|id|objective|takeaway|key takeaway|status|owner|reviewer|phone|location)\s*[:\-])\s*(.*)$/i;

export const QUESTION_START_REGEX =
  /^(?:q\d*[\).:\-\s]+|question\s*#?\d*[\).:\-\s]+|prompt\s*#?\d*[\).:\-\s]+|\d+[\).]\s+)/i;

export function isBlankOrPlaceholderValue(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return true;
  if (
    /^(?:_{2,}|-{2,}|–{2,}|—+|\.{3,}|tbd|n\/a|pending|\?+|\[.*\]|\{\{.*\}\}|<.*>)$/i.test(t)
  ) {
    return true;
  }
  return false;
}

export function looksLikeQuestion(text: string): boolean {
  const t = String(text || '').trim();
  if (t.length < 6) return false;
  return t.endsWith('?') || QUESTION_START_REGEX.test(t);
}

/**
 * Returns true if a line can serve as the bound prompt/question for an empty
 * answer label immediately below or beside it (supports questions ending in "?",
 * numbered/Q-prefixed prompts, and standalone imperative prompts like
 * "Explain the retry policy.").
 */
export function isBindablePromptText(text: string): boolean {
  const t = String(text || '').trim();
  if (t.length < 4) return false;
  if (isBlankOrPlaceholderValue(t)) return false;
  if (STARTS_WITH_ANSWER_PREFIX_REGEX.test(t)) return false;
  if (looksLikeQuestion(t)) return true;
  // Standalone non-question prompts (imperatives, topics, or instructions)
  return t.length >= 6;
}

export interface GenericAnswerLabelMatch {
  labelPrefix: string;
  remainder: string;
}

/**
 * Matches a line/cell that consists of an empty generic answer label (optionally
 * followed by blank/placeholder tokens such as "A: _____", "Ans:", "Answer: [TBD]").
 */
export function matchEmptyGenericAnswerLabel(
  text: string,
  allowBareLetterDelimiter = false
): GenericAnswerLabelMatch | null {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  const m =
    trimmed.match(GENERIC_ANSWER_LABEL_REGEX) ||
    (allowBareLetterDelimiter ? trimmed.match(BARE_LETTER_ANSWER_LABEL_REGEX) : null);

  if (!m) return null;
  const labelPrefix = m[1].trim();
  const remainder = (m[2] || '').trim();

  if (!isBlankOrPlaceholderValue(remainder)) {
    return null;
  }

  return { labelPrefix, remainder };
}

export interface InlineQaLabelMatch {
  question: string;
  /** Full prefix to preserve before the answer when rewriting the full text */
  fullPrefix: string;
  /** Just the trailing answer label token (e.g. "A:", "Ans:", "Answer:") */
  answerLabel: string;
  /** True when the question and answer label were separated by a newline */
  multiline: boolean;
}

/**
 * Detects a single paragraph or cell containing both a question/prompt and a
 * trailing empty answer label, either separated by a newline ("Q1: ...?\nA:")
 * or inline after a question mark ("What is DNS? A:").
 */
export function matchInlineQuestionAndAnswerLabel(text: string): InlineQaLabelMatch | null {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return null;

  // 1. Multi-line cell / paragraph (e.g. "Q1: What is DNS?\nA:" or "Explain X.\nAns: ____")
  if (raw.includes('\n')) {
    const lines = raw.split('\n');
    let lastNonEmptyIdx = lines.length - 1;
    while (lastNonEmptyIdx >= 0 && !lines[lastNonEmptyIdx].trim()) {
      lastNonEmptyIdx--;
    }
    if (lastNonEmptyIdx > 0) {
      const lastLine = lines[lastNonEmptyIdx].trim();
      const beforeText = lines
        .slice(0, lastNonEmptyIdx)
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' ');
      if (isBindablePromptText(beforeText)) {
        const ansMatch = matchEmptyGenericAnswerLabel(lastLine, true);
        if (ansMatch) {
          const preservedLeading = lines.slice(0, lastNonEmptyIdx).join('\n');
          return {
            question: beforeText,
            fullPrefix: `${preservedLeading}\n${ansMatch.labelPrefix}`,
            answerLabel: ansMatch.labelPrefix,
            multiline: true
          };
        }
      }
    }
  }

  // 2. Single-line inline Q&A ("What is DNS? A:" or "Q1: Why use caching? Answer: ____")
  const inlineMatch = raw.match(
    /^(.{6,}?\?)\s+((?:answer|ans\.?|response|reply|solution|explanation|a)(?:\s*#?\d+)?\s*[:\-])\s*(.*)$/i
  );
  if (inlineMatch && isBlankOrPlaceholderValue(inlineMatch[3])) {
    const question = inlineMatch[1].trim();
    const answerLabel = inlineMatch[2].trim();
    return {
      question,
      fullPrefix: `${question} ${answerLabel}`,
      answerLabel,
      multiline: false
    };
  }

  return null;
}

/**
 * Walks backward from `currentIndex - 1` (skipping up to `maxEmptySkip` blank
 * spacing lines) to find the nearest preceding question or prompt to bind to an
 * empty answer field.
 */
export function findPrecedingPrompt(
  lines: string[],
  currentIndex: number,
  options?: {
    maxEmptySkip?: number;
    stopIndices?: Set<number>;
    isSameRegion?: (idx: number) => boolean;
  }
): { index: number; text: string } | null {
  const maxEmptySkip = options?.maxEmptySkip ?? 2;
  let emptySkipped = 0;

  for (let idx = currentIndex - 1; idx >= 0; idx--) {
    if (options?.isSameRegion && !options.isSameRegion(idx)) {
      return null;
    }
    if (options?.stopIndices?.has(idx)) {
      return null;
    }

    const candidate = (lines[idx] || '').trim();
    if (!candidate) {
      emptySkipped++;
      if (emptySkipped > maxEmptySkip) return null;
      continue;
    }

    if (isBindablePromptText(candidate)) {
      return { index: idx, text: candidate };
    }
    return null;
  }

  return null;
}

/**
 * Checks whether an upcoming non-empty line within `maxEmptySkip` blank lines
 * after a question is an explicit empty generic answer label ("A:", "Ans:",
 * "Answer:"). Used so a visual blank line between a question and "A:" is not
 * mistakenly claimed as a separate blank answer paragraph.
 */
export function hasFollowingEmptyAnswerLabel(
  lines: string[],
  questionIndex: number,
  options?: {
    maxEmptySkip?: number;
    isSameRegion?: (idx: number) => boolean;
  }
): boolean {
  const maxEmptySkip = options?.maxEmptySkip ?? 2;
  let emptySkipped = 0;

  for (let idx = questionIndex + 1; idx < lines.length; idx++) {
    if (options?.isSameRegion && !options.isSameRegion(idx)) {
      return false;
    }
    const candidate = (lines[idx] || '').trim();
    if (!candidate) {
      emptySkipped++;
      if (emptySkipped > maxEmptySkip) return false;
      continue;
    }
    return matchEmptyGenericAnswerLabel(candidate, true) !== null;
  }
  return false;
}

/**
 * Builds a concise surrounding context snippet for a slot from neighboring
 * non-empty lines around the target/prompt indices.
 */
export function buildContextSnippet(
  lines: string[],
  anchorIndices: number[],
  maxLen = 360
): string {
  if (anchorIndices.length === 0) return '';
  const minIdx = Math.min(...anchorIndices);
  const maxIdx = Math.max(...anchorIndices);
  const parts: string[] = [];
  const seen = new Set<number>();

  // Gather up to 2 preceding non-empty lines for additional local grounding
  let beforeCount = 0;
  const beforeLines: string[] = [];
  for (let i = minIdx - 1; i >= 0 && beforeCount < 2; i--) {
    const t = (lines[i] || '').trim();
    if (t) {
      beforeLines.unshift(t);
      seen.add(i);
      beforeCount++;
    }
  }
  parts.push(...beforeLines);

  for (let i = minIdx; i <= maxIdx; i++) {
    if (seen.has(i)) continue;
    const t = (lines[i] || '').trim();
    if (t) {
      parts.push(t);
      seen.add(i);
    }
  }

  // Gather 1 following non-empty line
  for (let i = maxIdx + 1; i < lines.length; i++) {
    const t = (lines[i] || '').trim();
    if (t) {
      parts.push(t);
      break;
    }
  }

  return parts.join(' | ').slice(0, maxLen);
}

/**
 * Combines a preserved answer prefix (e.g. "A:", "Ans:", "Answer:") with the
 * generated answer while preventing duplicated prefixes ("A: A: ...").
 */
export function formatAppendAfterLabel(labelPrefix: string, answer: string): string {
  const prefix = String(labelPrefix || '').trimEnd();
  let clean = String(answer || '').trim();
  if (!prefix) return clean;
  if (!clean) return prefix;

  // Extract trailing short label token (handles multiline prefix ending in "\nA:")
  const lastLine = prefix.includes('\n') ? prefix.slice(prefix.lastIndexOf('\n') + 1).trim() : prefix.trim();
  const escapedLabel = lastLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dupRegex = new RegExp(`^${escapedLabel}\\s*`, 'i');
  if (dupRegex.test(clean)) {
    clean = clean.replace(dupRegex, '').trim();
  }

  return `${prefix} ${clean}`.trimEnd();
}

export function cleanPlaceholderPrompt(token: string, fullLine: string): string {
  const stripped = token
    .replace(/^\{\{|\}\}$/g, '')
    .replace(/^\[\[|\]\]$/g, '')
    .replace(/^\[|\]$/g, '')
    .replace(/^<|>$/g, '')
    .replace(/_/g, ' ')
    .trim();
  if (stripped && stripped.length >= 2 && !/^tbd$/i.test(stripped)) {
    return `${stripped} (from: "${fullLine.slice(0, 120)}")`;
  }
  return fullLine.replace(token, '_____').trim();
}
