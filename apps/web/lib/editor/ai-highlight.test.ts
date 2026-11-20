import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import {
  AI_HIGHLIGHT_DEFAULT_COLOR,
  addAIHighlight,
  AIHighlight,
  removeAIHighlight,
  stripAIHighlight,
  stripAIHighlightHtml,
} from "./ai-highlight";

/**
 * Novel `ai-highlight.ts` (`packages/headless/src/extensions/ai-highlight.ts`
 * @ fa95098e…) — the AI selection mark, its commands and its shortcut.
 */

const editors: Editor[] = [];

function makeEditor(text = "早上从京都站坐车去岚山。"): Editor {
  const editor = new Editor({
    extensions: [StarterKit, AIHighlight],
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
    element: document.createElement("div"),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("AIHighlight mark", () => {
  it("registers the three commands behind the module augmentation", () => {
    const editor = makeEditor();
    expect(typeof editor.commands.setAIHighlight).toBe("function");
    expect(typeof editor.commands.toggleAIHighlight).toBe("function");
    expect(typeof editor.commands.unsetAIHighlight).toBe("function");
  });

  it("renders the design-token colour as data-color plus an inline background", () => {
    const editor = makeEditor();
    editor.commands.setTextSelection({ from: 1, to: 5 });
    addAIHighlight(editor);

    const mark = editor.getHTML();
    expect(mark).toContain("<mark");
    expect(mark).toContain(`data-color="${AI_HIGHLIGHT_DEFAULT_COLOR}"`);
    expect(mark).toContain(`background-color: ${AI_HIGHLIGHT_DEFAULT_COLOR}`);
    // `color: inherit` keeps the paragraph's own text colour readable on the wash.
    expect(mark).toContain("color: inherit");
  });

  it("accepts an explicit colour like the upstream second argument", () => {
    const editor = makeEditor();
    editor.commands.setTextSelection({ from: 1, to: 5 });
    addAIHighlight(editor, "rgba(255, 128, 31, 0.2)");
    expect(editor.getHTML()).toContain("data-color=\"rgba(255, 128, 31, 0.2)\"");
  });

  it("clears every AI highlight in the document, not just the current selection", () => {
    const editor = makeEditor("第一段");
    editor.chain().insertContentAt(editor.state.doc.nodeSize - 2, "第二段").run();
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size });
    addAIHighlight(editor);
    expect(editor.getHTML().match(/<mark/g)?.length ?? 0).toBeGreaterThan(0);

    // Caret somewhere else entirely: the removal must still cover the whole doc.
    editor.commands.setTextSelection(1);
    removeAIHighlight(editor);

    expect(editor.getHTML()).not.toContain("<mark");
    expect(editor.state.doc.nodeSize).toBeGreaterThan(1);
  });

  it("is idempotent when nothing is highlighted", () => {
    const editor = makeEditor();
    const before = editor.getHTML();
    removeAIHighlight(editor);
    expect(editor.getHTML()).toBe(before);
  });

  it("is toggleable with Mod-Shift-h, which is Novel's only AI shortcut", () => {
    const editor = makeEditor();
    editor.commands.setTextSelection({ from: 1, to: 6 });

    const press = () =>
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "h",
          code: "KeyH",
          shiftKey: true,
          ctrlKey: true,
          metaKey: false,
          bubbles: true,
          cancelable: true,
        }),
      );

    press();
    const highlighted = editor.getHTML();
    press();
    const cleared = editor.getHTML();

    expect([highlighted.includes("<mark"), cleared.includes("<mark")]).toContain(true);
    expect(highlighted).not.toBe(cleared);
  });

  it("still parses a pasted <mark> element (shared parseHTML tag)", () => {
    const editor = makeEditor();
    editor.commands.setContent('<p><mark data-color="#fff">强调</mark></p>');

    const textNode = editor.state.doc.firstChild?.firstChild;
    expect(textNode?.marks[0]?.type.name).toBe("ai-highlight");
    expect(textNode?.marks[0]?.attrs.color).toBe("#fff");
    expect(editor.getText()).toContain("强调");
  });
});
describe("persistence guard (adaptation layer)", () => {
  it("removes ai-highlight marks from the JSON an entry would store", () => {
    const editor = makeEditor("早上去岚山。");
    editor.commands.setTextSelection({ from: 1, to: 3 });
    addAIHighlight(editor);

    const stripped = stripAIHighlight(editor.getJSON() as never) as {
      content: Array<{ content?: Array<{ marks?: unknown[]; text?: string }> }>;
    };
    expect(JSON.stringify(stripped)).not.toContain("ai-highlight");
    // Only the mark is gone; every text node is preserved verbatim.
    const text = (stripped.content[0]?.content ?? []).map((node) => node.text ?? "").join("");
    expect(text).toBe("早上去岚山。");
  });

  it("removes the rendered mark tag from HTML", () => {
    const editor = makeEditor("早上去岚山。");
    editor.commands.setTextSelection({ from: 1, to: 3 });
    addAIHighlight(editor);
    const html = editor.getHTML();
    expect(html).toContain("<mark");

    const stripped = stripAIHighlightHtml(html);
    expect(stripped).not.toContain("<mark");
    expect(stripped).toContain("早上去岚山。");
    expect(stripped.startsWith("<p>")).toBe(true);
  });

  it("merges the text nodes a highlight split, so highlight-only changes compare equal", () => {
    const editor = makeEditor("早上去岚山。");
    const before = JSON.stringify(stripAIHighlight(editor.getJSON() as never));

    editor.commands.setTextSelection({ from: 1, to: 3 });
    addAIHighlight(editor);
    const after = JSON.stringify(stripAIHighlight(editor.getJSON() as never));

    // Same document, byte-identical canonical form: the autosave must not fire.
    expect(after).toBe(before);
  });

  it("leaves other marks alone", () => {
    const editor = makeEditor("强调和**普通**");
    editor.commands.setTextSelection({ from: 1, to: 3 });
    editor.chain().setBold().run();
    const stripped = stripAIHighlightHtml(editor.getHTML());
    expect(stripped).toContain("<strong>");
  });
});
