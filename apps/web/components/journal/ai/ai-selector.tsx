"use client";

import type { AiRewriteLocale } from "@roamlog/contracts";
import type { Editor } from "@tiptap/react";
import { ArrowUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@roamlog/ui";

import { hashSelection } from "@/lib/ai/selection";
import { rewriteFailureMessage, streamRewrite } from "@/lib/ai/rewrite";
import { addAIHighlight } from "@/lib/editor/ai-highlight";
import { selectionMarkdown } from "@/lib/editor/text-context";

import AICompletionCommands, { type AIPendingRun } from "./ai-completion-command";
import AISelectorCommands from "./ai-selector-commands";
import { Command, CommandInput } from "./command";

/**
 * 移植来源: steven-tey/novel @ fa95098e66476c466faebb8211baa5869c101a9c
 *   apps/web/components/tailwind/generative/ai-selector.tsx (111 行) — 整文件
 * 许可: Apache-2.0（修改过的移植副本）
 * 修改说明（Apache-2.0 §4(b)）:
 *   - **transport（规格 D12）**: 上游 `useCompletion`（Vercel AI SDK v3，
 *     `/api/generate` 私有 data stream）换成 `streamRewrite`（本仓库冻结的 SSE v1）。
 *     因此 `{ completion, complete, isLoading }` 由本地 state + `streamRewrite` 复刻，
 *     状态机本身（`hasCompletion` 驱动的「命令列表 ⇄ 结果态」、二次提交=迭代）逐行保持。
 *   - **类型**: `useEditor()`（novel 的 context）→ 显式 `editor` prop；本仓库没有
 *     `EditorProvider`（v3 的 provider 会再渲染一个 `EditorContent`）。
 *   - **design token**: `bg-purple-500`/`text-purple-500` → `accent-blue`；
 *     `prose prose-sm` → 纯文本预览（见下）。
 *   - **i18n**: `AI is thinking` → 「AI 正在思考」；placeholder 两句按规格 §6.5 翻译。
 *   - **结果预览（适配层）**: 上游用 `react-markdown` 渲染。本仓库没有该依赖，且后端
 *     prompt 已按规格删掉「Use Markdown formatting」（输出是纯文本），所以这里用
 *     `whitespace-pre-wrap` 渲染纯文本——**与最终写回文档的内容逐字一致**，不会出现
 *     「预览是富文本、插入是星号」的不一致。
 *   - **错误态（适配层）**: 上游用 sonner `toast.error`；本仓库没有 sonner，且面板内
 *     错误比 toast 更可达（规格 §6.2 #11「保留面板内错误」），故在面板内渲染错误 +
 *     重试。
 *   - **中止（适配层，本仓库原创）**: 上游 `useCompletion` 从不调用 `stop`，没有中止
 *     UI（规格 §2.9/§3.4）。这里加「停止」按钮 + `AbortController`：服务端收到断开后
 *     以 `done{finishReason:"aborted"}` 收尾，**不写文档**。为什么加：长日志下一次改写
 *     可能跑十几秒，中止是本地模型网关的基本可用性诉求；上游缺它是因为它的 demo
 *     不需要。
 */

interface AISelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editor: Editor;
  /** Workspace scoping every AI request; the panel is not rendered without it. */
  workspaceId: string;
  tripId?: string;
  locale?: AiRewriteLocale;
  /** Called after the result was written into the document. */
  onApplied?: () => void;
}

export function AISelector({
  onOpenChange,
  editor,
  workspaceId,
  tripId,
  locale,
  onApplied,
}: AISelectorProps) {
  const [inputValue, setInputValue] = useState("");
  const [completion, setCompletion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<AIPendingRun | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const hasCompletion = completion.length > 0;

  const run = useCallback(
    async (request: AIPendingRun) => {
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      setErrorMessage(null);
      setCompletion("");
      setPending(request);
      setIsLoading(true);

      try {
        const selectionHash = await hashSelection(request.value);
        if (controller.signal.aborted) return;

        for await (const event of streamRewrite(
          workspaceId,
          {
            text: request.value,
            instruction: request.instruction,
            selectionHash,
            ...(request.contextBefore === undefined
              ? {}
              : { contextBefore: request.contextBefore }),
            ...(request.command === undefined ? {} : { command: request.command }),
            ...(tripId ? { tripId } : {}),
            ...(locale ? { locale } : {}),
          },
          { signal: controller.signal },
        )) {
          if (!mountedRef.current) return;
          if (event.type === "text.delta") {
            setCompletion((previous) => previous + event.delta);
          } else if (event.type === "error") {
            setErrorMessage(event.message);
          }
        }
      } catch (error) {
        // A deliberate abort ends the SSE reader normally; it is not a failure.
        if (controller.signal.aborted) return;
        if (!mountedRef.current) return;
        setErrorMessage(rewriteFailureMessage(error));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (mountedRef.current) setIsLoading(false);
      }
    },
    [locale, tripId, workspaceId],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setCompletion("");
    setErrorMessage(null);
  }, []);

  return (
    // The bubble element is positioned with `width: max-content` by TipTap v3, so
    // the panel must declare an intrinsic width of its own — otherwise a long
    // Chinese result (no spaces to wrap at) stretches it past the viewport.
    <Command
      className="w-[min(350px,calc(100vw-24px))] max-w-full"
      style={{ width: "min(350px, calc(100vw - 24px))" }}
      data-testid="ai-selector-panel"
    >
      {hasCompletion && (
        <div className="flex max-h-[400px]">
          <div
            className="w-[350px] max-w-[calc(100vw-24px)] overflow-y-auto break-words p-2 px-4 text-sm leading-6 whitespace-pre-wrap text-body [overflow-wrap:anywhere]"
            data-testid="ai-rewrite-result"
          >
            {completion}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex h-12 w-full items-center px-4 text-sm font-medium text-accent-blue">
          <SparkleMark className="mr-2 size-4 shrink-0" />
          AI 正在思考
          <div className="ml-2 mt-1">
            <ThinkingDots />
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto h-7 px-2 text-[11px] font-normal text-muted"
            onClick={stop}
            data-testid="ai-rewrite-stop"
          >
            停止
          </Button>
        </div>
      )}

      {errorMessage && !isLoading && (
        <div role="alert" className="border-b border-hairline px-4 py-3 text-xs leading-5">
          <p className="text-accent-red">{errorMessage}</p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                if (pending) void run(pending);
              }}
            >
              重试
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={() => onOpenChange(false)}
            >
              关闭
            </Button>
          </div>
        </div>
      )}

      {!isLoading && (
        <>
          <div className="relative">
            <CommandInput
              value={inputValue}
              onValueChange={setInputValue}
              autoFocus
              placeholder={hasCompletion ? "告诉 AI 下一步怎么做" : "让 AI 改写或续写…"}
              onFocus={() => addAIHighlight(editor)}
            />
            <Button
              type="button"
              size="sm"
              aria-label="发送给 AI"
              className="absolute right-2 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-accent-blue px-0 text-black hover:bg-accent-blue/85"
              onClick={() => {
                // Novel: a second submit with a result on screen iterates on that
                // result (`ai-selector.tsx:80-83`); without one it starts from the
                // selection (`:85-90`).
                void (completion
                  ? run({
                      value: completion,
                      instruction: "zap",
                      command: inputValue,
                      guardSelection: false,
                    })
                  : run({
                      value: selectionMarkdown(editor),
                      instruction: "zap",
                      command: inputValue,
                      guardSelection: true,
                    })).then(() => setInputValue(""));
              }}
              data-testid="ai-rewrite-submit"
            >
              <ArrowUp aria-hidden="true" className="size-4" />
            </Button>
          </div>
          {hasCompletion ? (
            <AICompletionCommands
              editor={editor}
              completion={completion}
              onDiscard={() => {
                editor.chain().focus().unsetAIHighlight().run();
                onOpenChange(false);
              }}
              onMismatch={() => setErrorMessage("原文已变化，请重试")}
              onApplied={() => {
                onApplied?.();
                onOpenChange(false);
              }}
              pending={pending}
            />
          ) : (
            <AISelectorCommands
              editor={editor}
              onSelect={(value, option) =>
                void run(
                  option === "continue"
                    ? {
                        value,
                        instruction: "continue",
                        contextBefore: value,
                        guardSelection: false,
                      }
                    : { value, instruction: option, guardSelection: true },
                )
              }
            />
          )}
        </>
      )}
    </Command>
  );
}

/** Design-token stand-in for Novel's `ui/icons/magic` (decorative, 32-line SVG). */
function SparkleMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 3.5 13.6 8.4 18.5 10 13.6 11.6 12 16.5 10.4 11.6 5.5 10 10.4 8.4 12 3.5Z" />
      <path d="M18.5 15.5 19.2 17.3 21 18 19.2 18.7 18.5 20.5 17.8 18.7 16 18 17.8 17.3 18.5 15.5Z" />
    </svg>
  );
}

/** Port of Novel's `ui/icons/crazy-spinner.tsx` (三个跳动圆点). */
function ThinkingDots() {
  return (
    <div className="flex items-center justify-center gap-0.5">
      <div className="size-1.5 animate-bounce rounded-full bg-accent-blue [animation-delay:-0.3s]" />
      <div className="size-1.5 animate-bounce rounded-full bg-accent-blue [animation-delay:-0.15s]" />
      <div className="size-1.5 animate-bounce rounded-full bg-accent-blue" />
    </div>
  );
}

export default AISelector;