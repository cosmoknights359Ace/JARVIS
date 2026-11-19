/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 vinod — J.A.R.V.I.S Xfill Document Engine
 *
 * Deterministic OOXML (DOCX / PPTX) & Excel (XLSX) slot extraction,
 * grounded low-hallucination solving (Local Ollama -> Gemini Cloud),
 * and format-preserving document re-assembly.
 */

import crypto from 'crypto';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { GoogleGenAI, Type } from '@google/genai';

export type XfillFileType = 'docx' | 'xlsx' | 'pptx';
export type XfillSlotKind = 'placeholder' | 'question' | 'blank_field' | 'table_cell';
export type XfillSource = 'memory' | 'context' | 'knowledge' | 'missing' | 'user' | 'pending';
export type XfillConfidence = 'high' | 'medium' | 'needs_input' | 'pending';

export interface XfillSlotPublic {
  id: string;
  location: string;
  kind: XfillSlotKind;
  prompt: string;
  originalText: string;
  context: string;
  value: string;
  source: XfillSource;
  confidence: XfillConfidence;
  reasoning?: string;
}

interface DocxTarget {
  type: 'docx_para';
  partPath: string;
  paraIndex: number;
  mode: 'replace_placeholder' | 'append_after_label' | 'replace_whole';
  placeholderToken?: string;
  labelPrefix?: string;
}

interface PptxTarget {
  type: 'pptx_para';
  slidePath: string;
  paraIndex: number;
  mode: 'replace_placeholder' | 'append_after_label' | 'replace_whole';
  placeholderToken?: string;
  labelPrefix?: string;
}

interface XlsxTarget {
  type: 'xlsx_cell';
  sheetName: string;
  row: number;
  col: number;
  mode: 'replace_placeholder' | 'replace_whole';
  placeholderToken?: string;
}

type InternalTarget = DocxTarget | PptxTarget | XlsxTarget;

interface InternalSlot extends XfillSlotPublic {
  target: InternalTarget;
}

interface CachedDocument {
  docId: string;
  fileName: string;
  fileType: XfillFileType;
  buffer: Buffer;
  summary: string;
  slots: InternalSlot[];
  createdAt: number;
}

const DOC_CACHE = new Map<string, CachedDocument>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHED_DOCS = 25;
const GEMINI_MODEL = 'gemini-4-hydrogen';

function pruneCache() {
  const now = Date.now();
  for (const [id, doc] of DOC_CACHE.entries()) {
    if (now - doc.createdAt > CACHE_TTL_MS) {
      DOC_CACHE.delete(id);
    }
  }
  while (DOC_CACHE.size > MAX_CACHED_DOCS) {
    const oldestKey = DOC_CACHE.keys().next().value;
    if (oldestKey) DOC_CACHE.delete(oldestKey);
    else break;
  }
}

export function getCachedDocument(docId: string): CachedDocument | undefined {
  pruneCache();
  return DOC_CACHE.get(docId);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(str: string): string {
  return str
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function extractTextFromXmlFragment(xml: string, tagName: 'w:t' | 'a:t'): string {
  const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'g');
  let out = '';
  let m: RegExpExecArray | null;
  while ((m = regex.exec(xml)) !== null) {
    out += unescapeXml(m[1]);
  }
  return out;
}

function findTagBlocks(xml: string, tagName: string): Array<{ start: number; end: number; raw: string }> {
  const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tagName}>`, 'g');
  const results: Array<{ start: number; end: number; raw: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(xml)) !== null) {
    results.push({ start: m.index, end: m.index + m[0].length, raw: m[0] });
  }
  return results;
}

const PLACEHOLDER_REGEX =
  /(\{\{[^{}]+\}\}|\[\[(?:[^\]]+)\]\]|\[(?:enter|fill|insert|your|tbd|blank|answer|name|date|title|company|email|role|summary|topic|value|description|notes?|response|details?|presenter|project)[^\]]*\]|_{3,}|<[^<>\s][^<>]{1,40}>)/i;

const ANSWER_LABEL_REGEX =
  /^((?:answer|ans|response|reply|solution|explanation|result|summary|notes?|name|full name|email|date|title|project|project name|role|department|company|organization|author|presenter|topic|badge id|employee id|id|objective|takeaway|status|owner|reviewer|phone|location)\s*[:\-])\s*(.*)$/i;

const QUESTION_START_REGEX = /^(?:q\d*[\).:\-\s]+|question\s*\d*[\).:\-\s]+|\d+[\).]\s+)/i;

function isBlankOrPlaceholderValue(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^(?:_{2,}|-{3,}|\.{3,}|tbd|n\/a|pending|\?+|\[.*\]|\{\{.*\}\}|<.*>)$/i.test(t)) {
    return true;
  }
  return false;
}

function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  return t.endsWith('?') || QUESTION_START_REGEX.test(t);
}

function cleanPlaceholderPrompt(token: string, fullLine: string): string {
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

// ============================================================================
// 1. DOCX Inspection & Format-Preserving Patching
// ============================================================================

async function inspectDocx(buffer: Buffer): Promise<{ summary: string; slots: InternalSlot[] }> {
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) {
    throw new Error('Invalid .docx file: missing word/document.xml.');
  }

  const xml = await docFile.async('string');
  const paragraphs = findTagBlocks(xml, 'w:p');
  const paraTexts = paragraphs.map((p) => extractTextFromXmlFragment(p.raw, 'w:t').trim());

  // Map each paragraph index to its containing table row/cell if inside a <w:tbl>
  const tables = findTagBlocks(xml, 'w:tbl');
  const paraTableMeta = new Map<
    number,
    { tableNum: number; rowNum: number; colNum: number; rowCells: string[]; colHeader?: string }
  >();

  tables.forEach((tbl, tIdx) => {
    const rows = findTagBlocks(tbl.raw, 'w:tr');
    const rowCellTexts: string[][] = rows.map((row) =>
      findTagBlocks(row.raw, 'w:tc').map((tc) => extractTextFromXmlFragment(tc.raw, 'w:t').trim())
    );
    const headerRow = rowCellTexts[0] || [];

    rows.forEach((row, rIdx) => {
      const cells = findTagBlocks(row.raw, 'w:tc');
      const rowAbsStart = tbl.start + row.start;
      cells.forEach((cell, cIdx) => {
        const cellAbsStart = rowAbsStart + cell.start;
        const cellAbsEnd = cellAbsStart + cell.raw.length;
        paragraphs.forEach((p, pIdx) => {
          if (p.start >= cellAbsStart && p.end <= cellAbsEnd) {
            paraTableMeta.set(pIdx, {
              tableNum: tIdx + 1,
              rowNum: rIdx + 1,
              colNum: cIdx + 1,
              rowCells: rowCellTexts[rIdx] || [],
              colHeader: rIdx > 0 ? headerRow[cIdx] : undefined
            });
          }
        });
      });
    });
  });

  const slots: InternalSlot[] = [];
  const usedParaIndices = new Set<number>();

  const pushSlot = (slot: Omit<InternalSlot, 'id' | 'value' | 'source' | 'confidence'>) => {
    slots.push({
      ...slot,
      id: `slot_${slots.length + 1}`,
      value: '',
      source: 'pending',
      confidence: 'pending'
    });
  };

  for (let i = 0; i < paragraphs.length; i++) {
    if (usedParaIndices.has(i)) continue;
    const text = paraTexts[i];
    const tableInfo = paraTableMeta.get(i);
    const prevText = i > 0 ? paraTexts[i - 1] : '';
    const nextText = i + 1 < paragraphs.length ? paraTexts[i + 1] : '';
    const context = [prevText, text, nextText].filter(Boolean).join(' | ').slice(0, 260);
    const loc = tableInfo
      ? `Table ${tableInfo.tableNum} · Row ${tableInfo.rowNum}, Col ${tableInfo.colNum}`
      : `Paragraph ${i + 1}`;

    // A. Empty cell inside a table paired with a left label/question or answer column header
    if (tableInfo && isBlankOrPlaceholderValue(text)) {
      const leftCell = tableInfo.colNum >= 2 ? tableInfo.rowCells[tableInfo.colNum - 2] : '';
      const firstCell = tableInfo.rowCells[0] || '';
      const header = tableInfo.colHeader || '';
      const isAnswerHeader = /^(answer|response|value|output|solution|notes?|details?|status|result|fill)$/i.test(
        header.trim()
      );
      const hasPromptSource = Boolean(leftCell && !isBlankOrPlaceholderValue(leftCell));

      if ((hasPromptSource && tableInfo.rowNum > 1) || (isAnswerHeader && firstCell) || (hasPromptSource && tableInfo.rowCells.length === 2)) {
        const prompt = isAnswerHeader && firstCell && firstCell !== leftCell
          ? `${firstCell} — ${leftCell || header}`
          : leftCell || `${firstCell} (${header})`;
        usedParaIndices.add(i);
        pushSlot({
          location: loc,
          kind: 'table_cell',
          prompt: prompt.trim(),
          originalText: text || '(empty cell)',
          context: tableInfo.rowCells.filter(Boolean).join(' | ').slice(0, 260),
          target: {
            type: 'docx_para',
            partPath: 'word/document.xml',
            paraIndex: i,
            mode: 'replace_whole'
          }
        });
        continue;
      }
    }

    if (!text) continue;

    // B. Explicit placeholder token inside paragraph ({{...}}, [Enter ...], ____, <...>)
    const phMatch = text.match(PLACEHOLDER_REGEX);
    if (phMatch) {
      const token = phMatch[1];
      usedParaIndices.add(i);
      pushSlot({
        location: loc,
        kind: 'placeholder',
        prompt: cleanPlaceholderPrompt(token, text),
        originalText: text,
        context,
        target: {
          type: 'docx_para',
          partPath: 'word/document.xml',
          paraIndex: i,
          mode: 'replace_placeholder',
          placeholderToken: token
        }
      });
      continue;
    }

    // C. Labelled blank field ("Name:", "Answer:", "Project Title: ____")
    const labelMatch = text.match(ANSWER_LABEL_REGEX);
    if (labelMatch && isBlankOrPlaceholderValue(labelMatch[2])) {
      const labelPrefix = labelMatch[1].trim();
      const isGenericAnswerLabel = /^(answer|ans|response|reply|solution)\s*[:\-]$/i.test(labelPrefix);
      const effectivePrompt =
        isGenericAnswerLabel && prevText && looksLikeQuestion(prevText)
          ? prevText
          : labelPrefix.replace(/[:\-]+$/, '').trim();
      usedParaIndices.add(i);
      pushSlot({
        location: loc,
        kind: isGenericAnswerLabel ? 'question' : 'blank_field',
        prompt: effectivePrompt,
        originalText: text,
        context,
        target: {
          type: 'docx_para',
          partPath: 'word/document.xml',
          paraIndex: i,
          mode: 'append_after_label',
          labelPrefix
        }
      });
      continue;
    }

    // D. Question paragraph followed by an empty answer paragraph (outside tables)
    if (!tableInfo && looksLikeQuestion(text) && i + 1 < paragraphs.length) {
      const nextTableInfo = paraTableMeta.get(i + 1);
      if (!nextTableInfo && isBlankOrPlaceholderValue(nextText)) {
        usedParaIndices.add(i + 1);
        pushSlot({
          location: `Paragraph ${i + 2} (Answer to P${i + 1})`,
          kind: 'question',
          prompt: text,
          originalText: nextText || '(blank answer line)',
          context,
          target: {
            type: 'docx_para',
            partPath: 'word/document.xml',
            paraIndex: i + 1,
            mode: 'replace_whole'
          }
        });
        continue;
      }
    }
  }

  return {
    summary: `Word document · ${paragraphs.length} paragraphs · ${tables.length} ${tables.length === 1 ? 'table' : 'tables'} · ${slots.length} fillable ${slots.length === 1 ? 'field' : 'fields'} detected`,
    slots
  };
}

function patchParagraphXml(
  paraXml: string,
  textTag: 'w:t' | 'a:t',
  runTag: 'w:r' | 'a:r',
  newText: string
): string {
  const escaped = escapeXml(newText);
  const tRegex = new RegExp(`<${textTag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${textTag}>`, 'g');
  let replacedFirst = false;

  const updated = paraXml.replace(tRegex, () => {
    if (!replacedFirst) {
      replacedFirst = true;
      return textTag === 'w:t'
        ? `<w:t xml:space="preserve">${escaped}</w:t>`
        : `<a:t>${escaped}</a:t>`;
    }
    return `<${textTag}></${textTag}>`;
  });

  if (replacedFirst) {
    return updated;
  }

  // Paragraph had no existing text run (empty line or empty cell): insert a clean run before closing tag
  const closeTag = textTag === 'w:t' ? '</w:p>' : '</a:p>';
  const injectedRun =
    textTag === 'w:t'
      ? `<${runTag}><w:t xml:space="preserve">${escaped}</w:t></${runTag}>`
      : `<${runTag}><a:t>${escaped}</a:t></${runTag}>`;

  const closeIdx = paraXml.lastIndexOf(closeTag);
  if (closeIdx === -1) return paraXml;
  return paraXml.slice(0, closeIdx) + injectedRun + paraXml.slice(closeIdx);
}

async function exportDocx(doc: CachedDocument, answers: Record<string, string>): Promise<Buffer> {
  const zip = await JSZip.loadAsync(doc.buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('Corrupt cached .docx archive.');
  let xml = await docFile.async('string');

  const paragraphs = findTagBlocks(xml, 'w:p');
  const patchesByPara = new Map<number, string>();

  for (const slot of doc.slots) {
    if (slot.target.type !== 'docx_para') continue;
    const answer = answers[slot.id];
    if (typeof answer !== 'string' || !answer.trim()) continue;

    const pIdx = slot.target.paraIndex;
    const pBlock = paragraphs[pIdx];
    if (!pBlock) continue;

    const currentText = patchesByPara.has(pIdx)
      ? patchesByPara.get(pIdx)!
      : extractTextFromXmlFragment(pBlock.raw, 'w:t');

    let nextText = answer.trim();
    if (slot.target.mode === 'replace_placeholder' && slot.target.placeholderToken) {
      nextText = currentText.replace(slot.target.placeholderToken, answer.trim());
    } else if (slot.target.mode === 'append_after_label' && slot.target.labelPrefix) {
      nextText = `${slot.target.labelPrefix} ${answer.trim()}`;
    }

    patchesByPara.set(pIdx, nextText);
  }

  // Apply replacements from end to start so character offsets stay exact
  const sortedIndices = Array.from(patchesByPara.keys()).sort((a, b) => b - a);
  for (const pIdx of sortedIndices) {
    const pBlock = paragraphs[pIdx];
    const nextText = patchesByPara.get(pIdx)!;
    const patchedPara = patchParagraphXml(pBlock.raw, 'w:t', 'w:r', nextText);
    xml = xml.slice(0, pBlock.start) + patchedPara + xml.slice(pBlock.end);
  }

  zip.file('word/document.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ============================================================================
// 2. XLSX Inspection & Style-Preserving Patching (ExcelJS)
// ============================================================================

function colNumberToLetters(col: number): string {
  let letters = '';
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters || 'A';
}

function getCellText(cell: ExcelJS.Cell): string {
  const val = cell.value;
  if (val === null || val === undefined) return '';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return String(val).trim();
  }
  if (val instanceof Date) return val.toISOString().split('T')[0];
  if (typeof val === 'object') {
    if ('richText' in val && Array.isArray(val.richText)) {
      return val.richText.map((r) => r.text).join('').trim();
    }
    if ('result' in val && val.result !== undefined && val.result !== null) {
      return String(val.result).trim();
    }
    if ('text' in val && typeof val.text === 'string') {
      return val.text.trim();
    }
  }
  return '';
}

async function inspectXlsx(buffer: Buffer): Promise<{ summary: string; slots: InternalSlot[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  const slots: InternalSlot[] = [];
  const seenCoords = new Set<string>();

  const pushSlot = (slot: Omit<InternalSlot, 'id' | 'value' | 'source' | 'confidence'>) => {
    const t = slot.target as XlsxTarget;
    const coordKey = `${t.sheetName}!${t.row}:${t.col}`;
    if (seenCoords.has(coordKey)) return;
    seenCoords.add(coordKey);
    slots.push({
      ...slot,
      id: `slot_${slots.length + 1}`,
      value: '',
      source: 'pending',
      confidence: 'pending'
    });
  };

  workbook.eachSheet((sheet) => {
    const rowCount = Math.min(sheet.rowCount, 200);
    const colCount = Math.min(sheet.columnCount, 30);
    if (rowCount === 0 || colCount === 0) return;

    // Identify header row and answer columns if present in first 3 rows
    let headerRowIdx = -1;
    const answerCols = new Set<number>();
    const headersByCol = new Map<number, string>();

    for (let r = 1; r <= Math.min(3, rowCount); r++) {
      let foundAnswerHeader = false;
      for (let c = 1; c <= colCount; c++) {
        const text = getCellText(sheet.getRow(r).getCell(c));
        if (/^(answer|answers|response|responses|value|values|output|solution|notes?|details?|fill|result|summary|status)$/i.test(text)) {
          foundAnswerHeader = true;
          answerCols.add(c);
        }
      }
      if (foundAnswerHeader) {
        headerRowIdx = r;
        for (let c = 1; c <= colCount; c++) {
          headersByCol.set(c, getCellText(sheet.getRow(r).getCell(c)));
        }
        break;
      }
    }

    for (let r = 1; r <= rowCount; r++) {
      const row = sheet.getRow(r);
      const rowValues: string[] = [];
      for (let c = 1; c <= colCount; c++) {
        rowValues[c] = getCellText(row.getCell(c));
      }

      for (let c = 1; c <= colCount; c++) {
        const cellText = rowValues[c] || '';
        const addr = `${sheet.name}!${colNumberToLetters(c)}${r}`;
        const rowContext = rowValues.filter(Boolean).join(' | ').slice(0, 260);

        // A. Explicit placeholder inside a cell
        const phMatch = cellText.match(PLACEHOLDER_REGEX);
        if (phMatch && r !== headerRowIdx) {
          const leftLabel = c > 1 ? rowValues[c - 1] : '';
          const prompt = leftLabel && !isBlankOrPlaceholderValue(leftLabel)
            ? `${leftLabel} (${phMatch[1]})`
            : cleanPlaceholderPrompt(phMatch[1], cellText);

          pushSlot({
            location: addr,
            kind: 'placeholder',
            prompt,
            originalText: cellText,
            context: rowContext,
            target: {
              type: 'xlsx_cell',
              sheetName: sheet.name,
              row: r,
              col: c,
              mode: 'replace_placeholder',
              placeholderToken: phMatch[1]
            }
          });
          continue;
        }

        // B. Empty cell in an identified Answer/Response/Value column
        if (headerRowIdx > 0 && r > headerRowIdx && answerCols.has(c) && isBlankOrPlaceholderValue(cellText)) {
          const rowNonEmpty = rowValues
            .map((val, idx) => ({ val, idx, hdr: headersByCol.get(idx) || '' }))
            .filter((item) => item.val && !answerCols.has(item.idx) && !isBlankOrPlaceholderValue(item.val));

          if (rowNonEmpty.length > 0) {
            const promptParts = rowNonEmpty.map((item) =>
              item.hdr ? `${item.hdr}: ${item.val}` : item.val
            );
            const targetHeader = headersByCol.get(c) || 'Answer';
            pushSlot({
              location: addr,
              kind: 'table_cell',
              prompt: `${promptParts.join(' — ')} [${targetHeader}]`,
              originalText: cellText || '(empty cell)',
              context: rowContext,
              target: {
                type: 'xlsx_cell',
                sheetName: sheet.name,
                row: r,
                col: c,
                mode: 'replace_whole'
              }
            });
            continue;
          }
        }

        // C. Adjacent key-value or Q&A pair (e.g., Col A has question/label, Col B is empty)
        if (
          r !== headerRowIdx &&
          c < colCount &&
          cellText &&
          !isBlankOrPlaceholderValue(cellText) &&
          (looksLikeQuestion(cellText) || cellText.endsWith(':')) &&
          isBlankOrPlaceholderValue(rowValues[c + 1] || '')
        ) {
          const rightAddr = `${sheet.name}!${colNumberToLetters(c + 1)}${r}`;
          pushSlot({
            location: rightAddr,
            kind: looksLikeQuestion(cellText) ? 'question' : 'blank_field',
            prompt: cellText.replace(/:+$/, '').trim(),
            originalText: rowValues[c + 1] || '(empty cell)',
            context: rowContext,
            target: {
              type: 'xlsx_cell',
              sheetName: sheet.name,
              row: r,
              col: c + 1,
              mode: 'replace_whole'
            }
          });
        }
      }
    }
  });

  return {
    summary: `Excel workbook · ${workbook.worksheets.length} ${workbook.worksheets.length === 1 ? 'sheet' : 'sheets'} · ${slots.length} fillable ${slots.length === 1 ? 'cell' : 'cells'} detected`,
    slots
  };
}

async function exportXlsx(doc: CachedDocument, answers: Record<string, string>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(doc.buffer as any);

  for (const slot of doc.slots) {
    if (slot.target.type !== 'xlsx_cell') continue;
    const answer = answers[slot.id];
    if (typeof answer !== 'string' || !answer.trim()) continue;

    const sheet = workbook.getWorksheet(slot.target.sheetName);
    if (!sheet) continue;

    const cell = sheet.getRow(slot.target.row).getCell(slot.target.col);
    const current = getCellText(cell);
    const finalText =
      slot.target.mode === 'replace_placeholder' && slot.target.placeholderToken
        ? current.replace(slot.target.placeholderToken, answer.trim())
        : answer.trim();

    cell.value = finalText;
    cell.alignment = {
      ...(cell.alignment || {}),
      wrapText: true,
      vertical: 'top'
    };
  }

  const outArrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(outArrayBuffer);
}

// ============================================================================
// 3. PPTX Inspection & Slide XML Patching
// ============================================================================

async function inspectPptx(buffer: Buffer): Promise<{ summary: string; slots: InternalSlot[] }> {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml/)?.[1] || '0', 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml/)?.[1] || '0', 10);
      return na - nb;
    });

  if (slidePaths.length === 0) {
    throw new Error('Invalid .pptx file: no slides found inside archive.');
  }

  const slots: InternalSlot[] = [];

  for (let sIdx = 0; sIdx < slidePaths.length; sIdx++) {
    const slidePath = slidePaths[sIdx];
    const slideNum = sIdx + 1;
    const xml = await zip.file(slidePath)!.async('string');
    const paragraphs = findTagBlocks(xml, 'a:p');
    const paraTexts = paragraphs.map((p) => extractTextFromXmlFragment(p.raw, 'a:t').trim());
    const slideContext = paraTexts.filter(Boolean).slice(0, 6).join(' | ').slice(0, 260);
    const used = new Set<number>();

    const pushSlot = (slot: Omit<InternalSlot, 'id' | 'value' | 'source' | 'confidence'>) => {
      slots.push({
        ...slot,
        id: `slot_${slots.length + 1}`,
        value: '',
        source: 'pending',
        confidence: 'pending'
      });
    };

    for (let i = 0; i < paragraphs.length; i++) {
      if (used.has(i)) continue;
      const text = paraTexts[i];
      if (!text) continue;

      const loc = `Slide ${slideNum} · Line ${i + 1}`;
      const nextText = i + 1 < paragraphs.length ? paraTexts[i + 1] : '';

      // A. Explicit placeholder or "Click to add ..."
      const phMatch = text.match(PLACEHOLDER_REGEX);
      if (phMatch || /^click to add\b/i.test(text)) {
        used.add(i);
        const token = phMatch ? phMatch[1] : text;
        pushSlot({
          location: loc,
          kind: 'placeholder',
          prompt: phMatch ? cleanPlaceholderPrompt(token, text) : `Slide ${slideNum}: ${text}`,
          originalText: text,
          context: slideContext,
          target: {
            type: 'pptx_para',
            slidePath,
            paraIndex: i,
            mode: phMatch ? 'replace_placeholder' : 'replace_whole',
            placeholderToken: phMatch ? token : undefined
          }
        });
        continue;
      }

      // B. Labelled blank ("Key Takeaway:", "Answer:", "Presenter: ____")
      const labelMatch = text.match(ANSWER_LABEL_REGEX);
      if (labelMatch && isBlankOrPlaceholderValue(labelMatch[2])) {
        const labelPrefix = labelMatch[1].trim();
        const prevText = i > 0 ? paraTexts[i - 1] : '';
        const isGenericAnswer = /^(answer|ans|response|solution)\s*[:\-]$/i.test(labelPrefix);
        used.add(i);
        pushSlot({
          location: loc,
          kind: isGenericAnswer ? 'question' : 'blank_field',
          prompt:
            isGenericAnswer && prevText && looksLikeQuestion(prevText)
              ? prevText
              : labelPrefix.replace(/[:\-]+$/, '').trim(),
          originalText: text,
          context: slideContext,
          target: {
            type: 'pptx_para',
            slidePath,
            paraIndex: i,
            mode: 'append_after_label',
            labelPrefix
          }
        });
        continue;
      }

      // C. Question line followed by empty/placeholder line
      if (looksLikeQuestion(text) && i + 1 < paragraphs.length && isBlankOrPlaceholderValue(nextText)) {
        used.add(i + 1);
        pushSlot({
          location: `Slide ${slideNum} · Line ${i + 2}`,
          kind: 'question',
          prompt: text,
          originalText: nextText || '(blank slide line)',
          context: slideContext,
          target: {
            type: 'pptx_para',
            slidePath,
            paraIndex: i + 1,
            mode: 'replace_whole'
          }
        });
      }
    }
  }

  return {
    summary: `PowerPoint deck · ${slidePaths.length} ${slidePaths.length === 1 ? 'slide' : 'slides'} · ${slots.length} fillable ${slots.length === 1 ? 'field' : 'fields'} detected`,
    slots
  };
}

async function exportPptx(doc: CachedDocument, answers: Record<string, string>): Promise<Buffer> {
  const zip = await JSZip.loadAsync(doc.buffer);
  const bySlide = new Map<string, Array<{ slot: InternalSlot; answer: string }>>();

  for (const slot of doc.slots) {
    if (slot.target.type !== 'pptx_para') continue;
    const answer = answers[slot.id];
    if (typeof answer !== 'string' || !answer.trim()) continue;
    const list = bySlide.get(slot.target.slidePath) || [];
    list.push({ slot, answer: answer.trim() });
    bySlide.set(slot.target.slidePath, list);
  }

  for (const [slidePath, items] of bySlide.entries()) {
    const slideFile = zip.file(slidePath);
    if (!slideFile) continue;
    let xml = await slideFile.async('string');
    const paragraphs = findTagBlocks(xml, 'a:p');
    const patches = new Map<number, string>();

    for (const { slot, answer } of items) {
      const t = slot.target as PptxTarget;
      const pBlock = paragraphs[t.paraIndex];
      if (!pBlock) continue;
      const current = patches.has(t.paraIndex)
        ? patches.get(t.paraIndex)!
        : extractTextFromXmlFragment(pBlock.raw, 'a:t');

      let next = answer;
      if (t.mode === 'replace_placeholder' && t.placeholderToken) {
        next = current.replace(t.placeholderToken, answer);
      } else if (t.mode === 'append_after_label' && t.labelPrefix) {
        next = `${t.labelPrefix} ${answer}`;
      }
      patches.set(t.paraIndex, next);
    }

    const sorted = Array.from(patches.keys()).sort((a, b) => b - a);
    for (const idx of sorted) {
      const pBlock = paragraphs[idx];
      const patched = patchParagraphXml(pBlock.raw, 'a:t', 'a:r', patches.get(idx)!);
      xml = xml.slice(0, pBlock.start) + patched + xml.slice(pBlock.end);
    }

    zip.file(slidePath, xml);
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ============================================================================
// 4. Public Inspect / Export Orchestrators
// ============================================================================

export function detectFileType(fileName: string): XfillFileType | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.pptx')) return 'pptx';
  return null;
}

export async function inspectAndCacheDocument(
  fileName: string,
  buffer: Buffer
): Promise<{
  docId: string;
  fileName: string;
  fileType: XfillFileType;
  sizeBytes: number;
  summary: string;
  slots: XfillSlotPublic[];
}> {
  pruneCache();
  const fileType = detectFileType(fileName);
  if (!fileType) {
    throw new Error('Unsupported file format. Please upload a .docx, .xlsx, or .pptx file.');
  }

  let parsed: { summary: string; slots: InternalSlot[] };
  if (fileType === 'docx') {
    parsed = await inspectDocx(buffer);
  } else if (fileType === 'xlsx') {
    parsed = await inspectXlsx(buffer);
  } else {
    parsed = await inspectPptx(buffer);
  }

  const docId = `xf_${crypto.randomBytes(8).toString('hex')}`;
  const record: CachedDocument = {
    docId,
    fileName,
    fileType,
    buffer,
    summary: parsed.summary,
    slots: parsed.slots,
    createdAt: Date.now()
  };

  DOC_CACHE.set(docId, record);

  return {
    docId,
    fileName,
    fileType,
    sizeBytes: buffer.length,
    summary: parsed.summary,
    slots: parsed.slots.map(({ target: _t, ...pub }) => pub)
  };
}

export async function exportFilledDocument(
  docId: string,
  answers: Record<string, string>
): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const doc = getCachedDocument(docId);
  if (!doc) {
    throw new Error('Document session expired or not found. Please re-upload your file.');
  }

  let buffer: Buffer;
  let mimeType: string;

  if (doc.fileType === 'docx') {
    buffer = await exportDocx(doc, answers);
    mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  } else if (doc.fileType === 'xlsx') {
    buffer = await exportXlsx(doc, answers);
    mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else {
    buffer = await exportPptx(doc, answers);
    mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }

  const dotIdx = doc.fileName.lastIndexOf('.');
  const baseName = dotIdx > 0 ? doc.fileName.slice(0, dotIdx) : doc.fileName;
  const filledName = `${baseName}_filled.${doc.fileType}`;

  return { buffer, fileName: filledName, mimeType };
}

// ============================================================================
// 5. Built-In Sample Office File Generators (100% Real Openable Files)
// ============================================================================

export async function generateSampleDocument(
  type: XfillFileType
): Promise<{ fileName: string; buffer: Buffer }> {
  if (type === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'J.A.R.V.I.S (c) 2026 vinod';
    const ws = wb.addWorksheet('Technical_QA');
    ws.columns = [
      { header: 'Category', key: 'cat', width: 22 },
      { header: 'Question / Field', key: 'q', width: 48 },
      { header: 'Answer', key: 'a', width: 52 }
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF18181B' }
    };
    const rows = [
      ['Identity', 'Assistant Name', ''],
      ['Architecture', 'What is the primary advantage of running local LLMs via Ollama?', ''],
      ['Networking', 'How does Server-Sent Events (SSE) differ from standard REST responses?', ''],
      ['Algorithms', 'What is the average time complexity of hash table lookup and insertion?', ''],
      ['Security', 'Why should API keys remain strictly on the backend server rather than client JS?', ''],
      ['Private Info', 'Employee Badge ID (internal HR record)', '']
    ];
    rows.forEach((r) => ws.addRow(r));
    const arrBuf = await wb.xlsx.writeBuffer();
    return {
      fileName: 'jarvis_sample_questionnaire.xlsx',
      buffer: Buffer.from(arrBuf)
    };
  }

  if (type === 'docx') {
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
    );
    zip.file(
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
    );
    zip.file(
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>Engineering Assessment &amp; Technical Q&amp;A</w:t></w:r></w:p>
    <w:p><w:r><w:t>Assistant System: {{assistant}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Interface Theme: ______</w:t></w:r></w:p>
    <w:p><w:r><w:t>Q1: Explain the difference between synchronous and asynchronous I/O in Node.js?</w:t></w:r></w:p>
    <w:p><w:r><w:t>Answer:</w:t></w:r></w:p>
    <w:p><w:r><w:t>Q2: What does HTTP status code 429 indicate and how should clients handle it?</w:t></w:r></w:p>
    <w:p><w:r><w:t>Answer:</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Topic</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Answer</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>What is CAP theorem in distributed systems?</w:t></w:r></w:p></w:tc>
        <w:tc><w:p></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:t>Personal Phone Number</w:t></w:p></w:tc>
        <w:tc><w:p></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:sectPr/>
  </w:body>
</w:document>`
    );

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return { fileName: 'jarvis_sample_assessment.docx', buffer };
  }

  // PPTX minimal valid 2-slide OOXML deck
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
    <p:sldId id="257" r:id="rId2"/>
  </p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000"/>
</p:presentation>`
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`
  );

  const makeSlideXml = (title: string, lines: string[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="600000" y="450000"/><a:ext cx="7900000" cy="900000"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2800" b="1"/><a:t>${escapeXml(title)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="600000" y="1500000"/><a:ext cx="7900000" cy="4600000"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          ${lines
            .map(
              (l) =>
                `<a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${escapeXml(l)}</a:t></a:r></a:p>`
            )
            .join('\n          ')}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

  zip.file(
    'ppt/slides/slide1.xml',
    makeSlideXml('System Overview Briefing', [
      'Platform: {{assistant}}',
      'Model Routing Strategy: ______',
      'Summary: [Enter a 1-sentence executive summary of local-first AI assistants]'
    ])
  );
  zip.file(
    'ppt/slides/slide2.xml',
    makeSlideXml('Technical Architecture Q&A', [
      'Q1: Why is deterministic document parsing safer than letting an LLM rewrite raw XML?',
      'Answer:',
      'Q2: What is the benefit of JSON-schema constrained LLM output?',
      'Answer:',
      'Presenter Email: ______'
    ])
  );

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { fileName: 'jarvis_sample_deck.pptx', buffer };
}

// ============================================================================
// 6. Grounded Zero-Hallucination Batch Solver (Local Ollama -> Gemini Cloud)
// ============================================================================

export interface SolveRequestOptions {
  memory: Record<string, string>;
  contextNotes: string;
  strictGrounding: boolean;
  answerStyle: 'concise' | 'detailed' | 'bullets';
  customInstructions: string;
  modelName: string;
  ollamaHost: string;
  keepAliveMinutes: number;
  slotIds?: string[];
}

export interface SolvedSlotResult {
  id: string;
  answer: string;
  source: 'memory' | 'context' | 'knowledge' | 'missing';
  confidence: 'high' | 'medium' | 'needs_input';
  reasoning: string;
}

function cleanAnswerText(raw: string): string {
  return String(raw || '')
    .replace(/^```(?:\w+)?\n?/i, '')
    .replace(/```$/i, '')
    .replace(/^(?:here is the answer|answer|response)\s*:\s*/i, '')
    .trim();
}

function buildGroundedPrompt(
  slots: InternalSlot[],
  opts: SolveRequestOptions
): { system: string; user: string } {
  const styleRule =
    opts.answerStyle === 'bullets'
      ? 'Format multi-point answers as compact semicolon or short bullet lines suitable for documents.'
      : opts.answerStyle === 'detailed'
      ? 'Provide thorough, well-structured factual answers (2-4 crisp sentences max) without fluff.'
      : 'Keep every answer crisp, direct, and to the point (1-2 concise sentences or exact value).';

  const groundingRule = opts.strictGrounding
    ? 'STRICT GROUNDING MODE IS ON: You may ONLY use facts explicitly found in MEMORY_BANK or CONTEXT_NOTES. If a field cannot be answered strictly from those two sources, you MUST output "[NEEDS INPUT]" with source="missing" and confidence="needs_input".'
    : 'GROUNDING PRIORITY: (1) Always check MEMORY_BANK first. (2) Check CONTEXT_NOTES second. (3) For objective factual, academic, technical, or conceptual questions, answer accurately using verified knowledge (source="knowledge"). (4) CRITICAL ANTI-HALLUCINATION RULE: NEVER invent private personal, organizational, financial, or identity data (such as phone numbers, emails, badge/employee IDs, addresses, passwords, private dates, or internal metrics) not present in MEMORY_BANK or CONTEXT_NOTES — for those, ALWAYS output exact text "[NEEDS INPUT]", source="missing", confidence="needs_input".';

  const system = `You are J.A.R.V.I.S Xfill, a precision document auto-fill engine.
Rules:
1. ${groundingRule}
2. ${styleRule}
3. Never add conversational filler ("Sure!", "Here is...", "As an AI..."). Output ONLY the exact text to place inside the document field.
4. Preserve every exact slot id provided. Do not omit or invent ids.
5. Return ONLY valid JSON matching: { "answers": [ { "id": string, "answer": string, "source": "memory"|"context"|"knowledge"|"missing", "confidence": "high"|"medium"|"needs_input", "reasoning": string } ] }.`;

  const memLines = Object.entries(opts.memory || {}).map(([k, v]) => `- ${k}: ${v}`);
  const userPayload = {
    MEMORY_BANK: memLines.length > 0 ? memLines : ['(empty)'],
    CONTEXT_NOTES: opts.contextNotes?.trim() || '(none provided)',
    CUSTOM_INSTRUCTIONS: opts.customInstructions?.trim() || '(none)',
    SLOTS_TO_FILL: slots.map((s) => ({
      id: s.id,
      location: s.location,
      kind: s.kind,
      prompt: s.prompt,
      context: s.context
    }))
  };

  return {
    system,
    user: JSON.stringify(userPayload, null, 2)
  };
}

function normalizeSolvedItems(
  rawItems: any[],
  batchSlots: InternalSlot[]
): SolvedSlotResult[] {
  const validIds = new Set(batchSlots.map((s) => s.id));
  const byId = new Map<string, SolvedSlotResult>();

  if (Array.isArray(rawItems)) {
    for (const item of rawItems) {
      const id = typeof item?.id === 'string' ? item.id.trim() : '';
      if (!validIds.has(id)) continue;

      let answer = cleanAnswerText(item?.answer ?? '');
      let source: SolvedSlotResult['source'] =
        item?.source === 'memory' ||
        item?.source === 'context' ||
        item?.source === 'knowledge' ||
        item?.source === 'missing'
          ? item.source
          : 'knowledge';
      let confidence: SolvedSlotResult['confidence'] =
        item?.confidence === 'high' ||
        item?.confidence === 'medium' ||
        item?.confidence === 'needs_input'
          ? item.confidence
          : 'medium';

      if (!answer || /\[needs input\]/i.test(answer)) {
        answer = '[NEEDS INPUT]';
        source = 'missing';
        confidence = 'needs_input';
      }

      byId.set(id, {
        id,
        answer,
        source,
        confidence,
        reasoning: typeof item?.reasoning === 'string' ? item.reasoning.trim().slice(0, 140) : ''
      });
    }
  }

  // Ensure every requested slot receives a deterministic result
  return batchSlots.map((slot) => {
    const found = byId.get(slot.id);
    if (found) return found;
    return {
      id: slot.id,
      answer: '[NEEDS INPUT]',
      source: 'missing',
      confidence: 'needs_input',
      reasoning: 'Model omitted this slot; manual review required.'
    };
  });
}

async function solveBatchWithOllama(
  batchSlots: InternalSlot[],
  opts: SolveRequestOptions
): Promise<SolvedSlotResult[] | null> {
  const cleanHost = (opts.ollamaHost || 'http://127.0.0.1:11434')
    .replace(/\/+$/, '')
    .replace('localhost', '127.0.0.1');

  // 1. Fast reachability check (1.2s) so offline servers fall back to Gemini immediately
  const probeCtrl = new AbortController();
  const probeTimer = setTimeout(() => probeCtrl.abort(), 1200);
  try {
    const probeRes = await fetch(`${cleanHost}/api/tags`, {
      method: 'GET',
      signal: probeCtrl.signal
    });
    clearTimeout(probeTimer);
    if (!probeRes.ok) return null;
  } catch {
    clearTimeout(probeTimer);
    return null;
  }

  // 2. Local Ollama is live — allow generous 120s timeout for thorough local inference
  const { system, user } = buildGroundedPrompt(batchSlots, opts);
  const chatCtrl = new AbortController();
  const chatTimer = setTimeout(() => chatCtrl.abort(), 120000);

  try {
    const res = await fetch(`${cleanHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: chatCtrl.signal,
      body: JSON.stringify({
        model: opts.modelName || 'qwen2.5:3b',
        stream: false,
        format: 'json',
        keep_alive: `${opts.keepAliveMinutes || 30}m`,
        options: {
          temperature: 0.1,
          num_predict: 2048
        },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    });
    clearTimeout(chatTimer);
    if (!res.ok) return null;

    const data: any = await res.json();
    const rawContent = data?.message?.content;
    if (typeof rawContent !== 'string' || !rawContent.trim()) return null;

    const parsed = JSON.parse(rawContent);
    const items = Array.isArray(parsed?.answers)
      ? parsed.answers
      : Array.isArray(parsed)
      ? parsed
      : [];
    return normalizeSolvedItems(items, batchSlots);
  } catch {
    clearTimeout(chatTimer);
    return null;
  }
}

async function solveBatchWithGemini(
  ai: GoogleGenAI,
  batchSlots: InternalSlot[],
  opts: SolveRequestOptions
): Promise<SolvedSlotResult[]> {
  const { system, user } = buildGroundedPrompt(batchSlots, opts);

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: user,
    config: {
      systemInstruction: system,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          answers: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                answer: { type: Type.STRING },
                source: { type: Type.STRING },
                confidence: { type: Type.STRING },
                reasoning: { type: Type.STRING }
              },
              required: ['id', 'answer', 'source', 'confidence']
            }
          }
        },
        required: ['answers']
      }
    }
  });

  const rawText = (response.text || '{}').trim();
  const parsed = JSON.parse(rawText);
  return normalizeSolvedItems(parsed?.answers || [], batchSlots);
}

export async function solveDocumentSlots(
  docId: string,
  opts: SolveRequestOptions,
  aiClient: GoogleGenAI | null
): Promise<{
  results: SolvedSlotResult[];
  provider: 'ollama' | 'gemini';
  model: string;
  elapsedMs: number;
}> {
  const doc = getCachedDocument(docId);
  if (!doc) {
    throw new Error('Document session expired or not found. Please re-upload your file.');
  }

  const targetSlots =
    Array.isArray(opts.slotIds) && opts.slotIds.length > 0
      ? doc.slots.filter((s) => opts.slotIds!.includes(s.id))
      : doc.slots;

  if (targetSlots.length === 0) {
    throw new Error('No fillable fields selected to solve.');
  }

  const started = Date.now();
  const BATCH_SIZE = 10;
  const allResults: SolvedSlotResult[] = [];
  let usedProvider: 'ollama' | 'gemini' = 'ollama';
  let usedModel = opts.modelName || 'qwen2.5:3b';

  for (let i = 0; i < targetSlots.length; i += BATCH_SIZE) {
    const batch = targetSlots.slice(i, i + BATCH_SIZE);

    // 1. Local Ollama first (fast, low-temp T=0.1, JSON formatted)
    const ollamaBatch = await solveBatchWithOllama(batch, opts);
    if (ollamaBatch) {
      allResults.push(...ollamaBatch);
      continue;
    }

    // 2. Gemini Cloud fallback (gemini-4-hydrogen with strict responseSchema)
    if (!aiClient) {
      throw new Error(
        'Local Ollama is offline and no GEMINI_API_KEY is configured. Start Ollama locally or configure an API key in Settings > Secrets.'
      );
    }

    usedProvider = 'gemini';
    usedModel = GEMINI_MODEL;
    const geminiBatch = await solveBatchWithGemini(aiClient, batch, opts);
    allResults.push(...geminiBatch);
  }

  return {
    results: allResults,
    provider: usedProvider,
    model: usedModel,
    elapsedMs: Math.max(1, Date.now() - started)
  };
}
