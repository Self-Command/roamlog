import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { isNodeSelection } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { shouldShowBubbleMenu } from "./editor-bubble";

/**
 * Novel `editor-bubble.tsx:24-37` (`shouldShow`) @ fa95098e…
 *
 * 空选区 / 只读 / 图片 / NodeSelection 时**整条气泡都不出现**——这是 Novel 对
 * 「没有可用选区」的处理方式：入口直接不存在，而不是禁用后解释原因。
 */

const editors: Editor[] = [];

function makeEditor(content: Record<string, unknown>, editable = true): Editor {
  const editor = new Editor({
    extensions: [StarterKit, Image],
    content,
    editable,
    element: document.createElement("div"),
  });
  editors.push(editor);
  return editor;
}

const TEXT_DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "早上去岚山。" }] }],
};

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("shouldShowBubbleMenu", () => {
  it("shows for a non-empty text selection", () => {
    const editor = makeEditor(TEXT_DOC);
    editor.commands.setTextSelection({ from: 1, to: 4 });

    expect(shouldShowBubbleMenu(editor, editor.state)).toBe(true);
  });

  it("hides for an empty selection (caret only) — the acceptance case", () => {
    const editor = makeEditor(TEXT_DOC);
    editor.commands.setTextSelection(3);

    expect(editor.state.selection.empty).toBe(true);
    expect(shouldShowBubbleMenu(editor, editor.state)).toBe(false);
  });

  it("hides in a read-only editor even with a selection", () => {
    const editor = makeEditor(TEXT_DOC, false);
    editor.commands.setTextSelection({ from: 1, to: 4 });

    expect(editor.isEditable).toBe(false);
    expect(shouldShowBubbleMenu(editor, editor.state)).toBe(false);
  });

  it("hides when an image node is selected", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "image", attrs: { src: "https://example.test/a.jpg" } }],
        },
      ],
    });
    editor.commands.setNodeSelection(1);

    expect(editor.isActive("image")).toBe(true);
    expect(shouldShowBubbleMenu(editor, editor.state)).toBe(false);
  });

  it("hides for any node selection, not only images", () => {
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "horizontalRule" }],
    });
    editor.commands.setNodeSelection(0);

    expect(isNodeSelection(editor.state.selection)).toBe(true);
    expect(shouldShowBubbleMenu(editor, editor.state)).toBe(false);
  });
});