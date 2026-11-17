import { describe, expect, it } from "vitest";

import { MeResponseSchema, MyWorkspacesResponseSchema, TripSchema } from "@roamlog/contracts";

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
});
