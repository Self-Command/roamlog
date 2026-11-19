import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TEST_NOW, createFakeAdapter, makeTrip } from "@/test/fake-data";
import { renderWithQuery } from "@/test/query-harness";

import { TripsLibrary } from "./trips-library";

const harness = vi.hoisted(() => ({
  adapter: undefined as unknown as import("@/lib/api").DataAdapter,
}));

vi.mock("@/lib/data-provider", () => ({
  useDataAdapter: () => harness.adapter,
}));

const TRIP_A = "0198f000-0000-7000-8000-000000000011";
const TRIP_B = "0198f000-0000-7000-8000-000000000012";

describe("TripsLibrary data truthfulness", () => {
  beforeEach(() => {
    harness.adapter = createFakeAdapter();
  });

  it("renders a real empty state without fixture copy", async () => {
    renderWithQuery(<TripsLibrary workspaceSlug="roamlog-crew" />);

    expect(await screen.findByText("旅行库还是空的")).toBeInTheDocument();
    expect(screen.getByText(/按状态、地点和标签整理 0 趟真实旅行/)).toBeInTheDocument();
    expect(screen.queryByText(/所有卡片都来自本地 fixtures/)).not.toBeInTheDocument();
    expect(screen.queryByText("URL 状态将在 Wave 1 接入")).not.toBeInTheDocument();
    expect(screen.queryByText(/检查 mock 边界/)).not.toBeInTheDocument();
    expect(screen.queryByText("MSW DEVELOPMENT DATA")).not.toBeInTheDocument();
  });

  it("uses real trip cover, budget and duration data without inventing missing values", async () => {
    harness.adapter = createFakeAdapter({
      trips: [
        makeTrip({
          id: TRIP_A,
          title: "京都慢行",
          startDate: "2026-11-01",
          endDate: "2026-11-03",
          destinations: ["京都"],
          countryCodes: ["JP"],
          cover: {
            mediaId: "0198f000-0000-7000-8000-000000000050",
            status: "ready",
            url: "https://images.example.test/kyoto-large.jpg",
            thumbUrl: "https://images.example.test/kyoto-thumb.jpg",
            width: 1600,
            height: 900,
            blurhash: null,
            expiresAt: TEST_NOW,
          },
        }),
        makeTrip({
          id: TRIP_B,
          title: "巴黎周末",
          startDate: "2026-12-01",
          endDate: "2026-12-05",
          destinations: ["巴黎"],
          countryCodes: ["FR"],
          budgetAmountMinor: 1_234_500,
          budgetCurrency: "CNY",
        }),
      ],
    });

    const { container } = renderWithQuery(<TripsLibrary workspaceSlug="roamlog-crew" />);

    expect(await screen.findByText("京都慢行")).toBeInTheDocument();
    expect(screen.getByText("巴黎周末")).toBeInTheDocument();
    expect(screen.getByText("3 天")).toBeInTheDocument();
    expect(screen.getByText("5 天")).toBeInTheDocument();
    expect(screen.getByText(/12,345/)).toBeInTheDocument();
    expect(screen.queryByText("未设置")).not.toBeInTheDocument();
    expect(
      container.querySelector('img[src="https://images.example.test/kyoto-large.jpg"]'),
    ).not.toBeNull();
    expect(screen.queryByText(/fixtures/)).not.toBeInTheDocument();
  });

  it("filters real trips by title and destination", async () => {
    harness.adapter = createFakeAdapter({
      trips: [
        makeTrip({ id: TRIP_A, title: "京都慢行", destinations: ["京都"] }),
        makeTrip({ id: TRIP_B, title: "巴黎周末", destinations: ["巴黎"] }),
      ],
    });

    const user = userEvent.setup();
    renderWithQuery(<TripsLibrary workspaceSlug="roamlog-crew" />);
    await screen.findByText("京都慢行");

    await user.type(screen.getByRole("textbox", { name: "搜索旅行" }), "巴黎");
    expect(screen.getByText("巴黎周末")).toBeInTheDocument();
    expect(screen.queryByText("京都慢行")).not.toBeInTheDocument();
  });
});