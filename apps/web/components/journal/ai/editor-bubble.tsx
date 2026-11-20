"use client";

import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { isNodeSelection } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { BubbleMenuProps } from "@tiptap/react/menus";
import { forwardRef, useCallback, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";

/**
 * 移植来源: steven-tey/novel @ fa95098e66476c466faebb8211baa5869c101a9c
 *   packages/headless/src/components/editor-bubble.tsx (71 行) — 整文件
 * 许可: Apache-2.0（修改过的移植副本）
 * 修改说明（Apache-2.0 §4(b)），全部属于规格 §5 的 D1/D2：
 *   - D1: `BubbleMenu` 改从 `@tiptap/react/menus` 导入（v3 不再由 `@tiptap/react` 直接导出）。
 *   - D2: `tippyOptions` → `options`（Floating UI）。tippy 的 `onHidden` 在 v3 的等价物是
 *     `options.onHide`（`@tiptap/extension-bubble-menu` 的 `BubbleMenuView.hide()` 里调用）。
 *     tippy 的 `onCreate(instance)` 没有对应回调，改为在挂载后用 ref 拿到元素再挂监听。
 *   - D2: `moveTransition: "transform 0.15s ease-out"` 是 tippy 的过渡配置；Floating UI 用
 *     `transform: translate(...)` 定位，等价做法是给元素加 CSS transition（className）。
 *   - 类型：上游 `useCurrentEditor()` 取上下文里的 editor；本仓库没有 `EditorProvider`
 *     （v3 的 `EditorProvider` 会自己再渲染一个 `EditorContent`，与 `journal-editor.tsx`
 *     已有的 `EditorContent` 冲突），所以 editor 由调用方显式传入。
 *
 * `shouldShow`（上游 L24-37）逐行照抄：不可编辑 / 选中的是图片 / 空选区 / NodeSelection
 * 时整条气泡不显示——**AI 入口也一起消失**，这是 Novel 对空选区的行为。
 */

export interface EditorBubbleProps extends Omit<BubbleMenuProps, "editor" | "shouldShow"> {
  editor: BubbleMenuProps["editor"];
  readonly children: ReactNode;
}

/**
 * Upstream `editor-bubble.tsx:24-37`, verbatim. Exported as a plain function so
 * the four "bubble must not appear" cases are unit-testable without Floating UI.
 */
export function shouldShowBubbleMenu(editor: Editor, state: EditorState): boolean {
  const { selection } = state;
  const { empty } = selection;

  // don't show bubble menu if:
  // - the editor is not editable
  // - the selected node is an image
  // - the selection is empty
  // - the selection is a node selection (for drag handles)
  if (!editor.isEditable || editor.isActive("image") || empty || isNodeSelection(selection)) {
    return false;
  }
  return true;
}

export const EditorBubble = forwardRef<HTMLDivElement, EditorBubbleProps>(
  ({ children, editor, options, ...rest }, ref) => {
    const elementRef = useRef<HTMLDivElement | null>(null);

    // v3 (D2) dispatches a `updateOptions` transaction whenever `shouldShow` or
    // `options` change identity. A fresh closure per render would therefore
    // re-enter the editor on every render — an infinite loop under
    // `shouldRerenderOnTransaction: true` (D4). Both must stay referentially stable.
    const shouldShow: BubbleMenuProps["shouldShow"] = useCallback(
      ({ editor: current, state }: { editor: Editor; state: EditorState }) =>
        shouldShowBubbleMenu(current, state),
      [],
    );

    // 上游在 `tippyOptions.onCreate` 里给 popper 的首个子节点挂 blur 拦截，
    // 阻止面板内输入框抢焦点时把编辑器「blur」掉。
    useEffect(() => {
      const firstChild = elementRef.current?.firstElementChild;
      if (!firstChild) return;

      const preventBlur = (event: Event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      firstChild.addEventListener("blur", preventBlur);
      return () => {
        firstChild.removeEventListener("blur", preventBlur);
      };
    }, [children]);

    const bubbleMenuProps: Omit<BubbleMenuProps, "children"> = useMemo(
      () => ({
        shouldShow,
        // Passed through untouched: wrapping it in a new object would defeat the
        // identity check described above.
        ...(options === undefined ? {} : { options }),
        editor,
        ...rest,
      }),
      [shouldShow, options, editor, rest],
    );

    if (!editor) return null;

    return (
      // We need to add this because of https://github.com/ueberdosis/tiptap/issues/2658
      <div ref={ref}>
        <div ref={elementRef} className="contents">
          <BubbleMenu {...bubbleMenuProps}>{children}</BubbleMenu>
        </div>
      </div>
    );
  },
);

EditorBubble.displayName = "EditorBubble";

export default EditorBubble;