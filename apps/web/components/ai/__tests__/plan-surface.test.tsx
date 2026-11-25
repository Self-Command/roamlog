import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  PlanConfirmationCard,
  WorkspaceChatProvider,
  type useWorkspaceChat,
} from "../plan-card";
import { PlanSurface, type PlanDetails } from "../plan-surface";
import type { PlanToolArgs } from "../chat-model-adapter";
import {
  createMemoryStorage,
  renderWithDraftRuntime,
} from "../workflow/__tests__/draft-test-runtime";
import { createDraftPersistence } from "../workflow/draft-persistence";

type Plan = PlanToolArgs["plan"];
type PlanCardProps = Parameters<typeof PlanConfirmationCard>[0];
type WorkspaceChat = ReturnType<typeof useWorkspaceChat>;

const FUTURE = new Date(Date.now() + 10 * 60_000).toISOString();

const LONG_MESSAGE = [
  "## 需要你确认的假设",
  "",
  "- 两个人同行，节奏偏慢。",
  "- 预算 8000 元，优先古寺与咖啡。",
  "",
  "## 逐日安排",
  "",
  "### 第 1 天",
  "",
  "| 时间 | 安排 | 说明 |",
  "| --- | --- | --- |",
  "| 09:00 | 清水寺 | 步行上山，留出拍照时间 |",
  "| 14:00 | 祇园咖啡 | 下午休息 |",
  "",
  "## 预算与风险",
  "",
  "- 住宿和交通合计约 5000 元。",
  "- 风险：热门寺院可能需要排队。",
].join("\n");

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    runId: "0123456789abcdef0123456789abcdef",
    message: LONG_MESSAGE,
    plannedCalls: [
      {
        tool: "trips.create",
        args: {
          title: "京都古寺与咖啡慢游",
          startDate: "2027-04-02",
          endDate: "2027-04-06",
          destinations: ["京都"],
          budgetAmountMinor: 800000,
          budgetCurrency: "CNY",
        },
      },
      {
        tool: "stops.add",
        args: {
          tripId: "{{tripId}}",
          providerPlaceId: "place-kiyomizu",
        },
      },
    ],
    readOnlyTrace: [],
    expiresAt: FUTURE,
    ...overrides,
  };
}

function cardProps(plan: Plan, addResult: PlanCardProps["addResult"]): PlanCardProps {
  return {
    args: { plan },
    result: undefined,
    addResult,
    toolCallId: "plan-tool-1",
  } as unknown as PlanCardProps;
}

function renderPlan(
  plan: Plan,
  options: { canWrite?: boolean; addResult?: PlanCardProps["addResult"] } = {},
) {
  const addResult =
    options.addResult ?? (vi.fn() as unknown as PlanCardProps["addResult"]);
  const workspaceChat: WorkspaceChat = {
    workspaceSlug: "verify-crew",
    canWrite: options.canWrite ?? true,
  };

  renderWithDraftRuntime(
    <WorkspaceChatProvider value={workspaceChat}>
      <PlanConfirmationCard {...cardProps(plan, addResult)} />
    </WorkspaceChatProvider>,
    {
      conversationId: "plan-conversation",
      persistence: createDraftPersistence(
        "plan-workspace",
        "plan-user",
        createMemoryStorage(),
      ),
    },
  );

  return addResult;
}

describe("PlanConfirmationCard plan surface", () => {
  it("renders structured details when the backend supplies them", () => {
    render(
      <PlanSurface
        title="京都四日"
        message=""
        details={{
          objective: "慢节奏看古寺和咖啡",
          constraints: ["两个人"],
          assumptions: ["四月天气适合步行"],
          openQuestions: ["是否需要预约"],
          days: [
            {
              date: "2027-04-02",
              title: "第一天",
              items: [
                {
                  time: "09:00",
                  title: "清水寺",
                  location: "东山区",
                  transport: "步行",
                  notes: "早到避开人流",
                },
              ],
            },
          ],
          budget: { amountMinor: 800000, currency: "CNY", breakdown: ["住宿 5000 元"] },
          logistics: ["购买公交一日券"],
          risks: ["热门寺院排队"],
          alternatives: ["雨天改去京都国立博物馆"],
        }}
      />,
    );

    expect(screen.getByTestId("plan-objective")).toHaveTextContent("慢节奏看古寺和咖啡");
    expect(screen.getByTestId("plan-constraints")).toHaveTextContent("两个人");
    expect(screen.getByTestId("plan-assumptions")).toHaveTextContent("四月天气适合步行");
    expect(screen.getByTestId("plan-open-questions")).toHaveTextContent("是否需要预约");
    expect(screen.getByTestId("plan-detail-day")).toHaveTextContent("清水寺");
    expect(screen.getByTestId("plan-budget")).toHaveTextContent("8,000");
    expect(screen.getByTestId("plan-logistics")).toHaveTextContent("公交一日券");
    expect(screen.getByTestId("plan-risks")).toHaveTextContent("排队");
    expect(screen.getByTestId("plan-alternatives")).toHaveTextContent("博物馆");
  });

  it("renders the full model plan Markdown, including headings, table and daily details", async () => {
    renderPlan(makePlan());

    const message = await screen.findByTestId("plan-message");
    expect(within(message).getByText("需要你确认的假设")).toBeInTheDocument();
    expect(within(message).getByText("第 1 天")).toBeInTheDocument();
    expect(within(message).getByText("清水寺")).toBeInTheDocument();
    expect(within(message).getByText("预算与风险")).toBeInTheDocument();
    expect(within(message).getByRole("table")).toBeInTheDocument();
  });

  it("renders structured details carried by the plan tool part", async () => {
    renderPlan(
      makePlan({
        details: {
          objective: "慢节奏看古寺和咖啡",
          days: [
            {
              date: "2027-04-02",
              title: "第一天",
              items: [{ title: "清水寺", location: "东山区", type: "activity" }],
            },
          ],
          budget: { amountMinor: 800_000, currency: "CNY" },
          risks: ["热门寺院排队"],
        },
      }),
    );

    expect(await screen.findByTestId("plan-details")).toBeInTheDocument();
    expect(screen.getByTestId("plan-objective")).toHaveTextContent("慢节奏");
    expect(screen.getByTestId("plan-detail-day")).toHaveTextContent("清水寺");
    expect(screen.getByTestId("plan-budget")).toHaveTextContent("8,000");
    expect(screen.getByTestId("plan-risks")).toHaveTextContent("排队");
  });

  it("shows Chinese type labels and never leaks unknown internal type values", () => {
    const details = {
      objective: "类型标签",
      days: [
        {
          date: "2027-04-02",
          title: "第一天",
          items: [
            { title: "机场快线", type: "transit" },
            { title: "商务酒店", type: "stay" },
            { title: "午餐", type: "food", notes: "提前预约" },
            { title: "清水寺", type: "activity", transport: "步行" },
            { title: "带护照", type: "note" },
            { title: "未识别项", type: "custom" },
          ],
        },
      ],
    } as unknown as PlanDetails;

    render(<PlanSurface title="类型覆盖" message="" details={details} />);

    const day = screen.getByTestId("plan-detail-day");
    for (const label of ["交通", "住宿", "餐饮", "活动", "备注"]) {
      expect(within(day).getByText(label, { exact: true })).toBeInTheDocument();
    }
    expect(day).toHaveTextContent("未识别项");
    expect(day).not.toHaveTextContent(/\b(?:transit|stay|food|activity|note|custom)\b/u);
  });

  it("formats JPY budget in its zero-decimal minor unit", () => {
    renderPlan(
      makePlan({
        details: {
          objective: "东京五日",
          budget: { amountMinor: 200_000, currency: "JPY" },
        },
      }),
    );

    expect(screen.getByTestId("plan-budget")).toHaveTextContent("200,000");
    expect(screen.getByTestId("plan-budget")).not.toHaveTextContent("2,000.00");
  });

  it("uses the upstream streaming shimmer while the plan is still arriving", () => {
    render(
      <PlanSurface title="正在生成的计划" message="" isStreaming />,
    );

    expect(
      screen.getByTestId("plan-summary-title").querySelector(".roamlog-ai-shimmer"),
    ).not.toBeNull();
  });

  it("keeps the confirm action and submits the selected calls unchanged", async () => {
    const user = userEvent.setup();
    const addResult = renderPlan(makePlan());

    await user.click(screen.getByTestId("plan-confirm"));

    expect(addResult).toHaveBeenCalledTimes(1);
    expect(addResult).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "confirmed",
        runId: "0123456789abcdef0123456789abcdef",
        calls: expect.arrayContaining([
          expect.objectContaining({ tool: "trips.create" }),
          expect.objectContaining({ tool: "stops.add" }),
        ]),
      }),
    );
  });

  it("keeps a Viewer read-only", () => {
    renderPlan(makePlan(), { canWrite: false });

    expect(screen.getByTestId("plan-confirm")).toBeDisabled();
    expect(screen.getByText(/请联系工作区所有者或管理员/u)).toBeInTheDocument();
  });

  it("can collapse the body while the title and confirmation footer remain available", async () => {
    const user = userEvent.setup();
    renderPlan(makePlan());

    expect(await screen.findByTestId("plan-message")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "展开或收起计划" }));

    expect(screen.queryByTestId("plan-message")).not.toBeInTheDocument();
    expect(screen.getByTestId("plan-summary-title")).toBeInTheDocument();
    expect(screen.getByTestId("plan-confirm")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开或收起计划" }));
    expect(await screen.findByTestId("plan-message")).toBeInTheDocument();
  });

  it("handles an empty plan without dropping the summary or empty-state copy", () => {
    renderPlan(makePlan({ message: "", plannedCalls: [] }));

    expect(screen.queryByTestId("plan-message")).not.toBeInTheDocument();
    expect(screen.getByTestId("plan-empty")).toHaveTextContent("这次没有需要写入的操作");
    expect(screen.getByTestId("plan-summary-title")).toHaveTextContent(
      "没有需要写入的操作",
    );
  });
});
