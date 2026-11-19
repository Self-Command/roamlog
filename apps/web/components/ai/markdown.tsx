"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Minimal, dependency-free Markdown renderer for assistant messages.
 *
 * The repository has no Markdown package and this task may not touch
 * `package.json`, so this covers the subset the planner actually emits —
 * paragraphs, `#`/`##`/`###` headings, `-`/`1.` lists, fenced code, blockquotes,
 * bold / italic / inline code and http(s) links. Everything is rendered as React
 * elements: no `dangerouslySetInnerHTML`, so model output can never inject HTML.
 */

type Inline = ReactNode;

const INLINE_PATTERN =
  /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`|\[[^\]\n]+\]\((?:https?:\/\/)[^)\s]+\))/u;

function renderInline(text: string, keyPrefix: string): Inline[] {
  const nodes: Inline[] = [];
  let rest = text;
  let index = 0;

  while (rest.length > 0) {
    const match = INLINE_PATTERN.exec(rest);
    if (!match || match.index === undefined) break;
    if (match.index > 0) nodes.push(rest.slice(0, match.index));

    const token = match[0];
    const key = `${keyPrefix}-${index}`;
    index += 1;

    if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(
        <strong key={key} className="font-medium text-ink">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="rounded-[4px] border border-hairline bg-black/50 px-1 py-0.5 font-mono text-[0.85em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      nodes.push(
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-hairline-strong underline-offset-2 hover:text-ink"
        >
          {label}
        </a>,
      );
    } else {
      nodes.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }

    rest = rest.slice(match.index + token.length);
  }

  if (rest.length > 0) nodes.push(rest);
  return nodes;
}

function renderBlocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/gu, "\n").split("\n");
  const at = (position: number): string => lines[position] ?? "";
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;

  const nextKey = (prefix: string) => `${prefix}-${(key += 1)}`;

  while (index < lines.length) {
    const line = at(index);
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (/^```/u.test(line)) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/u.test(at(index))) {
        body.push(at(index));
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre
          key={nextKey("code")}
          className="overflow-x-auto rounded-control border border-hairline bg-black/60 p-3 font-mono text-xs leading-5"
        >
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/u.exec(line);
    if (heading) {
      const level = (heading[1] ?? "").length;
      blocks.push(
        <p
          key={nextKey("head")}
          className={
            level === 1
              ? "font-serif text-lg leading-tight tracking-[-0.02em] text-ink"
              : "font-medium text-ink"
          }
        >
          {renderInline(heading[2] ?? "", nextKey("head-inline"))}
        </p>,
      );
      index += 1;
      continue;
    }

    if (/^>\s?/u.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^>\s?/u.test(at(index))) {
        body.push(at(index).replace(/^>\s?/u, ""));
        index += 1;
      }
      blocks.push(
        <blockquote
          key={nextKey("quote")}
          className="border-l border-hairline-strong pl-3 text-muted"
        >
          {renderInline(body.join(" "), nextKey("quote-inline"))}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/u.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*([-*]|\d+\.)\s+/u.test(at(index))) {
        items.push(at(index).replace(/^\s*([-*]|\d+\.)\s+/u, ""));
        index += 1;
      }
      blocks.push(
        <ul key={nextKey("list")} className="ml-4 list-disc space-y-1">
          {items.map((item, itemIndex) => (
            <li key={`${nextKey("item")}-${itemIndex}`}>
              {renderInline(item, `${nextKey("item-inline")}-${itemIndex}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = at(index);
      if (
        current.trim() === "" ||
        /^```/u.test(current) ||
        /^(#{1,3})\s+/u.test(current) ||
        /^>\s?/u.test(current) ||
        /^\s*([-*]|\d+\.)\s+/u.test(current)
      ) {
        break;
      }
      paragraph.push(current);
      index += 1;
    }
    blocks.push(
      <p key={nextKey("p")}>{renderInline(paragraph.join(" "), nextKey("p-inline"))}</p>,
    );
  }

  return blocks;
}

export function Markdown({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="space-y-3 break-words text-sm leading-6 text-body">
      {renderBlocks(text).map((block, blockIndex) => (
        <Fragment key={blockIndex}>{block}</Fragment>
      ))}
    </div>
  );
}
