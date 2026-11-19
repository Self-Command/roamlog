import { describe, expect, it } from "vitest";

import {
  PlaceProviderSchema,
  PublicStopSchema,
  PublicTripResponseSchema,
  PublicTripSchema,
} from "../index";

const TRIP_ID = "01942f30-1200-7000-8000-000000000003";
const STOP_ID = "01942f30-1200-7000-8000-000000000020";

function publicStop(overrides: Record<string, unknown> = {}) {
  return {
    id: STOP_ID,
    city: "Kyoto",
    country: "Japan",
    countryCode: "JP",
    lat: 35.0116,
    lng: 135.7681,
    provider: "geoapify",
    address: "京都市, 京都府, 日本",
    startDate: "2026-11-21",
    endDate: "2026-11-24",
    notes: "",
    order: 0,
    ...overrides,
  };
}

function publicTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: TRIP_ID,
    title: "Kyoto, slowly",
    summary: "A week of temples and rain.",
    status: "active",
    startDate: "2026-11-21",
    endDate: "2026-11-24",
    durationDays: 4,
    coverMediaId: null,
    cover: null,
    origin: "Shanghai",
    originProvider: "geoapify",
    destinations: ["Kyoto"],
    countryCodes: ["JP"],
    tags: [],
    ...overrides,
  };
}

describe("public share place provider contract", () => {
  it("accepts every provider the place search can store", () => {
    for (const provider of PlaceProviderSchema.options) {
      expect(PublicStopSchema.parse(publicStop({ provider })).provider).toBe(provider);
      expect(PublicTripSchema.parse(publicTrip({ originProvider: provider })).originProvider).toBe(
        provider,
      );
    }
  });

  it("keeps both provider fields nullable for legacy shares", () => {
    expect(PublicStopSchema.parse(publicStop({ provider: null })).provider).toBeNull();
    expect(PublicTripSchema.parse(publicTrip({ originProvider: null })).originProvider).toBeNull();
  });

  it("requires the provider keys instead of treating them as optional", () => {
    const stopWithoutProvider = publicStop();
    delete (stopWithoutProvider as Record<string, unknown>).provider;
    expect(PublicStopSchema.safeParse(stopWithoutProvider).success).toBe(false);

    const tripWithoutOriginProvider = publicTrip();
    delete (tripWithoutOriginProvider as Record<string, unknown>).originProvider;
    expect(PublicTripSchema.safeParse(tripWithoutOriginProvider).success).toBe(false);
  });

  it("rejects providers outside the shared enum instead of widening the union", () => {
    expect(PublicStopSchema.safeParse(publicStop({ provider: "google" })).success).toBe(false);
    expect(PublicStopSchema.safeParse(publicStop({ provider: "" })).success).toBe(false);
    expect(PublicTripSchema.safeParse(publicTrip({ originProvider: "mapbox" })).success).toBe(
      false,
    );
  });

  it("validates the whole public response with the provider fields in place", () => {
    const payload = PublicTripResponseSchema.parse({
      trip: publicTrip({ originProvider: "photon" }),
      stops: [publicStop({ provider: "local" })],
      entries: [],
      media: [],
      budget: null,
    });

    expect(payload.trip.originProvider).toBe("photon");
    expect(payload.stops[0]?.provider).toBe("local");
  });

  it("still rejects internal moderation columns on the public projection", () => {
    const withModeration = PublicTripResponseSchema.safeParse({
      trip: publicTrip({
        moderatedAt: "2026-11-19T10:00:00.000Z",
        moderatedById: TRIP_ID,
      }),
      stops: [publicStop({ moderatedAt: "2026-11-19T10:00:00.000Z", moderatedById: TRIP_ID })],
      entries: [],
      media: [],
      budget: null,
    });

    expect(withModeration.success).toBe(false);
  });
});