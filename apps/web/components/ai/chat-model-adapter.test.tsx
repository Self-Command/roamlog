import type { AiChatResponse, AiStreamEvent } from "@roamlog/contracts";
import { AiChatResponseSchema } from "@roamlog/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import {
  AiRequestError,
  createAiPlan,
  executeAiRun,
  streamAiPlan,
} from "@/lib/api/ai";

import {
  EXECUTE_TOOL_NAME,
  PLAN_TOOL_NAME,
  createAiChatModelAdapter,
  userText,
  type ConfirmedPlanResult,
} from "./chat-model-adapter";

vi.mock("@/lib/api/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/ai")>();
  return {
    ...actual,
    createAiPlan: vi.fn(),
    executeAiRun: vi.fn(),
    streamAiPlan: vi.fn(),
  };
});

const WORKSPACE_ID = "018f0a00-0000-7000-8000-0000000000aa";
const RUN_ID = "0123456789abcdef0123456789abcdef";

const planMock = vi.mocked(createAiPlan);
const executeMock = vi.mocked(executeAiRun);
const streamMock = vi.mocked(streamAiPlan);

const CONVERSATION_ID = "018f0a00-0000-7000-8000-0000000000cc";

function streamOfPlan(plan: AiChatResponse): AsyncGenerator<AiStreamEvent, void, void> {
  return (async function* () {
    yield {
      type: "meta",
      v: 1,
      conversationId: CONVERSATION_ID,
      userMessageId: "u1",
      assistantMessageId: "a1",
      provider: { protocol: "openai-chat", model: "auto/test" },
    };
    yield {
      type: "plan",
      runId: plan.runId,
      message: plan.message,
      plannedCalls: plan.plannedCalls,
      readOnlyTrace: plan.readOnlyTrace,
      ...(plan.warnings ? { warnings: plan.warnings } : {}),
      expiresAt: plan.expiresAt,
    };
    yield { type: "done", messageId: "a1", finishReason: "tool-calls" };
  })();
}

function makePlan(overrides: Partial<AiChatResponse> = {}): AiChatResponse {
  return AiChatResponseSchema.parse({
    runId: RUN_ID,
    message: "计划已整理。",
    plannedCalls: [{ tool: "trips.get", args: { tripId: null } }],
    readOnlyTrace: [],
    usage: { inputTokens: 10, outputTokens: 5 },
    provider: { protocol: "openai-chat", model: "auto/test" },
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    ...overrides,
  });
}

interface PartLike {
  type: string;
  toolName?: string;
  args?: { plan?: AiChatResponse };
  result?: unknown;
}

async function collect(
  messages: readonly unknown[],
): Promise<{ status?: unknown; content: PartLike[] }[]> {
  const adapter = createAiChatModelAdapter({ workspaceId: WORKSPACE_ID, canWrite: true });
  const stream = adapter.run({
    messages,
    abortSignal: new AbortController().signal,
  } as never);
  const resolved = stream instanceof Promise ? await stream : stream;
  if (!("next" in (resolved as object))) {
    return [resolved as unknown as { status?: unknown; content: PartLike[] }];
  }
  const chunks: { status?: unknown; content: PartLike[] }[] = [];
  for await (const chunk of resolved as AsyncGenerator<{
    status?: unknown;
    content?: PartLike[];
  }>) {
    chunks.push({ status: chunk.status, content: (chunk.content ?? []) as PartLike[] });
  }
  return chunks;
}

function first(chunks: { status?: unknown; content: PartLike[] }[]) {
  const head = chunks[0];
  if (!head) throw new Error("the adapter yielded no chunk");
  return head;
}

const USER_MESSAGE = {
  role: "user",
  id: "u1",
  createdAt: new Date(),
  content: [{ type: "text", text: "想去京都" }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAiChatModelAdapter", () => {
  it("maps a user turn to an assistant text part plus one pending plan tool part", async () => {
    streamMock.mockImplementation(() => streamOfPlan(makePlan()));

    const chunks = await collect([USER_MESSAGE]);
    expect(chunks).toHaveLength(1);
    expect(first(chunks).status).toEqual({ type: "requires-action", reason: "tool-calls" });
    expect(streamMock).toHaveBeenCalledWith(
      WORKSPACE_ID,
      { message: "想去京都", clientMessageId: "u1" },
      expect.any(AbortSignal),
    );
    expect(planMock).not.toHaveBeenCalled();

    const tool = first(chunks).content.find((part) => part.type === "tool-call");
    expect(tool?.toolName).toBe(PLAN_TOOL_NAME);
    expect(tool?.result).toBeUndefined();
    expect(tool?.args?.plan?.plannedCalls).toHaveLength(1);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("falls back to the blocking plan only when the stream endpoint returns 404", async () => {
    streamMock.mockImplementation(() => {
      throw new AiRequestError(404, "Not Found", "NOT_FOUND", "unknown");
    });
    planMock.mockResolvedValue(makePlan());

    const chunks = await collect([USER_MESSAGE]);

    expect(planMock).toHaveBeenCalledWith(WORKSPACE_ID, { message: "想去京都" });
    expect(chunks).toHaveLength(1);
    expect(first(chunks).status).toEqual({ type: "requires-action", reason: "tool-calls" });
  });

  it("does not fall back for a non-404 streaming failure", async () => {
    streamMock.mockImplementation(() => {
      throw new AiRequestError(503, "AI is not configured", "AI_NOT_CONFIGURED", "not_configured");
    });
    planMock.mockResolvedValue(makePlan());

    const chunks = await collect([USER_MESSAGE]);

    expect(planMock).not.toHaveBeenCalled();
    expect(first(chunks).status).toEqual({ type: "complete", reason: "stop" });
    expect(JSON.stringify(first(chunks).content)).toContain("AI 尚未配置");
  });

  it("runs executeAiRun only for the calls the user confirmed", async () => {
    executeMock.mockResolvedValue({
      results: [{ tool: "trips.get", ok: true }],
      partialFailure: false,
      summary: "1 action(s) applied.",
    });

    const confirmation: ConfirmedPlanResult = {
      status: "confirmed",
      runId: RUN_ID,
      calls: [{ tool: "trips.get", args: { tripId: null } }],
      idempotencyKey: "key-1",
    };

    const chunks = await collect([
      USER_MESSAGE,
      {
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
            result: confirmation,
          },
        ],
      },
    ]);

    expect(executeMock).toHaveBeenCalledWith(WORKSPACE_ID, RUN_ID, {
      calls: confirmation.calls,
      idempotencyKey: "key-1",
    });
    expect(chunks).toHaveLength(1);
    expect(first(chunks).status).toEqual({ type: "complete", reason: "stop" });

    const resultPart = first(chunks).content.find((part) => part.toolName === EXECUTE_TOOL_NAME);
    expect((resultPart?.result as { status?: string })?.status).toBe("executed");
    expect(planMock).not.toHaveBeenCalled();
  });

  it("turns an execute failure into a retryable copy card and never re-plans", async () => {
    executeMock.mockRejectedValue(new ApiError(404, "run consumed", "AI_RUN_CONSUMED"));

    const chunks = await collect([
      USER_MESSAGE,
      {
        role: "assistant",
        id: "a1",
        createdAt: new Date(),
        content: [
          {
            type: "tool-call",
            toolName: PLAN_TOOL_NAME,
            toolCallId: "plan-1",
            args: { plan: makePlan() },
            result: {
              status: "confirmed",
              runId: RUN_ID,
              calls: [{ tool: "trips.get", args: { tripId: null } }],
              idempotencyKey: "key-1",
            },
          },
        ],
      },
    ]);

    const resultPart = first(chunks).content.find((part) => part.toolName === EXECUTE_TOOL_NAME);
    const result = resultPart?.result as { status?: string; description?: string } | undefined;
    expect(result?.status).toBe("failed");
    expect(result?.description).toMatch(/同一份计划只能提交一次/);
    expect(planMock).not.toHaveBeenCalled();
  });

  it("keeps plan failures as assistant text with no tool part", async () => {
    streamMock.mockImplementation(() => {
      throw new ApiError(503, "nope", "AI_NOT_CONFIGURED");
    });

    const chunks = await collect([USER_MESSAGE]);
    expect(first(chunks).status).toEqual({ type: "complete", reason: "stop" });
    expect(first(chunks).content).toHaveLength(1);
    expect(first(chunks).content[0]?.type).toBe("text");
    expect(JSON.stringify(first(chunks).content)).toContain("AI 尚未配置");
  });
});

describe("userText", () => {
  it("joins the text parts of a message and trims them", () => {
    expect(userText({ content: [{ type: "text", text: " 京都 " }] })).toBe("京都");
    expect(userText({ content: "成都" })).toBe("成都");
  });
});
