import { describe, expect, it } from "vitest";

import {
  presentStop,
  presentTrip,
  type PresentStopInput,
  type PresentTripInput,
} from "../content-presenters.js";

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const USER_ID = "01942f30-1200-7000-8000-000000000002";
const TRIP_ID = "01942f30-1200-7000-8000-000000000003";
const STOP_ID = "01942f30-1200-7000-8000-000000000004";

function tripRecord(overrides: Partial<PresentTripInput> = {}): PresentTripInput {
  return {
    id: TRIP_ID,
    workspaceId: WORKSPACE_ID,
    title: "Seoul, slowly",
    summary: "A week of food, trains, and rain.",
    status: "active",
    startDate: new Date("2026-11-10T00:00:00.000Z"),
    endDate: new Date("2026-11-18T00:00:00.000Z"),
    coverMediaId: null,
    origin: "Shanghai",
    destinations: ["Seoul"],
    countryCodes: ["KR"],
    tags: ["food"],
    guestNames: [],
    budgetAmountMinor: 900_000,
    budgetCurrency: "KRW",
    visibility: "workspace",
    favorite: false,
    version: 1,
    createdById: USER_ID,
    updatedById: USER_ID,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    updatedAt: new Date("2026-11-02T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function stopRecord(overrides: Partial<PresentStopInput> = {}): PresentStopInput {
  return {
    id: STOP_ID,
    tripId: TRIP_ID,
    workspaceId: WORKSPACE_ID,
    city: "Seoul",
    country: "South Korea",
    countryCode: "KR",
    lat: 37.5665,
    lng: 126.978,
    startDate: new Date("2026-11-10T00:00:00.000Z"),
    endDate: new Date("2026-11-12T00:00:00.000Z"),
    notes: "Stay near Euljiro.",
    order: 0,
    version: 1,
    createdById: USER_ID,
    updatedById: USER_ID,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    updatedAt: new Date("2026-11-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

describe("presentTrip", () => {
  it("derives durationDays from the inclusive date span", () => {
    expect(presentTrip(tripRecord()).durationDays).toBe(9);
    expect(
      presentTrip(
        tripRecord({
          startDate: "2026-11-10",
          endDate: "2026-11-10",
        }),
      ).durationDays,
    ).toBe(1);
  });

  it("reports a null cover until a signed cover projection exists", () => {
    const trip = presentTrip(tripRecord());
    expect(trip.cover).toBeNull();
    expect(trip.coverMediaId).toBeNull();
  });

  it("defaults unmigrated place metadata to null instead of inventing a location", () => {
    const trip = presentTrip(tripRecord());
    expect(trip.originLat).toBeNull();
    expect(trip.originLng).toBeNull();
    expect(trip.originCountryCode).toBeNull();
    expect(trip.timeZone).toBeNull();
  });

  it("passes migrated place metadata through unchanged", () => {
    const trip = presentTrip(
      tripRecord({
        originLat: 31.2304,
        originLng: 121.4737,
        originCountryCode: "CN",
        timeZone: "Asia/Shanghai",
      }),
    );
    expect(trip.originLat).toBe(31.2304);
    expect(trip.originLng).toBe(121.4737);
    expect(trip.originCountryCode).toBe("CN");
    expect(trip.timeZone).toBe("Asia/Shanghai");
  });

  it("keeps the existing canonical origin fallback", () => {
    expect(presentTrip(tripRecord({ origin: "   " })).origin).toBe("未填写");
  });
});

describe("presentStop", () => {
  it("defaults provider, providerPlaceId, and timeZone to null", () => {
    const stop = presentStop(stopRecord());
    expect(stop.provider).toBeNull();
    expect(stop.providerPlaceId).toBeNull();
    expect(stop.timeZone).toBeNull();
  });

  it("passes migrated place metadata through unchanged", () => {
    const stop = presentStop(
      stopRecord({
        provider: "photon",
        providerPlaceId: "osm:node/123456",
        timeZone: "Asia/Seoul",
      }),
    );
    expect(stop.provider).toBe("photon");
    expect(stop.providerPlaceId).toBe("osm:node/123456");
    expect(stop.timeZone).toBe("Asia/Seoul");
  });

  it("rejects a provider outside the contract enum instead of guessing", () => {
    expect(() => presentStop(stopRecord({ provider: "manual" }))).toThrow();
  });
});
