import { type Editor, Mark, markInputRule, markPasteRule, mergeAttributes } from "@tiptap/core";

/**
 * 移植来源: steven-tey/novel @ fa95098e66476c466faebb8211baa5869c101a9c
 *   packages/headless/src/extensions/ai-highlight.ts (124 行) — 整文件
 * 许可: Apache-2.0（上游 LICENSE 实测；本文件为修改过的移植副本）
 * 修改说明（Apache-2.0 §4(b)）:
 *   - 默认高亮色由上游 `#c1ecf970` 改为本仓库设计 token（accent-blue 22% 透明度），
 *     上游浅青色在真黑画布上过亮；改动点集中在 `AI_HIGHLIGHT_DEFAULT_COLOR`。
 *   - 其余算法、命令注册、输入/粘贴规则、快捷键均逐行保持上游实现。
 *
 * AI 选区的打底高亮 mark：
 * - 面板输入框聚焦时给当前选区加 `ai-highlight`（`ai-selector.tsx:74`）；
 * - 面板关闭 / 放弃时清除（`generative-menu-switch.tsx:15-17`）；
 * - `Mod-Shift-h` 由上游约定为「切换高亮」，**不是**打开面板（本仓库不自造面板快捷键）。
 */

export interface AIHighlightOptions {
  HTMLAttributes: Record<string, string>;
}

/**
 * 设计 token 适配：`--accent-blue` 的 22% 透明度。
 * 上游用 `#c1ecf970`（浅青色 + 44% alpha），在真黑画布上会盖住正文对比度。
 */
export const AI_HIGHLIGHT_DEFAULT_COLOR = "color-mix(in srgb, var(--accent-blue) 22%, transparent)";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    AIHighlight: {
      /**
       * Set a AIHighlight mark
       */
      setAIHighlight: (attributes?: { color: string }) => ReturnType;
      /**
       * Toggle a AIHighlight mark
       */
      toggleAIHighlight: (attributes?: { color: string }) => ReturnType;
      /**
       * Unset a AIHighlight mark
       */
      unsetAIHighlight: () => ReturnType;
    };
  }
}

export const inputRegex = /(?:^|\s)((?:==)((?:[^~=]+))(?:==))$/;
export const pasteRegex = /(?:^|\s)((?:==)((?:[^~=]+))(?:==))/g;

export const AIHighlight = Mark.create<AIHighlightOptions>({
  name: "ai-highlight",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-color") || element.style.backgroundColor,
        renderHTML: (attributes) => {
          if (!attributes.color) {
            return {};
          }

          return {
            "data-color": attributes.color,
            style: `background-color: ${attributes.color}; color: inherit`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "mark",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setAIHighlight:
        (attributes) =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes);
        },
      toggleAIHighlight:
        (attributes) =>
        ({ commands }) => {
          return commands.toggleMark(this.name, attributes);
        },
      unsetAIHighlight:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name);
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-h": () => this.editor.commands.toggleAIHighlight(),
    };
  },

  addInputRules() {
    return [
      markInputRule({
        find: inputRegex,
        type: this.type,
      }),
    ];
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: pasteRegex,
        type: this.type,
      }),
    ];
  },
});

/**
 * 上游已知缺陷（照抄，见规格 §6.7 R4）：`removeAIHighlight` 直接 `view.dispatch`，
 * **没有** `addToHistory:false`，因此每次开关面板都会在 undo 栈里留下一步。
 * `addAIHighlight` 走 `chain().setAIHighlight()` 同样进 history。
 * 规格决定「照抄保真」；若要修，需用户批准后统一加事务 meta。
 */
/** Minimal TipTap JSON node shape, enough to walk marks without importing pm types. */
interface JsonNode {
  type?: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: JsonNode[];
}

/**
 * Removes every `ai-highlight` mark from a document JSON.
 *
 * 适配层（本仓库原创，非 Novel 移植）：Novel 从不需要保存文档，所以它的 AI 高亮 mark
 * 只活在编辑器里。本仓库的日志 5 秒自动保存，并且会把 `contentJson` / `contentHtml`
 * 落库 —— 如果高亮进入内容，它就会被写进用户的日志（还会让「只有高亮变化」的事务
 * 触发自动保存，进而重置编辑器、关掉正在流式输出的面板）。
 * 因此 `journal-editor.tsx` 在 `onUpdate` 里用这两个函数把 `ai-highlight` 从**持久化
 * 内容**中剥掉；编辑器内的视觉高亮保持上游行为不变。
 */
export function stripAIHighlight<T extends JsonNode>(node: T): T {
  const marks = node.marks?.filter((mark) => mark.type !== "ai-highlight");
  const next: JsonNode = {
    ...node,
    ...(node.marks === undefined ? {} : { marks }),
  };
  // `marks: []` and "no marks" are the same document; dropping the key keeps the
  // comparison (and the stored JSON) identical to an untouched paragraph.
  if (next.marks !== undefined && next.marks.length === 0) delete next.marks;

  if (node.content) {
    const merged: JsonNode[] = [];
    for (const child of node.content.map((entry) => stripAIHighlight(entry))) {
      const previous = merged[merged.length - 1];
      // Adding the highlight splits one text node into several; joining them back
      // makes a highlight-only change compare equal to the original document
      // (otherwise every keystroke-free highlight would mark the entry dirty).
      if (
        previous?.type === "text" &&
        child.type === "text" &&
        typeof previous.text === "string" &&
        typeof child.text === "string" &&
        JSON.stringify(previous.marks ?? []) === JSON.stringify(child.marks ?? [])
      ) {
        merged[merged.length - 1] = { ...previous, text: previous.text + child.text };
      } else {
        merged.push(child);
      }
    }
    next.content = merged;
  }
  return next as T;
}

/**
 * Removes the same marks from serialized HTML. The tag shape is this extension's
 * `renderHTML` output (`data-color` + inline `background-color` + `color: inherit`),
 * so a plain replace is safe: no other mark in this editor renders `<mark>`.
 */
export function stripAIHighlightHtml(html: string): string {
  return html.replace(
    /<mark data-color="[^"]*" style="background-color: [^"]*; color: inherit;?">([\s\S]*?)<\/mark>/gu,
    "$1",
  );
}

export const removeAIHighlight = (editor: Editor) => {
  const tr = editor.state.tr;
  tr.removeMark(0, editor.state.doc.nodeSize - 2, editor.state.schema.marks["ai-highlight"]);
  editor.view.dispatch(tr);
};
export const addAIHighlight = (editor: Editor, color?: string) => {
  editor
    .chain()
    .setAIHighlight({ color: color ?? AI_HIGHLIGHT_DEFAULT_COLOR })
    .run();
};
