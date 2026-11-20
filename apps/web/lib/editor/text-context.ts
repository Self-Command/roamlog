import type { Editor } from "@tiptap/core";
import { Fragment, type Node } from "@tiptap/pm/model";

/**
 * 移植来源: steven-tey/novel @ fa95098e66476c466faebb8211baa5869c101a9c
 *   packages/headless/src/utils/index.ts:24-44 — `getPrevText` / `getAllContent`（片段移植）
 * 许可: Apache-2.0（修改过的移植副本）
 * 修改说明（Apache-2.0 §4(b)）:
 *   - 上游 `editor.storage.markdown.serializer.serialize(doc)` 传的是 ProseMirror `Node`；
 *     TipTap v3（`@tiptap/markdown` 3.34.0）的 `MarkdownManager.serialize` 只接受
 *     `JSONContent`（实现为 `renderNodes(docOrContent)`，按 `node.type` 字符串分派）。
 *     故这里先 `doc.toJSON()` 再序列化 —— 取节点、拼 Fragment、复制 doc 的算法与上游逐行一致。
 *   - 类型从 `EditorInstance`（novel 的类型别名）换成 `@tiptap/core` 的 `Editor`。
 *
 * 语义（上游原文注释）：`getPrevText` 取「给定位置之前」的全部顶层节点并转成 Markdown；
 * `getAllContent` 取整篇。两者都**不截断**——长度上限由服务端负责（见规格 §6.3）。
 */

// Get the text before a given position in markdown format
export const getPrevText = (editor: Editor, position: number) => {
  const nodes: Node[] = [];
  editor.state.doc.forEach((node, pos) => {
    if (pos >= position) return false;
    nodes.push(node);
    return true;
  });
  const fragment = Fragment.fromArray(nodes);
  const doc = editor.state.doc.copy(fragment);

  return editor.storage.markdown.manager.serialize(doc.toJSON()) as string;
};

// Get all content from the editor in markdown format
export const getAllContent = (editor: Editor) => {
  const fragment = editor.state.doc.content;
  const doc = editor.state.doc.copy(fragment);

  return editor.storage.markdown.manager.serialize(doc.toJSON()) as string;
};

/**
 * 选区原文的 Markdown 形式。对应上游 `ai-selector-commands.tsx:41-42` 与
 * `ai-selector.tsx:85-86`：`serialize(slice.content)`。
 *
 * TipTap v3（D5）：`serialize` 接受 `JSONContent`，所以传 `slice.content.toJSON()`。
 */
export const selectionMarkdown = (editor: Editor) => {
  const slice = editor.state.selection.content();
  return editor.storage.markdown.manager.serialize(slice.content.toJSON()) as string;
};