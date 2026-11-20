"use client";

import type { TextMessagePartProps } from "@assistant-ui/react";
import {
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import { Button } from "@roamlog/ui";
import { ArrowUp, PanelLeft, RotateCcw, Square } from "lucide-react";
import { useEffect } from "react";

import { Markdown } from "./markdown";
import { AI_TOOL_COMPONENTS } from "./plan-card";

/**
 * The conversation surface: message stream + fixed composer.
 *
 * Structure ported from the assistant-ui "Thread" composition —
 * `ThreadPrimitive.Root/Viewport/Messages/Empty`, `MessagePrimitive.Root/Parts`,
 * `ActionBarPrimitive.Root/Reload`, `ComposerPrimitive.Root/Input/Send` and
 * `ThreadPrimitive.Suggestion`. Stop uses `aui.thread.cancelRun()`; reload is
 * `ActionBarPrimitive.Reload` (which calls `aui.message.reload()`).
 * Styling follows the Roamlog Resend-derived tokens.
 */

const SUGGESTIONS = [
  "想去京都一周，预算 8000，喜欢古寺和咖啡馆",
  "带爸妈去成都四天，节奏慢一点，少走路",
  "周末去杭州，预算 2000，想住湖边",
] as const;

function AssistantText({ text }: TextMessagePartProps) {
  return <Markdown text={text} />;
}

function UserText({ text }: TextMessagePartProps) {
  return <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink">{text}</p>;
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[85%] rounded-card border border-hairline-strong bg-surface-2 px-4 py-3">
        <MessagePrimitive.Parts components={{ Text: UserText }} />
      </div>
    </MessagePrimitive.Root>
  );
}

/**
 * Live status for the 10–20 s a tool round spends between model turns.
 *
 * It is a fixed-height line rendered *below* the message body, so a streamed
 * preamble stays visible while the tool round is still running. It is shown
 * only while the message is running; `done` / `plan` / `error` clear it, and an
 * aborted run is hidden because its status is no longer `running`.
 */
function AssistantProgress() {
  const status = useAuiState((state) => state.message.status);
  const label = useAuiState((state) => {
    const progress = state.message.metadata?.custom?.progress as
      | { label?: unknown }
      | null
      | undefined;
    return typeof progress?.label === "string" && progress.label.length > 0
      ? progress.label
      : null;
  });
  if (status?.type !== "running") return null;
  return (
    <p aria-live="polite" className="min-h-5 text-xs leading-5 text-muted">
      {label ? `${label}${label.endsWith("…") ? "" : "…"}` : null}
    </p>
  );
}

/** `cancelRun()` leaves the message `incomplete/cancelled`; label it plainly. */
function AssistantRunStatus() {
  const status = useAuiState((state) => state.message.status);
  const hasText = useAuiState((state) =>
    state.message.content.some(
      (part) => part.type === "text" && part.text.trim().length > 0,
    ),
  );
  if (status?.type !== "incomplete" || status.reason !== "cancelled") return null;
  // A cancelled run that produced nothing says 已取消; a partial answer is
  // kept and marked 已停止 instead of leaving an endlessly spinning bubble.
  return (
    <p role="status" className="text-xs leading-5 text-muted">
      {hasText ? "已停止" : "已取消"}
    </p>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-start">
      <div className="min-w-0 max-w-full flex-1 space-y-3">
        <MessagePrimitive.Parts
          components={{
            Text: AssistantText,
            tools: { by_name: AI_TOOL_COMPONENTS },
          }}
        />
        <AssistantProgress />
        <MessagePrimitive.Error>
          <p role="alert" className="text-xs leading-5 text-accent-red">
            这条回复中断了。工作区没有被写入任何内容，请重新发送。
          </p>
        </MessagePrimitive.Error>
        <AssistantRunStatus />
        <ActionBarPrimitive.Root className="flex items-center gap-1" hideWhenRunning>
          <ActionBarPrimitive.Reload asChild>
            <Button type="button" variant="ghost" size="sm" aria-label="重新生成">
              <RotateCcw aria-hidden="true" className="size-3.5" />
            </Button>
          </ActionBarPrimitive.Reload>
        </ActionBarPrimitive.Root>
      </div>
    </MessagePrimitive.Root>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center sm:py-16">
      <div className="space-y-2">
        <h2 className="font-serif text-2xl leading-tight tracking-[-0.02em] text-ink sm:text-3xl">
          先计划，后写入
        </h2>
        <p className="mx-auto max-w-md text-sm leading-6 text-muted">
          用一句话描述目的地、时间和预算。助手只做只读搜索并列出准备执行的操作，你确认后才会写入工作区。
        </p>
      </div>
      <ul className="flex w-full max-w-xl flex-col gap-2">
        {SUGGESTIONS.map((prompt) => (
          <li key={prompt}>
            <ThreadPrimitive.Suggestion
              prompt={prompt}
              send
              className="w-full rounded-control border border-hairline bg-surface-1 px-4 py-3 text-left text-sm leading-6 text-body outline-none transition-colors hover:border-hairline-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
            >
              {prompt}
            </ThreadPrimitive.Suggestion>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StopButton() {
  const aui = useAui();
  const running = useAuiState((state) => state.thread.isRunning);
  if (!running) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label="停止生成"
      className="shrink-0"
      onClick={() => aui.thread.cancelRun()}
    >
      <Square aria-hidden="true" className="size-3.5" />
    </Button>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-card border border-hairline-strong bg-surface-1 px-2 py-2 focus-within:border-ink/40">
      <ComposerPrimitive.Input
        aria-label="给 AI 助手发消息"
        placeholder="想去哪里？说一句就行（Enter 发送，Shift+Enter 换行）"
        rows={1}
        maxRows={8}
        className="max-h-48 min-h-9 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-6 text-ink outline-none placeholder:text-stone"
      />
      <StopButton />
      <ComposerPrimitive.Send asChild>
        <Button type="button" variant="primary" size="sm" aria-label="发送" className="shrink-0">
          <ArrowUp aria-hidden="true" className="size-4" />
        </Button>
      </ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  );
}

export interface ChatThreadProps {
  onOpenSidebar: () => void;
}

export function ChatThread({ onOpenSidebar }: ChatThreadProps) {
  const aui = useAui();

  // Leaving the thread (route change / unmount) must abort the in-flight run,
  // otherwise the server keeps generating into a socket nobody watches and the
  // message stays "running" until a manual stop.
  useEffect(
    () => () => {
      try {
        aui.thread.cancelRun();
      } catch {
        // The runtime can already be torn down during navigation.
      }
    },
    [aui],
  );

  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2 lg:hidden">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="打开会话列表"
          onClick={onOpenSidebar}
        >
          <PanelLeft aria-hidden="true" className="size-4" />
        </Button>
        <p className="type-meta truncate">AI 旅行助手</p>
      </div>

      <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto w-full max-w-3xl space-y-6">
          <ThreadPrimitive.Empty>
            <EmptyState />
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages
            components={{ UserMessage, AssistantMessage }}
          />
        </div>
      </ThreadPrimitive.Viewport>

      <div className="border-t border-hairline px-4 py-3">
        <Composer />
        <p className="mx-auto mt-2 w-full max-w-3xl text-center text-[11px] leading-5 text-stone">
          助手只能先规划；写入必须由你在计划卡里勾选并确认。
        </p>
      </div>
    </ThreadPrimitive.Root>
  );
}
