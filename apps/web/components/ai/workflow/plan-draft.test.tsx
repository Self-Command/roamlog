import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PlanToolArgs } from "../chat-model-adapter";
import {
  PlanConfirmationCard,
  WorkspaceChatProvider,
  type useWorkspaceChat,
} from "../plan-card";
import {
  createMemoryStorage,
  renderWithDraftRuntime,
} from "./__tests__/draft-test-runtime";
import {
  createDraftPersistence,
  draftStorageKey,
} from "./draft-persistence";

type Plan = PlanToolArgs["plan"];
type PlanCardProps = Parameters<typeof PlanConfirmationCard>[0];
type WorkspaceChat = ReturnType<typeof useWorkspaceChat>;

const FUTURE = new Date(Date.now() + 30 * 60_000).toISOString();
const ORIGINAL_MESSAGE = [
  "## 京都慢旅行",
  "",
  "- 目标：看古寺、喝咖啡",
  "- 预算：8000 元",
  "",
  "## 逐日安排",
  "",
  "### 第 1 天",
  "",
  "09:00 清水寺",
].join("\n");

function makePlan(): Plan {
  return {
    runId: "0123456789abcdef0123456789abcdef",
    message: ORIGINAL_MESSAGE,
    plannedCalls: [
      {
        tool: "trips.create",
        args: {
          title: "京都慢旅行",
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
    details: {
      objective: "慢节奏看古寺和咖啡",
      constraints: ["两个人"],
      assumptions: ["机票按 3200 元估算"],
      days: [
        {
          date: "2027-04-02",
          title: "抵达京都",
          items: [{ time: "09:00", title: "清水寺", type: "activity" }],
        },
      ],
      budget: { amountMinor: 800000, currency: "CNY", breakdown: ["住宿 2400 元"] },
      risks: ["热门寺院排队"],
    },
    readOnlyTrace: [],
    expiresAt: FUTURE,
  };
}

function renderPlanCard({
  storage,
  plan = makePlan(),
  addResult = vi.fn(),
}: {
  storage: ReturnType<typeof createMemoryStorage>;
  plan?: Plan;
  addResult?: PlanCardProps["addResult"];
}) {
  const workspaceChat: WorkspaceChat = {
    workspaceSlug: "verify-crew",
    canWrite: true,
  };
  return renderWithDraftRuntime(
    <WorkspaceChatProvider value={workspaceChat}>
      <PlanConfirmationCard
        {...({
          args: { plan },
          result: undefined,
          addResult,
          toolCallId: "plan-tool-1",
        } as unknown as PlanCardProps)}
      />
    </WorkspaceChatProvider>,
    {
      conversationId: "plan-conversation",
      persistence: createDraftPersistence(
        "plan-workspace",
        "plan-user",
        storage,
      ),
    },
  );
}

describe("persistent editable plan draft", () => {
  it("restores edited message and details after remount", async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const first = renderPlanCard({ storage });

    await user.click(screen.getByTestId("plan-draft-toggle"));
    const message = screen.getByLabelText("计划草稿正文");
    await user.clear(message);
    await user.type(message, "草稿修改后的完整计划");
    const objective = screen.getByLabelText("计划草稿目标");
    await user.clear(objective);
    await user.type(objective, "改为更慢的节奏");

    await waitFor(() => {
      expect(
        storage.getItem(draftStorageKey("plan-workspace", "plan-user")),
      ).toContain("草稿修改后的完整计划");
    });
    first.unmount();

    renderPlanCard({ storage });

    expect(await screen.findByLabelText("计划草稿正文")).toHaveValue(
      "草稿修改后的完整计划",
    );
    expect(screen.getByLabelText("计划草稿目标")).toHaveValue(
      "改为更慢的节奏",
    );
  });

  it("edits JPY budget without multiplying it by 100", async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const base = makePlan();
    const plan = {
      ...base,
      details: {
        ...base.details!,
        budget: { amountMinor: 200_000, currency: "JPY", breakdown: [] },
      },
    } as Plan;

    const first = renderPlanCard({ storage, plan });
    await user.click(screen.getByTestId("plan-draft-toggle"));

    const amount = screen.getByLabelText("计划草稿预算金额");
    expect(amount).toHaveValue(200_000);
    await user.clear(amount);
    await user.type(amount, "250000");
    expect(amount).toHaveValue(250_000);
    await waitFor(() => {
      expect(
        storage.getItem(draftStorageKey("plan-workspace", "plan-user")),
      ).toContain('"amountMinor":250000');
    });

    first.unmount();
    renderPlanCard({ storage, plan });
    await user.click(screen.getByTestId("plan-draft-toggle"));
    expect(screen.getByLabelText("计划草稿预算金额")).toHaveValue(250_000);
    expect(screen.getByLabelText("计划草稿预算币种")).toHaveValue("JPY");
  });

  it("restores row selection and group folding", async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const first = renderPlanCard({ storage });

    const stopsGroup = screen
      .getAllByTestId("plan-group")
      .find((group) => group.getAttribute("data-group-bucket") === "stops")!;
    const stopsTrigger = within(stopsGroup).getByTestId("plan-group-trigger");
    if (stopsTrigger.getAttribute("aria-expanded") !== "true") {
      await user.click(stopsTrigger);
    }
    const stopsRow = within(stopsGroup).getByTestId("plan-row");
    await user.click(within(stopsRow).getByRole("checkbox"));
    expect(screen.getByTestId("plan-confirm")).toHaveTextContent(
      "执行选中的 1 项",
    );

    const firstGroupTrigger = screen.getAllByTestId("plan-group-trigger")[0]!;
    await user.click(firstGroupTrigger);
    expect(firstGroupTrigger).toHaveAttribute("aria-expanded", "false");

    await waitFor(() => {
      const saved = storage.getItem(
        draftStorageKey("plan-workspace", "plan-user"),
      );
      expect(saved).toContain('"dirty":true');
      expect(saved).toContain('"selected":[true,false]');
    });
    first.unmount();

    renderPlanCard({ storage });

    expect(await screen.findByTestId("plan-confirm")).toHaveTextContent(
      "执行选中的 1 项",
    );
    expect(screen.getAllByTestId("plan-group-trigger")[0]).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("restores the AI original version without changing plannedCalls", async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    renderPlanCard({ storage });

    await user.click(screen.getByTestId("plan-draft-toggle"));
    const message = screen.getByLabelText("计划草稿正文");
    await user.clear(message);
    await user.type(message, "临时覆盖内容");
    await user.click(screen.getByTestId("plan-draft-reset"));

    expect(screen.getByLabelText("计划草稿正文")).toHaveValue(ORIGINAL_MESSAGE);
    expect(screen.getByTestId("plan-confirm")).toHaveTextContent(
      "执行选中的 2 项",
    );
  });

  it("clears the persisted draft after confirmation", async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const addResult = vi.fn();
    renderPlanCard({ storage, addResult });

    await user.click(screen.getByTestId("plan-draft-toggle"));
    const message = screen.getByLabelText("计划草稿正文");
    await user.clear(message);
    await user.type(message, "确认前临时修改");
    await waitFor(() => {
      expect(
        storage.getItem(draftStorageKey("plan-workspace", "plan-user")),
      ).toContain("确认前临时修改");
    });

    await user.click(screen.getByTestId("plan-confirm"));
    expect(addResult).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(
        storage.getItem(draftStorageKey("plan-workspace", "plan-user")),
      ).not.toContain("确认前临时修改");
    });
  });

  it("falls back to the AI plan when stored draft JSON is corrupt", async () => {
    const storage = createMemoryStorage();
    storage.setItem(
      draftStorageKey("plan-workspace", "plan-user"),
      '{"broken":',
    );

    renderPlanCard({ storage });

    expect(await screen.findByTestId("plan-draft-editor")).toBeInTheDocument();
    expect(screen.getByTestId("plan-confirm")).toHaveTextContent(
      "执行选中的 2 项",
    );
  });

  it("keeps edited prose out of the executable call subset", async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    const addResult = vi.fn();
    renderPlanCard({ storage, addResult });

    await user.click(screen.getByTestId("plan-draft-toggle"));
    const message = screen.getByLabelText("计划草稿正文");
    await user.clear(message);
    await user.type(message, "把行程改成三天，只去一个地方");
    await user.click(screen.getByTestId("plan-confirm"));

    const submitted = addResult.mock.calls[0]?.[0] as {
      calls: readonly { tool: string }[];
    };
    expect(submitted.calls).toHaveLength(2);
    expect(submitted.calls.map((call) => call.tool)).toEqual([
      "trips.create",
      "stops.add",
    ]);
  });
});
