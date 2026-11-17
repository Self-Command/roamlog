import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";

import { AdminContentService } from "../admin-content.service.js";
import { AdminMediaService } from "../admin-media.service.js";
import {
  NOW,
  USER_ADMIN_ID,
  USER_OWNER_ID,
  WORKSPACE_A_ID,
  WORKSPACE_B_ID,
  makeActor,
} from "../../../../test/identity-fixtures.js";

function tripRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "01942f30-1200-7000-8000-000000000701",
    workspaceId: WORKSPACE_A_ID,
    title: "Kyoto in November",
    summary: "A slow week",
    status: "planning",
    startDate: new Date("2026-11-01T00:00:00.000Z"),
    endDate: new Date("2026-11-07T00:00:00.000Z"),
    coverMediaId: null,
    origin: "Shanghai",
    destinations: ["Kyoto"],
    countryCodes: ["JP"],
    tags: [],
    guestNames: [],
    budgetAmountMinor: null,
    budgetCurrency: null,
    visibility: "workspace",
    favorite: false,
    version: 1,
    createdById: USER_OWNER_ID,
    updatedById: USER_OWNER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function mediaRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "01942f30-1200-7000-8000-000000000801",
    workspaceId: WORKSPACE_A_ID,
    tripId: null,
    uploaderId: USER_OWNER_ID,
    bucket: "roamlog-test",
    key: "workspaces/a/photo.jpg",
    mimeType: "image/jpeg",
    size: 1024,
    width: 100,
    height: 100,
    blurhash: null,
    variants: {},
    status: "ready",
    error: null,
    caption: null,
    date: null,
    location: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

describe("AdminContentService", () => {
  function setup() {
    const prisma = {
      client: {
        trip: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
        journalEntry: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
        comment: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      },
    };
    const audit = { record: vi.fn().mockResolvedValue({ id: "audit" }) };
    const service = new AdminContentService(prisma as never, audit as never);
    return { prisma, audit, service };
  }

  it("scopes trip moderation to the requested Workspace", async () => {
    const { prisma, service } = setup();
    prisma.client.trip.findMany.mockResolvedValue([]);

    await service.listTrips(
      makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
      { workspaceId: WORKSPACE_A_ID, limit: "20" },
    );

    const query = prisma.client.trip.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(query.where.workspaceId).toBe(WORKSPACE_A_ID);
    expect(query.where.workspaceId).not.toBe(WORKSPACE_B_ID);
  });

  it("soft-deletes a trip and writes an audit entry", async () => {
    const { prisma, audit, service } = setup();
    prisma.client.trip.findUnique.mockResolvedValue(tripRecord());
    prisma.client.trip.update.mockResolvedValue(tripRecord({ deletedAt: NOW }));

    const result = await service.remove(
      makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
      "trip",
      tripRecord().id,
    );

    expect(result.message).toMatch(/deleted/i);
    expect(prisma.client.trip.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: tripRecord().id },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.content.deleted",
        targetType: "trip",
        targetId: tripRecord().id,
        workspaceId: WORKSPACE_A_ID,
      }),
    );
  });

  it("restores a soft-deleted journal entry", async () => {
    const { prisma, service } = setup();
    const id = "01942f30-1200-7000-8000-000000000702";
    prisma.client.journalEntry.findUnique.mockResolvedValue({
      id,
      workspaceId: WORKSPACE_A_ID,
      deletedAt: NOW,
    });
    prisma.client.journalEntry.update.mockResolvedValue({});

    const result = await service.restore(
      makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
      "entry",
      id,
    );

    expect(result.message).toMatch(/restored/i);
    expect(prisma.client.journalEntry.update).toHaveBeenCalledWith({
      where: { id },
      data: { deletedAt: null },
    });
  });

  it("returns 404 for missing content", async () => {
    const { prisma, service } = setup();
    prisma.client.comment.findUnique.mockResolvedValue(null);

    await expect(
      service.remove(
        makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
        "comment",
        "01942f30-1200-7000-8000-000000000703",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("AdminMediaService", () => {
  function setup() {
    const prisma = {
      client: {
        media: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      },
    };
    const audit = { record: vi.fn().mockResolvedValue({ id: "audit" }) };
    const service = new AdminMediaService(prisma as never, audit as never);
    return { prisma, audit, service };
  }

  it("lists media filtered by Workspace and status", async () => {
    const { prisma, service } = setup();
    prisma.client.media.findMany.mockResolvedValue([]);

    await service.list(makeActor(USER_ADMIN_ID, { platformRole: "admin" }), {
      workspaceId: WORKSPACE_A_ID,
      status: "ready",
    });

    const query = prisma.client.media.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(query.where).toMatchObject({ workspaceId: WORKSPACE_A_ID, status: "ready" });
  });

  it("soft-deletes media and audits the target", async () => {
    const { prisma, audit, service } = setup();
    prisma.client.media.findUnique.mockResolvedValue(mediaRecord());
    prisma.client.media.update.mockResolvedValue(mediaRecord({ deletedAt: NOW }));

    const result = await service.remove(
      makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
      mediaRecord().id,
    );

    expect(result.message).toMatch(/deleted/i);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.media.deleted",
        targetType: "media",
        targetId: mediaRecord().id,
        workspaceId: WORKSPACE_A_ID,
      }),
    );
  });
});
