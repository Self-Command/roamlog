import type { AiChatResponse, AiPlanWarning, AiRunExecuteResponse } from "@roamlog/contracts";
import { AiChatResponseSchema } from "@roamlog/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import { createAiPlan, executeAiRun } from "@/lib/api/ai";

import { AiConsole } from "./ai-console";

vi.mock("@/lib/api/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/ai")>();
  return {
    ...actual,
    createAiPlan: vi.fn(),
    executeAiRun: vi.fn(),
  };
});

const WORKSPACE_ID = "018f0a00-0000-7000-8000-0000000000aa";
const WORKSPACE_SLUG = "kyoto-crew";
const RUN_ID = "0123456789abcdef0123456789abcdef";
const TRIP_ID = "018f0a00-0000-7000-8000-0000000000b1";
const OTHER_TRIP_ID = "018f0a00-0000-7000-8000-0000000000b2";
const PROMPT = "想去京都一周，预算 8000，喜欢古寺和咖啡馆";

function makePlan(overrides: Partial<AiChatResponse> = {}): AiChatResponse {
  return AiChatResponseSchema.parse({
    runId: RUN_ID,
    message: "计划已提交，**正在等待你确认**。写入会先排队，你确认后才真正保存。",
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
      { tool: "places.search", args: { q: "Kiyomizu-dera Temple, Kyoto", limit: 5 } },
      { tool: "places.search", args: { q: "Kinkaku-ji, Kyoto", limit: 5 } },
    ],
    usage: { inputTokens: 6716, outputTokens: 2956 },
    provider: { protocol: "openai-chat", model: "auto/deepseek-v4.1-flash" },
    expiresAt: "2026-11-19T15:00:00.000Z",
    ...overrides,
  });
}

function makeExecution(
  overrides: Partial<AiRunExecuteResponse> = {},
): AiRunExecuteResponse {
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

function emptyPlanWith(warnings: AiPlanWarning[]): AiChatResponse {
  return makePlan({
    message: "计划已整理。",
    plannedCalls: [],
    readOnlyTrace: [],
    warnings,
  });
}

const planMock = vi.mocked(createAiPlan);
const executeMock = vi.mocked(executeAiRun);

function renderConsole(role: "owner" | "editor" | "viewer" = "editor") {
  return render(
    <AiConsole workspaceId={WORKSPACE_ID} workspaceSlug={WORKSPACE_SLUG} role={role} />,
  );
}

async function planTrip(user: ReturnType<typeof userEvent.setup>) {
  renderConsole();
  await user.type(screen.getByLabelText("旅行需求"), PROMPT);
  await user.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByText("创建旅行");
}

async function confirmExecution(user: ReturnType<typeof userEvent.setup>, buttonName: string) {
  await user.click(screen.getByRole("button", { name: buttonName }));
  await user.click(await screen.findByRole("button", { name: "确认执行" }));
}

beforeEach(() => {
  planMock.mockReset();
  executeMock.mockReset();
  planMock.mockResolvedValue(makePlan());
  executeMock.mockResolvedValue(makeExecution());
});

describe("AI console: planning is read-only", () => {
  it("renders the confirmable plan and never calls the execute endpoint while planning", async () => {
    const user = userEvent.setup();
    renderConsole();

    await user.type(screen.getByLabelText("旅行需求"), PROMPT);
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("创建旅行")).toBeInTheDocument();
    expect(planMock).toHaveBeenCalledTimes(1);
    expect(planMock).toHaveBeenCalledWith(WORKSPACE_ID, { message: PROMPT });
    expect(executeMock).not.toHaveBeenCalled();

    // The assistant reply and the read-only trace are visible.
    expect(screen.getByText("正在等待你确认")).toBeInTheDocument();
    expect(
      screen.getByText(
        "已搜索：Kyoto, Japan / Kiyomizu-dera Temple, Kyoto / Kinkaku-ji, Kyoto（共 3 次查询）",
      ),
    ).toBeInTheDocument();

    // Every proposed write is a checked, labelled row with the side-effect badge.
    expect(screen.getByText("京都一周：古寺与咖啡馆")).toBeInTheDocument();
    expect(screen.getByText("护照")).toBeInTheDocument();
    expect(screen.getAllByText("将写入数据")).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: /创建旅行/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /添加装备/ })).toBeChecked();

    const execute = screen.getByRole("button", { name: "执行选中的 2 项操作" });
    expect(execute).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "计划已生成，共 2 项操作待确认。",
    );

    // No developer vocabulary reached the rendered page.
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(
      /AI_TOOL_FAILED|plannedCalls|readOnlyTrace|providerPlaceId|trips\.create|packing\.add|JSON|schema|WRITES DATA/u,
    );
  });

  it("does not execute until the confirmation dialog is confirmed", async () => {
    const user = userEvent.setup();
    await planTrip(user);

    await user.click(screen.getByRole("button", { name: "执行选中的 2 项操作" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("确认执行这些操作？");
    expect(dialog).toHaveTextContent("只执行你勾选的 2 项");
    expect(executeMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("submitting a new prompt after a plan is impossible until it is discarded", async () => {
    const user = userEvent.setup();
    await planTrip(user);

    expect(screen.getByLabelText("旅行需求")).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "放弃计划，不执行" }));

    expect(screen.getByLabelText("旅行需求")).toBeEnabled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(screen.queryByText("创建旅行")).not.toBeInTheDocument();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("keeps the send button as the only primary action after discarding", async () => {
    const user = userEvent.setup();
    await planTrip(user);

    // The plan panel owns the primary action while a plan is pending.
    expect(screen.getByRole("button", { name: "发送" })).toHaveClass("bg-surface-2");
    await user.click(screen.getByRole("button", { name: "放弃计划，不执行" }));
    await user.type(screen.getByRole("textbox", { name: "旅行需求" }), "换个城市");
    expect(screen.getByRole("button", { name: "发送" })).toHaveClass("bg-ink");
  });

  it("renders exactly one white primary action at each planning stage", async () => {
    const user = userEvent.setup();
    const { container } = renderConsole();

    // Before a plan exists the send button is the single primary.
    expect(container.querySelectorAll("button.bg-ink")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "发送" })).toHaveClass("bg-ink");

    await user.type(screen.getByRole("textbox", { name: "旅行需求" }), PROMPT);
    await user.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText("创建旅行");

    // Once a plan exists the execute button takes over; send steps back.
    expect(container.querySelectorAll("button.bg-ink")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "执行选中的 2 项操作" })).toHaveClass("bg-ink");
    expect(screen.getByRole("button", { name: "发送" })).toHaveClass("bg-surface-2");
  });
});

describe("AI console: confirmed execution", () => {
  it("sends only the checked calls with one idempotency key", async () => {
    const user = userEvent.setup();
    await planTrip(user);

    await user.click(screen.getByRole("checkbox", { name: /添加装备/ }));
    expect(screen.getByRole("button", { name: "执行选中的 1 项操作" })).toBeEnabled();

    await confirmExecution(user, "执行选中的 1 项操作");

    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(1));
    const call = executeMock.mock.calls[0];
    if (!call) throw new Error("executeAiRun was not called.");
    expect(call[0]).toBe(WORKSPACE_ID);
    expect(call[1]).toBe(RUN_ID);
    expect(call[2].calls).toEqual([makePlan().plannedCalls[0]]);
    expect(call[2].idempotencyKey.length).toBeGreaterThanOrEqual(8);
  });

  it("shows one result per call and links the newly created trip", async () => {
    const user = userEvent.setup();
    await planTrip(user);

    await confirmExecution(user, "执行选中的 2 项操作");

    expect(await screen.findByText("执行完成")).toBeInTheDocument();
    expect(screen.getAllByText("已保存")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "打开新建的旅行" })).toHaveAttribute(
      "href",
      `/w/${WORKSPACE_SLUG}/trips/${TRIP_ID}`,
    );
    expect(screen.getByRole("status")).toHaveTextContent("执行完成，2 项操作已保存。");
    // The panel is no longer confirmable once the run is consumed server-side.
    expect(screen.queryByRole("button", { name: /执行选中的/ })).not.toBeInTheDocument();
  });

  it("warns at the top when only part of the run succeeded", async () => {
    executeMock.mockResolvedValue(
      makeExecution({
        results: [
          { tool: "trips.create", ok: true, entityId: TRIP_ID },
          {
            tool: "packing.add",
            ok: false,
            error: { code: "INVALID_ARGUMENTS", message: "Trip id was rejected." },
          },
        ],
        partialFailure: true,
        summary: "1 action(s) applied, 1 failed.",
      }),
    );

    const user = userEvent.setup();
    await planTrip(user);
    await confirmExecution(user, "执行选中的 2 项操作");

    expect(await screen.findByText("部分成功，请检查")).toBeInTheDocument();
    expect(screen.getByText("1 项已保存，1 项失败。已成功的内容不会回滚，请重新规划失败的部分。"))
      .toBeInTheDocument();
    expect(screen.getByText("这条操作的参数不完整，所以没有写入。")).toBeInTheDocument();
    expect(screen.getByText("未保存")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("执行完成，1 项成功，1 项失败。");
  });

  it("reuses the same idempotency key when the user retries a failed execution", async () => {
    executeMock
      .mockRejectedValueOnce(new ApiError(0, "The network dropped.", "NETWORK_ERROR"))
      .mockResolvedValueOnce(makeExecution());

    const user = userEvent.setup();
    await planTrip(user);

    await confirmExecution(user, "执行选中的 2 项操作");
    expect(await screen.findByText("执行结果未知")).toBeInTheDocument();
    expect(executeMock).toHaveBeenCalledTimes(1);

    await confirmExecution(user, "执行选中的 2 项操作");
    await waitFor(() => expect(executeMock).toHaveBeenCalledTimes(2));

    const firstKey = executeMock.mock.calls[0]?.[2].idempotencyKey;
    const secondKey = executeMock.mock.calls[1]?.[2].idempotencyKey;
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);
    expect(await screen.findByText("执行完成")).toBeInTheDocument();
  });

  it("does not show an executed plan as created before the server confirms it", async () => {
    executeMock.mockImplementation(() => new Promise<AiRunExecuteResponse>(() => undefined));
    const user = userEvent.setup();
    await planTrip(user);

    await confirmExecution(user, "执行选中的 2 项操作");

    expect(screen.getByRole("button", { name: "正在执行…" })).toBeDisabled();
    expect(screen.queryByText("已保存")).not.toBeInTheDocument();
    expect(screen.queryByText("执行完成")).not.toBeInTheDocument();
  });
});

describe("AI console: failure copy", () => {
  const notConfigured = new ApiError(503, "AI is not configured.", "AI_NOT_CONFIGURED");
  const quota = new ApiError(429, "Daily quota exceeded.", "AI_QUOTA");
  const loopLimit = new ApiError(422, "Tool loop limit reached.", "AI_LOOP_LIMIT");
  const upstream = new ApiError(502, "Upstream model gateway failed.", "AI_UPSTREAM");

  async function expectPlanFailure(failure: ApiError, title: string) {
    planMock.mockRejectedValue(failure);

    const user = userEvent.setup();
    renderConsole();
    await user.type(screen.getByLabelText("旅行需求"), PROMPT);
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("没有");
    expect(executeMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("旅行需求")).toHaveValue(PROMPT);
    expect(document.body.textContent ?? "").not.toMatch(
      /AI_NOT_CONFIGURED|AI_QUOTA|AI_LOOP_LIMIT|AI_UPSTREAM|JSON|schema/u,
    );
  }

  it("maps AI_NOT_CONFIGURED to a readable sentence", async () => {
    await expectPlanFailure(notConfigured, "AI 尚未配置");
  });

  it("maps AI_QUOTA to a readable sentence", async () => {
    await expectPlanFailure(quota, "今天的 AI 规划次数已用完");
  });

  it("maps AI_LOOP_LIMIT to a readable sentence", async () => {
    await expectPlanFailure(loopLimit, "这次需求需要的步骤过多");
  });

  it("maps AI_UPSTREAM to a readable sentence", async () => {
    await expectPlanFailure(upstream, "模型服务暂时不可用");
  });

  it("links the admin console when the provider is not configured", async () => {
    planMock.mockRejectedValue(notConfigured);

    const user = userEvent.setup();
    renderConsole();
    await user.type(screen.getByLabelText("旅行需求"), PROMPT);
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByRole("link", { name: /打开后台系统设置/ })).toHaveAttribute(
      "href",
      "http://localhost:3001/admin/settings",
    );
  });

  it("explains a consumed run instead of pretending it can be executed again", async () => {
    executeMock.mockRejectedValue(
      new ApiError(409, "This plan was already executed.", "AI_RUN_CONSUMED"),
    );

    const user = userEvent.setup();
    await planTrip(user);
    await confirmExecution(user, "执行选中的 2 项操作");

    expect(await screen.findByText("这份计划已经执行过")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /执行选中的/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重新规划" })).toBeEnabled();
  });

  it("disables the composer for a viewer instead of offering controls that cannot work", async () => {
    const user = userEvent.setup();
    renderConsole("viewer");

    expect(screen.getByLabelText("旅行需求")).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(screen.getByText(/你的角色是 viewer/)).toBeInTheDocument();
    expect(screen.getByText("还没有计划")).toBeInTheDocument();

    await user.click(screen.getByText("还没有计划"));
    expect(planMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe("AI console: plan warnings", () => {
  async function send(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("旅行需求"), PROMPT);
    await user.click(screen.getByRole("button", { name: "发送" }));
  }

  it("renders one warning with a human action name and an explicit past-date explanation", async () => {
    planMock.mockResolvedValue(emptyPlanWith([makeWarning()]));

    const user = userEvent.setup();
    renderConsole();
    await send(user);

    const toggle = await screen.findByRole("button", { name: /1 条提示/u });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("创建旅行")).toBeInTheDocument();
    expect(screen.getByText("计划日期早于今天，已忽略该调用")).toBeInTheDocument();
    expect(
      screen.getByText("这些日期早于今天，已忽略。请给出未来的日期。"),
    ).toBeInTheDocument();

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/PAST_DATE|plannedCalls|warnings|JSON/u);
  });

  it("lists three warnings behind an expandable count", async () => {
    planMock.mockResolvedValue(
      emptyPlanWith([
        makeWarning(),
        makeWarning({ subject: "stops.add", message: "第二个被忽略的调用" }),
        makeWarning({ subject: "itinerary.addDay", message: "第三个被忽略的调用" }),
      ]),
    );

    const user = userEvent.setup();
    renderConsole();
    await send(user);

    const toggle = await screen.findByRole("button", { name: /3 条提示/u });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("第二个被忽略的调用")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("第二个被忽略的调用")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByText("第二个被忽略的调用")).toBeInTheDocument();
  });

  it("does not render a warning block when the server sent none", async () => {
    const user = userEvent.setup();
    await planTrip(user);

    expect(screen.queryByRole("button", { name: /条提示/u })).not.toBeInTheDocument();
    expect(screen.queryByText(/被校验拦下/u)).not.toBeInTheDocument();
  });

  it("points an empty plan at the warnings and restores the draft without re-sending", async () => {
    planMock.mockResolvedValue(emptyPlanWith([makeWarning()]));

    const user = userEvent.setup();
    renderConsole();
    await send(user);

    expect(await screen.findByText("已生成建议，但全部被校验拦下")).toBeInTheDocument();
    expect(screen.getByText(/见上方「1 条提示」/u)).toBeInTheDocument();
    expect(screen.queryByText(/已创建/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/已保存/u)).not.toBeInTheDocument();
    expect(screen.queryByText("还没有计划")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "计划已生成，但 1 项操作被校验拦下，原因已在计划面板说明。",
    );

    expect(planMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "修改需求重新规划" }));
    expect(planMock).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("旅行需求")).toHaveValue(PROMPT);
  });

  it("renders an unknown warning code from the server message alone", async () => {
    const unknownMessage = "这条建议暂时无法处理，已跳过。";
    planMock.mockResolvedValue(
      emptyPlanWith([makeWarning({ code: "FUTURE_WARNING_CODE", message: unknownMessage })]),
    );

    const user = userEvent.setup();
    renderConsole();
    await send(user);

    expect(await screen.findByText(unknownMessage)).toBeInTheDocument();
    // No invented coaching for an unknown code — only the server's sentence.
    expect(screen.queryByText(/这些日期早于今天/u)).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/FUTURE_WARNING_CODE|PAST_DATE/u);
  });
});