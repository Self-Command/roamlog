import type {
  AiPlanWarning,
  AiRunExecuteResponse,
  AiStreamEvent,
  AiToolCall,
} from "@roamlog/contracts";
import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";

import {
  aiFailureKind,
  createAiIdempotencyKey,
  createAiPlan,
  executeAiRun,
  streamAiPlan,
  toAiRequestError,
  type AiStreamEventPayload,
} from "@/lib/api/ai";

import { executionFailureCopy, planFailureCopy } from "./copy";
import { aiChatSelectionStore } from "./chat-selection";
import { attachmentsFromMessage } from "./media-attachment-adapter";

/**
 * The single seam between the Roamlog plan/execute API and assistant-ui.
 *
 * Ported from the assistant-ui "ChatModelAdapter" contract
 * (`@assistant-ui/core` `ChatModelAdapter.run`) plus the human-in-the-loop tool
 * pattern documented for `LocalRuntimeOptions.unstable_humanToolNames` /
 * `ToolCallMessagePartProps.addResult`: a yielded tool part without a `result`
 * and a `requires-action` status pauses the run until the renderer supplies one,
 * and the adapter is then called again with the supplied result in `messages`.
 *
 * Only two rounds exist per conversation turn:
 *   1. plan    — `streamAiPlan` (SSE, read-only) → assistant text streamed
 *                delta-by-delta + one pending `roamlog.plan` tool part carrying
 *                the parsed plan envelope. A 404/405 deployment falls back to
 *                the old blocking `createAiPlan`.
 *   2. execute — the user confirms inside that part (via `addResult`) →
 *                `executeAiRun` → assistant text + a `roamlog.execute` tool part
 *                holding the per-call results.
 *
 * Nothing else in the UI is allowed to call these two endpoints.
 *
 * Content ordering (migration §C.3): the stream is accumulated into a
 * `Content[]` in arrival order instead of a single `text` string. A text delta
 * extends the trailing text part; a `tool.start` pushes a tool-call part; a
 * later text delta starts a new text part, so "text → tool → text" renders in
 * the same order the server produced it.
 */

export const PLAN_TOOL_NAME = "roamlog.plan";
export const EXECUTE_TOOL_NAME = "roamlog.execute";

type PlanEvent = Extract<AiStreamEvent, { type: "plan" }>;

/**
 * The fields `plan-card.tsx` actually reads. Both the blocking `AiChatResponse`
 * and the SSE `plan` event satisfy it; the event simply omits `usage` and
 * `provider`, which the card never renders.
 */
export type PlanCardPlan = Pick<
  PlanEvent,
  "runId" | "message" | "plannedCalls" | "readOnlyTrace" | "warnings" | "expiresAt"
> & { warnings?: AiPlanWarning[] };

export interface PlanToolArgs {
  plan: PlanCardPlan;
}

export interface ConfirmedPlanResult {
  status: "confirmed";
  runId: string;
  calls: AiToolCall[];
  idempotencyKey: string;
}

export interface ExecutedPlanResult {
  status: "executed";
  calls: AiToolCall[];
  response: AiRunExecuteResponse;
}

export interface FailedExecutionResult {
  status: "failed";
  calls: AiToolCall[];
  title: string;
  description: string;
  retryable: boolean;
}

export type ExecuteToolResult =
  | ExecutedPlanResult
  | FailedExecutionResult;

export type PlanToolResult = ConfirmedPlanResult | ExecuteToolResult;

/**
 * Three-state outcome, derived from the per-call results only.
 *
 * The wire contract keeps a single boolean (`partialFailure`, now true whenever
 * any call failed), so "everything failed" and "some failed" arrive with the same
 * flag. The UI has to tell them apart — a plan where nothing was written must
 * never read as "已执行".
 */
export type ExecutionOutcome = "ok" | "partial" | "all-failed";

export function executionOutcome(response: AiRunExecuteResponse): ExecutionOutcome {
  if (response.results.length === 0) return "ok";
  const failed = response.results.filter((result) => !result.ok).length;
  if (failed === 0) return "ok";
  return failed === response.results.length ? "all-failed" : "partial";
}

const EXECUTION_OUTCOME_TEXT: Record<ExecutionOutcome, string> = {
  ok: "已执行，下面是每一步的结果。",
  partial: "部分操作没有写入成功，下面是每一步的结果。",
  "all-failed": "没有写入任何数据，下面是每一步的结果。",
};

/** Assistant bubble copy that always matches the badge on the result card. */
export function executionOutcomeText(outcome: ExecutionOutcome): string {
  return EXECUTION_OUTCOME_TEXT[outcome];
}

type Content = NonNullable<ChatModelRunResult["content"]>;
type ToolPart = Extract<Content[number], { type: "tool-call" }>;

function textPart(text: string): Content[number] {
  return { type: "text", text };
}

/**
 * assistant-ui types tool arguments as a recursive JSON object; the plan
 * envelope is Zod-parsed wire JSON that has already been validated, so the cast
 * only widens the declared type. It never changes the value.
 */
function toolPart(
  toolName: string,
  toolCallId: string,
  args: Record<string, unknown>,
  extra: {
    result?: unknown;
    isError?: boolean;
    timing?: ToolPart["timing"];
    providerMetadata?: ToolPart["providerMetadata"];
  } = {},
): ToolPart {
  const part: ToolPart = {
    type: "tool-call",
    toolName,
    toolCallId,
    args: args as never,
    argsText: JSON.stringify(args),
    ...(extra.result !== undefined ? { result: extra.result as never } : {}),
    ...(extra.isError ? { isError: true } : {}),
    ...(extra.timing ? { timing: extra.timing } : {}),
    ...(extra.providerMetadata ? { providerMetadata: extra.providerMetadata } : {}),
  };
  return part;
}

/* -------------------------------------------------------------------------- */
/* Pure content-array helpers (unit-tested by chat-model-adapter.test.tsx)    */
/* -------------------------------------------------------------------------- */

/** Append a text delta to the trailing text part, or start a new text part. */
export function appendTextDelta(content: Content, delta: string): Content {
  if (delta.length === 0) return content;
  const last = content[content.length - 1];
  if (last?.type === "text") {
    return [...content.slice(0, -1), { ...last, text: last.text + delta }];
  }
  return [...content, textPart(delta)];
}

/** Insert or update a tool part by `toolCallId`, preserving arrival order. */
export function upsertToolPart(content: Content, next: ToolPart): Content {
  const index = content.findIndex(
    (part) => part.type === "tool-call" && part.toolCallId === next.toolCallId,
  );
  if (index === -1) return [...content, next];

  const existing = content[index];
  if (!existing || existing.type !== "tool-call") return content;

  const merged: ToolPart = {
    ...existing,
    ...next,
    // `tool.start` carries the args; progress/end updates must not erase them.
    args: Object.keys(next.args as object).length > 0 ? next.args : existing.args,
    argsText: next.argsText.length > 0 ? next.argsText : existing.argsText,
    timing: next.timing ?? existing.timing,
    providerMetadata: next.providerMetadata ?? existing.providerMetadata,
  };
  return [...content.slice(0, index), merged, ...content.slice(index + 1)];
}

/** Update one tool part through a callback; unknown ids are a no-op. */
export function updateToolPart(
  content: Content,
  toolCallId: string,
  update: (part: ToolPart) => ToolPart,
): Content {
  const index = content.findIndex(
    (part) => part.type === "tool-call" && part.toolCallId === toolCallId,
  );
  if (index === -1) return content;
  const existing = content[index];
  if (!existing || existing.type !== "tool-call") return content;
  return [...content.slice(0, index), update(existing), ...content.slice(index + 1)];
}

function roamlogMetadata(part: ToolPart): Record<string, unknown> {
  const raw = part.providerMetadata?.roamlog;
  return raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
}

function withRoamlogMetadata(
  part: ToolPart,
  patch: Record<string, unknown>,
): ToolPart["providerMetadata"] {
  return {
    ...(part.providerMetadata ?? {}),
    roamlog: { ...roamlogMetadata(part), ...patch } as never,
  };
}

function toMillis(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function appendFailureCopy(
  content: Content,
  title: string,
  description: string,
): Content {
  const copy = `${title}\n\n${description}`;
  const hasText = content.some(
    (part) => part.type === "text" && part.text.trim().length > 0,
  );
  return appendTextDelta(content, hasText ? `\n\n${copy}` : copy);
}

interface PlanPartLike {
  type: string;
  toolName?: string;
  result?: unknown;
}

function planConfirmationFrom(message: { content: readonly unknown[] }): ConfirmedPlanResult | null {
  for (const raw of message.content) {
    const part = raw as PlanPartLike;
    if (part.type !== "tool-call" || part.toolName !== PLAN_TOOL_NAME) continue;
    const result = part.result as ConfirmedPlanResult | undefined;
    if (result && result.status === "confirmed") return result;
  }
  return null;
}

export function userText(message: {
  content: readonly unknown[] | string;
}): string {
  if (typeof message.content === "string") return message.content.trim();

  return message.content
    .map((raw) => {
      const part = raw as { type: string; text?: string };
      return part.type === "text" && typeof part.text === "string" ? part.text : "";
    })
    .join("")
    .trim();
}

export interface AiChatModelOptions {
  workspaceId: string;
  /** Owner / Admin / Editor may confirm writes; Viewers only ever get plans. */
  canWrite: boolean;
}

export function createAiChatModelAdapter({
  workspaceId,
  canWrite,
}: AiChatModelOptions): ChatModelAdapter {
  return {
    async *run({
      messages,
      abortSignal,
      unstable_getMessage,
      unstable_assistantMessageId,
      unstable_threadId,
    }) {
      const last = messages[messages.length - 1];

      // Round 2: the user confirmed a plan inside the tool part.
      //
      // On a resumed run the assistant message holding the tool result is the
      // one being generated, so it arrives through `unstable_getMessage()`
      // rather than in `messages` (which stops at the parent user message).
      const inFlight = unstable_getMessage?.();
      const assistant =
        inFlight?.role === "assistant"
          ? inFlight
          : last?.role === "assistant"
            ? last
            : undefined;
      if (assistant) {
        const confirmed = planConfirmationFrom(assistant);
        if (confirmed) {
          if (!canWrite) {
            yield {
              content: [
                textPart(planFailureCopy("forbidden").title),
                toolPart(EXECUTE_TOOL_NAME, `${confirmed.runId}-denied`, {}, {
                  result: {
                    status: "failed",
                    calls: confirmed.calls,
                    ...planFailureCopy("forbidden"),
                    retryable: false,
                  } satisfies FailedExecutionResult,
                  isError: true,
                }),
              ],
              status: { type: "complete", reason: "stop" },
            };
            return;
          }

          try {
            const response = await executeAiRun(workspaceId, confirmed.runId, {
              calls: confirmed.calls,
              idempotencyKey: confirmed.idempotencyKey,
            });
            yield {
              content: [
                textPart(executionOutcomeText(executionOutcome(response))),
                toolPart(
                  EXECUTE_TOOL_NAME,
                  `${confirmed.runId}-result`,
                  { runId: confirmed.runId },
                  {
                    result: {
                      status: "executed",
                      calls: confirmed.calls,
                      response,
                    } satisfies ExecutedPlanResult,
                  },
                ),
              ],
              status: { type: "complete", reason: "stop" },
            };
          } catch (error) {
            const failure = toAiRequestError(error);
            const copy = executionFailureCopy(failure.kind);
            yield {
              content: [
                textPart(copy.title),
                toolPart(
                  EXECUTE_TOOL_NAME,
                  `${confirmed.runId}-failure`,
                  { runId: confirmed.runId },
                  {
                    result: {
                      status: "failed",
                      calls: confirmed.calls,
                      title: copy.title,
                      description: copy.description,
                      retryable: failure.retryable,
                    } satisfies FailedExecutionResult,
                    isError: true,
                  },
                ),
              ],
              status: { type: "complete", reason: "stop" },
            };
          }
          return;
        }
      }

      // Round 1: plan only. `streamAiPlan` is read-only by contract; the
      // blocking endpoint is kept solely as a 404/405 deployment fallback.
      const request = [...messages].reverse().find((message) => message.role === "user");
      const prompt = request ? userText(request) : "";
      const toolCallId = `plan-${createAiIdempotencyKey()}`;
      // Model + reasoning depth are read at request time (not captured at mount),
      // so the selector's current value is what this turn actually uses.
      const selection = aiChatSelectionStore(workspaceId).get();
      // Image parts persisted on the user message carry their media id; that is
      // the only attachment source that survives a reload.
      const attachments = request
        ? attachmentsFromMessage(
            request as unknown as {
              content?: readonly { type: string; providerMetadata?: unknown }[];
              attachments?: readonly {
                content?: readonly { type: string; providerMetadata?: unknown }[];
              }[];
            },
          )
        : [];

      let content: Content = [];
      let planEvent: PlanEvent | undefined;
      let errorEvent: Extract<AiStreamEvent, { type: "error" }> | undefined;
      let doneEvent: Extract<AiStreamEvent, { type: "done" }> | undefined;
      /** True after a progress frame was surfaced to the UI. */
      let progressShown = false;

      try {
        const stream = streamAiPlan(
          workspaceId,
          {
            message: prompt,
            // `useLocalRuntime` seeds this with `threadListItem.remoteId`, i.e.
            // the persisted conversation id, so follow-up turns keep context.
            ...(unstable_threadId ? { conversationId: unstable_threadId } : {}),
            ...(request?.id ? { clientMessageId: request.id } : {}),
            ...(unstable_assistantMessageId
              ? { assistantMessageId: unstable_assistantMessageId }
              : {}),
            ...(selection.model === undefined ? {} : { model: selection.model }),
            ...(selection.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: selection.reasoningEffort }),
            ...(attachments.length > 0 ? { attachments } : {}),
          },
          abortSignal,
        );

        for await (const event of stream as AsyncGenerator<AiStreamEventPayload>) {
          switch (event.type) {
            case "progress":
              // Status only: never append the label to the answer. A preamble
              // sentence followed by a 20 s tool round is the common real case,
              // so progress must keep updating the status line after text too;
              // it is cleared only on a terminal frame below.
              progressShown = true;
              yield {
                content: [...content],
                status: { type: "running" },
                metadata: { custom: { progress: event } },
              };
              break;
            case "text.delta":
              content = appendTextDelta(content, event.delta);
              // Each delta yields the full content so far; assistant-ui
              // replaces the previous snapshot, so words are never duplicated.
              // The existing progress metadata is intentionally left untouched:
              // removing it here would blank the status line for the rest of a
              // long tool round.
              yield {
                content: [...content],
                status: { type: "running" },
              };
              break;
            case "tool.start":
              content = upsertToolPart(
                content,
                toolPart(event.name, event.toolCallId, event.args, {
                  timing: { startedAt: toMillis(event.startedAt) },
                  providerMetadata: {
                    roamlog: {
                      name: event.name,
                      ...(event.stepId ? { stepId: event.stepId } : {}),
                      ...(event.parentToolCallId
                        ? { parentToolCallId: event.parentToolCallId }
                        : {}),
                    },
                  },
                }),
              );
              yield {
                content: [...content],
                status: { type: "running" },
              };
              break;
            case "tool.progress":
              content = updateToolPart(content, event.toolCallId, (part) => ({
                ...part,
                providerMetadata: withRoamlogMetadata(part, {
                  ...(event.label ? { progressLabel: event.label } : {}),
                  ...(event.percent !== undefined ? { percent: event.percent } : {}),
                }),
              }));
              yield {
                content: [...content],
                status: { type: "running" },
              };
              break;
            case "tool.end":
              content = updateToolPart(content, event.toolCallId, (part) => {
                const completedAt = toMillis(event.finishedAt);
                return {
                  ...part,
                  ...(event.result !== undefined
                    ? { result: event.result as never }
                    : {}),
                  ...(event.status === "error" ? { isError: true } : {}),
                  timing: {
                    startedAt: part.timing?.startedAt ?? completedAt - event.durationMs,
                    completedAt,
                  },
                  providerMetadata: withRoamlogMetadata(part, {
                    state: event.status,
                    durationMs: event.durationMs,
                    ...(event.error
                      ? { errorMessage: `${event.error.code}: ${event.error.message}` }
                      : {}),
                  }),
                };
              });
              yield {
                content: [...content],
                status: { type: "running" },
              };
              break;
            case "plan":
              planEvent = event;
              break;
            case "error":
              errorEvent = event;
              break;
            case "done":
              doneEvent = event;
              break;
            default:
              break;
          }
        }
      } catch (error) {
        if (abortSignal.aborted) return;

        const failure = toAiRequestError(error);
        if (failure.status === 404 || failure.status === 405) {
          // The streaming endpoint is not deployed yet: fall back to the old
          // blocking plan endpoint. Any other failure must not silently retry.
          try {
            const plan = await createAiPlan(workspaceId, { message: prompt });
            yield {
              content: [textPart(plan.message), toolPart(PLAN_TOOL_NAME, toolCallId, { plan })],
              status: { type: "requires-action", reason: "tool-calls" },
              ...(progressShown ? { metadata: { custom: { progress: undefined } } } : {}),
            };
          } catch (fallbackError) {
            const copy = planFailureCopy(toAiRequestError(fallbackError).kind);
            yield {
              content: [textPart(`${copy.title}\n\n${copy.description}`)],
              status: { type: "complete", reason: "stop" },
              ...(progressShown ? { metadata: { custom: { progress: undefined } } } : {}),
            };
          }
          return;
        }

        const copy = planFailureCopy(failure.kind);
        // If text already streamed, keep it and mark the message incomplete;
        // a pre-flight failure has no text and keeps the old single bubble.
        yield {
          content: appendFailureCopy(content, copy.title, copy.description),
          status: content.length > 0
            ? { type: "incomplete", reason: "error" }
            : { type: "complete", reason: "stop" },
          ...(progressShown ? { metadata: { custom: { progress: undefined } } } : {}),
        };
        return;
      }

      if (abortSignal.aborted) return;

      const finishReason = doneEvent?.finishReason ?? (errorEvent ? "error" : "stop");

      if (finishReason === "aborted" || errorEvent?.code === "AI_ABORTED") {
        // The message is `incomplete/cancelled`; `message.tsx` renders the
        // single 「已停止」 label, so no duplicate text part is added here.
        yield {
          content: [...content],
          status: { type: "incomplete", reason: "cancelled" },
          ...(progressShown ? { metadata: { custom: { progress: undefined } } } : {}),
        };
        return;
      }

      if (errorEvent || finishReason === "error") {
        const kind = errorEvent ? aiFailureKind(200, errorEvent.code) : "invalid_response";
        const copy = planFailureCopy(kind);
        yield {
          content: appendFailureCopy(content, copy.title, copy.description),
          status: { type: "incomplete", reason: "error" },
          ...(progressShown ? { metadata: { custom: { progress: undefined } } } : {}),
        };
        return;
      }

      if (planEvent) {
        if (!content.some((part) => part.type === "text" && part.text.trim().length > 0)) {
          content = appendTextDelta(content, planEvent.message);
        }
        content = [...content, toolPart(PLAN_TOOL_NAME, toolCallId, { plan: planEvent })];
        yield {
          content: [...content],
          status: { type: "requires-action", reason: "tool-calls" },
          ...(progressShown ? { metadata: { custom: { progress: undefined } } } : {}),
        };
        return;
      }

      if (finishReason === "length") {
        yield {
          content: [...content],
          status: { type: "incomplete", reason: "length" },
          ...(progressShown ? { metadata: { custom: { progress: undefined } } } : {}),
        };
        return;
      }

      // Text-only reply: the last running snapshot is enough for the text; an
      // explicit terminal snapshot is only required when a progress line was
      // shown, because `done` is otherwise what ends the status line.
      if (progressShown) {
        yield {
          content: [...content],
          status: { type: "complete", reason: "stop" },
          metadata: { custom: { progress: undefined } },
        };
      }
      return;
    },
  };
}
