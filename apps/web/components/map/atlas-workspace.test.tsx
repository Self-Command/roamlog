import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeAdapter, makeStop, makeTrip } from "@/test/fake-data";
import { renderWithQuery } from "@/test/query-harness";

import { AtlasWorkspace } from "./atlas-workspace";

const harness = vi.hoisted(() => ({
  adapter: undefined as unknown as import("@/lib/api").DataAdapter,
}));

vi.mock("@/lib/data-provider", () => ({
  useDataAdapter: () => harness.adapter,
}));

const TRIP_A = "0198f000-0000-7000-8000-000000000011";
const TRIP_B = "0198f000-0000-7000-8000-000000000012";

function trips() {
  return [
    makeTrip({
      id: TRIP_A,
      title: "京都慢行",
      status: "completed",
      startDate: "2026-11-01",
      endDate: "2026-11-03",
      destinations: ["京都"],
      countryCodes: ["JP"],
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

describe("AtlasWorkspace data truthfulness", () => {
  beforeEach(() => {
    harness.adapter = createFakeAdapter();
  });

  it("plots only real stop coordinates", async () => {
    harness.adapter = createFakeAdapter({
      trips: trips(),
      stops: [
        makeStop({
          id: "0198f000-0000-7000-8000-000000000041",
          tripId: TRIP_A,
          city: "京都",
          country: "日本",
          countryCode: "JP",
        }),
        makeStop({
          id: "0198f000-0000-7000-8000-000000000042",
          tripId: TRIP_B,
          city: "巴黎",
          country: "法国",
          countryCode: "FR",
          lat: 48.8566,
          lng: 2.3522,
        }),
      ],
    });

    renderWithQuery(<AtlasWorkspace workspaceSlug="roamlog-crew" />);

    expect(await screen.findByTestId("world-map")).toBeInTheDocument();
    expect(screen.getByText(/2 STOPS · REAL COORDINATES/)).toBeInTheDocument();
    expect(document.querySelector("polyline")).toBeNull();
    expect(screen.queryByText("首尔，晚秋与夜航")).not.toBeInTheDocument();
    expect(screen.queryByText("冰岛环岛手记")).not.toBeInTheDocument();
    expect(screen.queryByText(/FIXTURE COORDINATES/)).not.toBeInTheDocument();
  });

  it("keeps the map rendered when no stop has coordinates", async () => {
    harness.adapter = createFakeAdapter({
      trips: trips(),
      stops: [
        makeStop({
          id: "0198f000-0000-7000-8000-000000000043",
          tripId: TRIP_A,
          lat: null,
          lng: null,
        }),
      ],
    });

    renderWithQuery(<AtlasWorkspace workspaceSlug="roamlog-crew" />);

    expect(await screen.findByText("还没有可显示的地图坐标")).toBeInTheDocument();
    expect(screen.getByTestId("world-map")).toBeInTheDocument();
    expect(screen.getByText(/另有 1 个停靠点缺少经纬度/)).toBeInTheDocument();
    expect(screen.queryByText(/9 个国家/)).not.toBeInTheDocument();
  });

  it("keeps the map rendered for a workspace with no trips", async () => {
    harness.adapter = createFakeAdapter({ trips: [], stops: [] });

    renderWithQuery(<AtlasWorkspace workspaceSlug="roamlog-crew" />);

    expect(await screen.findByTestId("world-map")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "世界足迹" })).toBeInTheDocument();
    expect(screen.getByText("还没有可显示的地图坐标")).toBeInTheDocument();
  });

  it("offers a flat/globe switch without leaving the map route", async () => {
    const user = userEvent.setup();
    harness.adapter = createFakeAdapter({
      trips: trips(),
      stops: [
        makeStop({
          id: "0198f000-0000-7000-8000-000000000046",
          tripId: TRIP_A,
          lat: 35.0116,
          lng: 135.7681,
        }),
      ],
    });

    renderWithQuery(<AtlasWorkspace workspaceSlug="roamlog-crew" />);
    await screen.findByTestId("world-map");

    const group = screen.getByRole("group", { name: "地图视图切换" });
    const flatButton = within(group).getByRole("button", { name: "平面" });
    const globeButton = within(group).getByRole("button", { name: "地球" });
    expect(flatButton).toHaveAttribute("aria-pressed", "true");
    expect(globeButton).toHaveAttribute("aria-pressed", "false");

    // The switch is a real pair of buttons, so it is reached by Tab and
    // activated by Enter/Space without a pointer.
    flatButton.focus();
    expect(flatButton).toHaveFocus();
    await user.tab();
    expect(globeButton).toHaveFocus();
  });

  it("filters the trip sidebar by real search text", async () => {
    harness.adapter = createFakeAdapter({
      trips: trips(),
      stops: [
        makeStop({
          id: "0198f000-0000-7000-8000-000000000044",
          tripId: TRIP_A,
        }),
        makeStop({
          id: "0198f000-0000-7000-8000-000000000045",
          tripId: TRIP_B,
          city: "巴黎",
          country: "法国",
          countryCode: "FR",
          lat: 48.8566,
          lng: 2.3522,
        }),
      ],
    });

    const user = userEvent.setup();
    renderWithQuery(<AtlasWorkspace workspaceSlug="roamlog-crew" />);
    await screen.findByTestId("world-map");

    await user.type(screen.getByRole("searchbox", { name: "搜索旅行足迹" }), "巴黎");
    expect(screen.getAllByText("巴黎周末").length).toBeGreaterThan(0);
    expect(screen.queryByText("京都慢行")).not.toBeInTheDocument();
  });
});
