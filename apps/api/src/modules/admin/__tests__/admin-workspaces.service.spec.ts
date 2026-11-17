import { ForbiddenException, NotFoundException } from "@nestjs/common";
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
          update: vi.fn(),
          updateMany: vi.fn(),
          create: vi.fn(),
        },
        trip: { count: vi.fn() },
        journalEntry: { count: vi.fn() },
        invitation: { updateMany: vi.fn() },
        user: { findUnique: vi.fn() },
        $transaction: vi.fn(),
      },
    };
    const audit = { record: vi.fn().mockResolvedValue({ id: "audit" }) };
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
});
