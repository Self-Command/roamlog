import { describe, expect, it } from "vitest";

import {
  ActivitySchema,
  CommentSchema,
  ExpenseWithSplitsSchema,
  InvitationSchema,
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

import { demoFixtureState } from "../fixtures";

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
    expect(demoFixtureState.stops.every((item) => StopSchema.safeParse(item).success)).toBe(true);
    expect(demoFixtureState.expenses.every((item) => ExpenseWithSplitsSchema.safeParse(item).success)).toBe(true);
    expect(demoFixtureState.packing.every((item) => PackingItemSchema.safeParse(item).success)).toBe(true);
    expect(demoFixtureState.comments.every((item) => CommentSchema.safeParse(item).success)).toBe(true);
    expect(demoFixtureState.activities.every((item) => ActivitySchema.safeParse(item).success)).toBe(true);
    expect(demoFixtureState.notifications.every((item) => NotificationSchema.safeParse(item).success)).toBe(true);
  });
});
