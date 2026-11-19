import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
  messageId: string;
}

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

const TOKEN_REGEX =
  /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;

function highlightCodeLine(line: string, lang: string): React.ReactNode[] {
  const lowerLang = lang.toLowerCase();
  const isTextOnly = lowerLang === 'text' || lowerLang === 'txt' || lowerLang === 'plain';
  if (isTextOnly || !line) {
    return [line];
  }

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_REGEX.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(line.slice(lastIndex, match.index));
    }

    const token = match[0];
    let className: string | null = null;

    if (
      token.startsWith('//') ||
      token.startsWith('/*') ||
      (token.startsWith('#') && !['css', 'html', 'xml'].includes(lowerLang))
    ) {
      className = 'text-zinc-500 italic';
    } else if (
      token.startsWith('"') ||
      token.startsWith("'") ||
      token.startsWith('`')
    ) {
      className = 'text-emerald-300';
    } else if (/^\d/.test(token)) {
      className = 'text-amber-300';
    } else if (CODE_KEYWORDS.has(token)) {
      className = 'text-orange-400 font-medium';
    } else if (/^[A-Z][A-Za-z0-9_]*$/.test(token) && token.length > 1) {
      className = 'text-sky-300';
    }

    if (className) {
      nodes.push(
        <span key={key++} className={className}>
          {token}
        </span>
      );
    } else {
      nodes.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex));
  }

  return nodes;
}

const INLINE_REGEX =
  /(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|\*[^*\n]+\*)/g;

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  INLINE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];

    if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (linkMatch) {
        nodes.push(
          <a
            key={key++}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-400 underline underline-offset-2 hover:text-orange-300 font-medium transition-colors"
          >
            {linkMatch[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key++}
          className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 font-mono text-[12px] text-orange-300"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**')) {
      nodes.push(
        <strong key={key++} className="font-semibold text-zinc-50">
          {renderInline(token.slice(2, -2))}
        </strong>
      );
    } else if (token.startsWith('~~')) {
      nodes.push(
        <del key={key++} className="text-zinc-500 line-through">
          {renderInline(token.slice(2, -2))}
        </del>
      );
    } else if (token.startsWith('*')) {
      nodes.push(
        <em key={key++} className="italic text-zinc-200">
          {renderInline(token.slice(1, -1))}
        </em>
      );
    } else {
      nodes.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
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
      const headingContent = renderInline(headingMatch[2]);
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
                    {renderInline(h)}
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
                      {renderInline(row[cIdx] ?? '')}
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
            <p key={qIdx}>{renderInline(qLine)}</p>
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
              {renderInline(item.text)}
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
            <li key={idx}>{renderInline(item)}</li>
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
            {renderInline(pLine)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return elements;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, messageId }) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!content) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono py-1">
        <span className="inline-block w-1.5 h-3.5 bg-orange-500 animate-pulse" />
        <span>Generating response...</span>
      </div>
    );
  }

  // Safely close an in-flight streaming code fence so code blocks render without flicker
  const fenceMatches = content.match(/```/g) || [];
  const normalized = fenceMatches.length % 2 === 1 ? `${content}\n\`\`\`` : content;
  const parts = normalized.split(/(```[\s\S]*?```)/g);

  const handleCopyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="space-y-2 break-words">
      {parts.map((part, idx) => {
        if (!part) return null;

        if (part.startsWith('```') && part.endsWith('```')) {
          const inner = part.slice(3, -3);
          const firstNl = inner.indexOf('\n');
          const lang = firstNl !== -1 ? inner.slice(0, firstNl).trim() : '';
          const rawCode = firstNl !== -1 ? inner.slice(firstNl + 1) : inner;
          const code = rawCode.replace(/\n$/, '');
          const codeLines = code.split('\n');
          const blockId = `${messageId}-code-${idx}`;

          return (
            <div
              key={blockId}
              className="my-3 rounded-xl overflow-hidden border border-zinc-800 bg-[#070709]"
            >
              <div className="flex items-center justify-between px-3.5 py-2 bg-zinc-900/90 border-b border-zinc-800 text-xs font-mono">
                <div className="flex items-center gap-2 text-zinc-400">
                  <span className="text-orange-400 font-medium">{lang || 'code'}</span>
                  <span aria-hidden="true" className="text-zinc-700">·</span>
                  <span className="text-zinc-500 tabular-nums">
                    {codeLines.length} {codeLines.length === 1 ? 'line' : 'lines'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopyCode(code, blockId)}
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
              <pre className="p-4 overflow-x-auto text-xs font-mono text-zinc-200 leading-relaxed">
                <code>
                  {codeLines.map((line, lIdx) => (
                    <span key={lIdx} className="block">
                      {highlightCodeLine(line, lang)}
                    </span>
                  ))}
                </code>
              </pre>
            </div>
          );
        }

        return (
          <div key={`${messageId}-md-${idx}`} className="space-y-2">
            {renderMarkdownBlocks(part, `${messageId}-${idx}`)}
          </div>
        );
      })}
    </div>
  );
};
