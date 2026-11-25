"use client";

/**
 * Generic assistant-ui tool renderer for every tool that has no dedicated card.
 *
 * Ported from vercel/chatbot `components/ai-elements/tool.tsx`
 * @ a8989b522fa3672a2ae52f053105e40993b36ca1 (Apache-2.0), L25–L172, and the
 * generic branch that replaces `message.tsx` L341's `return null`.
 *
 * The only original code here is the adapter described in the migration spec
 * §C.2.1: assistant-ui's 4-state `ToolCallMessagePartStatus` (plus the raw
 * `args`/`result`/`isError` props) is translated into the 5 visible states the
 * upstream card understands, and the duration is read from `timing` (which
 * upstream's AI SDK part does not have, but assistant-ui does).
 */

import type {
  ToolCallMessagePartComponent,
  ToolCallMessagePartProps,
  ToolCallMessagePartStatus,
} from "@assistant-ui/react";
import { useEffect, useState } from "react";

import {
  describePlannedCall,
  isKnownToolName,
  summarizeToolResult,
  toolDisplayName,
} from "./copy";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolCardState,
} from "./tool-card-primitives";

/* -------------------------------------------------------------------------- */
/* Type adaptation: AI SDK 7 states → assistant-ui 4 states                   */
/* -------------------------------------------------------------------------- */

/** The seven `ToolUIPart["state"]` values from vercel/chatbot / AI SDK. */
export type ToolUiState =
  | "approval-requested"
  | "approval-responded"
  | "input-available"
  | "input-streaming"
  | "output-available"
  | "output-denied"
  | "output-error";

/**
 * Pure 7 → 4 mapping required by the task.
 *
 * `requires-action` is assistant-ui's approval/interrupt state; the four
 * regular states are `running`, `complete`, `incomplete` and `requires-action`
 * (the latter two are `ToolCallMessagePartStatus` members).
 */
export function mapToolStateToStatus(state: ToolUiState): ToolCallMessagePartStatus {
  switch (state) {
    case "input-streaming":
    case "input-available":
    case "approval-responded":
      return { type: "running" };
    case "approval-requested":
      return { type: "requires-action", reason: "tool-calls" };
    case "output-available":
      return { type: "complete" };
    case "output-denied":
      return { type: "incomplete", reason: "cancelled" };
    case "output-error":
      return { type: "incomplete", reason: "error" };
  }
}

interface RoamlogToolMetadata {
  state?: "ok" | "error" | "cancelled";
  durationMs?: number;
  progressLabel?: string;
  errorMessage?: string;
}

function readRoamlogMetadata(
  metadata: ToolCallMessagePartProps["providerMetadata"],
): RoamlogToolMetadata {
  const raw = metadata?.roamlog;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  return {
    ...(value.state === "ok" || value.state === "error" || value.state === "cancelled"
      ? { state: value.state }
      : {}),
    ...(typeof value.durationMs === "number" && Number.isFinite(value.durationMs)
      ? { durationMs: value.durationMs }
      : {}),
    ...(typeof value.progressLabel === "string" ? { progressLabel: value.progressLabel } : {}),
    ...(typeof value.errorMessage === "string" ? { errorMessage: value.errorMessage } : {}),
  };
}

/** Maps the runtime part state to the visible card state. */
export function toToolCardState({
  status,
  result,
  isError,
  metadata,
}: {
  status?: ToolCallMessagePartStatus;
  result?: unknown;
  isError?: boolean;
  metadata?: RoamlogToolMetadata;
}): ToolCardState {
  if (metadata?.state === "cancelled") return "cancelled";
  if (metadata?.state === "error" || isError) return "error";
  if (metadata?.state === "ok") return "complete";
  if (status?.type === "requires-action") return "waiting";
  if (status?.type === "incomplete") {
    return status.reason === "cancelled" ? "cancelled" : "error";
  }
  if (status?.type === "running") return "running";
  if (status?.type === "complete") return "complete";
  return result === undefined ? "running" : "complete";
}

function errorTextFor(
  status: ToolCallMessagePartStatus | undefined,
  result: unknown,
  isError: boolean | undefined,
  metadata: RoamlogToolMetadata,
): string | undefined {
  if (metadata.errorMessage) return metadata.errorMessage;
  if (status?.type === "incomplete") {
    const error = status.error;
    if (typeof error === "string" && error.trim().length > 0) return error;
    if (error && typeof error === "object" && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim().length > 0) return message;
    }
  }
  if (!isError) return undefined;
  if (typeof result === "string" && result.trim().length > 0) return result;
  if (result && typeof result === "object" && "message" in result) {
    const message = (result as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) return message;
  }
  return "这项操作没有完成";
}

/** Live elapsed time while running; final timing once completed. */
function useDuration(
  startedAt: number | undefined,
  completedAt: number | undefined,
  running: boolean,
  fixedDuration: number | undefined,
): number | undefined {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running || startedAt === undefined || completedAt !== undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, startedAt, completedAt]);

  if (fixedDuration !== undefined) return fixedDuration;
  if (startedAt === undefined) return undefined;
  const end = completedAt ?? (running ? now : undefined);
  return end === undefined ? undefined : Math.max(0, end - startedAt);
}

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

export const ToolCard: ToolCallMessagePartComponent = ({
  toolName,
  args,
  argsText,
  result,
  isError,
  status,
  timing,
  providerMetadata,
}: ToolCallMessagePartProps) => {
  const metadata = readRoamlogMetadata(providerMetadata);
  const state = toToolCardState({ status, result, isError, metadata });
  // A live call is opened so its streamed arguments and progress are actually
  // readable, not hidden behind a collapsed header. Histories still default to
  // collapsed once the call is complete.
  const [open, setOpen] = useState(
    () => state === "running" || state === "error" || state === "cancelled",
  );

  // An error can arrive after the card was first rendered while running; open
  // the body so the reason is visible without an extra click.
  useEffect(() => {
    if (state === "error" || state === "cancelled") setOpen(true);
  }, [state]);

  const durationMs = useDuration(
    timing?.startedAt,
    timing?.completedAt,
    state === "running",
    metadata.durationMs,
  );
  const errorText = errorTextFor(status, result, isError, metadata);
  const hasArguments =
    typeof args === "object" && args !== null && Object.keys(args as object).length > 0;
  const planned =
    hasArguments && isKnownToolName(toolName)
      ? describePlannedCall({
          tool: toolName,
          args: args as Record<string, unknown>,
        })
      : null;
  const inputSummary = planned ? (
    <div className="min-w-0 space-y-0.5">
      <p className="break-words text-xs font-medium leading-5 text-ink">
        {planned.headline}
      </p>
      {planned.details.length > 0 ? (
        <p className="break-words text-[11px] leading-5 text-muted">
          {planned.details.join(" · ")}
        </p>
      ) : null}
    </div>
  ) : null;
  const resultSummaryValue =
    result === undefined ? null : summarizeToolResult(toolName, result);
  const resultSummary = resultSummaryValue ? (
    <div className="min-w-0 space-y-0.5">
      <p className="break-words text-xs font-medium leading-5 text-ink">
        {resultSummaryValue.headline}
      </p>
      {resultSummaryValue.details.length > 0 ? (
        <p className="break-words text-[11px] leading-5 text-muted">
          {resultSummaryValue.details.join(" · ")}
        </p>
      ) : null}
    </div>
  ) : null;

  return (
    <Tool open={open} onOpenChange={setOpen}>
      <ToolHeader
        title={toolDisplayName(toolName)}
        toolType="dynamic-tool"
        toolName={toolName}
        state={state}
        durationMs={durationMs}
        progressLabel={metadata.progressLabel}
      />
      <ToolContent>
        <ToolInput
          input={args}
          rawText={argsText}
          preferRaw={state === "running" && !planned}
          streaming={state === "running"}
          summary={inputSummary}
        />
        <ToolOutput errorText={errorText} output={result} summary={resultSummary} />
      </ToolContent>
    </Tool>
  );
};
