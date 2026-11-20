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
} from "@/lib/api/ai";

import { executionFailureCopy, planFailureCopy } from "./copy";

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
  extra: { result?: unknown; isError?: boolean } = {},
): Content[number] {
  return {
    type: "tool-call",
    toolName,
    toolCallId,
    args: args as never,
    argsText: JSON.stringify(args),
    ...(extra.result !== undefined ? { result: extra.result as never } : {}),
    ...(extra.isError ? { isError: true } : {}),
  } as Content[number];
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

      let text = "";
      let planEvent: PlanEvent | undefined;
      let errorEvent: Extract<AiStreamEvent, { type: "error" }> | undefined;
      let doneEvent: Extract<AiStreamEvent, { type: "done" }> | undefined;

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
          },
          abortSignal,
        );

        for await (const event of stream) {
          switch (event.type) {
            case "text.delta":
              text += event.delta;
              // Each delta yields the full text so far; assistant-ui replaces
              // the previous snapshot, so words are never duplicated.
              yield {
                content: [textPart(text)],
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
            };
          } catch (fallbackError) {
            const copy = planFailureCopy(toAiRequestError(fallbackError).kind);
            yield {
              content: [textPart(`${copy.title}\n\n${copy.description}`)],
              status: { type: "complete", reason: "stop" },
            };
          }
          return;
        }

        const copy = planFailureCopy(failure.kind);
        // If text already streamed, keep it and mark the message incomplete;
        // a pre-flight failure has no text and keeps the old single bubble.
        yield {
          content: [
            textPart(
              text
                ? `${text}\n\n${copy.title}\n\n${copy.description}`
                : `${copy.title}\n\n${copy.description}`,
            ),
          ],
          status: text
            ? { type: "incomplete", reason: "error" }
            : { type: "complete", reason: "stop" },
        };
        return;
      }

      if (abortSignal.aborted) return;

      const finishReason = doneEvent?.finishReason ?? (errorEvent ? "error" : "stop");

      if (finishReason === "aborted" || errorEvent?.code === "AI_ABORTED") {
        // The message is `incomplete/cancelled`; `thread.tsx` renders the
        // single 「已停止」 label, so no duplicate text part is added here.
        yield {
          content: text ? [textPart(text)] : [],
          status: { type: "incomplete", reason: "cancelled" },
        };
        return;
      }

      if (errorEvent || finishReason === "error") {
        const kind = errorEvent ? aiFailureKind(200, errorEvent.code) : "invalid_response";
        const copy = planFailureCopy(kind);
        yield {
          content: [textPart(`${copy.title}\n\n${copy.description}`)],
          status: { type: "incomplete", reason: "error" },
        };
        return;
      }

      if (planEvent) {
        yield {
          content: [
            textPart(text || planEvent.message),
            toolPart(PLAN_TOOL_NAME, toolCallId, { plan: planEvent }),
          ],
          status: { type: "requires-action", reason: "tool-calls" },
        };
        return;
      }

      if (finishReason === "length") {
        yield {
          content: text ? [textPart(text)] : [],
          status: { type: "incomplete", reason: "length" },
        };
        return;
      }

      // Text-only reply: the last running snapshot is enough; the local
      // runtime closes the message when this generator ends.
      return;
    },
  };
}
