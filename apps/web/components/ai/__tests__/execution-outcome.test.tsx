import type {
  AiChatResponse,
  AiRunExecuteResponse,
  AiToolResult,
} from "@roamlog/contracts";
import { AiChatResponseSchema } from "@roamlog/contracts";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { executeAiRun } from "@/lib/api/ai";

import {
  EXECUTE_TOOL_NAME,
  PLAN_TOOL_NAME,
  createAiChatModelAdapter,
  executionOutcome,
  executionOutcomeText,
  type ConfirmedPlanResult,
} from "../chat-model-adapter";
import { ExecutionResultCard } from "../plan-card";

vi.mock("@/lib/api/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/ai")>();
  return { ...actual, createAiPlan: vi.fn(), executeAiRun: vi.fn() };
});

const WORKSPACE_ID = "018f0a00-0000-7000-8000-0000000000aa";
const RUN_ID = "0123456789abcdef0123456789abcdef";
const TRIP_ID = "018f0a00-0000-7000-8000-0000000000b1";

const executeMock = vi.mocked(executeAiRun);

const okResult: AiToolResult = { tool: "trips.create", ok: true, entityId: TRIP_ID };
const failedResult: AiToolResult = {
  tool: "stops.add",
  ok: false,
  error: { code: "TRIP_NOT_FOUND", message: "Trip not found." },
};

function successResponse(): AiRunExecuteResponse {
  return {
    results: [okResult, { tool: "packing.add", ok: true }],
    partialFailure: false,
    summary: "已执行 2 项",
  };
}

function partialResponse(): AiRunExecuteResponse {
  return {
    results: [okResult, { tool: "packing.add", ok: false, error: failedResult.error }],
    partialFailure: true,
    summary: "已执行 1 项，1 项失败，成功的操作未被回滚",
  };
}

function allFailedResponse(): AiRunExecuteResponse {
  return {
    results: [
      { tool: "trips.create", ok: false, error: { code: "TRIP_NOT_FOUND", message: "Trip not found." } },
      { tool: "packing.add", ok: false, error: { code: "TRIP_NOT_FOUND", message: "Trip not found." } },
    ],
    // The server now flags *any* failure, so this is `true` for all-failed too.
    partialFailure: true,
    summary: "2 项全部失败，没有写入任何数据",
  };
}

function cardProps(response: AiRunExecuteResponse) {
  return {
    result: { status: "executed", calls: [], response },
  } as unknown as Parameters<typeof ExecutionResultCard>[0];
}

function renderCard(response: AiRunExecuteResponse) {
  render(<ExecutionResultCard {...cardProps(response)} />);
  return screen.getByLabelText("执行结果");
}

function makePlan(): AiChatResponse {
  return AiChatResponseSchema.parse({
    runId: RUN_ID,
    message: "计划已整理。",
    plannedCalls: [{ tool: "trips.get", args: { tripId: null } }],
    readOnlyTrace: [],
    usage: { inputTokens: 10, outputTokens: 5 },
    provider: { protocol: "openai-chat", model: "auto/test" },
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  });
}

const CONFIRMATION: ConfirmedPlanResult = {
  status: "confirmed",
  runId: RUN_ID,
  calls: [{ tool: "trips.get", args: { tripId: null } }],
  idempotencyKey: "key-1",
};

const USER_MESSAGE = {
  role: "user",
  id: "u1",
  createdAt: new Date(),
  content: [{ type: "text", text: "想去京都" }],
};

const CONFIRMED_MESSAGE = {
  role: "assistant",
  id: "a1",
  createdAt: new Date(),
  content: [
    { type: "text", text: "计划已整理。" },
    {
      type: "tool-call",
      toolName: PLAN_TOOL_NAME,
      toolCallId: "plan-1",
      args: { plan: makePlan() },
      result: CONFIRMATION,
    },
  ],
};

interface PartLike {
  type: string;
  toolName?: string;
  text?: string;
  result?: unknown;
}

/** Mirrors the adapter contract: render once, then stream the execute round. */
async function executeRound(response: AiRunExecuteResponse): Promise<PartLike[]> {
  executeMock.mockResolvedValue(response);
  const adapter = createAiChatModelAdapter({ workspaceId: WORKSPACE_ID, canWrite: true });
  const stream = adapter.run({ messages: [USER_MESSAGE, CONFIRMED_MESSAGE] } as never);
  const resolved = stream instanceof Promise ? await stream : stream;
  const chunks: { content?: PartLike[] }[] = [];
  if (!("next" in (resolved as object))) {
    chunks.push(resolved as unknown as { content?: PartLike[] });
  } else {
    for await (const chunk of resolved as AsyncGenerator<{ content?: PartLike[] }>) {
      chunks.push(chunk);
    }
  }
  const head = chunks[0];
  if (!head?.content) throw new Error("the adapter yielded no content");
  return head.content;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("executionOutcome", () => {
  it("derives ok / partial / all-failed from the per-call results", () => {
    expect(executionOutcome(successResponse())).toBe("ok");
    expect(executionOutcome(partialResponse())).toBe("partial");
    expect(executionOutcome(allFailedResponse())).toBe("all-failed");
  });
});

describe("ExecutionResultCard outcome badge", () => {
  it("shows 全部完成 only when every call succeeded", () => {
    const card = renderCard(successResponse());

    expect(within(card).getByText("全部完成")).toBeInTheDocument();
    expect(within(card).queryByText("部分失败")).not.toBeInTheDocument();
    expect(within(card).queryByText("全部失败")).not.toBeInTheDocument();
  });

  it("shows 部分失败 and never 全部完成 when some calls failed", () => {
    const card = renderCard(partialResponse());

    expect(within(card).getByText("部分失败")).toBeInTheDocument();
    expect(within(card).queryByText("全部完成")).not.toBeInTheDocument();
    expect(within(card).getByText(/1 项失败/)).toBeInTheDocument();
  });

  it("shows 全部失败, no 全部完成 and no 已执行 when every call failed", () => {
    const card = renderCard(allFailedResponse());

    expect(within(card).getByText("全部失败")).toBeInTheDocument();
    expect(within(card).queryByText("全部完成")).not.toBeInTheDocument();
    expect(within(card).queryByText(/已执行/)).not.toBeInTheDocument();
    // The user must be able to tell at a glance that nothing was persisted.
    expect(within(card).getByText(/可以回到计划卡/)).toBeInTheDocument();
    expect(within(card).getByText(/2 项全部失败/)).toBeInTheDocument();
  });

  it("derives the outcome from the results, never from the partialFailure flag", () => {
    // A pre-fix (or mid-deploy) API sends `partialFailure: false` for this exact
    // payload; the card must still refuse to claim success.
    const card = renderCard({ ...allFailedResponse(), partialFailure: false });

    expect(within(card).getByText("全部失败")).toBeInTheDocument();
    expect(within(card).queryByText("全部完成")).not.toBeInTheDocument();
    expect(within(card).queryByText(/已执行/)).not.toBeInTheDocument();
  });
});

describe("executionOutcomeText", () => {
  it("never claims an execution when nothing was written", () => {
    expect(executionOutcomeText("ok")).toContain("已执行");
    expect(executionOutcomeText("partial")).toContain("部分操作没有写入成功");
    expect(executionOutcomeText("all-failed")).toContain("没有写入任何数据");
    expect(executionOutcomeText("all-failed")).not.toContain("已执行");
  });

  it.each([
    ["ok", successResponse, "已执行，下面是每一步的结果。"],
    ["partial", partialResponse, "部分操作没有写入成功，下面是每一步的结果。"],
    ["all-failed", allFailedResponse, "没有写入任何数据，下面是每一步的结果。"],
  ])("writes the %s outcome into the assistant bubble", async (_label, build, expected) => {
    const parts = await executeRound(build());

    const text = parts.find((part) => part.type === "text");
    expect(text?.text).toBe(expected);
    expect(executeMock).toHaveBeenCalledTimes(1);

    const resultPart = parts.find((part) => part.toolName === EXECUTE_TOOL_NAME);
    const executed = resultPart?.result as { status?: string } | undefined;
    expect(executed?.status).toBe("executed");
  });
});
