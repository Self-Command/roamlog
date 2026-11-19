import { UnprocessableEntityException } from "@nestjs/common";
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

function build() {
  // `create` re-reads the row inside the transaction so the response carries
  // the inserted destinations; keep the fake consistent with that contract.
  let stored = tripRow();
  const repository = {
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({})),
    findTrip: vi.fn(async () => stored),
    createTrip: vi.fn(async (_tx: unknown, data: Record<string, unknown>) => {
      stored = tripRow({ ...data, id: TRIP_ID } as Partial<TripRecord>);
      return stored;
    }),
    updateTrip: vi.fn(async (_tx: unknown, _args: unknown) => 1),
    createParticipant: vi.fn(async () => ({})),
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

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const httpError = error as { getStatus?: () => number; getResponse?: () => unknown };
    return { status: httpError.getStatus?.() ?? 0, body: httpError.getResponse?.() };
  }
  throw new Error("expected the call to reject");
}

describe("TripsService origin location persistence", () => {
  it("writes the origin coordinates, country and time zone on create", async () => {
    const { service, repository } = build();

    const trip = await service.create(actor, membership(), {
      title: "Paris, again",
      startDate: "2026-11-10",
      endDate: "2026-11-12",
      origin: "Paris",
      originLat: 48.8566,
      originLng: 2.3522,
      originCountryCode: "FR",
      timeZone: "Europe/Paris",
    });

    const data = repository.createTrip.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(data).toMatchObject({
      originLat: 48.8566,
      originLng: 2.3522,
      originCountryCode: "FR",
      timeZone: "Europe/Paris",
    });
    expect(trip).toMatchObject({
      originLat: 48.8566,
      originLng: 2.3522,
      originCountryCode: "FR",
      timeZone: "Europe/Paris",
      cover: null,
    });
  });

  it("persists an absent origin location as null instead of inventing one", async () => {
    const { service, repository } = build();

    await service.create(actor, membership(), {
      title: "Nowhere",
      startDate: "2026-11-10",
      endDate: "2026-11-12",
    });

    const data = repository.createTrip.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(data).toMatchObject({
      originLat: null,
      originLng: null,
      originCountryCode: null,
      timeZone: null,
    });
  });

  it("rejects a one-sided coordinate pair on create with 422", async () => {
    const { service, repository } = build();

    const failure = await rejection(
      service.create(actor, membership(), {
        title: "Half a location",
        startDate: "2026-11-10",
        endDate: "2026-11-12",
        originLat: 48.8566,
      }),
    );

    expect(failure.status).toBe(422);
    expect(failure.body).toMatchObject({
      code: "VALIDATION_ERROR",
      errors: [
        {
          field: "originLng",
          code: "INVALID_COORDINATE_PAIR",
          message: "Origin latitude and longitude must both be set or both be null.",
        },
      ],
    });
    expect(repository.transaction).not.toHaveBeenCalled();
  });

  it("clears the location when the patch sends explicit nulls", async () => {
    const { service, repository } = build();
    repository.findTrip
      .mockResolvedValueOnce(
        tripRow({ originLat: 37.5665, originLng: 126.978, originCountryCode: "KR", timeZone: "Asia/Seoul" }),
      )
      .mockResolvedValue(tripRow());

    const trip = await service.update(actor, membership(), TRIP_ID, {
      version: 1,
      originLat: null,
      originLng: null,
      originCountryCode: null,
      timeZone: null,
    });

    const data = repository.updateTrip.mock.calls[0]?.[1] as unknown as Record<string, unknown>;
    expect(data.data).toMatchObject({
      originLat: null,
      originLng: null,
      originCountryCode: null,
      timeZone: null,
    });
    expect(trip).toMatchObject({ originLat: null, originLng: null, originCountryCode: null, timeZone: null });
  });

  it("leaves the location untouched when the patch omits it", async () => {
    const { service, repository } = build();
    repository.findTrip
      .mockResolvedValueOnce(tripRow({ originLat: 37.5665, originLng: 126.978, timeZone: "Asia/Seoul" }))
      .mockResolvedValue(tripRow({ originLat: 37.5665, originLng: 126.978, timeZone: "Asia/Seoul" }));

    await service.update(actor, membership(), TRIP_ID, { version: 1, title: "Renamed" });

    const data = repository.updateTrip.mock.calls[0]?.[1] as unknown as { data: Record<string, unknown> };
    expect("originLat" in data.data).toBe(false);
    expect("originLng" in data.data).toBe(false);
    expect("originCountryCode" in data.data).toBe(false);
    expect("timeZone" in data.data).toBe(false);
  });

  it("rejects a patch that would leave the stored pair half-complete", async () => {
    const { service, repository } = build();
    repository.findTrip.mockResolvedValueOnce(tripRow({ originLat: 37.5665, originLng: 126.978 }));

    const failure = await rejection(
      service.update(actor, membership(), TRIP_ID, { version: 1, originLat: null }),
    );

    expect(failure.status).toBe(422);
    expect(repository.updateTrip).not.toHaveBeenCalled();
  });

  it("rejects a patch that adds only one coordinate to a location-less trip", async () => {
    const { service, repository } = build();

    const failure = await rejection(
      service.update(actor, membership(), TRIP_ID, { version: 1, originLng: 2.3522 }),
    );

    expect(failure.status).toBe(422);
    expect(failure.body).toMatchObject({
      errors: [expect.objectContaining({ code: "INVALID_COORDINATE_PAIR" })],
    });
    expect(repository.updateTrip).not.toHaveBeenCalled();
  });

  it("maps the coordinate-pair failure to UnprocessableEntityException, not a 400", async () => {
    const { service } = build();

    const error = await service
      .create(actor, membership(), {
        title: "x",
        startDate: "2026-11-10",
        endDate: "2026-11-12",
        originLng: 2.3522,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnprocessableEntityException);
  });
});
