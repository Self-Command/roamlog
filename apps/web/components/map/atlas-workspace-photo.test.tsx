import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MediaPage } from "@roamlog/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeMedia } from "@/test/cover-upload-doubles";
import { createFakeAdapter, makeStop, makeTrip } from "@/test/fake-data";
import { renderWithQuery } from "@/test/query-harness";

import { AtlasWorkspace } from "./atlas-workspace";

const harness = vi.hoisted(() => ({
  adapter: undefined as unknown as import("@/lib/api").DataAdapter,
  media: { current: { data: undefined } as { data: unknown } },
}));

vi.mock("@/lib/data-provider", () => ({
  useDataAdapter: () => harness.adapter,
}));

/**
 * The photo layer reads the workspace media list the API already exposes
 * (`GET /v1/workspaces/{id}/media`). The hook is stubbed so the suite asserts the
 * layer's own behaviour instead of a network round-trip.
 */
vi.mock("@roamlog/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@roamlog/api-client")>();
  return { ...actual, useListWorkspaceMedia: () => harness.media.current };
});

const TRIP_A = "0198f000-0000-7000-8000-000000000011";

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
  ];
}

function mediaPage(items: MediaPage["items"]): { data: { status: number; data: MediaPage } } {
  return { data: { status: 200, data: { items, nextCursor: null, hasMore: false } } };
}

describe("AtlasWorkspace photo layer", () => {
  beforeEach(() => {
    harness.adapter = createFakeAdapter({
      trips: trips(),
      stops: [
        makeStop({
          id: "0198f000-0000-7000-8000-000000000041",
          tripId: TRIP_A,
          city: "京都",
          country: "日本",
          countryCode: "JP",
          lat: 35.0116,
          lng: 135.7681,
        }),
      ],
    });
    harness.media.current = { data: undefined };
  });

  it("shows no photo switch when no media row carries GPS", async () => {
    harness.media.current = mediaPage([
      makeMedia({ id: "0198f000-0000-7000-8000-0000000000e1", status: "ready" }),
    ]);

    renderWithQuery(<AtlasWorkspace workspaceSlug="roamlog-crew" />);
    await screen.findByTestId("world-map");

    expect(screen.queryByRole("button", { name: /照片图层/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("photo-locations-panel")).not.toBeInTheDocument();
  });

  it("plots the photo places once a media row has coordinates", async () => {
    const user = userEvent.setup();
    harness.media.current = mediaPage([
      makeMedia({
        id: "0198f000-0000-7000-8000-0000000000e1",
        status: "ready",
        lat: 35.0116,
        lng: 135.7681,
        date: "2026-11-02",
        variants: { thumb: { url: "https://media.example.test/kyoto-thumb.jpg" } },
      }),
      makeMedia({ id: "0198f000-0000-7000-8000-0000000000e2", status: "ready", lat: null, lng: null }),
    ]);

    renderWithQuery(<AtlasWorkspace workspaceSlug="roamlog-crew" />);
    await screen.findByTestId("world-map");

    const group = screen.getByRole("group", { name: "地图图层" });
    const toggle = within(group).getByRole("button", { name: /照片图层/ });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText(/PHOTO LOCATIONS \/ 1/)).toBeInTheDocument();

    // Opening a place shows its thumbnail; switching the layer off removes it.
    const panel = screen.getByTestId("photo-locations-panel");
    await user.click(within(panel).getByRole("button", { name: /带定位的照片/ }));
    expect(within(panel).getByRole("img")).toHaveAttribute(
      "src",
      "https://media.example.test/kyoto-thumb.jpg",
    );

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("photo-locations-panel")).not.toBeInTheDocument();
  });
});
