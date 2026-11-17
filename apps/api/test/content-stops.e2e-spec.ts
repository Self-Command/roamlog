import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "../src/common/services/permission.service.js";
import { StopsService } from "../src/modules/trips/stops.service.js";
import { makeActor } from "./identity-fixtures.js";
import { USER_EDITOR_ID } from "./identity-fixtures.js";
import {
  STOP_ID,
  TRIP_A_ID,
  fakeActivities,
  fakeTransaction,
  membership,
  stopRecord,
  tripRecord,
} from "./content-fixtures.js";

function setup() {
  const repository = {
    transaction: vi.fn(),
    findTrip: vi.fn(),
    listStops: vi.fn(),
    findStop: vi.fn(),
    maxOrder: vi.fn(),
    createStop: vi.fn(),
    updateStop: vi.fn(),
    softDeleteStop: vi.fn(),
    findStopsByIds: vi.fn(),
    setOrders: vi.fn(),
  };
  const activities = fakeActivities();
  const service = new StopsService(
    repository as never,
    new PermissionService(),
    activities as never,
  );
  return { repository, activities, service };
}

describe("StopsService date invariants", () => {
  it("rejects a stop spanning dates outside the parent trip", async () => {
    const { repository, service } = setup();
    const tx = {};
    fakeTransaction(repository, tx);
    repository.findTrip.mockResolvedValue(tripRecord());

    await expect(
      service.create(makeActor(USER_EDITOR_ID), membership("editor"), TRIP_A_ID, {
        city: "Busan",
        country: "South Korea",
        countryCode: "KR",
        startDate: "2026-11-17",
        endDate: "2026-11-22",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createStop).not.toHaveBeenCalled();
  });

  it("rejects an inverted stop date range before opening a transaction", async () => {
    const { repository, service } = setup();

    await expect(
      service.create(makeActor(USER_EDITOR_ID), membership("editor"), TRIP_A_ID, {
        city: "Busan",
        country: "South Korea",
        countryCode: "KR",
        startDate: "2026-11-15",
        endDate: "2026-11-12",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.transaction).not.toHaveBeenCalled();
  });

  it("returns 409 with the current stop for a stale update", async () => {
    const { repository, service } = setup();
    const tx = {};
    fakeTransaction(repository, tx);
    repository.findStop
      .mockResolvedValueOnce(stopRecord({ version: 1 }))
      .mockResolvedValueOnce(stopRecord({ version: 2, city: "Busan" }));
    repository.findTrip.mockResolvedValue(tripRecord());
    repository.updateStop.mockResolvedValue(0);

    await expect(
      service.update(makeActor(USER_EDITOR_ID), membership("editor"), STOP_ID, {
        version: 1,
        city: "Seoul Station",
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: "VERSION_CONFLICT",
        current: expect.objectContaining({ id: STOP_ID, version: 2 }),
      },
    });
  });
});
