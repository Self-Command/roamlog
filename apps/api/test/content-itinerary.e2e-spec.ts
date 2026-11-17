import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "../src/common/services/permission.service.js";
import { ItineraryService } from "../src/modules/itinerary/itinerary.service.js";
import { makeActor } from "./identity-fixtures.js";
import { USER_EDITOR_ID, WORKSPACE_A_ID } from "./identity-fixtures.js";
import {
  ITINERARY_ID,
  TRIP_A_ID,
  fakeActivities,
  fakeTransaction,
  itineraryRecord,
  membership,
  tripRecord,
} from "./content-fixtures.js";

function setup() {
  const repository = {
    transaction: vi.fn(),
    listItems: vi.fn(),
    findItem: vi.fn(),
    findItemsByIds: vi.fn(),
    createItem: vi.fn(),
    updateItem: vi.fn(),
    setOrders: vi.fn(),
    softDeleteItem: vi.fn(),
  };
  const trips = { findTrip: vi.fn() };
  const activities = fakeActivities();
  const service = new ItineraryService(
    repository as never,
    trips as never,
    new PermissionService(),
    activities as never,
  );
  return { repository, trips, activities, service };
}

describe("ItineraryService", () => {
  it("rejects an invalid wall-clock time range before writing", async () => {
    const { service } = setup();

    await expect(
      service.create(makeActor(), membership("editor"), TRIP_A_ID, {
        date: "2026-11-11",
        startTime: "18:00",
        endTime: "09:00",
        title: "Impossible dinner",
        type: "food",
        location: "Seoul",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("reorders only items in the trip and writes one activity in the same transaction", async () => {
    const { repository, trips, activities, service } = setup();
    const tx = {};
    fakeTransaction(repository, tx);
    trips.findTrip.mockResolvedValue(tripRecord());
    repository.findItemsByIds.mockResolvedValue([
      itineraryRecord({ id: ITINERARY_ID, order: 0 }),
    ]);
    repository.setOrders.mockResolvedValue([
      itineraryRecord({ id: ITINERARY_ID, order: 1 }),
    ]);

    const result = await service.reorder(makeActor(USER_EDITOR_ID), membership("editor"), TRIP_A_ID, {
      items: [{ id: ITINERARY_ID, order: 1 }],
    });

    expect(result).toHaveLength(1);
    expect(repository.findItemsByIds).toHaveBeenCalledWith(
      tx,
      WORKSPACE_A_ID,
      TRIP_A_ID,
      [ITINERARY_ID],
    );
    expect(repository.setOrders).toHaveBeenCalledWith(
      tx,
      WORKSPACE_A_ID,
      TRIP_A_ID,
      [{ id: ITINERARY_ID, order: 1 }],
    );
    expect(activities.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        verb: "itinerary.reordered",
        entityId: TRIP_A_ID,
        actorId: USER_EDITOR_ID,
      }),
    );
  });

  it("rejects reorder payloads that contain a foreign or deleted item", async () => {
    const { repository, trips, service } = setup();
    const tx = {};
    fakeTransaction(repository, tx);
    trips.findTrip.mockResolvedValue(tripRecord());
    repository.findItemsByIds.mockResolvedValue([]);

    await expect(
      service.reorder(makeActor(), membership("editor"), TRIP_A_ID, {
        items: [{ id: ITINERARY_ID, order: 0 }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.setOrders).not.toHaveBeenCalled();
  });

  it("rejects an itinerary date outside the trip", async () => {
    const { repository, trips, service } = setup();
    trips.findTrip.mockResolvedValue(tripRecord());

    await expect(
      service.create(makeActor(), membership("editor"), TRIP_A_ID, {
        date: "2026-11-30",
        title: "After the trip",
        type: "note",
        location: "Seoul",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.transaction).not.toHaveBeenCalled();
  });
});
