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

function tripRow(overrides: Partial<TripRecord> = {}): TripRecord {
  return {
    id: TRIP_ID,
    workspaceId: WORKSPACE_ID,
    title: "Seoul, slowly",
    summary: "",
    status: "planning",
    startDate: new Date("2026-11-10T00:00:00.000Z"),
    endDate: new Date("2026-11-18T00:00:00.000Z"),
    coverMediaId: null,
    origin: "Shanghai",
    originLat: null,
    originLng: null,
    originCountryCode: null,
    originAddress: null,
    originBbox: null,
    timeZone: null,
    destinations: ["Seoul"],
    countryCodes: ["KR"],
    tags: [],
    guestNames: [],
    budgetAmountMinor: null,
    budgetCurrency: null,
    visibility: "workspace",
    favorite: false,
    showExactPhotoLocation: true,
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

function build(overrides: Partial<TripRecord> = {}) {
  // The real update re-reads the row inside the transaction, so the fake write
  // has to land in `stored` for the presented trip to prove what was persisted.
  let stored = tripRow(overrides);
  const repository = {
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({})),
    findTrip: vi.fn(async () => stored),
    updateTrip: vi.fn(async (_tx: unknown, args: { data: Partial<TripRecord> }) => {
      stored = { ...stored, ...args.data, version: stored.version + 1 };
      return 1;
    }),
    createTrip: vi.fn(async () => stored),
    createDestinations: vi.fn(async () => undefined),
    replaceDestinations: vi.fn(async () => undefined),
    softDeleteDestinations: vi.fn(async () => undefined),
    findMedia: vi.fn(async () => null),
    findMediaForCover: vi.fn(async () => []),
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

describe("TripsService exact photo location switch", () => {
  it("persists the switch and reports it back on the updated trip", async () => {
    const { service, repository } = build();

    const trip = await service.update(actor, membership(), TRIP_ID, {
      version: 1,
      showExactPhotoLocation: false,
    });

    const args = repository.updateTrip.mock.calls[0]?.[1] as { data: Record<string, unknown> };
    expect(args.data).toMatchObject({ showExactPhotoLocation: false });
    expect(trip.showExactPhotoLocation).toBe(false);
  });

  it("leaves the stored value alone when the patch does not mention the switch", async () => {
    const { service, repository } = build({ showExactPhotoLocation: false });

    const trip = await service.update(actor, membership(), TRIP_ID, {
      version: 1,
      title: "Seoul, again",
    });

    const args = repository.updateTrip.mock.calls[0]?.[1] as { data: Record<string, unknown> };
    expect(args.data).not.toHaveProperty("showExactPhotoLocation");
    expect(trip.showExactPhotoLocation).toBe(false);
  });

  it("can turn the switch back on after it was off", async () => {
    const { service } = build({ showExactPhotoLocation: false });

    const trip = await service.update(actor, membership(), TRIP_ID, {
      version: 1,
      showExactPhotoLocation: true,
    });

    expect(trip.showExactPhotoLocation).toBe(true);
  });
});
