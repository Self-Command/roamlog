import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdapter, makeEntry, makeExpense, makeTrip } from "@/test/fake-data";
import { renderWithQuery } from "@/test/query-harness";

import { InsightsWorkspace } from "./insights-workspace";

const harness = vi.hoisted(() => ({
  adapter: undefined as unknown as import("@/lib/api").DataAdapter,
}));

vi.mock("@/lib/data-provider", () => ({
  useDataAdapter: () => harness.adapter,
}));

const TRIP_A = "0198f000-0000-7000-8000-000000000011";
const TRIP_B = "0198f000-0000-7000-8000-000000000012";

function realTrips() {
  return [
    makeTrip({
      id: TRIP_A,
      title: "京都慢行",
      status: "active",
      startDate: "2026-11-01",
      endDate: "2026-11-03",
      destinations: ["京都"],
      countryCodes: ["JP"],
      budgetAmountMinor: 500_000,
      budgetCurrency: "CNY",
    }),
    makeTrip({
      id: TRIP_B,
      title: "巴黎周末",
      status: "planning",
      startDate: "2026-12-01",
      endDate: "2026-12-05",
      destinations: ["巴黎"],
      countryCodes: ["FR"],
    }),
  ];
}

describe("InsightsWorkspace data truthfulness", () => {
  beforeEach(() => {
    harness.adapter = createFakeAdapter();
  });

  it("renders the insufficient-data empty state without invented numbers", async () => {
    renderWithQuery(<InsightsWorkspace workspaceSlug="roamlog-crew" />);

    expect(await screen.findByText("还没有足够的旅行数据")).toBeInTheDocument();
    expect(screen.queryByText(/9 趟/)).not.toBeInTheDocument();
    expect(screen.queryByText("¥18,800")).not.toBeInTheDocument();
    expect(screen.queryByText(/¥50,312/)).not.toBeInTheDocument();
    expect(screen.queryByText("MSW DEVELOPMENT DATA")).not.toBeInTheDocument();
    expect(screen.queryByText(/没有生产后端写入/)).not.toBeInTheDocument();
  });

  it("aggregates trips, entries and expenses from the api adapter", async () => {
    harness.adapter = createFakeAdapter({
      trips: realTrips(),
      entries: [
        makeEntry({ id: "0198f000-0000-7000-8000-000000000021", tripId: TRIP_A, date: "2026-11-01" }),
        makeEntry({ id: "0198f000-0000-7000-8000-000000000022", tripId: TRIP_B, date: "2026-12-02" }),
      ],
      expenses: [
        makeExpense({
          id: "0198f000-0000-7000-8000-000000000031",
          tripId: TRIP_A,
          date: "2026-11-02",
          category: "food",
          amountMinor: 123_400,
          currency: "CNY",
        }),
        makeExpense({
          id: "0198f000-0000-7000-8000-000000000032",
          tripId: TRIP_B,
          date: "2026-12-03",
          category: "transport",
          amountMinor: 50_000,
          currency: "CNY",
        }),
        makeExpense({
          id: "0198f000-0000-7000-8000-000000000033",
          tripId: TRIP_B,
          date: "2026-12-04",
          category: "food",
          amountMinor: 10_000,
          currency: "USD",
        }),
      ],
    });

    renderWithQuery(<InsightsWorkspace workspaceSlug="roamlog-crew" />);

    expect(await screen.findByText("¥1,734")).toBeInTheDocument();
    expect(screen.getByText("2 座城市")).toBeInTheDocument();
    expect(screen.getByText("餐饮")).toBeInTheDocument();
    expect(screen.getByText("交通")).toBeInTheDocument();
    expect(screen.getByText(/5,000/)).toBeInTheDocument();
    expect(screen.getByText("路线距离")).toBeInTheDocument();
    expect(screen.getAllByText("尚未接入").length).toBeGreaterThan(0);
  });

  it("surfaces a retryable error when records fail to load", async () => {
    harness.adapter = createFakeAdapter({
      trips: [makeTrip({ id: TRIP_A, title: "京都慢行" })],
    });
    const fetchEntries = vi.mocked(harness.adapter.fetchEntries);
    fetchEntries.mockRejectedValue(new Error("records unavailable"));

    const user = userEvent.setup();
    renderWithQuery(<InsightsWorkspace workspaceSlug="roamlog-crew" />);

    expect(
      await screen.findByText("洞察数据读取失败", undefined, { timeout: 4_000 }),
    ).toBeInTheDocument();
    fetchEntries.mockReset();
    fetchEntries.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    await user.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByText("京都慢行")).toBeInTheDocument();
  });
});