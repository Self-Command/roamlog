import { describe, expect, it, vi } from "vitest";
import { ConflictException, HttpException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";

import {
  NOW,
  USER_VIEWER_ID,
  WORKSPACE_A_ID,
} from "../../../../test/identity-fixtures.js";
import { ReportsService, REPORT_HOURLY_LIMIT } from "../reports.service.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import { makeActor } from "../../../../test/identity-fixtures.js";

const TRIP_ID = "01942f30-1200-7000-8000-000000000921";

function membership(role: WorkspaceMembershipAccess["role"] = "viewer"): WorkspaceMembershipAccess {
  return {
    id: "01942f30-1200-7000-8000-000000000922",
    workspaceId: WORKSPACE_A_ID,
    userId: USER_VIEWER_ID,
    role,
    status: "active",
    joinedAt: NOW,
    invitedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    workspaceName: "Studio",
  };
}

function setup() {
  const prisma = {
    client: {
      trip: { findFirst: vi.fn() },
      journalEntry: { findFirst: vi.fn() },
      comment: { findFirst: vi.fn() },
      media: { findFirst: vi.fn() },
      report: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn() },
    },
  };
  return { prisma, service: new ReportsService(prisma as never) };
}

describe("ReportsService.create", () => {
  it("lets a Viewer report visible workspace content", async () => {
    const { prisma, service } = setup();
    prisma.client.trip.findFirst.mockResolvedValue({ id: TRIP_ID });
    prisma.client.report.findFirst.mockResolvedValue(null);
    prisma.client.report.count.mockResolvedValue(0);
    prisma.client.report.create.mockResolvedValue({
      id: "01942f30-1200-7000-8000-000000000923",
      status: "open",
      createdAt: NOW,
    });

    const response = await service.create(
      makeActor(USER_VIEWER_ID),
      membership("viewer"),
      { targetType: "trip", targetId: TRIP_ID, reason: "spam", detail: "广告" },
    );

    expect(response).toEqual({
      id: "01942f30-1200-7000-8000-000000000923",
      status: "open",
      createdAt: NOW.toISOString(),
    });
    expect(prisma.client.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: WORKSPACE_A_ID,
          targetType: "trip",
          targetId: TRIP_ID,
          reporterId: USER_VIEWER_ID,
          reason: "spam",
          detail: "广告",
        }),
      }),
    );
  });

  it("returns 404 REPORT_TARGET_NOT_FOUND for content the member cannot see", async () => {
    const { prisma, service } = setup();
    prisma.client.trip.findFirst.mockResolvedValue(null);

    await expect(
      service.create(makeActor(USER_VIEWER_ID), membership(), {
        targetType: "trip",
        targetId: TRIP_ID,
        reason: "spam",
      }),
    ).rejects.toMatchObject({ status: 404, response: { code: "REPORT_TARGET_NOT_FOUND" } });
    expect(prisma.client.report.create).not.toHaveBeenCalled();
  });

  it("returns 409 REPORT_DUPLICATE when the same user reports the same target twice", async () => {
    const { prisma, service } = setup();
    prisma.client.trip.findFirst.mockResolvedValue({ id: TRIP_ID });
    prisma.client.report.findFirst.mockResolvedValue({ id: "existing" });

    await expect(
      service.create(makeActor(USER_VIEWER_ID), membership(), {
        targetType: "trip",
        targetId: TRIP_ID,
        reason: "harassment",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.create(makeActor(USER_VIEWER_ID), membership(), {
        targetType: "trip",
        targetId: TRIP_ID,
        reason: "harassment",
      }),
    ).rejects.toMatchObject({ response: { code: "REPORT_DUPLICATE" } });
  });

  it("returns 429 after the hourly budget is exhausted", async () => {
    const { prisma, service } = setup();
    prisma.client.trip.findFirst.mockResolvedValue({ id: TRIP_ID });
    prisma.client.report.findFirst.mockResolvedValue(null);
    prisma.client.report.count.mockResolvedValue(REPORT_HOURLY_LIMIT);

    const failure = service.create(makeActor(USER_VIEWER_ID), membership(), {
      targetType: "trip",
      targetId: TRIP_ID,
      reason: "spam",
    });

    await expect(failure).rejects.toBeInstanceOf(HttpException);
    await expect(failure).rejects.toMatchObject({ status: 429, response: { code: "RATE_LIMITED" } });
    expect(prisma.client.report.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ reporterId: USER_VIEWER_ID }) }),
    );
  });

  it("returns 422 REPORT_REASON_INVALID for an unknown reason", async () => {
    const { prisma, service } = setup();

    await expect(
      service.create(makeActor(USER_VIEWER_ID), membership(), {
        targetType: "trip",
        targetId: TRIP_ID,
        reason: "copyright",
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.create(makeActor(USER_VIEWER_ID), membership(), {
        targetType: "trip",
        targetId: TRIP_ID,
        reason: "copyright",
      }),
    ).rejects.toMatchObject({ response: { code: "REPORT_REASON_INVALID" } });
    expect(prisma.client.trip.findFirst).not.toHaveBeenCalled();
  });

  it("keeps the target probe opaque: unknown target types are validation errors", async () => {
    const { service } = setup();
    await expect(
      service.create(makeActor(USER_VIEWER_ID), membership(), {
        targetType: "workspace",
        targetId: TRIP_ID,
        reason: "spam",
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(NotFoundException).toBeDefined();
  });
});