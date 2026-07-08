"use client";

/**
 * Minimal, safe markdown renderer for course text pages (headless delivery:
 * manifests ship markdown bodies; the PWA renders). Deliberately tiny — no
 * dependency, no raw-HTML passthrough: the parser only ever produces React
 * elements from PLAIN STRINGS, so everything is escaped by construction.
 *
 * Supported (exactly what course content uses): #/##/### headings,
 * paragraphs, **bold**, *italic*, `-` lists, `1.` lists, and pipe tables.
 * Anything unrecognized renders as a plain paragraph — never broken markup.
 */

import { Fragment, useMemo, type CSSProperties, type ReactNode } from "react";

/* ------------------------------ inline spans ------------------------------ */

const STRONG: CSSProperties = { fontWeight: 700, color: "var(--color-ink)" };

/** `**bold**` and `*italic*` — single pass, no nesting (content never nests). */
function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} style={STRONG}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/* --------------------------------- blocks -------------------------------- */

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] };

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const TABLE_SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (line === "") {
      i += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1]!.length as 1 | 2 | 3,
        text: heading[2]!,
      });
      i += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const ordered = /^\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const item = lines[i]!.trim();
        const m = ordered ? /^\d+\.\s+(.*)$/.exec(item) : /^[-*]\s+(.*)$/.exec(item);
        if (!m) break;
        items.push(m[1]!);
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        tableLines.push(lines[i]!.trim());
        i += 1;
      }
      const header = splitRow(tableLines[0]!);
      const bodyLines = tableLines
        .slice(1)
        .filter((l) => !TABLE_SEPARATOR.test(l));
      blocks.push({ kind: "table", header, rows: bodyLines.map(splitRow) });
      continue;
    }
    // Paragraph: consecutive plain lines join into one calm block.
    const para: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i]!.trim();
      if (
        next === "" ||
        next.startsWith("#") ||
        next.startsWith("|") ||
        /^[-*]\s+/.test(next) ||
        /^\d+\.\s+/.test(next)
      ) {
        break;
      }
      para.push(next);
      i += 1;
    }
    blocks.push({ kind: "p", text: para.join(" ") });
  }
  return blocks;
}

/* -------------------------------- renderer -------------------------------- */

const P_STYLE: CSSProperties = {
  fontSize: 15.5,
  lineHeight: 1.65,
  color: "var(--color-ink-secondary)",
  margin: 0,
  maxWidth: "34em",
};

const H_STYLE: Record<number, CSSProperties> = {
  1: { fontSize: 20, fontWeight: 800, lineHeight: 1.3, margin: 0 },
  2: { fontSize: 17, fontWeight: 800, lineHeight: 1.35, margin: 0 },
  3: { fontSize: 15, fontWeight: 800, lineHeight: 1.4, margin: 0 },
};

const CELL: CSSProperties = {
  padding: "8px 10px",
  fontSize: 13,
  lineHeight: 1.45,
  textAlign: "left",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-ink-secondary)",
  verticalAlign: "top",
};

/** Renders inside the player's reading column (parent supplies the gap). */
export function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <>
      {blocks.map((block, i) => {
        if (block.kind === "heading") {
          const style = H_STYLE[block.level]!;
          if (block.level === 1) return <h1 key={i} style={style}>{renderInline(block.text)}</h1>;
          if (block.level === 2) return <h2 key={i} style={style}>{renderInline(block.text)}</h2>;
          return <h3 key={i} style={style}>{renderInline(block.text)}</h3>;
        }
        if (block.kind === "list") {
          const items = block.items.map((item, j) => (
            <li key={j} style={{ marginTop: j === 0 ? 0 : 5 }}>
              {renderInline(item)}
            </li>
          ));
          const listStyle: CSSProperties = { ...P_STYLE, paddingLeft: 22 };
          return block.ordered ? (
            <ol key={i} style={listStyle}>{items}</ol>
          ) : (
            <ul key={i} style={listStyle}>{items}</ul>
          );
        }
        if (block.kind === "table") {
          return (
            <div
              key={i}
              style={{
                overflowX: "auto",
                background: "var(--color-card)",
                border: "1.5px solid var(--color-border)",
                borderRadius: 12,
              }}
            >
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 320 }}>
                <thead>
                  <tr>
                    {block.header.map((cell, j) => (
                      <th
                        key={j}
                        scope="col"
                        style={{
                          ...CELL,
                          fontWeight: 800,
                          color: "var(--color-ink)",
                          background: "var(--color-canvas)",
                        }}
                      >
                        {renderInline(cell)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td key={c} className="rl-num" style={CELL}>
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p key={i} style={P_STYLE}>
            {renderInline(block.text)}
          </p>
        );
      })}
    </>
  );
}
