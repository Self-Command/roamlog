import type {
  AiChatResponse,
  AiPlanWarning,
  AiRunExecuteResponse,
  AiToolCall,
} from "@roamlog/contracts";
import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";

import {
  createAiIdempotencyKey,
  createAiPlan,
  executeAiRun,
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
 *   1. plan    — `createAiPlan` (read-only) → assistant text + one pending
 *                `roamlog.plan` tool part carrying the parsed plan envelope.
 *   2. execute — the user confirms inside that part (via `addResult`) →
 *                `executeAiRun` → assistant text + a `roamlog.execute` tool part
 *                holding the per-call results.
 *
 * Nothing else in the UI is allowed to call these two endpoints.
 */

export const PLAN_TOOL_NAME = "roamlog.plan";
export const EXECUTE_TOOL_NAME = "roamlog.execute";

export interface PlanToolArgs {
  plan: AiChatResponse & { warnings?: AiPlanWarning[] };
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
    async *run({ messages, unstable_getMessage }) {
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

      // Round 1: plan only. `createAiPlan` is read-only by contract.
      const request = [...messages].reverse().find((message) => message.role === "user");
      const prompt = request ? userText(request) : "";
      const toolCallId = `plan-${createAiIdempotencyKey()}`;

      try {
        const plan = await createAiPlan(workspaceId, { message: prompt });
        yield {
          content: [textPart(plan.message), toolPart(PLAN_TOOL_NAME, toolCallId, { plan })],
          status: { type: "requires-action", reason: "tool-calls" },
        };
      } catch (error) {
        const copy = planFailureCopy(toAiRequestError(error).kind);
        yield {
          content: [textPart(`${copy.title}\n\n${copy.description}`)],
          status: { type: "complete", reason: "stop" },
        };
      }
    },
  };
}
