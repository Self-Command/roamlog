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
  ImageMessagePartProps,
  ReasoningMessagePartProps,
  TextMessagePartProps,
} from "@assistant-ui/react";
import { MessagePrimitive, useAuiState } from "@assistant-ui/react";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { createCoverMediaClient } from "../../lib/api/media";
import { AttachmentPreview } from "./attachment-preview";
import { readImageMetadata } from "./media-attachment-adapter";
import { Markdown } from "./markdown";
import { MessageActions } from "./message-actions";
import { AI_TOOL_COMPONENTS } from "./plan-card";
import { MessageReasoning } from "./reasoning";
import { Shimmer } from "./shimmer";
import { ToolCard } from "./tool-card";

/**
 * `roamlog-ai-text` is the hook the streaming caret uses: `ai-motion.tsx` appends
 * a blinking cursor to the last paragraph of the last text part while the run is
 * live (`data-streaming="true"` on the body column).
 */
function AssistantText({ text }: TextMessagePartProps) {
  return (
    <div className="roamlog-ai-text min-w-0">
      <Markdown text={text} />
    </div>
  );
}

function UserText({ text }: TextMessagePartProps) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink">
      {text}
    </p>
  );
}

/**
 * One image attachment on a user message.
 *
 * Port of upstream `messages.tsx` L126–L138 / `preview-attachment.tsx` L17–L35:
 * every attachment renders as a 96 px tile above the text (upstream puts the
 * attachment row before `{content}`; assistant-ui emits the parts in content
 * order, so `order-first` reproduces the same stacking inside the bubble).
 *
 * Persistence: the media row id rides on the part's `providerMetadata.roamlog`
 * (`media-attachment-adapter.ts`), so a stale signed URL after a page reload is
 * re-signed in place by `fetchMedia` instead of leaving a broken tile.
 */
const mediaClient = createCoverMediaClient();

function UserImage({ image, filename, providerMetadata }: ImageMessagePartProps) {
  const metadata = readImageMetadata(providerMetadata);
  const [src, setSrc] = useState(image);

  useEffect(() => {
    setSrc(image);
  }, [image]);

  const refresh = (): void => {
    if (!metadata?.mediaId) return;
    void mediaClient
      .fetchMedia(metadata.mediaId)
      .then((read) => {
        const url = read.url ?? read.thumbUrl;
        if (url) setSrc(url);
      })
      .catch(() => {
        // Keep whatever URL the part carried: a thumbnail is not worth an alert.
      });
  };

  return (
    <div className="order-first mb-2 flex flex-wrap gap-2" data-testid="message-attachments">
      <a
        className="group relative block h-24 w-24 shrink-0 overflow-hidden rounded-control border border-hairline-strong bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-ink"
        href={src}
        rel="noreferrer"
        target="_blank"
        aria-label={`查看附件 ${filename ?? metadata?.name ?? ""}`.trim()}
      >
        {/* Signed cross-origin media URL. */}
        <img
          alt={filename ?? metadata?.name ?? "附件"}
          className="size-full object-cover"
          data-testid="message-attachment-thumb"
          height={96}
          onError={refresh}
          src={src}
          width={96}
        />
      </a>
    </div>
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
 * Ported from the upstream `isThinking` rule (message.tsx L116–L124 /
 * L355–L357): while no content part has arrived the assistant message shows the
 * shimmer `WaitingText`; once text/tool parts exist each of them carries its own
 * running state and this row becomes the under-body status line.
 *
 * All three running states required by the task are visible animation, never a
 * static word:
 * - no content yet → shimmer sweep (`Shimmer`, upstream L25–L40);
 * - text streaming → pulsing dots + status label under the body, plus the
 *   blinking caret painted by `ai-motion.tsx`;
 * - a tool running → the tool card's own pulsing dots (see `tool-card.tsx`).
 * Both branches reserve `min-h-5`, so the layout never jumps when the status
 * line appears or disappears.
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

  if (status?.type !== "running") return null;

  if (contentEmpty) {
    return (
      <p
        aria-live="polite"
        className="flex min-h-5 items-center text-xs leading-5 text-muted"
        data-testid="ai-thinking-skeleton"
      >
        <Shimmer as="span" className="truncate" duration={1}>
          {label ?? "正在思考…"}
        </Shimmer>
      </p>
    );
  }

  return (
    <p
      aria-live="polite"
      className="flex min-h-5 items-center gap-2 text-xs leading-5 text-muted"
      data-testid="ai-stream-status"
    >
      <span aria-hidden="true" className="flex items-end gap-1" data-testid="ai-stream-dots">
        <i className="roamlog-ai-dot" />
        <i className="roamlog-ai-dot" />
        <i className="roamlog-ai-dot" />
      </span>
      <span className="truncate">{label ?? "正在生成…"}</span>
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
    <p
      role="status"
      data-testid="ai-run-stopped"
      className="min-h-5 text-xs leading-5 text-muted"
    >
      {hasText ? "已停止" : "已取消"}
    </p>
  );
}

/** Upstream `WaitingText` (message.tsx L25–L40): shimmer, never static text. */
export function WaitingText({ label }: { label?: string }) {
  return (
    <p
      aria-live="polite"
      className="flex min-h-[calc(13px*1.65)] min-w-0 items-center text-sm leading-6 text-muted"
    >
      <Shimmer as="span" className="max-w-full whitespace-normal break-words" duration={1}>
        {label ?? "正在思考…"}
      </Shimmer>
    </p>
  );
}

export function UserMessage() {
  return (
    <MessagePrimitive.Root className="group/message flex w-full justify-end">
      <div className="flex min-w-0 max-w-[85%] flex-col items-end gap-1">
        <div className="flex max-w-full flex-col items-end rounded-card border border-hairline-strong bg-surface-2 px-4 py-3">
          {/*
            Live attachments live in `message.attachments` (assistant-ui does not
            merge them into `content`), so they need their own primitive — same
            split as upstream, where `message.tsx` L126–L138 renders
            `attachmentsFromMessage` next to the text. Reloaded turns carry the
            parts in `content` instead, which `Parts` renders via `UserImage`.
            `thread-list-adapter` flattens attachments into `content` on save, so
            the two never double up.
          */}
          <div
            className="mb-2 flex flex-wrap justify-end gap-2 empty:hidden"
            data-testid="message-attachments-row"
          >
            <MessagePrimitive.Attachments>
              {({ attachment }) => (
                <AttachmentPreview attachment={attachment} variant="message" />
              )}
            </MessagePrimitive.Attachments>
          </div>
          <MessagePrimitive.Parts components={{ Text: UserText, Image: UserImage }} />
        </div>
        <MessageActions role="user" />
      </div>
    </MessagePrimitive.Root>
  );
}

export function AssistantMessage() {
  // Drives the streaming caret in `ai-motion.tsx`; false on every terminal state
  // (complete / error / cancelled) so no animation survives the run.
  const streaming = useAuiState((state) => state.message.status?.type === "running");

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

      <div
        className="roamlog-ai-body flex min-w-0 flex-1 flex-col gap-2"
        data-streaming={streaming ? "true" : "false"}
      >
        <MessagePrimitive.Parts
          components={{
            Text: AssistantText,
            Reasoning: AssistantReasoning,
            tools: { by_name: AI_TOOL_COMPONENTS, Fallback: ToolCard },
          }}
        />
        <AssistantProgress />
        <MessagePrimitive.Error>
          <p
            role="alert"
            data-testid="ai-message-error"
            className="min-h-5 text-xs leading-5 text-accent-red"
          >
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
