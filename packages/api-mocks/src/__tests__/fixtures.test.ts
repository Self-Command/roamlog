import { describe, expect, it } from "vitest";

import {
  ActivitySchema,
  CommentSchema,
  ExpenseWithSplitsSchema,
  InvitationSchema,
  ItineraryItemSchema,
  JournalEntrySchema,
  MediaSchema,
  MeResponseSchema,
  MyWorkspacesResponseSchema,
  NotificationSchema,
  PackingItemSchema,
  StopSchema,
  TripSchema,
  WorkspaceMemberWithUserSchema,
} from "@roamlog/contracts";

import { demoFixtureState, demoStops, demoTrips } from "../fixtures";

describe("MSW fixtures", () => {
  it("satisfies the frozen contracts and exposes a parseable fixture snapshot", () => {
    expect(MeResponseSchema.parse(demoFixtureState.me)).toEqual(demoFixtureState.me);
    expect(MyWorkspacesResponseSchema.parse(demoFixtureState.workspaces)).toEqual(
      demoFixtureState.workspaces,
    );
    expect(demoFixtureState.trips.every((trip) => TripSchema.safeParse(trip).success)).toBe(true);
  });

  it("contains exactly one active journey for the local workspace state", () => {
    expect(demoFixtureState.trips.filter((trip) => trip.status === "active")).toHaveLength(1);
    expect(
      demoFixtureState.trips.filter((trip) => trip.status === "upcoming").length,
    ).toBeGreaterThan(0);
  });

  it("provides contract-valid content volumes for the full Web preview", () => {
    expect(demoFixtureState.entries.length).toBeGreaterThanOrEqual(16);
    expect(demoFixtureState.media.length).toBeGreaterThanOrEqual(24);
    expect(demoFixtureState.itinerary.length).toBeGreaterThanOrEqual(8);
    expect(demoFixtureState.expenses.length).toBeGreaterThanOrEqual(20);
    expect(demoFixtureState.packing.length).toBeGreaterThanOrEqual(30);
    expect(demoFixtureState.comments.length).toBeGreaterThanOrEqual(8);
    expect(demoFixtureState.activities.length).toBeGreaterThanOrEqual(10);

    expect(demoFixtureState.members.every((item) => WorkspaceMemberWithUserSchema.safeParse(item).success)).toBe(true);
    expect(demoFixtureState.invitations.every((item) => InvitationSchema.safeParse(item).success)).toBe(true);
    expect(demoFixtureState.entries.every((item) => JournalEntrySchema.safeParse(item).success)).toBe(true);
    expect(demoFixtureState.media.every((item) => MediaSchema.safeParse(item).success)).toBe(true);
    expect(demoFixtureState.itinerary.every((item) => ItineraryItemSchema.safeParse(item).success)).toBe(true);
    expect(demoFixtureState.stops.every((item) => StopSchema.safeParse(item).success)).toBe(true);
    expect(demoFixtureState.expenses.every((item) => ExpenseWithSplitsSchema.safeParse(item).success)).toBe(true);
    expect(demoFixtureState.packing.every((item) => PackingItemSchema.safeParse(item).success)).toBe(true);
    expect(demoFixtureState.comments.every((item) => CommentSchema.safeParse(item).success)).toBe(true);
    expect(demoFixtureState.activities.every((item) => ActivitySchema.safeParse(item).success)).toBe(true);
    expect(demoFixtureState.notifications.every((item) => NotificationSchema.safeParse(item).success)).toBe(true);
  });

  it("keeps the deep-path exports used by e2e/support/mock-fixtures.ts parseable", () => {
    // Playwright's support module imports `demoTrips` through
    // `../../packages/api-mocks/src/fixtures`; this asserts the same export is
    // non-empty and already round-trips through the frozen trip/stop contracts.
    expect(demoTrips.length).toBeGreaterThan(0);
    expect(demoStops.length).toBeGreaterThan(0);
    expect(demoStops).toHaveLength(demoFixtureState.stops.length);
    expect(TripSchema.array().parse(demoTrips)).toEqual(demoTrips);
    expect(StopSchema.array().parse(demoStops)).toEqual(demoStops);
  });

  it("accepts populated place address and bbox fields on stops and trips", () => {
    const stop = StopSchema.parse({
      ...demoStops[0]!,
      address: "首尔特别市钟路区社稷路 9 街 12",
      bbox: [126.9, 37.5, 127.05, 37.6],
    });
    expect(stop.address).toBe("首尔特别市钟路区社稷路 9 街 12");
    expect(stop.bbox).toEqual([126.9, 37.5, 127.05, 37.6]);

    const trip = TripSchema.parse({
      ...demoTrips[0]!,
      originAddress: "上海市黄浦区中山东一路 1 号",
      originBbox: [121.47, 31.23, 121.49, 31.28],
    });
    expect(trip.originAddress).toBe("上海市黄浦区中山东一路 1 号");
    expect(trip.originBbox).toEqual([121.47, 31.23, 121.49, 31.28]);
  });
});
