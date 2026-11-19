import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "../../../common/services/permission.service.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import type { StopRecord, TripRecord } from "../content-records.js";
import { StopsService } from "../stops.service.js";

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const USER_ID = "01942f30-1200-7000-8000-000000000002";
const TRIP_ID = "01942f30-1200-7000-8000-000000000003";
const STOP_ID = "01942f30-1200-7000-8000-000000000004";
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
    originLat: null,
    originLng: null,
    originCountryCode: "JP",
    originAddress: null,
    originBbox: null,
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

function stopRow(overrides: Partial<StopRecord> = {}): StopRecord {
  return {
    id: STOP_ID,
    tripId: TRIP_ID,
    workspaceId: WORKSPACE_ID,
    city: "京都",
    country: "日本",
    countryCode: "JP",
    lat: 35.0116,
    lng: 135.7681,
    provider: null,
    providerPlaceId: null,
    timeZone: "Asia/Tokyo",
    address: KYOTO_ADDRESS,
    bbox: KYOTO_BBOX,
    startDate: new Date("2026-11-10T00:00:00.000Z"),
    endDate: new Date("2026-11-12T00:00:00.000Z"),
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

function build(options: { row?: StopRecord } = {}) {
  let row = options.row ?? stopRow();
  const repository = {
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({})),
    findTrip: vi.fn(async () => tripRow()),
    maxOrder: vi.fn(async () => ({ _max: { order: -1 } })),
    findStop: vi.fn(async () => row),
    createStop: vi.fn(async (_tx: unknown, data: Record<string, unknown>) => {
      row = stopRow({ ...data, id: STOP_ID } as Partial<StopRecord>);
      return row;
    }),
    updateStop: vi.fn(async (_tx: unknown, args: { data: Record<string, unknown> }) => {
      row = stopRow({ ...row, ...args.data } as Partial<StopRecord>);
      return 1;
    }),
  };
  const activities = { record: vi.fn(async () => ({ id: "activity" })) };
  const service = new StopsService(
    repository as never,
    new PermissionService(),
    activities as never,
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
    city: "京都",
    country: "日本",
    countryCode: "JP",
    startDate: "2026-11-10",
    endDate: "2026-11-12",
    ...overrides,
  };
}

describe("StopsService address and bbox persistence", () => {
  it("persists address and bbox on create and returns them", async () => {
    const { service, repository } = build();

    const stop = await service.create(
      actor,
      membership(),
      TRIP_ID,
      createInput({ address: KYOTO_ADDRESS, bbox: KYOTO_BBOX }),
    );

    const data = repository.createStop.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(data.address).toBe(KYOTO_ADDRESS);
    expect(data.bbox).toEqual(KYOTO_BBOX);
    expect(stop.address).toBe(KYOTO_ADDRESS);
    expect(stop.bbox).toEqual(KYOTO_BBOX);
  });

  it("persists an absent address and box as null", async () => {
    const { service, repository } = build();

    await service.create(actor, membership(), TRIP_ID, createInput());

    const data = repository.createStop.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(data.address).toBeNull();
    expect(data.bbox).toBeNull();
  });

  it("rejects a malformed bbox on create with 422 INVALID_BBOX", async () => {
    for (const bbox of [{ a: 1 }, [1, 2, 3], [1, 2, 3, 4, 5], [1, 2, 3, "north"], [10, 20, 5, 30]]) {
      const { service, repository } = build();
      const failure = await rejection(
        service.create(actor, membership(), TRIP_ID, createInput({ bbox })),
      );

      expect(failure.status, JSON.stringify(bbox)).toBe(422);
      expect(failure.body).toMatchObject({
        code: "INVALID_BBOX",
        errors: [{ field: "bbox", code: "INVALID_BBOX" }],
      });
      expect(repository.createStop).not.toHaveBeenCalled();
    }
  });

  it("persists address and box on update", async () => {
    const { service, repository } = build({
      row: stopRow({ address: null, bbox: null }),
    });

    const stop = await service.update(actor, membership(), STOP_ID, {
      version: 1,
      address: KYOTO_ADDRESS,
      bbox: KYOTO_BBOX,
    });

    const data = repository.updateStop.mock.calls[0]?.[1].data as Record<string, unknown>;
    expect(data.address).toBe(KYOTO_ADDRESS);
    expect(data.bbox).toEqual(KYOTO_BBOX);
    expect(stop.address).toBe(KYOTO_ADDRESS);
    expect(stop.bbox).toEqual(KYOTO_BBOX);
  });

  it("clears address and box when null is sent explicitly", async () => {
    const { service, repository } = build();

    await service.update(actor, membership(), STOP_ID, {
      version: 1,
      address: null,
      bbox: null,
    });

    const data = repository.updateStop.mock.calls[0]?.[1].data as Record<string, unknown>;
    expect(data).toHaveProperty("address", null);
    expect(data).toHaveProperty("bbox", null);
  });

  it("leaves both columns untouched when the patch omits them", async () => {
    const { service, repository } = build();

    await service.update(actor, membership(), STOP_ID, { version: 1, notes: "改备注" });

    const data = repository.updateStop.mock.calls[0]?.[1].data as Record<string, unknown>;
    expect(data).not.toHaveProperty("address");
    expect(data).not.toHaveProperty("bbox");
  });

  it("rejects a malformed bbox on update with 422 INVALID_BBOX", async () => {
    const { service, repository } = build();

    const failure = await rejection(
      service.update(actor, membership(), STOP_ID, { version: 1, bbox: [1, 2, 3] }),
    );

    expect(failure.status).toBe(422);
    expect(failure.body).toMatchObject({ code: "INVALID_BBOX" });
    expect(repository.updateStop).not.toHaveBeenCalled();
  });
});