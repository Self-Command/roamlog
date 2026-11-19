import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "../../../common/services/permission.service.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import { MediaUrlService } from "../../media/media-url.service.js";
import { TripCoverService } from "../../media/trip-cover.service.js";
import type { TripRecord } from "../content-records.js";
import { TripsService } from "../trips.service.js";

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const USER_ID = "01942f30-1200-7000-8000-000000000002";
const TRIP_ID = "01942f30-1200-7000-8000-000000000003";
const NOW = new Date("2026-11-01T00:00:00.000Z");

const KYOTO_ADDRESS = "京都市, 京都府, 日本";
const KYOTO_BBOX: [number, number, number, number] = [135.6, 34.85, 135.93, 35.17];

function tripRow(overrides: Partial<TripRecord> = {}): TripRecord {
  return {
    id: TRIP_ID,
    workspaceId: WORKSPACE_ID,
    title: "Kyoto, slowly",
    summary: "",
    status: "planning",
    startDate: new Date("2026-11-10T00:00:00.000Z"),
    endDate: new Date("2026-11-18T00:00:00.000Z"),
    coverMediaId: null,
    origin: "京都",
    originLat: 35.0116,
    originLng: 135.7681,
    originCountryCode: "JP",
    originAddress: KYOTO_ADDRESS,
    originBbox: KYOTO_BBOX,
    timeZone: "Asia/Tokyo",
    destinations: ["大阪"],
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
    id: "01942f30-1200-7000-8000-0000000000aa",
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

function build(options: { row?: TripRecord } = {}) {
  let row = options.row ?? tripRow();
  const repository = {
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({})),
    findTrip: vi.fn(async () => row),
    createTrip: vi.fn(async (_tx: unknown, data: Record<string, unknown>) =>
      tripRow({ ...data, id: TRIP_ID } as Partial<TripRecord>),
    ),
    updateTrip: vi.fn(async (_tx: unknown, args: { data: Record<string, unknown> }) => {
      row = tripRow({ ...row, ...args.data } as Partial<TripRecord>);
      return 1;
    }),
    createParticipant: vi.fn(async () => ({})),
    createDestinations: vi.fn(async () => undefined),
    replaceDestinations: vi.fn(async () => undefined),
    softDeleteDestinations: vi.fn(async () => undefined),
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
  return { service, repository };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const httpError = error as { getStatus?: () => number; getResponse?: () => unknown };
    return { status: httpError.getStatus?.() ?? 0, body: httpError.getResponse?.() };
  }
  throw new Error("expected the call to reject");
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "Kyoto, slowly",
    startDate: "2026-11-10",
    endDate: "2026-11-18",
    origin: "京都",
    ...overrides,
  };
}

describe("TripsService origin address and bbox persistence", () => {
  it("persists originAddress and originBbox on create and returns them", async () => {
    const { service, repository } = build();

    const trip = await service.create(
      actor,
      membership(),
      createInput({ originAddress: KYOTO_ADDRESS, originBbox: KYOTO_BBOX }),
    );

    const data = repository.createTrip.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(data.originAddress).toBe(KYOTO_ADDRESS);
    expect(data.originBbox).toEqual(KYOTO_BBOX);
    expect(trip.originAddress).toBe(KYOTO_ADDRESS);
    expect(trip.originBbox).toEqual(KYOTO_BBOX);
  });

  it("persists an absent address and box as null instead of inventing them", async () => {
    const { service, repository } = build();

    await service.create(actor, membership(), createInput());

    const data = repository.createTrip.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(data.originAddress).toBeNull();
    expect(data.originBbox).toBeNull();
  });

  it("rejects a malformed originBbox on create with 422 INVALID_BBOX", async () => {
    const cases: unknown[] = [
      { a: 1 },
      [135.6, 34.85, 135.93],
      [135.6, 34.85, 135.93, 35.17, 1],
      [135.6, 34.85, 135.93, "35.17"],
      // Inverted box: west > east.
      [135.93, 34.85, 135.6, 35.17],
      // Out of the WGS84 range.
      [181, 34.85, 181.5, 35.17],
    ];

    for (const originBbox of cases) {
      const { service, repository } = build();
      const failure = await rejection(
        service.create(actor, membership(), createInput({ originBbox })),
      );

      expect(failure.status, JSON.stringify(originBbox)).toBe(422);
      expect(failure.body).toMatchObject({
        code: "INVALID_BBOX",
        errors: [{ field: "originBbox", code: "INVALID_BBOX" }],
      });
      expect(repository.createTrip).not.toHaveBeenCalled();
    }
  });

  it("persists address and box on update", async () => {
    const { service, repository } = build({ row: tripRow({ originAddress: null, originBbox: null }) });

    await service.update(actor, membership(), TRIP_ID, {
      version: 1,
      originAddress: KYOTO_ADDRESS,
      originBbox: KYOTO_BBOX,
    });

    const data = repository.updateTrip.mock.calls[0]?.[1].data as Record<string, unknown>;
    expect(data.originAddress).toBe(KYOTO_ADDRESS);
    expect(data.originBbox).toEqual(KYOTO_BBOX);
  });

  it("clears address and box when null is sent explicitly", async () => {
    const { service, repository } = build();

    await service.update(actor, membership(), TRIP_ID, {
      version: 1,
      originAddress: null,
      originBbox: null,
    });

    const data = repository.updateTrip.mock.calls[0]?.[1].data as Record<string, unknown>;
    // `undefined` would leave the column untouched; `null` must reach Prisma.
    expect(data).toHaveProperty("originAddress", null);
    expect(data).toHaveProperty("originBbox", null);
  });

  it("leaves both columns untouched when the patch omits them", async () => {
    const { service, repository } = build();

    await service.update(actor, membership(), TRIP_ID, { version: 1, summary: "plan v2" });

    const data = repository.updateTrip.mock.calls[0]?.[1].data as Record<string, unknown>;
    expect(data).not.toHaveProperty("originAddress");
    expect(data).not.toHaveProperty("originBbox");
  });

  it("rejects a malformed originBbox on update with 422 INVALID_BBOX", async () => {
    const { service, repository } = build();

    const failure = await rejection(
      service.update(actor, membership(), TRIP_ID, { version: 1, originBbox: { west: 1 } }),
    );

    expect(failure.status).toBe(422);
    expect(failure.body).toMatchObject({ code: "INVALID_BBOX" });
    expect(repository.updateTrip).not.toHaveBeenCalled();
  });

  it("copies address and box when a trip is duplicated", async () => {
    const { service, repository } = build();

    const copy = await service.duplicate(actor, membership(), TRIP_ID, {});
    expect(copy.id).toBe(TRIP_ID);

    const data = repository.createTrip.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(data.originAddress).toBe(KYOTO_ADDRESS);
    expect(data.originBbox).toEqual(KYOTO_BBOX);
  });

  it("drops an unreadable stored box on duplicate instead of copying garbage", async () => {
    const { service, repository } = build({
      row: tripRow({ originBbox: { not: "a bbox" }, originAddress: KYOTO_ADDRESS }),
    });

    await service.duplicate(actor, membership(), TRIP_ID, {});

    const data = repository.createTrip.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(data.originAddress).toBe(KYOTO_ADDRESS);
    expect(data.originBbox).toBeNull();
  });
});