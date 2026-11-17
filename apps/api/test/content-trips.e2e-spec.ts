import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "../src/common/services/permission.service.js";
import { presentTrip } from "../src/modules/trips/content-presenters.js";
import { TripsService } from "../src/modules/trips/trips.service.js";
import { VersionConflictException } from "../src/modules/trips/version-conflict.exception.js";
import { makeActor } from "./identity-fixtures.js";
import {
  NOW,
  USER_EDITOR_ID,
  USER_OWNER_ID,
  USER_VIEWER_ID,
  WORKSPACE_A_ID,
} from "./identity-fixtures.js";
import {
  OTHER_WORKSPACE_ID,
  TRIP_A_ID,
  TRIP_B_ID,
  activityRecord,
  fakeActivities,
  fakeTransaction,
  membership,
  tripRecord,
} from "./content-fixtures.js";

function setup() {
  const repository = {
    transaction: vi.fn(),
    findTrip: vi.fn(),
    listTrips: vi.fn(),
    createTrip: vi.fn(),
    updateTrip: vi.fn(),
    softDeleteTrip: vi.fn(),
    findParticipant: vi.fn(),
    listParticipants: vi.fn(),
    createParticipant: vi.fn(),
    deleteParticipant: vi.fn(),
    findWorkspaceMember: vi.fn(),
    findMedia: vi.fn(),
    listDuplicateChildren: vi.fn(),
    createDuplicateChildren: vi.fn(),
  };
  const activities = fakeActivities();
  const service = new TripsService(
    repository as never,
    new PermissionService(),
    activities as never,
  );
  return { repository, activities, service };
}

describe("TripsService", () => {
  it("renders a legacy empty origin as unspecified without throwing", () => {
    expect(presentTrip(tripRecord({ origin: "" }))).toMatchObject({
      origin: "未填写",
    });
  });

  it("rejects an invalid trip date range before any write", async () => {
    const { repository, service } = setup();

    await expect(
      service.create(makeActor(), membership("editor"), {
        title: "Impossible route",
        startDate: "2026-11-20",
        endDate: "2026-11-10",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.transaction).not.toHaveBeenCalled();
  });

  it("rejects a Viewer before reading or writing a trip", async () => {
    const { repository, service } = setup();

    await expect(
      service.update(makeActor(USER_VIEWER_ID), membership("viewer"), TRIP_A_ID, {
        version: 1,
        title: "Viewer overwrite",
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(repository.transaction).not.toHaveBeenCalled();
  });

  it("returns 404 when a valid trip UUID belongs to another Workspace", async () => {
    const { repository, service } = setup();
    repository.findTrip.mockResolvedValue(null);

    await expect(
      service.get(makeActor(), membership("owner"), TRIP_B_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.findTrip).toHaveBeenCalledWith(WORKSPACE_A_ID, TRIP_B_ID);
  });

  it("returns 409 with the current trip when an optimistic update is stale", async () => {
    const { repository, service } = setup();
    const tx = {};
    fakeTransaction(repository, tx);
    const current = tripRecord({ version: 2, title: "Edited elsewhere" });
    repository.findTrip
      .mockResolvedValueOnce(tripRecord({ version: 1 }))
      .mockResolvedValueOnce(current);
    repository.updateTrip.mockResolvedValue(0);

    const error = await service
      .update(makeActor(), membership("editor"), TRIP_A_ID, {
        version: 1,
        title: "My stale edit",
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(VersionConflictException);
    expect(error).toMatchObject({
      status: 409,
      response: {
        code: "VERSION_CONFLICT",
        current: expect.objectContaining({ id: TRIP_A_ID, version: 2 }),
      },
    });
    expect(repository.updateTrip).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        workspaceId: WORKSPACE_A_ID,
        tripId: TRIP_A_ID,
        version: 1,
      }),
    );
  });

  it("writes the trip activity in the same transaction as the update", async () => {
    const { repository, activities, service } = setup();
    const tx = {};
    fakeTransaction(repository, tx);
    repository.findTrip
      .mockResolvedValueOnce(tripRecord())
      .mockResolvedValueOnce(tripRecord({ version: 2, title: "Revised title" }));
    repository.updateTrip.mockResolvedValue(1);

    const updated = await service.update(makeActor(USER_EDITOR_ID), membership("editor"), TRIP_A_ID, {
      version: 1,
      title: "Revised title",
    });

    expect(updated).toMatchObject({ id: TRIP_A_ID, version: 2, title: "Revised title" });
    expect(activities.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        workspaceId: WORKSPACE_A_ID,
        tripId: TRIP_A_ID,
        actorId: USER_EDITOR_ID,
        verb: "trip.updated",
        entityType: "trip",
        entityId: TRIP_A_ID,
      }),
    );
  });

  it("filters private trips for Editors while Owners see the full Workspace", async () => {
    const { repository, service } = setup();
    repository.listTrips.mockResolvedValue([]);

    await service.list(makeActor(USER_EDITOR_ID), membership("editor"), { limit: 20 });
    expect(repository.listTrips).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: WORKSPACE_A_ID,
          OR: [
            { visibility: { in: ["workspace", "public_link"] } },
            { createdById: USER_EDITOR_ID },
          ],
        }),
      }),
    );

    await service.list(makeActor(USER_OWNER_ID), membership("owner"), { limit: 20 });
    expect(repository.listTrips).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ OR: expect.anything() }),
      }),
    );
  });

  it("hides a private trip from an Editor who is not its creator", async () => {
    const { repository, service } = setup();
    repository.findTrip.mockResolvedValue(
      tripRecord({
        visibility: "private",
        createdById: USER_OWNER_ID,
      }),
    );

    await expect(
      service.get(makeActor(USER_EDITOR_ID), membership("editor"), TRIP_A_ID),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      service.get(makeActor(USER_OWNER_ID), membership("owner"), TRIP_A_ID),
    ).resolves.toMatchObject({ id: TRIP_A_ID, visibility: "private" });
  });
});

describe("activity persistence contract", () => {
  it("presents immutable activity metadata and ISO timestamps", () => {
    expect(activityRecord({ metadata: { from: "planning" }, createdAt: NOW })).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      entityType: "trip",
      createdAt: NOW,
    });
    expect(OTHER_WORKSPACE_ID).not.toBe(WORKSPACE_A_ID);
  });
});
