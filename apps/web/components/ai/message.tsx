"use client";

/**
 * Message rendering ported from vercel/chatbot `components/chat/message.tsx`
 * @ a8989b522fa3672a2ae52f053105e40993b36ca1 (Apache-2.0), L84–L414.
 *
 * Adaptation layer:
 * - `UseChatHelpers` / `ChatMessage` are replaced by assistant-ui primitives.
 *   `MessagePrimitive.Parts` renders `text` / `reasoning` / `tool-*` in the
 *   exact order they arrive, which is the assistant-ui equivalent of upstream's
 *   `message.parts.map(...)` loop.
 * - Unknown tool names are handled by `tools.Fallback: ToolCard`; upstream's
 *   `return null` at L341 is intentionally replaced (spec §C.4).
 * - The upstream `Weather` / `Document*` / `PreviewAttachment` branches are
 *   not ported: Roamlog's tools are the ten planner tools rendered by
 *   `plan-card.tsx` or the generic `ToolCard`; the task mapping excludes the
 *   artifact/document UI.
 * - `WaitingText` uses an animate-pulse line instead of `Shimmer` (no
 *   `shimmer` component in this repo); the `isThinking = isLoading &&
 *   !hasAnyContent` condition is kept.
 */

import type {
  ReasoningMessagePartProps,
  TextMessagePartProps,
} from "@assistant-ui/react";
import { MessagePrimitive, useAuiState } from "@assistant-ui/react";
import { Sparkles } from "lucide-react";

import { Markdown } from "./markdown";
import { MessageActions } from "./message-actions";
import { AI_TOOL_COMPONENTS } from "./plan-card";
import { MessageReasoning } from "./reasoning";
import { ToolCard } from "./tool-card";

function AssistantText({ text }: TextMessagePartProps) {
  return <Markdown text={text} />;
}

function UserText({ text }: TextMessagePartProps) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink">
      {text}
    </p>
  );
}

function AssistantReasoning({ text, status }: ReasoningMessagePartProps) {
  return (
    <MessageReasoning
      reasoning={text}
      isLoading={status?.type === "running"}
    />
  );
}

/**
 * Live status for the 10–20 s a tool round spends between model turns.
 *
 * Ported from the upstream `isThinking` rule (message.tsx L116–L124): the
 * status line only occupies the message when no text/tool/reasoning part has
 * arrived yet. Once a tool card exists it carries the running state itself.
 */
function AssistantProgress() {
  const status = useAuiState((state) => state.message.status);
  const contentEmpty = useAuiState((state) => state.message.content.length === 0);
  const label = useAuiState((state) => {
    const progress = state.message.metadata?.custom?.progress as
      | { label?: unknown }
      | null
      | undefined;
    return typeof progress?.label === "string" && progress.label.length > 0
      ? progress.label
      : null;
  });

  if (status?.type !== "running" || !contentEmpty) return null;

  return (
    <p aria-live="polite" className="min-h-5 text-xs leading-5 text-muted">
      {label ? `${label}${label.endsWith("…") ? "" : "…"}` : "正在思考…"}
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

export function WaitingText() {
  return (
    <p className="animate-pulse text-sm leading-6 text-muted" aria-live="polite">
      正在思考…
    </p>
  );
}

export function UserMessage() {
  return (
    <MessagePrimitive.Root className="group/message flex w-full justify-end">
      <div className="flex min-w-0 max-w-[85%] flex-col items-end gap-1">
        <div className="max-w-full rounded-card border border-hairline-strong bg-surface-2 px-4 py-3">
          <MessagePrimitive.Parts components={{ Text: UserText }} />
        </div>
        <MessageActions role="user" />
      </div>
    </MessagePrimitive.Root>
  );
}

export function AssistantMessage() {
  return (
    <MessagePrimitive.Root
      className="group/message flex w-full min-w-0 justify-start gap-3"
      data-testid="message-assistant"
    >
      <div className="flex h-7 shrink-0 items-center">
        <div className="flex size-7 items-center justify-center rounded-card bg-surface-2 text-muted ring-1 ring-hairline-strong">
          <Sparkles aria-hidden="true" className="size-3.5" />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <MessagePrimitive.Parts
          components={{
            Text: AssistantText,
            Reasoning: AssistantReasoning,
            tools: { by_name: AI_TOOL_COMPONENTS, Fallback: ToolCard },
          }}
        />
        <AssistantProgress />
        <MessagePrimitive.Error>
          <p role="alert" className="text-xs leading-5 text-accent-red">
            这条回复中断了。工作区没有被写入任何内容，请重新发送。
          </p>
        </MessagePrimitive.Error>
        <AssistantRunStatus />
        <MessageActions role="assistant" />
      </div>
    </MessagePrimitive.Root>
  );
}

/** Upstream `ThinkingMessage` (message.tsx L398–L414). */
export function ThinkingMessage() {
  return (
    <div
      className="group/message w-full"
      data-role="assistant"
      data-testid="message-assistant-loading"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-7 shrink-0 items-center">
          <div className="flex size-7 items-center justify-center rounded-card bg-surface-2 text-muted ring-1 ring-hairline-strong">
            <Sparkles aria-hidden="true" className="size-3.5" />
          </div>
        </div>
        <WaitingText />
      </div>
    </div>
  );
}
