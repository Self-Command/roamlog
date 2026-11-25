import { HttpException } from "@nestjs/common";
import type { AiStreamEvent } from "@roamlog/contracts";
import { describe, expect, it, vi } from "vitest";

import type { AiStepResult } from "../adapters/adapter.js";
import { AiPlanService } from "../ai-plan.service.js";
import { staticAiSettingsSource } from "../ai.settings.js";
import { AiToolbox } from "../ai-tools.js";
import {
  actorStub,
  aiSettings,
  fixedClock,
  loggerStub,
  membershipStub,
  quotaStub,
  runStoreStub,
  scriptedAdapter,
  toolServiceMocks,
} from "./ai-fixtures.js";

const CONVERSATION_ID = "01942f30-1200-7000-8000-000000000301";
const ASK_ARGS = {
  title: "先确认旅行需求",
  questions: [
    {
      id: "destination",
      prompt: "想去哪里？",
      kind: "text" as const,
      required: true,
    },
    {
      id: "pace",
      prompt: "喜欢什么节奏？",
      kind: "single" as const,
      options: [
        { label: "慢", value: "slow" },
        { label: "紧凑", value: "fast" },
      ],
    },
  ],
};

function harness(turns: AiStepResult[], pending?: Record<string, unknown>) {
  const tools = toolServiceMocks();
  const toolbox = new AiToolbox(
    tools.places as never,
    tools.trips as never,
    tools.stops as never,
    tools.itinerary as never,
    tools.packing as never,
  );
  const adapter = scriptedAdapter(turns);
  const conversations = {
    getOrCreate: vi.fn().mockResolvedValue({ id: CONVERSATION_ID, title: null }),
    loadContext: vi.fn().mockResolvedValue({ messages: [], facts: {} }),
    appendUserMessage: vi
      .fn()
      .mockResolvedValue({ messageId: "message-user-1", clientId: "client-user-1", created: true }),
    startStream: vi.fn().mockResolvedValue({ streamId: "stream-1" }),
    finishAssistantMessage: vi.fn().mockResolvedValue(undefined),
    findPendingHumanTool: vi.fn().mockResolvedValue(pending ?? null),
    settlePendingHumanTool: vi.fn().mockResolvedValue(null),
  };
  const service = new AiPlanService(
    staticAiSettingsSource(aiSettings()),
    () => adapter,
    toolbox,
    quotaStub() as never,
    runStoreStub() as never,
    loggerStub() as never,
    fixedClock(),
    conversations as never,
  );
  return { service, adapter, conversations, tools };
}

async function collect(
  stream: AsyncGenerator<AiStreamEvent, void, void>,
): Promise<AiStreamEvent[]> {
  const events: AiStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function pendingAskUser() {
  const content = [
    { type: "text", text: "我需要先确认几个关键问题。" },
    {
      type: "tool-call",
      toolCallId: "human-1",
      toolName: "ask_user",
      args: ASK_ARGS,
      argsText: JSON.stringify(ASK_ARGS),
    },
  ];
  return {
    id: "message-assistant-1",
    clientId: "assistant-1",
    parentId: "message-user-1",
    content,
    modelContext: [
      { role: "user", content: JSON.stringify({ request: "帮我安排一次旅行", hints: {} }) },
      {
        role: "assistant",
        content: "我需要先确认几个关键问题。",
        toolCalls: [{ id: "human-1", name: "ask_user", input: ASK_ARGS }],
      },
    ],
    metadata: {
      pendingHumanTool: { toolCallId: "human-1", name: "ask_user", args: ASK_ARGS },
    },
    pending: { toolCallId: "human-1", name: "ask_user", args: ASK_ARGS },
  };
}

function pendingBrief(openQuestions: string[] = []) {
  const args = {
    title: "京都慢旅行",
    summary: "两个人，2027 年 4 月 2 日到 6 日去京都，预算 8000 元。",
    constraints: ["慢节奏", "喜欢古寺和咖啡"],
    assumptions: ["住京都站附近"],
    ...(openQuestions.length > 0 ? { openQuestions } : {}),
  };
  const content = [
    { type: "text", text: "请确认需求摘要。" },
    {
      type: "tool-call",
      toolCallId: "human-2",
      toolName: "confirm_brief",
      args,
      argsText: JSON.stringify(args),
    },
  ];
  return {
    id: "message-assistant-2",
    clientId: "assistant-2",
    parentId: "message-user-1",
    content,
    modelContext: [
      { role: "user", content: JSON.stringify({ request: "京都 5 天", hints: {} }) },
      {
        role: "assistant",
        content: "请确认需求摘要。",
        toolCalls: [{ id: "human-2", name: "confirm_brief", input: args }],
      },
    ],
    metadata: {
      pendingHumanTool: { toolCallId: "human-2", name: "confirm_brief", args },
    },
    pending: { toolCallId: "human-2", name: "confirm_brief", args },
  };
}

describe("AI human-in-the-loop workflow", () => {
  it("pauses a vague request with human.request and persists the pending tool", async () => {
    const { service, conversations } = harness([
      {
        text: "我需要先确认几个关键问题。",
        toolCalls: [{ id: "human-1", name: "ask_user", input: ASK_ARGS }],
      },
    ]);

    const events = await collect(
      service.streamChat(actorStub(), membershipStub(), { message: "帮我安排一次旅行" }),
    );

    expect(events.some((event) => event.type === "plan")).toBe(false);
    expect(events.find((event) => event.type === "human.request")).toMatchObject({
      type: "human.request",
      toolCallId: "human-1",
      name: "ask_user",
      args: ASK_ARGS,
    });
    expect(events.at(-1)).toMatchObject({ type: "done", finishReason: "requires-action" });

    const persisted = conversations.finishAssistantMessage.mock.calls[0]?.[0];
    expect(persisted).toMatchObject({
      status: { type: "requires-action", reason: "tool-calls" },
      finishReason: "requires-action",
      metadata: {
        pendingHumanTool: { toolCallId: "human-1", name: "ask_user", args: ASK_ARGS },
      },
    });
    const toolPart = (
      persisted.content as Array<{ type: string; toolName?: string; result?: unknown }>
    ).find((part) => part.type === "tool-call");
    expect(toolPart).toMatchObject({ toolName: "ask_user" });
    expect(toolPart?.result).toBeUndefined();
  });

  it("resumes with the typed answer and can pause again on confirm_brief", async () => {
    const pending = pendingAskUser();
    const settledContent = pending.content.map((part) =>
      part.type === "tool-call"
        ? {
            ...part,
            result: {
              answers: {
                destination: { values: ["京都"], text: "京都" },
                pace: { values: ["slow"] },
              },
            },
          }
        : part,
    );
    const briefArgs = {
      title: "京都慢旅行",
      summary: "两个人，2027 年 4 月 2 日到 6 日去京都，预算 8000 元，节奏慢。",
      constraints: ["喜欢古寺和咖啡"],
      assumptions: ["住京都站附近"],
    };
    const { service, adapter, conversations } = harness(
      [
        {
          text: "这是需求摘要。",
          toolCalls: [{ id: "human-2", name: "confirm_brief", input: briefArgs }],
        },
      ],
      pending,
    );
    conversations.settlePendingHumanTool.mockResolvedValue({
      content: settledContent,
      metadata: {},
    });

    const events = await collect(
      service.streamChat(actorStub(), membershipStub(), {
        conversationId: CONVERSATION_ID,
        humanToolResult: {
          toolCallId: "human-1",
          name: "ask_user",
          result: {
            answers: {
              destination: { values: ["京都"], text: "京都" },
              pace: { values: ["slow"] },
            },
          },
        },
      }),
    );

    expect(conversations.settlePendingHumanTool).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        toolCallId: "human-1",
        name: "ask_user",
      }),
    );
    const toolResult = adapter.inputs[0]?.messages.findLast((message) => message.role === "tool");
    expect(toolResult).toMatchObject({ role: "tool" });
    expect(
      JSON.parse(
        (toolResult as unknown as { results: Array<{ content: string }> }).results[0]!.content,
      ),
    ).toMatchObject({
      ok: true,
      result: { answers: { destination: { text: "京都" } } },
    });
    expect(events.find((event) => event.type === "human.request")).toMatchObject({
      toolCallId: "human-2",
      name: "confirm_brief",
    });
    expect(events.at(-1)).toMatchObject({ finishReason: "requires-action" });

    const persisted = conversations.finishAssistantMessage.mock.calls[0]?.[0] as {
      content: Array<{ type: string; toolName?: string; result?: unknown }>;
    };
    expect(
      persisted.content.find(
        (part) => part.type === "tool-call" && part.toolName === "ask_user",
      )?.result,
    ).toBeDefined();
  });

  it("allows a write plan only after confirm_brief was explicitly confirmed", async () => {
    const pending = pendingBrief();
    const briefResult = { decision: "confirmed" as const };
    const settledContent = pending.content.map((part) =>
      part.type === "tool-call" ? { ...part, result: briefResult } : part,
    );
    const { service, conversations } = harness(
      [
        {
          text: null,
          toolCalls: [
            {
              id: "write-1",
              name: "trips.create",
              input: {
                title: "京都慢旅行",
                startDate: "2027-04-02",
                endDate: "2027-04-06",
              },
            },
          ],
        },
        {
          text:
            "## 目标\n京都慢旅行。\n\n## 当日安排\n- 抵达后沿鸭川散步。\n\n## 交通\n步行与地铁。\n\n## 预算\n8000 元。\n\n## 风险\n樱花季人流较大。",
          toolCalls: [],
        },
      ],
      pending,
    );
    conversations.settlePendingHumanTool.mockResolvedValue({
      content: settledContent,
      metadata: {},
    });

    const events = await collect(
      service.streamChat(actorStub(), membershipStub(), {
        conversationId: CONVERSATION_ID,
        humanToolResult: {
          toolCallId: "human-2",
          name: "confirm_brief",
          result: briefResult,
        },
      }),
    );

    const plan = events.find((event) => event.type === "plan");
    expect(plan).toMatchObject({
      type: "plan",
      plannedCalls: [
        {
          tool: "trips.create",
          args: {
            title: "京都慢旅行",
            startDate: "2027-04-02",
            endDate: "2027-04-06",
          },
        },
      ],
    });
    expect(events.at(-1)).toMatchObject({ finishReason: "tool-calls" });
    const persisted = conversations.finishAssistantMessage.mock.calls[0]?.[0] as {
      content: Array<{ type: string; toolName?: string; result?: unknown }>;
    };
    expect(
      persisted.content.find(
        (part) => part.type === "tool-call" && part.toolName === "confirm_brief",
      )?.result,
    ).toEqual(briefResult);
  });

  it("rejects a write attempt while the brief is still unconfirmed", async () => {
    const pending = pendingAskUser();
    const { service, adapter, tools, conversations } = harness(
      [
        {
          text: null,
          toolCalls: [{ id: "write-1", name: "trips.create", input: { title: "Kyoto" } }],
        },
        { text: "还需要先确认需求摘要。", toolCalls: [] },
      ],
      pending,
    );
    conversations.settlePendingHumanTool.mockResolvedValue({
      content: pending.content,
      metadata: {},
    });

    const events = await collect(
      service.streamChat(actorStub(), membershipStub(), {
        conversationId: CONVERSATION_ID,
        humanToolResult: {
          toolCallId: "human-1",
          name: "ask_user",
          result: {
            answers: {
              destination: { values: ["京都"], text: "京都" },
              pace: { values: ["slow"] },
            },
          },
        },
      }),
    );

    expect(events.some((event) => event.type === "plan")).toBe(false);
    expect(tools.trips.create).not.toHaveBeenCalled();
    const feedback = adapter.inputs[1]?.messages.at(-1) as unknown as {
      results: Array<{ content: string }>;
    };
    expect(JSON.parse(feedback.results[0]!.content)).toMatchObject({
      ok: false,
      error: { code: "BRIEF_CONFIRMATION_REQUIRED" },
    });
  });

  it("settles a dismissed ask_user request and never offers tools or a plan", async () => {
    const pending = pendingAskUser();
    const { service, adapter, conversations } = harness(
      [{ text: "已取消本次提问，你可以重新描述需求。", toolCalls: [] }],
      pending,
    );
    conversations.settlePendingHumanTool.mockResolvedValue({
      content: pending.content,
      metadata: {},
    });

    const events = await collect(
      service.streamChat(actorStub(), membershipStub(), {
        conversationId: CONVERSATION_ID,
        humanToolResult: {
          toolCallId: "human-1",
          name: "ask_user",
          result: { approved: false, reason: "user_cancelled" },
        },
      }),
    );

    expect(events.some((event) => event.type === "plan")).toBe(false);
    expect(conversations.settlePendingHumanTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: "human-1",
        name: "ask_user",
      }),
    );
    expect(adapter.inputs[0]?.tools).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: "done", finishReason: "stop" });
  });

  it("settles a dismissed brief without a plan or write permission", async () => {
    const pending = pendingBrief();
    const { service, adapter, tools, conversations } = harness(
      [{ text: "已取消需求确认，未生成计划。", toolCalls: [] }],
      pending,
    );
    conversations.settlePendingHumanTool.mockResolvedValue({
      content: pending.content,
      metadata: {},
    });

    const events = await collect(
      service.streamChat(actorStub(), membershipStub(), {
        conversationId: CONVERSATION_ID,
        humanToolResult: {
          toolCallId: "human-2",
          name: "confirm_brief",
          result: { approved: false, reason: "user_cancelled" },
        },
      }),
    );

    expect(events.some((event) => event.type === "plan")).toBe(false);
    expect(adapter.inputs[0]?.tools).toEqual([]);
    expect(tools.trips.create).not.toHaveBeenCalled();
    expect(conversations.settlePendingHumanTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: "human-2",
        result: { approved: false, reason: "user_cancelled" },
      }),
    );
  });

  it("treats a non-cancel rejection reason as a revision without opening writes", async () => {
    const pending = pendingBrief();
    const { service, adapter, tools, conversations } = harness(
      [{ text: "我会按你的修改意见更新摘要。", toolCalls: [] }],
      pending,
    );
    conversations.settlePendingHumanTool.mockResolvedValue({
      content: pending.content,
      metadata: {},
    });

    const events = await collect(
      service.streamChat(actorStub(), membershipStub(), {
        conversationId: CONVERSATION_ID,
        humanToolResult: {
          toolCallId: "human-2",
          name: "confirm_brief",
          result: { approved: false, reason: "预算改成 5000 元" },
        },
      }),
    );

    expect(events.some((event) => event.type === "plan")).toBe(false);
    expect(adapter.inputs[0]?.tools).not.toEqual([]);
    expect(tools.trips.create).not.toHaveBeenCalled();
  });

  it("rejects confirming a brief with unresolved questions on the server", async () => {
    const pending = pendingBrief(["是否接受转机？"]);
    const { service, adapter, conversations } = harness([], pending);

    const error = await collect(
      service.streamChat(actorStub(), membershipStub(), {
        conversationId: CONVERSATION_ID,
        humanToolResult: {
          toolCallId: "human-2",
          name: "confirm_brief",
          result: { decision: "confirmed" },
        },
      }),
    ).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(400);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: "AI_HUMAN_TOOL_INVALID",
    });
    expect(adapter.inputs).toHaveLength(0);
    expect(conversations.settlePendingHumanTool).not.toHaveBeenCalled();
  });

  it("does not allow the same human tool result to be resumed twice", async () => {
    const pending = pendingAskUser();
    const { service, adapter } = harness([], pending);

    const error = await collect(
      service.streamChat(actorStub(), membershipStub(), {
        conversationId: CONVERSATION_ID,
        humanToolResult: {
          toolCallId: "human-1",
          name: "ask_user",
          result: {
            answers: {
              destination: { values: ["京都"] },
              pace: { values: ["slow"] },
            },
          },
        },
      }),
    ).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(409);
    expect(adapter.inputs).toHaveLength(0);
  });
});
