import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdapter, makeTrip } from "@/test/fake-data";
import { renderWithQuery } from "@/test/query-harness";

import { DashboardPage } from "./dashboard-page";

const harness = vi.hoisted(() => ({
  adapter: undefined as unknown as import("@/lib/api").DataAdapter,
}));

vi.mock("@/lib/data-provider", () => ({
  useDataAdapter: () => harness.adapter,
}));

describe("DashboardPage data truthfulness", () => {
  beforeEach(() => {
    harness.adapter = createFakeAdapter();
  });

  it("renders a real empty state with no invented numbers", async () => {
    renderWithQuery(<DashboardPage workspaceSlug="roamlog-crew" />);

    expect(await screen.findByText("还没有旅行")).toBeInTheDocument();
    expect(screen.getByText(/0 趟旅行，0 个国家，0 个城市/)).toBeInTheDocument();
    expect(screen.queryByText(/9 趟/)).not.toBeInTheDocument();
    expect(screen.queryByText("¥18,800")).not.toBeInTheDocument();
    expect(screen.queryByText("MSW DEVELOPMENT DATA")).not.toBeInTheDocument();
    expect(screen.queryByText(/没有生产后端写入/)).not.toBeInTheDocument();
  });

  it("aggregates real trips returned by the api adapter", async () => {
    harness.adapter = createFakeAdapter({
      trips: [
        makeTrip({
          id: "0198f000-0000-7000-8000-000000000011",
          title: "京都慢行",
          status: "active",
          startDate: "2026-11-01",
          endDate: "2026-11-03",
          destinations: ["京都"],
          countryCodes: ["JP"],
          budgetAmountMinor: 1_234_500,
          budgetCurrency: "CNY",
        }),
        makeTrip({
          id: "0198f000-0000-7000-8000-000000000012",
          title: "巴黎周末",
          status: "planning",
          startDate: "2026-12-01",
          endDate: "2026-12-05",
          destinations: ["巴黎"],
          countryCodes: ["FR"],
          updatedAt: "2026-11-17T08:00:00.000Z",
        }),
      ],
    });

    renderWithQuery(<DashboardPage workspaceSlug="roamlog-crew" />);

    expect(
      await screen.findByText("2 趟旅行，2 个国家，2 个城市。下一段行程、预算和最近更新的旅行都在这里。"),
    ).toBeInTheDocument();
    expect(screen.getByText("旅行总数")).toBeInTheDocument();
    expect(screen.getByText("累计天数")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getAllByText(/12,345/).length).toBeGreaterThan(0);
  });
});
