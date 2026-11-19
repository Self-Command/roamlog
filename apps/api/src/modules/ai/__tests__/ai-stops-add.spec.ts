import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "../../../common/services/permission.service.js";
import type { StopRecord, TripRecord } from "../../trips/content-records.js";
import { StopsService } from "../../trips/stops.service.js";
import { AiToolbox, type AiToolContext } from "../ai-tools.js";
import {
  actorStub,
  GEOAPIFY_KYOTO,
  membershipStub,
  placeSearchItems,
  TRIP_ID,
  tripRecord,
  WORKSPACE_ID,
  USER_ID,
} from "./ai-fixtures.js";

const STOP_ID = "01942f30-1200-7000-8000-000000000302";
const NOW = new Date("2026-11-19T00:00:00.000Z");

function tripRow(): TripRecord {
  return {
    id: TRIP_ID,
    workspaceId: WORKSPACE_ID,
    title: "Kyoto",
    summary: "",
    status: "planning",
    startDate: new Date("2026-12-01T00:00:00.000Z"),
    endDate: new Date("2026-12-07T00:00:00.000Z"),
    coverMediaId: null,
    origin: "未填写",
    originLat: null,
    originLng: null,
    originCountryCode: null,
    originAddress: null,
    originBbox: null,
    timeZone: null,
    destinations: [],
    countryCodes: [],
    tags: [],
    guestNames: [],
    budgetAmountMinor: null,
    budgetCurrency: null,
    visibility: "private",
    favorite: false,
    version: 1,
    createdById: USER_ID,
    updatedById: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

function stopRow(overrides: Partial<StopRecord> = {}): StopRecord {
  return {
    id: STOP_ID,
    tripId: TRIP_ID,
    workspaceId: WORKSPACE_ID,
    city: "京都市",
    country: "日本",
    countryCode: "JP",
    lat: 35.0115754,
    lng: 135.7681441,
    provider: "geoapify",
    providerPlaceId: GEOAPIFY_KYOTO.providerPlaceId,
    timeZone: "Asia/Tokyo",
    address: "京都市, 京都府, 日本",
    bbox: GEOAPIFY_KYOTO.bbox,
    startDate: new Date("2026-12-01T00:00:00.000Z"),
    endDate: new Date("2026-12-02T00:00:00.000Z"),
    notes: "",
    order: 0,
    version: 1,
    createdById: USER_ID,
    updatedById: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Wires the **real** `AiToolbox` and the **real** `StopsService` to a stub place
 * search and a recording repository. This is the production write path for an
 * AI-authored stop, minus Nest DI and PostgreSQL.
 *
 * The candidate comes from a Geoapify-shaped `places.search` result, which is
 * exactly the source the old `Stop_provider_check` used to reject with 23514.
 */
function build() {
  const stop = stopRow();
  const repository = {
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({})),
    findTrip: vi.fn(async () => tripRow()),
    maxOrder: vi.fn(async () => ({ _max: { order: -1 } })),
    findStop: vi.fn(async () => stop),
    createStop: vi.fn(async (_tx: unknown, data: Record<string, unknown>) =>
      stopRow({ ...data, id: STOP_ID } as Partial<StopRecord>),
    ),
    updateStop: vi.fn(async () => 1),
  };
  const activities = { record: vi.fn(async () => ({ id: "activity" })) };
  const stops = new StopsService(repository as never, new PermissionService(), activities as never);
  const places = {
    search: vi.fn(async () => ({ items: placeSearchItems(GEOAPIFY_KYOTO) })),
  };
  const toolbox = new AiToolbox(
    places as never,
    // `TripsService.get` presents contract-shaped dates (strings), unlike the
    // repository rows `StopsService` reads internally.
    { get: vi.fn(async () => tripRecord()) } as never,
    stops as never,
    {} as never,
    {} as never,
  );
  const context: AiToolContext = {
    actor: actorStub(),
    membership: membershipStub("editor"),
    runId: "b".repeat(32),
    candidates: new Map(),
  };
  return { toolbox, context, repository, places };
}

describe("AiToolbox stops.add place metadata", () => {
  it("writes provider, address and bbox from the Geoapify candidate", async () => {
    const { toolbox, context, repository, places } = build();

    const search = await toolbox.execute({ tool: "places.search", args: { q: "京都" } }, context);
    expect(search.ok).toBe(true);
    expect(places.search).toHaveBeenCalledWith({ q: "京都", limit: 6 });
    // The candidate keeps the search source verbatim instead of downgrading it.
    expect(context.candidates.get(GEOAPIFY_KYOTO.providerPlaceId)).toMatchObject({
      provider: "geoapify",
      address: "京都市, 京都府, 日本",
      bbox: GEOAPIFY_KYOTO.bbox,
    });

    const added = await toolbox.execute(
      {
        tool: "stops.add",
        args: { tripId: TRIP_ID, providerPlaceId: GEOAPIFY_KYOTO.providerPlaceId },
      },
      context,
    );

    expect(added.ok).toBe(true);
    expect(repository.createStop).toHaveBeenCalledTimes(1);
    const data = repository.createStop.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(data).toMatchObject({
      provider: "geoapify",
      providerPlaceId: GEOAPIFY_KYOTO.providerPlaceId,
      address: "京都市, 京都府, 日本",
      bbox: GEOAPIFY_KYOTO.bbox,
      timeZone: "Asia/Tokyo",
      lat: GEOAPIFY_KYOTO.lat,
      lng: GEOAPIFY_KYOTO.lng,
    });

    // The presenter round-trip is what the API returns to the client.
    const payload = added.payload as { stopId: string; city: string };
    expect(payload.stopId).toBe(STOP_ID);
    const created = stopRow({ ...data } as Partial<StopRecord>);
    expect(created.provider).toBe("geoapify");
    expect(created.address).toBe("京都市, 京都府, 日本");
    expect(created.bbox).toEqual(GEOAPIFY_KYOTO.bbox);
  });

  it("still refuses a place id that places.search never returned", async () => {
    const { toolbox, context, repository } = build();

    const added = await toolbox.execute(
      {
        tool: "stops.add",
        args: { tripId: TRIP_ID, providerPlaceId: "51e1bdfea47461405994da8b683bb64140f00103f9" },
      },
      context,
    );

    expect(added.ok).toBe(false);
    expect(added.error?.code).toBe("UNRESOLVED_PLACE");
    expect(repository.createStop).not.toHaveBeenCalled();
  });
});
