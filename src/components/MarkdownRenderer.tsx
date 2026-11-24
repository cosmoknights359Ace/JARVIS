import React, { useState, useMemo, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import {
  splitMarkdownFences,
  tokenizeCodeLine,
  parseInlineTokens,
  CodeTokenKind,
  InlineToken
} from '../utils/markdownParser';

interface MarkdownRendererProps {
  content: string;
  messageId: string;
  isStreaming?: boolean;
}

const TOKEN_CLASS_MAP: Record<CodeTokenKind, string | null> = {
  plain: null,
  comment: 'text-zinc-500 italic',
  string: 'text-emerald-300',
  number: 'text-amber-300',
  keyword: 'text-orange-400 font-medium',
  type: 'text-sky-300'
};

function renderHighlightedLine(line: string, lang: string): React.ReactNode[] {
  const tokens = tokenizeCodeLine(line, lang);
  if (tokens.length === 0) return [''];
  if (tokens.length === 1 && tokens[0].kind === 'plain') return [tokens[0].value];

  return tokens.map((tok, idx) => {
    const cls = TOKEN_CLASS_MAP[tok.kind];
    if (!cls) return tok.value;
    return (
      <span key={idx} className={cls}>
        {tok.value}
      </span>
    );
  });
}

function renderInlineNodes(tokens: InlineToken[], keyPrefix: string): React.ReactNode[] {
  return tokens.map((tok, idx) => {
    const key = `${keyPrefix}-${idx}`;
    switch (tok.type) {
      case 'text':
        return tok.text;
      case 'code':
        return (
          <code
            key={key}
            className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 font-mono text-[12px] text-orange-300"
          >
            {tok.text}
          </code>
        );
      case 'link':
        return (
          <a
            key={key}
            href={tok.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-400 underline underline-offset-2 hover:text-orange-300 font-medium transition-colors"
          >
            {tok.label}
          </a>
        );
      case 'bold':
        return (
          <strong key={key} className="font-semibold text-zinc-50">
            {renderInlineNodes(tok.children, key)}
          </strong>
        );
      case 'strike':
        return (
          <del key={key} className="text-zinc-500 line-through">
            {renderInlineNodes(tok.children, key)}
          </del>
        );
      case 'italic':
        return (
          <em key={key} className="italic text-zinc-200">
            {renderInlineNodes(tok.children, key)}
          </em>
        );
    }
  });
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  return renderInlineNodes(parseInlineTokens(text), keyPrefix);
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  const cells = splitTableCells(trimmed);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function renderMarkdownBlocks(blockText: string, keyPrefix: string): React.ReactNode[] {
  const lines = blockText.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      elements.push(<hr key={`${keyPrefix}-hr-${i}`} className="my-3 border-zinc-800/90" />);
      i++;
      continue;
    }

    // Headings (# to ####)
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingContent = renderInline(headingMatch[2], `${keyPrefix}-h-${i}`);
      if (level === 1) {
        elements.push(
          <h1
            key={`${keyPrefix}-h1-${i}`}
            className="text-lg font-display font-bold text-zinc-100 pt-2 pb-0.5 tracking-tight"
          >
            {headingContent}
          </h1>
        );
      } else if (level === 2) {
        elements.push(
          <h2
            key={`${keyPrefix}-h2-${i}`}
            className="text-base font-display font-semibold text-orange-400 pt-2 pb-0.5"
          >
            {headingContent}
          </h2>
        );
      } else {
        elements.push(
          <h3
            key={`${keyPrefix}-h3-${i}`}
            className="text-sm font-display font-semibold text-zinc-100 pt-1.5"
          >
            {headingContent}
          </h3>
        );
      }
      i++;
      continue;
    }

    // GFM Table
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableCells(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitTableCells(lines[i]));
        i++;
      }

      elements.push(
        <div
          key={`${keyPrefix}-tbl-${i}`}
          className="my-3 overflow-x-auto rounded-xl border border-zinc-800 bg-[#070709]"
        >
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/70">
                {headers.map((h, hIdx) => (
                  <th
                    key={hIdx}
                    className="px-3.5 py-2.5 font-display font-semibold text-zinc-200 whitespace-nowrap"
                  >
                    {renderInline(h, `${keyPrefix}-th-${i}-${hIdx}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-zinc-900/40 transition-colors">
                  {headers.map((_, cIdx) => (
                    <td
                      key={cIdx}
                      className="px-3.5 py-2.5 text-zinc-300 align-top tabular-nums"
                    >
                      {renderInline(row[cIdx] ?? '', `${keyPrefix}-td-${i}-${rIdx}-${cIdx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Blockquote (clean hairline container, no thick left bar)
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      elements.push(
        <blockquote
          key={`${keyPrefix}-bq-${i}`}
          className="my-2.5 px-3.5 py-2.5 rounded-xl bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-300 leading-relaxed space-y-1"
        >
          {quoteLines.map((qLine, qIdx) => (
            <p key={qIdx}>{renderInline(qLine, `${keyPrefix}-bq-${i}-${qIdx}`)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: { indent: number; text: string }[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)[-*+]\s+(.*)$/);
        if (m) {
          items.push({ indent: m[1].length, text: m[2] });
        }
        i++;
      }
      elements.push(
        <ul
          key={`${keyPrefix}-ul-${i}`}
          className="my-2 space-y-1.5 pl-5 list-disc marker:text-orange-500/80 text-sm text-zinc-200 leading-relaxed"
        >
          {items.map((item, idx) => (
            <li
              key={idx}
              style={item.indent >= 2 ? { marginLeft: `${Math.min(item.indent * 6, 24)}px` } : undefined}
            >
              {renderInline(item.text, `${keyPrefix}-ul-${i}-${idx}`)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        const m = lines[i].match(/^\s*\d+[.)]\s+(.*)$/);
        if (m) items.push(m[1]);
        i++;
      }
      elements.push(
        <ol
          key={`${keyPrefix}-ol-${i}`}
          className="my-2 space-y-1.5 pl-5 list-decimal marker:text-orange-400 marker:font-mono marker:text-xs text-sm text-zinc-200 leading-relaxed"
        >
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `${keyPrefix}-ol-${i}-${idx}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph (group consecutive non-special lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,4})\s+/.test(lines[i].trim()) &&
      !/^(?:-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('>') &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      paraLines.push(lines[i]);
      i++;
    }

    elements.push(
      <p key={`${keyPrefix}-p-${i}`} className="text-sm text-zinc-200 leading-relaxed">
        {paraLines.map((pLine, pIdx) => (
          <React.Fragment key={pIdx}>
            {pIdx > 0 && <br />}
            {renderInline(pLine, `${keyPrefix}-p-${i}-${pIdx}`)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return elements;
}

const MarkdownRendererInner: React.FC<MarkdownRendererProps> = ({
  content,
  messageId,
  isStreaming = false
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const segments = useMemo(() => splitMarkdownFences(content), [content]);

  const handleCopyCode = useCallback((code: string, id: string) => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  }, []);

  if (!content) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono py-1">
        <span className="inline-block w-1.5 h-3.5 bg-orange-500 animate-pulse" />
        <span>Generating response...</span>
      </div>
    );
  }

  return (
    <div className="space-y-2 break-words">
      {segments.map((seg, idx) => {
        if (seg.type === 'code') {
          const blockId = `${messageId}-code-${idx}`;
          const lineCount = seg.code ? seg.code.split('\n').length : 0;

          return (
            <div
              key={blockId}
              className="my-3 rounded-xl overflow-hidden border border-zinc-800 bg-[#070709]"
            >
              <div className="flex items-center justify-between px-3.5 py-2 bg-zinc-900/90 border-b border-zinc-800 text-xs font-mono">
                <div className="flex items-center gap-2 text-zinc-400">
                  <span className="text-orange-400 font-medium">{seg.lang || 'code'}</span>
                  <span aria-hidden="true" className="text-zinc-700">·</span>
                  <span className="text-zinc-500 tabular-nums">
                    {lineCount} {lineCount === 1 ? 'line' : 'lines'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopyCode(seg.code, blockId)}
                  className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-orange-400 transition-colors whitespace-nowrap"
                  title="Copy code block"
                >
                  {copiedId === blockId ? (
                    <>
                      <Check size={13} className="text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={13} />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              {/* Lightweight plain <pre><code> while streaming; full syntax highlighting once finished */}
              <pre
                data-highlighted={isStreaming ? 'false' : 'true'}
                className="p-4 overflow-x-auto text-xs font-mono text-zinc-200 leading-relaxed"
              >
                {isStreaming ? (
                  <code>{seg.code}</code>
                ) : (
                  <code>
                    {seg.code.split('\n').map((line, lIdx) => (
                      <span key={lIdx} className="block">
                        {renderHighlightedLine(line, seg.lang)}
                      </span>
                    ))}
                  </code>
                )}
              </pre>
            </div>
          );
        }

        return (
          <div key={`${messageId}-md-${idx}`} className="space-y-2">
            {renderMarkdownBlocks(seg.content, `${messageId}-${idx}`)}
          </div>
        );
      })}
    </div>
  );
};

export const MarkdownRenderer = React.memo(MarkdownRendererInner);
