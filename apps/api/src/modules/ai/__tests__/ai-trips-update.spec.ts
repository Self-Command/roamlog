import { HttpException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "../../../common/services/permission.service.js";
import { MediaUrlService } from "../../media/media-url.service.js";
import { TripCoverService } from "../../media/trip-cover.service.js";
import type { TripRecord } from "../../trips/content-records.js";
import { TripsService } from "../../trips/trips.service.js";
import { AiToolbox, type AiToolContext } from "../ai-tools.js";
import { actorStub, membershipStub, TRIP_ID, USER_ID, WORKSPACE_ID } from "./ai-fixtures.js";

/**
 * `trips.update` is wired to the **real** `TripsService.update`: these tests
 * prove the AI tool reuses the product's own path (version optimistic lock,
 * role check, visibility check) instead of writing the Trip row directly.
 */
const OTHER_USER_ID = "01942f30-1200-7000-8000-0000000000ee";
const NOW = new Date("2026-11-19T00:00:00.000Z");

function tripRow(overrides: Partial<TripRecord> = {}): TripRecord {
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

function build(overrides: Partial<TripRecord> = {}) {
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
  const trips = new TripsService(repository as never, new PermissionService(), activities as never, covers);
  const toolbox = new AiToolbox(
    {} as never,
    trips as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { toolbox, repository, current: () => stored };
}

function context(role: "viewer" | "editor" | "owner" = "editor"): AiToolContext {
  return {
    actor: actorStub(),
    membership: membershipStub(role),
    runId: "d".repeat(32),
    candidates: new Map(),
    createdTripIds: [],
  };
}

interface UpdateCall {
  readonly workspaceId: string;
  readonly tripId: string;
  readonly version: number;
  readonly data: Record<string, unknown>;
}

function updateCall(repository: ReturnType<typeof build>["repository"]): UpdateCall {
  const call = repository.updateTrip.mock.calls[0]?.[1] as UpdateCall | undefined;
  expect(call).toBeDefined();
  return call as UpdateCall;
}

async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  const thrown = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(thrown).toBeInstanceOf(HttpException);
  return thrown as HttpException;
}

describe("AiToolbox trips.update", () => {
  it("extends a trip's end date through TripsService.update and bumps the version", async () => {
    const { toolbox, repository } = build();

    const outcome = await toolbox.execute(
      { tool: "trips.update", args: { tripId: TRIP_ID, endDate: "2026-12-06" } },
      context(),
    );

    expect(outcome.ok).toBe(true);
    const call = updateCall(repository);
    expect(call.tripId).toBe(TRIP_ID);
    expect(call.workspaceId).toBe(WORKSPACE_ID);
    // The optimistic-lock token is the row's version, never a model number.
    expect(call.version).toBe(1);
    expect(call.data).toMatchObject({ endDate: new Date("2026-12-06T00:00:00.000Z") });
    // The presented trip is the real post-update state.
    expect(outcome.payload).toMatchObject({
      tripId: TRIP_ID,
      startDate: "2026-12-01",
      endDate: "2026-12-06",
      version: 2,
    });
  });

  it("strips visibility, privacy, status and version fields the model tries to add", async () => {
    const { toolbox, repository, current } = build();

    const outcome = await toolbox.execute(
      {
        tool: "trips.update",
        args: {
          tripId: TRIP_ID,
          endDate: "2026-12-06",
          title: "Kyoto, six days",
          version: 42,
          visibility: "public_link",
          showExactPhotoLocation: false,
          status: "completed",
          favorite: true,
          workspaceId: "01942f30-1200-7000-8000-00000000dead",
          createdById: OTHER_USER_ID,
        },
      },
      context(),
    );

    expect(outcome.ok).toBe(true);
    const call = updateCall(repository);
    expect(call.version).toBe(1);
    for (const forbidden of [
      "visibility",
      "showExactPhotoLocation",
      "status",
      "favorite",
      "workspaceId",
      "createdById",
    ]) {
      expect(call.data).not.toHaveProperty(forbidden);
    }
    // Stored privacy switches are untouched by an AI edit.
    expect(current().visibility).toBe("private");
    expect(current().showExactPhotoLocation).toBe(true);
    expect(current().status).toBe("planning");
  });

  it("requires at least one whitelisted field", async () => {
    const { toolbox, repository } = build();

    const outcome = await toolbox.execute(
      { tool: "trips.update", args: { tripId: TRIP_ID, showExactPhotoLocation: false } },
      context(),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error?.code).toBe("INVALID_ARGUMENTS");
    expect(repository.updateTrip).not.toHaveBeenCalled();
  });

  it("returns the product's own VALIDATION_ERROR for an inverted date range", async () => {
    const { toolbox, repository } = build();

    const thrown = await rejection(
      toolbox.execute(
        { tool: "trips.update", args: { tripId: TRIP_ID, startDate: "2026-12-10", endDate: "2026-12-01" } },
        context(),
      ),
    );

    expect(thrown.getStatus()).toBe(400);
    expect((thrown.getResponse() as { code?: string }).code).toBe("VALIDATION_ERROR");
    expect(repository.updateTrip).not.toHaveBeenCalled();
  });

  it("returns TRIP_NOT_FOUND for a trip the actor may not see, not a 500", async () => {
    const { toolbox, repository } = build({
      visibility: "private",
      createdById: OTHER_USER_ID,
    });

    const thrown = await rejection(
      toolbox.execute(
        { tool: "trips.update", args: { tripId: TRIP_ID, endDate: "2026-12-06" } },
        context("editor"),
      ),
    );

    expect(thrown).toBeInstanceOf(NotFoundException);
    expect(thrown.getStatus()).toBe(404);
    expect((thrown.getResponse() as { code?: string }).code).toBe("TRIP_NOT_FOUND");
    expect(repository.updateTrip).not.toHaveBeenCalled();
  });

  it("returns WORKSPACE_ROLE_FORBIDDEN for a viewer", async () => {
    const { toolbox, repository } = build();

    const thrown = await rejection(
      toolbox.execute(
        { tool: "trips.update", args: { tripId: TRIP_ID, endDate: "2026-12-06" } },
        context("viewer"),
      ),
    );

    expect(thrown.getStatus()).toBe(403);
    expect((thrown.getResponse() as { code?: string }).code).toBe("WORKSPACE_ROLE_FORBIDDEN");
    expect(repository.updateTrip).not.toHaveBeenCalled();
  });
});
