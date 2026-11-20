import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { AIHighlight } from "./ai-highlight";
import { getAllContent, getPrevText, selectionMarkdown } from "./text-context";

/**
 * Novel's `getPrevText` / `getAllContent`
 * (`packages/headless/src/utils/index.ts:24-44` @ fa95098e…) ported to TipTap v3,
 * plus the regression the Markdown extension must not cause.
 */

const editors: Editor[] = [];

function makeEditor(
  content: Record<string, unknown> | string,
  options: { markdown?: boolean; aiHighlight?: boolean; editable?: boolean } = {},
): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit,
      ...(options.markdown === false ? [] : [Markdown]),
      ...(options.aiHighlight ? [AIHighlight] : []),
    ],
    content,
    editable: options.editable ?? true,
    element: document.createElement("div"),
  });
  editors.push(editor);
  return editor;
}

function doc(...paragraphs: string[]) {
  return {
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      ...(text.length === 0 ? {} : { content: [{ type: "text", text }] }),
    })),
  };
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("getPrevText", () => {
  it("serializes only the blocks that start before the position", () => {
    // Each paragraph node is `text.length + 2` wide: node 3 starts at position 10.
    const editor = makeEditor(doc("第一段", "第二段", "第三段"));

    const before = getPrevText(editor, 10);

    expect(before).toContain("第一段");
    expect(before).toContain("第二段");
    expect(before).not.toContain("第三段");
  });

  it("returns an empty string at the very start of the document", () => {
    const editor = makeEditor(doc("第一段"));
    // Position 1 is the first text position; the first block starts at 0, so it is
    // already included — upstream behaves the same way (`pos >= position` stops).
    expect(getPrevText(editor, 0)).toBe("");
  });

  it("returns the whole document for a position past its end", () => {
    const editor = makeEditor(doc("第一段", "第二段"));
    const all = getPrevText(editor, editor.state.doc.nodeSize);
    expect(all).toContain("第一段");
    expect(all).toContain("第二段");
  });

  it("keeps block structure in Markdown (a heading stays a heading)", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "岚山" }] },
        { type: "paragraph", content: [{ type: "text", text: "竹林小径。" }] },
      ],
    });

    const all = getAllContent(editor);
    expect(all).toContain("## 岚山");
    expect(all).toContain("竹林小径。");
  });
});

describe("getAllContent", () => {
  it("serializes the whole document", () => {
    const editor = makeEditor(doc("早", "中", "晚"));
    const all = getAllContent(editor);

    expect(all).toContain("早");
    expect(all).toContain("中");
    expect(all).toContain("晚");
  });
});

describe("selectionMarkdown", () => {
  it("serializes the current selection only", () => {
    const editor = makeEditor(doc("第一段", "第二段", "第三段"));
    // Select the text of the second paragraph (positions 6..9).
    editor.commands.setTextSelection({ from: 6, to: 9 });

    const markdown = selectionMarkdown(editor);

    expect(markdown).toContain("第二段");
    expect(markdown).not.toContain("第一段");
    expect(markdown).not.toContain("第三段");
  });

  it("returns an empty string for an empty selection", () => {
    const editor = makeEditor(doc("第一段"));
    editor.commands.setTextSelection(3);
    expect(selectionMarkdown(editor)).toBe("");
  });
});

describe("Markdown extension registration", () => {
  const existing = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "第二天" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "早上去了" },
          { type: "text", marks: [{ type: "bold" }], text: "岚山" },
          { type: "text", text: "。" },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "竹林" }] }],
          },
        ],
      },
    ],
  };

  it("does not change getJSON / getHTML / getText for an existing entry", () => {
    const without = makeEditor(existing, { markdown: false });
    const withMarkdown = makeEditor(existing);

    // `contentType` stays "json": the extension only adds `getMarkdown` and the
    // storage manager, so every existing read path must be byte-identical.
    expect(withMarkdown.getJSON()).toEqual(without.getJSON());
    expect(withMarkdown.getHTML()).toBe(without.getHTML());
    expect(withMarkdown.getText()).toBe(without.getText());
    expect(withMarkdown.isEmpty).toBe(without.isEmpty);
  });

  it("keeps insertContentAt in JSON/HTML mode, so AI text is not parsed as Markdown", () => {
    const without = makeEditor(existing, { markdown: false });
    const withMarkdown = makeEditor(existing);

    // The AI panel writes plain strings through `insertContentAt` (Novel does the
    // same). Without `contentType: "markdown"` the Markdown extension must not
    // interpret them, otherwise `**x**` would become bold in one editor only.
    for (const editor of [without, withMarkdown]) {
      editor.chain().insertContentAt(editor.state.doc.content.size - 1, "**不是加粗**").run();
    }

    expect(withMarkdown.getHTML()).toBe(without.getHTML());
    expect(withMarkdown.getText()).toContain("**不是加粗**");
  });

  it("HTML written by this editor round-trips through the old (no-Markdown) editor", () => {
    // Production already has entries written by the *old* editor. The contract is
    // that each side can read what the other stored: same DOM, same structure.
    const next = makeEditor(existing);
    const nextHtml = next.getHTML();

    // Old client: it only ever sees `contentHtml` + `contentJson`, no Markdown extension.
    const old = makeEditor(nextHtml, { markdown: false });
    expect(old.getHTML()).toBe(nextHtml);
    expect(old.getText()).toBe(next.getText());

    const nextDom = document.createElement("div");
    nextDom.innerHTML = nextHtml;
    const oldDom = document.createElement("div");
    oldDom.innerHTML = old.getHTML();
    expect(oldDom.innerHTML).toBe(nextDom.innerHTML);
    expect(oldDom.querySelectorAll("*").length).toBe(nextDom.querySelectorAll("*").length);

    // …and the new editor reopening the HTML the old editor produced.
    const reopened = makeEditor(old.getHTML());
    expect(reopened.getHTML()).toBe(nextHtml);
    expect(reopened.getJSON()).toEqual(next.getJSON());

    // A DB round trip stores `contentHtml` as a string and `contentJson` parsed back.
    const fromDatabase = makeEditor(JSON.parse(JSON.stringify(next.getJSON())));
    expect(fromDatabase.getHTML()).toBe(nextHtml);
  });

  it("still produces Markdown on demand", () => {
    const editor = makeEditor(existing);
    expect(editor.getMarkdown()).toContain("## 第二天");
    expect(editor.getMarkdown()).toContain("**岚山**");
  });
});