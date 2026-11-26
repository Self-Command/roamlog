import type {
  AiChatModelsResponse,
  AiChatResponse,
  AiPlanWarning,
  AiRunExecuteResponse,
  AiStreamEvent,
} from "@roamlog/contracts";
import { AiChatResponseSchema } from "@roamlog/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import { executeAiRun, streamAiPlan } from "@/lib/api/ai";

import { AiChat } from "./ai-chat";
import { GENERIC_SUGGESTIONS } from "./suggested-actions";

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
const WORKSPACE_SLUG = "kyoto-crew";
const RUN_ID = "0123456789abcdef0123456789abcdef";
const TRIP_ID = "018f0a00-0000-7000-8000-0000000000b1";
const OTHER_TRIP_ID = "018f0a00-0000-7000-8000-0000000000b2";
const PROMPT = GENERIC_SUGGESTIONS[0];

function makePlan(overrides: Partial<AiChatResponse> = {}): AiChatResponse {
  return AiChatResponseSchema.parse({
    runId: RUN_ID,
    message: "计划已整理，**请确认下面的操作**。",
    plannedCalls: [
      {
        tool: "trips.create",
        args: {
          title: "京都一周：古寺与咖啡馆",
          destinations: ["Kyoto, Japan"],
          startDate: "2026-04-05",
          endDate: "2026-04-11",
          budgetAmountMinor: 800000,
          budgetCurrency: "CNY",
          visibility: "private",
        },
      },
      {
        tool: "packing.add",
        args: { tripId: TRIP_ID, name: "护照", category: "documents", quantity: 1 },
      },
    ],
    readOnlyTrace: [
      { tool: "places.search", args: { q: "Kyoto, Japan", limit: 5 } },
      { tool: "places.search", args: { q: "Kinkaku-ji, Kyoto", limit: 5 } },
    ],
    usage: { inputTokens: 6716, outputTokens: 2956 },
    provider: { protocol: "openai-chat", model: "auto/deepseek-v4.1-flash" },
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    ...overrides,
  });
}

function makeExecution(overrides: Partial<AiRunExecuteResponse> = {}): AiRunExecuteResponse {
  return {
    results: [
      { tool: "trips.create", ok: true, entityId: TRIP_ID },
      { tool: "packing.add", ok: true, entityId: OTHER_TRIP_ID },
    ],
    partialFailure: false,
    summary: "2 action(s) applied.",
    ...overrides,
  };
}

function makeWarning(overrides: Partial<AiPlanWarning> = {}): AiPlanWarning {
  return {
    code: "PAST_DATE",
    message: "计划日期早于今天，已忽略该调用",
    subject: "trips.create",
    ...overrides,
  };
}

const executeMock = vi.mocked(executeAiRun);
const streamMock = vi.mocked(streamAiPlan);
const CONVERSATION_ID = "018f0a00-0000-7000-8000-0000000000cc";
const REMOTE_CONVERSATION_ID = "018f0a00-0000-7000-8000-0000000000c1";
const USER_ID = "018f0a00-0000-7000-8000-0000000000bb";

const REMOTE_CONVERSATION = {
  id: REMOTE_CONVERSATION_ID,
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
  title: null,
  titleSource: "placeholder",
  status: "regular",
  visibility: "private",
  shareUrl: null,
  lastMessageAt: null,
  createdAt: "2026-11-20T08:00:00.000Z",
  updatedAt: "2026-11-20T08:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Keeps the remote conversation adapter quiet while these tests only assert the chat turn. */
function installConversationFetch(modelsPayload?: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (modelsPayload !== undefined && url.includes("/ai/models")) {
        return jsonResponse(modelsPayload);
      }
      if (url.includes("/ai/conversations?")) {
        return jsonResponse({ items: [], nextCursor: null });
      }
      if (url.endsWith("/ai/conversations") && method === "POST") {
        return jsonResponse(REMOTE_CONVERSATION, 201);
      }
      if (url.endsWith("/title/generate")) {
        return jsonResponse({ title: "京都" });
      }
      if (url.includes("/messages") && method === "GET") {
        return jsonResponse({ headId: null, messages: [] });
      }
      if (url.includes("/messages/") && method === "PUT") {
        const clientId = decodeURIComponent(url.split("/messages/")[1] ?? "m1");
        return jsonResponse({
          id: clientId,
          role: "user",
          content: [],
          createdAt: "2026-11-20T08:00:00.000Z",
          clientId,
        });
      }
      return jsonResponse(REMOTE_CONVERSATION);
    }),
  );
}

function planEventFrom(plan: AiChatResponse): AiStreamEvent {
  return {
    type: "plan",
    runId: plan.runId,
    message: plan.message,
    plannedCalls: plan.plannedCalls,
    readOnlyTrace: plan.readOnlyTrace,
    ...(plan.warnings ? { warnings: plan.warnings } : {}),
    expiresAt: plan.expiresAt,
  };
}

function mockStreamPlan(plan: AiChatResponse): void {
  streamMock.mockImplementation(async function* () {
    yield {
      type: "meta",
      v: 1,
      conversationId: CONVERSATION_ID,
      userMessageId: "u1",
      assistantMessageId: "a1",
      provider: { protocol: "openai-chat", model: "auto/test" },
    };
    yield { type: "text.delta", delta: plan.message };
    yield planEventFrom(plan);
    yield { type: "done", messageId: "a1", finishReason: "tool-calls" };
  });
}

function mockStreamFailure(error: unknown): void {
  streamMock.mockImplementation(() => {
    throw error;
  });
}

function renderChat(role: "owner" | "editor" | "viewer" = "editor") {
  return render(<AiChat workspaceId={WORKSPACE_ID} workspaceSlug={WORKSPACE_SLUG} role={role} />);
}

async function sendPrompt(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: PROMPT }));
  await waitFor(() => expect(streamMock).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  installConversationFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AiChat empty state", () => {
  it("shows generic starter prompts inside the empty page, not above the composer", async () => {
    const user = userEvent.setup();
    renderChat();

    expect(await screen.findByRole("heading", { name: "从一个目标开始" })).toBeInTheDocument();
    for (const suggestion of GENERIC_SUGGESTIONS) {
      expect(screen.getByRole("button", { name: suggestion })).toBeInTheDocument();
    }
    expect(screen.getByTestId("ai-empty-suggestions")).toBeInTheDocument();
    const composer = screen.getByTestId("composer-root");
    expect(within(composer).queryByTestId("suggested-actions")).toBeNull();
    expect(screen.getByLabelText("给 AI 助手发消息")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: PROMPT }));
    await waitFor(() => expect(streamMock).toHaveBeenCalledTimes(1));
  });
});

describe("AiChat vision disclosure", () => {
  const VISION_OFF: AiChatModelsResponse = {
    models: [
      {
        id: "auto/deepseek-v4.1-flash",
        name: "Deepseek V4.1 Flash",
        provider: "auto",
        reasoning: true,
        reasoningEfforts: ["low", "medium", "high"],
        vision: false,
      },
    ],
    defaultModel: "auto/deepseek-v4.1-flash",
    reasoningSupported: true,
  };
  const VISION_ON: AiChatModelsResponse = {
    ...VISION_OFF,
    models: [
      {
        id: "auto/deepseek-v4.1-flash",
        name: "Deepseek V4.1 Flash",
        provider: "auto",
        reasoning: true,
        reasoningEfforts: ["low", "medium", "high"],
        vision: true,
      },
    ],
  };

  it("says images are archived but not sent, and keeps the attach button usable", async () => {
    installConversationFetch(VISION_OFF);
    renderChat();

    const note = await screen.findByTestId("vision-note");
    expect(note).toHaveTextContent(
      "当前 AI 服务不能读取图片；图片只会作为附件保留在对话中。",
    );
    const attach = screen.getByTestId("attachments-button");
    expect(attach).toHaveAttribute("title", expect.stringContaining("不能读取图片"));
    // Archiving a photo is still allowed, so the control stays enabled.
    expect(attach).toBeEnabled();
  });

  it("shows no note once the model is declared able to read images", async () => {
    installConversationFetch(VISION_ON);
    renderChat();

    expect(await screen.findByTestId("model-selector-current")).toHaveTextContent(
      "Deepseek V4.1 Flash",
    );
    expect(screen.queryByTestId("vision-note")).not.toBeInTheDocument();
    expect(screen.getByTestId("attachments-button")).not.toHaveAttribute("title");
  });
});

describe("AiChat plan confirmation", () => {
  it("renders the plan as a card inside the assistant message, not a side panel", async () => {
    const user = userEvent.setup();
    mockStreamPlan(makePlan());
    renderChat();

    await sendPrompt(user);

    const card = await screen.findByLabelText("计划确认卡");
    expect(
      await within(card).findByRole("heading", { name: "京都一周：古寺与咖啡馆" }),
    ).toBeInTheDocument();
    // Non-destructive groups start folded; open the packing group to inspect it.
    await user.click(within(card).getByRole("button", { name: /打包清单/ }));
    expect(within(card).getByText("添加装备")).toBeInTheDocument();
    expect(within(card).getByText(/已选 2 \/ 2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新生成" })).toBeInTheDocument();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("keeps the server warnings and the read-only trace of the plan", async () => {
    const user = userEvent.setup();
    mockStreamPlan(makePlan({ warnings: [makeWarning()] }));
    renderChat();

    await sendPrompt(user);

    const card = await screen.findByLabelText("计划确认卡");
    expect(within(card).getByText(/计划日期早于今天，已忽略该调用/)).toBeInTheDocument();
    expect(within(card).getByText(/已搜索：Kyoto, Japan/)).toBeInTheDocument();
  });

  it("executes only the selected calls, once the user confirms", async () => {
    const user = userEvent.setup();
    mockStreamPlan(makePlan());
    executeMock.mockResolvedValue(makeExecution());
    renderChat();

    await sendPrompt(user);

    const card = await screen.findByLabelText("计划确认卡");
    // Each group header owns a select-all checkbox, so target the row itself.
    await user.click(within(card).getByRole("button", { name: /打包清单/ }));
    const packingRow = within(card).getByRole("checkbox", { name: /选择「添加装备」/ });
    await user.click(packingRow);

    const confirm = within(card).getByRole("button", { name: "执行选中的 1 项" });
    await user.click(confirm);

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    const [, runId, input] = executeMock.mock.calls[0] ?? [];
    expect(runId).toBe(RUN_ID);
    expect(input?.calls).toHaveLength(1);
    expect(input?.calls[0]?.tool).toBe("trips.create");
    expect(typeof input?.idempotencyKey).toBe("string");
    expect((input?.idempotencyKey ?? "").length).toBeGreaterThan(0);

    const results = await screen.findByLabelText("执行结果");
    expect(within(results).getByText("执行结果")).toBeInTheDocument();
    expect(within(results).getAllByText("已保存")).toHaveLength(2);
    expect(within(results).getByText("2 action(s) applied.")).toBeInTheDocument();
    expect(within(card).getByText(/1 项已确认/)).toBeInTheDocument();
  });

  it("groups the plan by entity and folds a group until it is opened", async () => {
    const user = userEvent.setup();
    mockStreamPlan(makePlan());
    renderChat();

    await sendPrompt(user);

    const card = await screen.findByLabelText("计划确认卡");
    const packingSection = within(card).getByRole("region", { name: /打包清单 1 项/ });
    expect(within(packingSection).getByText("新增 1")).toBeInTheDocument();
    // Folded by default: the row exists only after opening its group.
    expect(within(card).queryByText("护照")).not.toBeInTheDocument();

    await user.click(within(packingSection).getByRole("button", { name: /打包清单/ }));
    expect(within(card).getByText("护照")).toBeInTheDocument();
    expect(within(card).getByText("添加装备")).toBeInTheDocument();

    await user.click(within(packingSection).getByRole("button", { name: /打包清单/ }));
    expect(within(card).queryByText("护照")).not.toBeInTheDocument();
  });

  it("disables the confirmation when every group is cleared", async () => {
    const user = userEvent.setup();
    mockStreamPlan(makePlan());
    renderChat();

    await sendPrompt(user);

    const card = await screen.findByLabelText("计划确认卡");
    await user.click(within(card).getByRole("checkbox", { name: /选择「行程」全部 1 项/ }));
    await user.click(within(card).getByRole("checkbox", { name: /选择「打包清单」全部 1 项/ }));

    expect(within(card).getByText(/已选 0 \/ 2/)).toBeInTheDocument();
    expect(within(card).getByText("至少选择 1 项才能执行。")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "执行选中的 0 项" })).toBeDisabled();
  });

  it("shows an empty-plan explanation instead of an empty list", async () => {
    const user = userEvent.setup();
    mockStreamPlan(makePlan({ plannedCalls: [], readOnlyTrace: [] }));
    renderChat();

    await sendPrompt(user);

    const card = await screen.findByLabelText("计划确认卡");
    expect(within(card).getByTestId("plan-empty")).toHaveTextContent("这次没有需要写入的操作");
    expect(within(card).queryByTestId("plan-group")).not.toBeInTheDocument();
    expect(within(card).queryByTestId("plan-confirm")).not.toBeInTheDocument();
  });

  it("turns an expired plan into a read-only receipt", async () => {
    const user = userEvent.setup();
    mockStreamPlan(makePlan({ expiresAt: new Date(Date.now() - 60_000).toISOString() }));
    renderChat();

    await sendPrompt(user);

    const card = await screen.findByLabelText("计划确认卡");
    expect(within(card).getByTestId("plan-receipt")).toHaveTextContent(
      "计划已过期，未执行任何操作。请重新发送这条需求。",
    );
    expect(within(card).queryByTestId("plan-confirm")).not.toBeInTheDocument();
    for (const checkbox of within(card).getAllByRole("checkbox")) {
      expect(checkbox).toBeDisabled();
    }
  });

  it("asks twice before a destructive plan is executed", async () => {
    const user = userEvent.setup();
    mockStreamPlan(
      makePlan({
        plannedCalls: [
          {
            tool: "trips.create",
            args: { title: "危险计划", startDate: "2026-12-01", endDate: "2026-12-03" },
          },
          { tool: "stops.delete", args: { stopId: TRIP_ID } },
        ],
      }),
    );
    executeMock.mockResolvedValue(makeExecution());
    renderChat();

    await sendPrompt(user);

    const card = await screen.findByLabelText("计划确认卡");
    expect(within(card).getByText(/其中移除 1 项，删除后无法恢复/)).toBeInTheDocument();
    const confirm = within(card).getByTestId("plan-confirm");
    await user.click(confirm);
    expect(executeMock).not.toHaveBeenCalled();
    expect(within(card).getByText(/再次点击按钮会移除 1 项/)).toBeInTheDocument();
    expect(within(card).getByTestId("plan-confirm")).toHaveTextContent("再次点击确认移除 1 项");

    await user.click(within(card).getByTestId("plan-confirm"));
    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
  });

  it("disables the confirmation for viewers", async () => {
    const user = userEvent.setup();
    mockStreamPlan(makePlan());
    renderChat("viewer");

    await sendPrompt(user);

    const card = await screen.findByLabelText("计划确认卡");
    expect(within(card).getByRole("button", { name: /执行选中的/ })).toBeDisabled();
    expect(within(card).getByText(/请联系工作区所有者或管理员/)).toBeInTheDocument();
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe("AiChat failures", () => {
  it("renders the 503 AI-not-configured copy with the admin link", async () => {
    const user = userEvent.setup();
    mockStreamFailure(new ApiError(503, "AI is not configured", "AI_NOT_CONFIGURED"));
    renderChat();

    await sendPrompt(user);

    expect(await screen.findByText("AI 服务尚未启用")).toBeInTheDocument();
    expect(screen.getByText(/请联系管理员启用 AI 服务后再试/)).toBeInTheDocument();
    expect(screen.queryByLabelText("计划确认卡")).not.toBeInTheDocument();
  });

  it("renders the quota copy without leaking the raw error code", async () => {
    const user = userEvent.setup();
    mockStreamFailure(new ApiError(429, "AI_QUOTA_EXCEEDED", "AI_QUOTA_EXCEEDED"));
    renderChat();

    await sendPrompt(user);

    expect(await screen.findByText("今天的使用次数已用完")).toBeInTheDocument();
    expect(screen.queryByText(/AI_QUOTA_EXCEEDED/)).not.toBeInTheDocument();
  });
});
