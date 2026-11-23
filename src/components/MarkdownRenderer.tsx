import React from "react";

interface MarkdownRendererProps {
  content: string;
  isUser?: boolean;
  dir?: "rtl" | "ltr";
}

const MAX_CONTENT_CHARS = 32_000;
const MAX_BLOCKS = 1000;
const MAX_INLINE_DEPTH = 6;

function cleanMathExpression(expr: string): string {
  return expr
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1) / ($2)")
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\approx/g, "≈")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\cdot/g, "·")
    .replace(/\\%/g, "%")
    .replace(/\\text\{([^}]+)\}/g, "$1")
    .trim();
}

function renderInline(text: string, isUser = false, depth = 0): React.ReactNode[] {
  if (!text) return [];
  if (depth >= MAX_INLINE_DEPTH) {
    return [text];
  }

  // Bounded non-backtracking inline tokenization for code, math, bold, and italic
  const tokenRegex =
    /(`[^`\n]+`|\$\$[^$\n]{1,200}\$\$|\$[^\s$\n][^$\n]{0,120}\$|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (tokenRegex.lastIndex === match.index) {
      tokenRegex.lastIndex++;
      continue;
    }

    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];

    if (token.startsWith("`") && token.endsWith("`") && token.length >= 2) {
      parts.push(
        <code
          key={key++}
          className={`px-1.5 py-0.5 rounded text-[0.85em] font-mono-num font-medium ${
            isUser
              ? "bg-white/15 text-blue-100"
              : "bg-slate-200/75 dark:bg-slate-800 text-[#0F294A] dark:text-blue-200 border border-slate-300/60 dark:border-slate-700"
          }`}
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (
      (token.startsWith("$$") && token.endsWith("$$") && token.length > 4) ||
      (token.startsWith("$") && token.endsWith("$") && token.length > 2)
    ) {
      const inner = token.startsWith("$$") ? token.slice(2, -2) : token.slice(1, -1);
      parts.push(
        <code
          key={key++}
          className={`px-1.5 py-0.5 rounded text-[0.85em] font-mono-num ${
            isUser
              ? "bg-white/15 text-blue-100"
              : "bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-200 border border-blue-200/70 dark:border-blue-800/70"
          }`}
        >
          {cleanMathExpression(inner)}
        </code>
      );
    } else if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      parts.push(
        <strong
          key={key++}
          className={
            isUser ? "font-semibold text-white" : "font-semibold text-[#0F294A] dark:text-slate-100"
          }
        >
          {renderInline(token.slice(2, -2), isUser, depth + 1)}
        </strong>
      );
    } else if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
      parts.push(
        <em key={key++} className="italic">
          {renderInline(token.slice(1, -1), isUser, depth + 1)}
        </em>
      );
    } else {
      parts.push(token);
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function isTableDivider(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  return /^\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?$/.test(trimmed);
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

const HEADING_RE = /^(#{1,6})(?:\s+(.*))?$/;
const HEADING_BOUNDARY_RE = /^#{1,6}(?:\s|$)/;
const HR_RE = /^(-{3,}|\*{3,}|_{3,})$/;
const UL_RE = /^[-*•]\s+/;
const OL_RE = /^\d+[.)]\s+/;

export const MarkdownRenderer = React.memo(function MarkdownRenderer({
  content,
  isUser = false,
  dir,
}: MarkdownRendererProps) {
  if (!content || typeof content !== "string") return null;

  const safeContent =
    content.length > MAX_CONTENT_CHARS
      ? `${content.slice(0, MAX_CONTENT_CHARS)}\n\n…`
      : content;

  const lines = safeContent.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let blockKey = 0;

  while (i < lines.length && blocks.length < MAX_BLOCKS) {
    const prevI = i;
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      blocks.push(
        <pre
          key={blockKey++}
          dir="ltr"
          className="my-2 p-3 rounded-lg bg-[#0F294A] dark:bg-[#0B1120] border border-transparent dark:border-slate-800 text-slate-100 text-xs font-mono-num overflow-x-auto"
        >
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Display math block $$ ... $$
    if (trimmed.startsWith("$$")) {
      const mathLines: string[] = [];
      if (trimmed.endsWith("$$") && trimmed.length > 4) {
        mathLines.push(trimmed.slice(2, -2));
        i++;
      } else {
        mathLines.push(trimmed.slice(2));
        i++;
        while (i < lines.length && !lines[i].trim().endsWith("$$")) {
          mathLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) {
          mathLines.push(lines[i].trim().slice(0, -2));
          i++;
        }
      }
      blocks.push(
        <div
          key={blockKey++}
          dir="ltr"
          className="my-2 px-3 py-2 rounded-lg bg-blue-50/70 dark:bg-blue-950/50 border border-blue-200/70 dark:border-blue-800/70 text-xs font-mono-num text-[#0F294A] dark:text-blue-200 overflow-x-auto"
        >
          {cleanMathExpression(mathLines.join(" "))}
        </div>
      );
      continue;
    }

    // Horizontal rule
    if (HR_RE.test(trimmed)) {
      blocks.push(<hr key={blockKey++} className="my-3 border-slate-200 dark:border-slate-800" />);
      i++;
      continue;
    }

    // Headings (handles #..###### including incomplete streaming chunks like "###" safely)
    const headingMatch = trimmed.match(HEADING_RE);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = (headingMatch[2] ?? "").trim();
      if (text) {
        const headingClass =
          level === 1
            ? "text-base font-bold text-[#0F294A] dark:text-slate-100 mt-3 mb-1.5"
            : level === 2
            ? "text-sm font-bold text-[#0F294A] dark:text-slate-100 mt-3 mb-1"
            : "text-xs font-bold uppercase tracking-wide text-blue-800 dark:text-blue-400 mt-2.5 mb-1";
        blocks.push(
          <div
            key={blockKey++}
            className={isUser ? "text-sm font-bold text-white mt-2 mb-1" : headingClass}
          >
            {renderInline(text, isUser)}
          </div>
        );
      }
      i++;
      continue;
    }

    // Markdown table
    if (trimmed.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const headers = parseTableRow(line);
      i += 2; // skip header & divider
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes("|") && !isTableDivider(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      blocks.push(
        <div
          key={blockKey++}
          className="my-2.5 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]"
        >
          <table className="w-full text-start border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100/80 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-[#0F294A] dark:text-slate-100">
                {headers.map((h, idx) => (
                  <th key={idx} className="py-2 px-3 text-start font-semibold whitespace-nowrap">
                    {renderInline(h, false)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
              {rows.map((r, rIdx) => (
                <tr key={rIdx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                  {headers.map((_, cIdx) => (
                    <td key={cIdx} className="py-2 px-3 align-top">
                      {renderInline(r[cIdx] ?? "", false)}
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

    // Blockquote
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={blockKey++}
          className="my-2 ps-3 border-s-2 border-blue-400 dark:border-blue-500 text-slate-600 dark:text-slate-300 text-xs italic space-y-1"
        >
          {quoteLines.map((ql, idx) => (
            <p key={idx}>{renderInline(ql, isUser)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (UL_RE.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && UL_RE.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(UL_RE, ""));
        i++;
      }
      blocks.push(
        <ul key={blockKey++} className="my-1.5 ps-5 list-disc space-y-1">
          {items.map((item, idx) => (
            <li key={idx} className="leading-relaxed">
              {renderInline(item, isUser)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (OL_RE.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && OL_RE.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(OL_RE, ""));
        i++;
      }
      blocks.push(
        <ol key={blockKey++} className="my-1.5 ps-5 list-decimal space-y-1">
          {items.map((item, idx) => (
            <li key={idx} className="leading-relaxed">
              {renderInline(item, isUser)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph (collect consecutive plain lines matching exact block boundary conditions)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("```") &&
      !lines[i].trim().startsWith("$$") &&
      !HEADING_BOUNDARY_RE.test(lines[i].trim()) &&
      !lines[i].trim().startsWith(">") &&
      !UL_RE.test(lines[i].trim()) &&
      !OL_RE.test(lines[i].trim()) &&
      !HR_RE.test(lines[i].trim()) &&
      !(lines[i].trim().includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1]))
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }

    // Guaranteed forward-progress invariant: never allow i to stall
    if (i <= prevI) {
      paraLines.push(trimmed);
      i = prevI + 1;
    }

    if (paraLines.length > 0) {
      blocks.push(
        <p key={blockKey++} className="my-1.5 leading-relaxed">
          {renderInline(paraLines.join(" "), isUser)}
        </p>
      );
    }
  }

  return <div dir={dir} className="text-sm space-y-1 break-words text-start">{blocks}</div>;
});
