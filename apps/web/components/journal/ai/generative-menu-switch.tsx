"use client";

import type { AiRewriteLocale } from "@roamlog/contracts";
import type { Editor } from "@tiptap/react";
import { Sparkles } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, type ReactNode } from "react";

import { Button } from "@roamlog/ui";

import { removeAIHighlight } from "@/lib/editor/ai-highlight";

import { AISelector } from "./ai-selector";
import EditorBubble from "./editor-bubble";

/**
 * 移植来源: steven-tey/novel @ fa95098e66476c466faebb8211baa5869c101a9c
 *   apps/web/components/tailwind/generative/generative-menu-switch.tsx (48 行) — 整文件
 * 许可: Apache-2.0（修改过的移植副本）
 * 修改说明（Apache-2.0 §4(b)）:
 *   - **D1/D2**: `EditorBubble` 走本仓库 `editor-bubble.tsx`（`@tiptap/react/menus`）；
 *     上游 `tippyOptions={{ placement, onHidden }}` → `options={{ placement, onHide }}`。
 *     `onHide` 是 Floating UI 版本里的等价回调（`BubbleMenuView.hide()` 调用）。
 *   - 上游 `onHidden` 里调 `editor.chain().unsetHighlight()`（基础 Highlight mark）。本仓库
 *     editor **没有**注册 `@tiptap/extensions` 的 `Highlight`（StarterKit v3 不含它，且
 *     `@tiptap/extensions` 不是直接依赖），所以那条命令在这里不存在。改为清本面板真正用的
 *     `ai-highlight` `removeAIHighlight(editor)`；同时保留下面 `!open` 的 effect
 *     （上游行 15-17，才是它真正的清理路径）。
 *   - **design token**: `border-muted bg-background` → `border-hairline-strong bg-surface-1`；
 *     `text-purple-500` → `text-accent-blue`。
 *   - **i18n**: `Ask AI` → 「让 AI 改写」。
 *   - **图标**: 上游 `ui/icons/magic`（装饰性 SVG）→ `lucide-react` 的 `Sparkles`
 *     （规格 §6.1「纯装饰，等价替换」）。
 *   - **类型**: `useEditor()`（novel context）→ `editor` prop；`children` 保留（上游用来塞
 *     节点/链接/文字样式按钮，本仓库的气泡只放 AI 入口）。
 */

interface GenerativeMenuSwitchProps {
  /** Extra bubble buttons (Novel puts its node/link/text selectors here). */
  children?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editor: Editor;
  workspaceId: string;
  tripId?: string;
  locale?: AiRewriteLocale;
  onApplied?: () => void;
}

const GenerativeMenuSwitch = ({
  children,
  open,
  onOpenChange,
  editor,
  workspaceId,
  tripId,
  locale,
  onApplied,
}: GenerativeMenuSwitchProps) => {
  useEffect(() => {
    if (!open) removeAIHighlight(editor);
  }, [open, editor]);

  // Stable identity: TipTap v3's BubbleMenu re-dispatches when `options` change,
  // which would loop forever together with `shouldRerenderOnTransaction: true`.
  const onHide = useCallback(() => {
    onOpenChange(false);
    removeAIHighlight(editor);
  }, [onOpenChange, editor]);

  const bubbleOptions = useMemo(
    () => ({
      placement: (open ? "bottom-start" : "top") as "bottom-start" | "top",
      onHide,
    }),
    [open, onHide],
  );

  return (
    <EditorBubble
      editor={editor}
      options={bubbleOptions}
      className="flex w-fit max-w-[90vw] overflow-hidden rounded-control border border-hairline-strong bg-surface-1 shadow-xl transition-transform duration-150 ease-out"
    >
      {open && (
        <AISelector
          open={open}
          onOpenChange={onOpenChange}
          editor={editor}
          workspaceId={workspaceId}
          tripId={tripId}
          locale={locale}
          onApplied={onApplied}
        />
      )}
      {!open && (
        <Fragment>
          <Button
            className="gap-1 rounded-none text-accent-blue"
            variant="ghost"
            onClick={() => onOpenChange(true)}
            size="sm"
            data-testid="ai-ask-ai"
          >
            <Sparkles aria-hidden="true" className="size-4" />
            让 AI 改写
          </Button>
          {children}
        </Fragment>
      )}
    </EditorBubble>
  );
};

export default GenerativeMenuSwitch;