import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AdminWorkspacesService } from "../admin-workspaces.service.js";
import {
  NOW,
  USER_ADMIN_ID,
  USER_OWNER_ID,
  WORKSPACE_A_ID,
  makeActor,
} from "../../../../test/identity-fixtures.js";

function workspaceRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: WORKSPACE_A_ID,
    name: "Atlas Studio",
    slug: "atlas-studio",
    logoMediaId: null,
    ownerId: USER_OWNER_ID,
    plan: "free",
    status: "active",
    defaultCurrency: "CNY",
    timezone: "Asia/Shanghai",
    weekStartsOn: 1,
    settings: {},
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

describe("AdminWorkspacesService", () => {
  function setup() {
    const prisma = {
      client: {
        workspace: {
          findMany: vi.fn(),
          findUnique: vi.fn(),
          update: vi.fn(),
          count: vi.fn(),
        },
        workspaceMember: {
          count: vi.fn(),
          findFirst: vi.fn(),
          findMany: vi.fn(),
          update: vi.fn(),
          updateMany: vi.fn(),
          create: vi.fn(),
        },
        trip: { count: vi.fn() },
        journalEntry: { count: vi.fn() },
        media: {
          aggregate: vi.fn(),
          groupBy: vi.fn(),
        },
        invitation: { updateMany: vi.fn(), findMany: vi.fn() },
        user: { findUnique: vi.fn() },
        $transaction: vi.fn(),
      },
    };
    const audit = { record: vi.fn().mockResolvedValue({ id: "audit" }) };
    prisma.client.media.aggregate.mockResolvedValue({
      _sum: { size: null },
      _count: { _all: 0 },
    });
    prisma.client.media.groupBy.mockResolvedValue([]);
    prisma.client.workspaceMember.findMany.mockResolvedValue([]);
    prisma.client.invitation.findMany.mockResolvedValue([]);
    const service = new AdminWorkspacesService(prisma as never, audit as never);
    return { prisma, audit, service };
  }

  it("lets support suspend a Workspace and records an audit entry", async () => {
    const { prisma, audit, service } = setup();
    prisma.client.workspace.findUnique.mockResolvedValue(workspaceRecord());
    prisma.client.workspace.update.mockResolvedValue(workspaceRecord({ status: "suspended" }));
    prisma.client.workspaceMember.count.mockResolvedValue(2);
    prisma.client.trip.count.mockResolvedValue(1);
    prisma.client.journalEntry.count.mockResolvedValue(4);
    prisma.client.user.findUnique.mockResolvedValue({
      id: USER_OWNER_ID,
      name: "Owner",
      email: "owner@roamlog.test",
      image: null,
    });

    const result = await service.update(
      makeActor(USER_ADMIN_ID, { platformRole: "support" }),
      WORKSPACE_A_ID,
      { status: "suspended" },
    );

    expect(result.status).toBe("suspended");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.workspace.updated",
        targetType: "workspace",
        targetId: WORKSPACE_A_ID,
        workspaceId: WORKSPACE_A_ID,
      }),
    );
  });

  it("blocks support from deleting a Workspace", async () => {
    const { prisma, service } = setup();
    prisma.client.workspace.findUnique.mockResolvedValue(workspaceRecord());

    await expect(
      service.remove(
        makeActor(USER_ADMIN_ID, { platformRole: "support" }),
        WORKSPACE_A_ID,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("soft-deletes a Workspace and suspends members", async () => {
    const { prisma, audit, service } = setup();
    prisma.client.workspace.findUnique.mockResolvedValue(workspaceRecord());
    const tx = {
      workspace: {
        update: vi.fn().mockResolvedValue(workspaceRecord({ status: "deleted", deletedAt: NOW })),
      },
      workspaceMember: { updateMany: vi.fn() },
      invitation: { updateMany: vi.fn() },
    };
    prisma.client.$transaction.mockImplementation(async (callback: (value: unknown) => unknown) =>
      callback(tx),
    );

    const result = await service.remove(
      makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
      WORKSPACE_A_ID,
    );

    expect(result.message).toMatch(/deleted/i);
    expect(tx.workspaceMember.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_A_ID, status: "active" },
      data: { status: "suspended" },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.workspace.deleted" }),
      tx,
    );
  });

  it("transfers ownership transactionally when an admin changes ownerId", async () => {
    const { prisma, service } = setup();
    prisma.client.workspace.findUnique.mockResolvedValue(workspaceRecord());
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: USER_ADMIN_ID,
          status: "active",
          deletedAt: null,
        }),
      },
      workspaceMember: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: "member-owner", role: "owner" })
          .mockResolvedValueOnce({ id: "member-target", role: "editor" }),
        update: vi.fn(),
      },
      workspace: {
        update: vi.fn().mockResolvedValue(workspaceRecord({ ownerId: USER_ADMIN_ID })),
      },
    };
    prisma.client.$transaction.mockImplementation(async (callback: (value: unknown) => unknown) =>
      callback(tx),
    );
    prisma.client.workspaceMember.count.mockResolvedValue(2);
    prisma.client.trip.count.mockResolvedValue(0);
    prisma.client.journalEntry.count.mockResolvedValue(0);
    prisma.client.user.findUnique.mockResolvedValue({
      id: USER_ADMIN_ID,
      name: "Admin",
      email: "admin@roamlog.test",
      image: null,
    });

    const result = await service.update(
      makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
      WORKSPACE_A_ID,
      { ownerId: USER_ADMIN_ID },
    );

    expect(result.ownerId).toBe(USER_ADMIN_ID);
    expect(tx.workspaceMember.update).toHaveBeenCalledTimes(2);
  });

  it("returns 404 for a missing Workspace", async () => {
    const { prisma, service } = setup();
    prisma.client.workspace.findUnique.mockResolvedValue(null);

    await expect(
      service.get(makeActor(USER_ADMIN_ID, { platformRole: "support" }), WORKSPACE_A_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns list metrics and forwards search, plan and pagination parameters", async () => {
    const { prisma, service } = setup();
    prisma.client.workspace.findMany.mockResolvedValue([
      {
        ...workspaceRecord(),
        owner: {
          id: USER_OWNER_ID,
          name: "Owner",
          email: "owner@roamlog.test",
          image: null,
        },
        _count: { members: 2, trips: 3, journalEntries: 4, media: 5 },
      },
    ]);
    prisma.client.media.groupBy.mockResolvedValue([
      { workspaceId: WORKSPACE_A_ID, _sum: { size: 1024 } },
    ]);

    const page = await service.list(makeActor(USER_ADMIN_ID, { platformRole: "support" }), {
      q: "atlas",
      plan: "free",
      limit: 5,
    });

    expect(prisma.client.workspace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 6,
        where: {
          plan: "free",
          OR: [
            { name: { contains: "atlas", mode: "insensitive" } },
            { slug: { contains: "atlas", mode: "insensitive" } },
          ],
        },
        select: expect.objectContaining({
          owner: { select: { id: true, name: true, email: true, image: true } },
        }),
      }),
    );
    expect(page.items[0]).toMatchObject({
      memberCount: 2,
      tripCount: 3,
      entryCount: 4,
      mediaCount: 5,
      mediaBytes: 1024,
      owner: { name: "Owner" },
    });
  });

  it("returns cursor pagination boundaries for workspaces", async () => {
    const { prisma, service } = setup();
    const row = (id: string) => ({
      ...workspaceRecord({ id }),
      owner: { id: USER_OWNER_ID, name: "Owner", email: "owner@roamlog.test", image: null },
      _count: { members: 1, trips: 0, journalEntries: 0, media: 0 },
    });
    prisma.client.workspace.findMany
      .mockResolvedValueOnce([
        row("01942f30-1200-7000-8000-000000000101"),
        row("01942f30-1200-7000-8000-000000000102"),
        row("01942f30-1200-7000-8000-000000000103"),
      ])
      .mockResolvedValueOnce([row("01942f30-1200-7000-8000-000000000103")]);

    const first = await service.list(makeActor(USER_ADMIN_ID, { platformRole: "support" }), {
      limit: 2,
    });
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toEqual(expect.any(String));

    await service.list(makeActor(USER_ADMIN_ID, { platformRole: "support" }), {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(prisma.client.workspace.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        take: 3,
        cursor: { id: "01942f30-1200-7000-8000-000000000102" },
        skip: 1,
      }),
    );
  });

  it("rejects an unsupported plan with a validation error", async () => {
    const { service } = setup();

    await expect(
      service.list(makeActor(USER_ADMIN_ID, { platformRole: "support" }), { plan: "enterprise" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns members, invitations and media totals on the detail endpoint", async () => {
    const { prisma, service } = setup();
    prisma.client.workspace.findUnique.mockResolvedValue(workspaceRecord());
    prisma.client.workspaceMember.count.mockResolvedValue(2);
    prisma.client.trip.count.mockResolvedValue(1);
    prisma.client.journalEntry.count.mockResolvedValue(4);
    prisma.client.user.findUnique.mockResolvedValue({
      id: USER_OWNER_ID,
      name: "Owner",
      email: "owner@roamlog.test",
      image: null,
    });
    prisma.client.media.aggregate.mockResolvedValue({
      _sum: { size: 2048 },
      _count: { _all: 3 },
    });
    prisma.client.workspaceMember.findMany.mockResolvedValue([
      {
        role: "owner",
        status: "active",
        joinedAt: NOW,
        user: {
          id: USER_OWNER_ID,
          name: "Owner",
          email: "owner@roamlog.test",
          image: null,
        },
      },
    ]);
    prisma.client.invitation.findMany.mockResolvedValue([
      {
        id: "01942f30-1200-7000-8000-000000000801",
        workspaceId: WORKSPACE_A_ID,
        email: "invitee@roamlog.test",
        role: "viewer",
        invitedById: USER_OWNER_ID,
        expiresAt: NOW,
        acceptedAt: null,
        revokedAt: null,
        createdAt: NOW,
      },
    ]);

    const detail = await service.get(
      makeActor(USER_ADMIN_ID, { platformRole: "support" }),
      WORKSPACE_A_ID,
    );

    expect(detail).toMatchObject({ memberCount: 2, mediaCount: 3, mediaBytes: 2048 });
    expect(detail.members?.[0]).toMatchObject({ name: "Owner", role: "owner" });
    expect(detail.invitations?.[0]).toMatchObject({ email: "invitee@roamlog.test", role: "viewer" });
  });

  it("streams a filtered workspace CSV with real body counts", async () => {
    const { prisma, service } = setup();
    prisma.client.workspace.findMany.mockResolvedValue([
      {
        ...workspaceRecord(),
        owner: { id: USER_OWNER_ID, name: "Owner", email: "owner@roamlog.test", image: null },
        _count: { members: 2, trips: 3, journalEntries: 4, media: 5 },
      },
    ]);
    prisma.client.media.groupBy.mockResolvedValue([
      { workspaceId: WORKSPACE_A_ID, _sum: { size: 4096 } },
    ]);

    const chunks: string[] = [];
    for await (const chunk of service.exportCsv(
      makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
      { q: "atlas" },
    )) {
      chunks.push(chunk);
    }

    const csv = chunks.join("");
    expect(csv.startsWith("\uFEFFid,name,slug,ownerId,plan,status,")).toBe(true);
    expect(csv).toContain('"Atlas Studio"');
    expect(csv).toContain('"4096"');
    expect(csv).toContain('"2"');
  });

  it("rejects workspace CSV export for support", async () => {
    const { service } = setup();

    await expect(
      (async () => {
        for await (const _chunk of service.exportCsv(
          makeActor(USER_ADMIN_ID, { platformRole: "support" }),
          {},
        )) {
          // The generator throws before yielding when the role is forbidden.
        }
      })(),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
