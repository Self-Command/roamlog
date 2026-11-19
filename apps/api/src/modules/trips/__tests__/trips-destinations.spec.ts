import { TripSchema, type TripDestinationInput } from "@roamlog/contracts";
import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "../../../common/services/permission.service.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import { MediaUrlService } from "../../media/media-url.service.js";
import { TripCoverService } from "../../media/trip-cover.service.js";
import type { TripDestinationRecord, TripRecord } from "../content-records.js";
import { presentTrip } from "../content-presenters.js";
import { TripsService } from "../trips.service.js";

const WORKSPACE_ID = "01942f30-2200-7000-8000-000000000001";
const USER_ID = "01942f30-2200-7000-8000-000000000002";
const TRIP_ID = "01942f30-2200-7000-8000-000000000003";
const COPY_ID = "01942f30-2200-7000-8000-000000000004";
const NOW = new Date("2026-11-19T00:00:00.000Z");

const KYOTO: TripDestinationInput = {
  name: "京都",
  provider: "geoapify",
  providerPlaceId: "51e1bdfea47461405994da8b683bb64140f00103f9",
  address: "京都市, 京都府, 日本",
  country: "日本",
  countryCode: "JP",
  lat: 35.0116,
  lng: 135.7681,
  timeZone: "Asia/Tokyo",
  bbox: [135.6, 34.85, 135.93, 35.17],
};

const OSAKA: TripDestinationInput = {
  ...KYOTO,
  name: "大阪",
  address: "大阪市, 大阪府, 日本",
  lat: 34.6937,
  lng: 135.5023,
};

const NARA: TripDestinationInput = {
  ...KYOTO,
  name: "奈良",
  address: "奈良市, 奈良県, 日本",
  lat: 34.6851,
  lng: 135.8048,
};

function tripRow(overrides: Partial<TripRecord> = {}): TripRecord {
  return {
    id: TRIP_ID,
    workspaceId: WORKSPACE_ID,
    title: "Kansai by train",
    summary: "",
    status: "planning",
    startDate: new Date("2026-11-10T00:00:00.000Z"),
    endDate: new Date("2026-11-18T00:00:00.000Z"),
    coverMediaId: null,
    origin: "上海",
    originLat: 31.2304,
    originLng: 121.4737,
    originCountryCode: "CN",
    originAddress: null,
    originBbox: null,
    timeZone: "Asia/Shanghai",
    destinations: [],
    destinationsV2: [],
    countryCodes: ["JP"],
    tags: [],
    guestNames: [],
    budgetAmountMinor: null,
    budgetCurrency: null,
    visibility: "workspace",
    favorite: false,
    version: 1,
    createdById: USER_ID,
    updatedById: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function membership(role: WorkspaceMembershipAccess["role"] = "owner"): WorkspaceMembershipAccess {
  return {
    id: "01942f30-2200-7000-8000-0000000000aa",
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    role,
    status: "active",
    joinedAt: NOW,
    invitedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    workspaceName: "Test Workspace",
  };
}

const actor = { user: { id: USER_ID } } as never;

let destinationSequence = 0;

/**
 * In-memory stand-in for the two repository methods the service relies on:
 * active rows are returned by `findTrip`, replacements soft-delete the previous
 * group, and delete cascades. The assertions therefore read the same state a
 * real PostgreSQL round-trip would.
 */
function build(options: { row?: TripRecord; destinations?: TripDestinationRecord[] } = {}) {
  let row = options.row ?? tripRow();
  const destinations = [...(options.destinations ?? [])];

  function activeDestinationRows(tripId = row.id): TripDestinationRecord[] {
    return destinations
      .filter((destination) => destination.tripId === tripId && destination.deletedAt === null)
      .sort((left, right) => left.order - right.order);
  }

  const repository = {
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({})),
    findTrip: vi.fn(async (_workspaceId: string, tripId: string) =>
      row.id === tripId
        ? Object.assign({}, row, { destinationsV2: activeDestinationRows(tripId) })
        : destinations.some((destination) => destination.tripId === tripId)
          ? Object.assign({}, row, {
              id: tripId,
              destinationsV2: activeDestinationRows(tripId),
            })
          : null,
    ),
    createTrip: vi.fn(async (_tx: unknown, data: Record<string, unknown>) => {
      row = tripRow({ ...data, id: COPY_ID } as Partial<TripRecord>);
      return row;
    }),
    updateTrip: vi.fn(async (_tx: unknown, args: { data: Record<string, unknown> }) => {
      // Test double for a real UPDATE: merge the patch into the stored row.
      Object.assign(row, args.data);
      return 1;
    }),
    createParticipant: vi.fn(async () => ({})),
    softDeleteTrip: vi.fn(async (_tx: unknown, args: { actorId: string }) => {
      row.deletedAt = NOW;
      row.updatedById = args.actorId;
      return 1;
    }),
    createDestinations: vi.fn(
      async (
        _tx: unknown,
        rows: Array<Omit<TripDestinationRecord, "id" | "createdAt" | "deletedAt">>,
      ) => {
        for (const destination of rows) {
          destinationSequence += 1;
          destinations.push({
            ...destination,
            id: `01942f30-2200-7000-8000-0000000000${String(destinationSequence).padStart(2, "0")}`,
            createdAt: NOW,
            deletedAt: null,
          } as TripDestinationRecord);
        }
      },
    ),
    replaceDestinations: vi.fn(
      async (
        tx: unknown,
        args: {
          tripId: string;
          destinations: Array<Omit<TripDestinationRecord, "id" | "createdAt" | "deletedAt">>;
        },
      ) => {
        for (const destination of destinations) {
          if (destination.tripId === args.tripId && destination.deletedAt === null) {
            destination.deletedAt = NOW;
          }
        }
        await repository.createDestinations(tx, args.destinations);
      },
    ),
    softDeleteDestinations: vi.fn(async (_tx: unknown, tripId: string) => {
      for (const destination of destinations) {
        if (destination.tripId === tripId && destination.deletedAt === null) {
          destination.deletedAt = NOW;
        }
      }
    }),
    findMedia: vi.fn(async () => null),
    findMediaForCover: vi.fn(async () => []),
    listDuplicateChildren: vi.fn(async () => ({
      stops: [],
      itineraryItems: [],
      entries: [],
      participants: [],
    })),
    createDuplicateChildren: vi.fn(async () => undefined),
  };
  const activities = { record: vi.fn(async () => ({ id: "activity" })) };
  const storage = {
    createSignedReadUrl: async (key: string) => ({
      key,
      url: `https://cdn.example.test/${key}?X-Amz-Signature=stub`,
      expiresAt: "2026-11-18T12:00:00.000Z",
    }),
  };
  const covers = new TripCoverService(new MediaUrlService(storage as never));
  const service = new TripsService(
    repository as never,
    new PermissionService(),
    activities as never,
    covers,
  );
  return { service, repository, destinations };
}

function storedDestination(
  overrides: Partial<TripDestinationRecord> & Pick<TripDestinationRecord, "name" | "order">,
): TripDestinationRecord {
  return {
    id: `01942f30-2200-7000-8000-0000000001${String(overrides.order).padStart(2, "0")}`,
    tripId: TRIP_ID,
    provider: null,
    providerPlaceId: null,
    address: null,
    country: null,
    countryCode: null,
    lat: null,
    lng: null,
    timeZone: null,
    bbox: null,
    createdAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "Kansai by train",
    startDate: "2026-11-10",
    endDate: "2026-11-18",
    origin: "上海",
    ...overrides,
  };
}

describe("TripsService structured destinations", () => {
  it("writes ordered rows on create and returns them with derived names", async () => {
    const { service, repository } = build();

    const trip = await service.create(
      actor,
      membership(),
      createInput({ destinationsV2: [KYOTO, OSAKA] }),
    );

    const data = repository.createTrip.mock.calls[0]?.[1] as Record<string, unknown>;
    // Deprecated names mirror the structured group so old readers/search work.
    expect(data.destinations).toEqual(["京都", "大阪"]);

    const writeRows = repository.createDestinations.mock.calls[0]?.[1] as Array<
      Record<string, unknown>
    >;
    expect(writeRows.map((row) => [row.name, row.order])).toEqual([
      ["京都", 0],
      ["大阪", 1],
    ]);
    expect(writeRows[0]).toMatchObject({
      provider: "geoapify",
      address: "京都市, 京都府, 日本",
      lat: 35.0116,
      lng: 135.7681,
      timeZone: "Asia/Tokyo",
      bbox: [135.6, 34.85, 135.93, 35.17],
    });

    expect(trip.destinations).toEqual(["京都", "大阪"]);
    expect(trip.destinationsV2?.map((destination) => destination.name)).toEqual(["京都", "大阪"]);
    expect(trip.destinationsV2?.[1]?.address).toBe("大阪市, 大阪府, 日本");
  });

  it("keeps the old names-only create path untouched when destinationsV2 is absent", async () => {
    const { service, repository } = build();

    const trip = await service.create(actor, membership(), createInput({ destinations: ["东京"] }));

    expect(repository.createDestinations).toHaveBeenCalledTimes(1);
    // Called with an empty set (a fresh trip has no rows), not with invented ones.
    expect(repository.createDestinations.mock.calls[0]?.[1]).toEqual([]);
    expect(trip.destinations).toEqual(["东京"]);
    expect(trip.destinationsV2).toEqual([]);
  });

  it("replaces the whole group on update and soft-deletes the previous rows", async () => {
    const existing = [
      storedDestination({ name: "京都", order: 0, provider: "geoapify" }),
      storedDestination({ name: "大阪", order: 1, provider: "geoapify" }),
      storedDestination({ name: "奈良", order: 2, provider: "geoapify" }),
    ];
    const { service, repository, destinations } = build({
      row: tripRow({ destinations: ["京都", "大阪", "奈良"] }),
      destinations: existing,
    });

    const trip = await service.update(actor, membership(), TRIP_ID, {
      version: 1,
      destinationsV2: [KYOTO, NARA],
    });

    const replaced = repository.replaceDestinations.mock.calls[0]?.[1] as {
      tripId: string;
      destinations: Array<Record<string, unknown>>;
    };
    expect(replaced.tripId).toBe(TRIP_ID);
    expect(replaced.destinations.map((row) => [row.name, row.order])).toEqual([
      ["京都", 0],
      ["奈良", 1],
    ]);

    // Old rows stay in the table for history but are no longer active.
    expect(destinations.filter((destination) => destination.deletedAt === null)).toHaveLength(2);
    expect(destinations).toHaveLength(5);
    expect(trip.destinations).toEqual(["京都", "奈良"]);
    expect(trip.destinationsV2?.map((destination) => destination.name)).toEqual(["京都", "奈良"]);
  });

  it("leaves stored rows untouched when the update omits destinationsV2", async () => {
    const { service, repository } = build({
      row: tripRow({ destinations: ["京都", "大阪"] }),
      destinations: [
        storedDestination({ name: "京都", order: 0 }),
        storedDestination({ name: "大阪", order: 1 }),
      ],
    });

    const trip = await service.update(actor, membership(), TRIP_ID, {
      version: 1,
      title: "Renamed",
    });

    expect(repository.replaceDestinations).not.toHaveBeenCalled();
    expect(trip.title).toBe("Renamed");
    expect(trip.destinationsV2?.map((destination) => destination.name)).toEqual(["京都", "大阪"]);
  });

  it("clears the group when an empty destinationsV2 array is sent", async () => {
    const { service, destinations } = build({
      row: tripRow({ destinations: ["京都"] }),
      destinations: [storedDestination({ name: "京都", order: 0 })],
    });

    const trip = await service.update(actor, membership(), TRIP_ID, {
      version: 1,
      destinationsV2: [],
    });

    expect(destinations.every((destination) => destination.deletedAt !== null)).toBe(true);
    expect(trip.destinations).toEqual([]);
    expect(trip.destinationsV2).toEqual([]);
  });

  it("copies every destination row on duplicate", async () => {
    const sourceRows = [
      storedDestination({
        name: "京都",
        order: 0,
        provider: "geoapify",
        address: "京都市, 京都府, 日本",
        lat: 35.0116,
        lng: 135.7681,
        timeZone: "Asia/Tokyo",
        bbox: [135.6, 34.85, 135.93, 35.17],
      }),
      storedDestination({ name: "大阪", order: 1, provider: "photon" }),
    ];
    const { service, destinations } = build({
      row: tripRow({ destinations: ["京都", "大阪"] }),
      destinations: sourceRows,
    });

    const copy = await service.duplicate(actor, membership(), TRIP_ID, {});

    const copies = destinations.filter((destination) => destination.tripId === COPY_ID);
    expect(copies.map((destination) => [destination.name, destination.order])).toEqual([
      ["京都", 0],
      ["大阪", 1],
    ]);
    expect(copies[0]).toMatchObject({
      provider: "geoapify",
      address: "京都市, 京都府, 日本",
      lat: 35.0116,
      lng: 135.7681,
      timeZone: "Asia/Tokyo",
      bbox: [135.6, 34.85, 135.93, 35.17],
    });
    expect(copy.destinationsV2?.map((destination) => destination.name)).toEqual(["京都", "大阪"]);
  });

  it("soft-deletes destination rows when the trip is deleted", async () => {
    const { service, destinations } = build({
      row: tripRow({ destinations: ["京都"] }),
      destinations: [storedDestination({ name: "京都", order: 0 })],
    });

    await service.remove(actor, membership(), TRIP_ID);

    expect(destinations.every((destination) => destination.deletedAt !== null)).toBe(true);
  });
});

describe("presentTrip destinations projection", () => {
  it("sorts by order, excludes soft-deleted rows, and derives the names array", () => {
    const presented = presentTrip(
      tripRow({
        destinations: ["京都", "大阪"],
        destinationsV2: [
          storedDestination({ name: "大阪", order: 1 }),
          storedDestination({ name: "京都", order: 0 }),
          storedDestination({
            name: "已删除",
            order: 2,
            deletedAt: NOW,
          }),
        ],
      }),
    );

    expect(presented.destinations).toEqual(["京都", "大阪"]);
    expect(presented.destinationsV2?.map((destination) => destination.order)).toEqual([0, 1]);
    expect(presented.destinationsV2?.map((destination) => destination.name)).toEqual([
      "京都",
      "大阪",
    ]);
  });

  it("falls back to the deprecated names for a trip that has no rows yet", () => {
    const presented = presentTrip(
      tripRow({ destinations: ["东京"], destinationsV2: [] }),
    );
    expect(presented.destinations).toEqual(["东京"]);
    expect(presented.destinationsV2).toEqual([]);
  });

  it("ignores operator columns and unknown future columns (strict-schema regression)", () => {
    const record = {
      ...tripRow({
        destinations: ["京都"],
        destinationsV2: [storedDestination({ name: "京都", order: 0, provider: "geoapify" })],
      }),
      moderatedAt: new Date("2026-11-19T09:00:00.000Z"),
      moderatedById: "01942f30-2200-7000-8000-000000000999",
      someFutureColumn: "x",
    };

    const presented = presentTrip(record as never);

    expect(() => TripSchema.parse(presented)).not.toThrow();
    expect(presented).not.toHaveProperty("someFutureColumn");
    expect(presented.destinationsV2).toHaveLength(1);
  });

  it("keeps a malformed stored bbox readable by degrading it to null", () => {
    const presented = presentTrip(
      tripRow({
        destinationsV2: [
          storedDestination({ name: "京都", order: 0, bbox: [135.6, 34.85] }),
        ],
      }),
    );
    expect(presented.destinationsV2?.[0]?.bbox).toBeNull();
  });
});