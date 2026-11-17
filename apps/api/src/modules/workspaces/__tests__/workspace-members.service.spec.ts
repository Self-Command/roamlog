import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceMembersService } from "../workspace-members.service.js";
import { WorkspaceOwnershipService } from "../workspace-ownership.service.js";
import {
  NOW,
  USER_ADMIN_ID,
  USER_OWNER_ID,
  USER_VIEWER_ID,
  WORKSPACE_A_ID,
  makeActor,
} from "../../../../test/identity-fixtures.js";

function memberRecord(role: "owner" | "admin" | "editor" | "viewer", userId = USER_OWNER_ID) {
  return {
    id: `01942f30-1200-7000-8000-00000000020${role === "owner" ? "1" : "4"}`,
    workspaceId: WORKSPACE_A_ID,
    userId,
    role,
    status: "active",
    joinedAt: NOW,
    invitedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    user: {
      id: userId,
      email: "member@roamlog.test",
      emailVerified: true,
      name: "Member",
      image: null,
      platformRole: "user",
      status: "active",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      lastActiveAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    },
  };
}

describe("WorkspaceMembersService", () => {
  function setup() {
    const prisma = {
      client: {
        workspace: {
          findUnique: vi.fn(),
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        workspaceMember: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        },
        trip: {
          count: vi.fn().mockResolvedValue(0),
        },
        $transaction: vi.fn(),
        $queryRaw: vi.fn(),
      },
    };
    const access = { requireMembership: vi.fn() };
    const audit = { record: vi.fn().mockResolvedValue({ id: "audit" }) };
    const service = new WorkspaceMembersService(prisma as never, access as never, audit as never);
    const ownership = new WorkspaceOwnershipService(
      prisma as never,
      access as never,
      audit as never,
    );
    return { prisma, access, audit, service, ownership };
  }

  it("rejects Admin when it attempts to change the Owner", async () => {
    const { prisma, access, service } = setup();
    access.requireMembership.mockResolvedValue({
      ...memberRecord("admin", USER_ADMIN_ID),
      user: undefined,
    });
    prisma.client.workspaceMember.findFirst.mockResolvedValue(memberRecord("owner"));

    await expect(
      service.update(makeActor(USER_ADMIN_ID), WORKSPACE_A_ID, memberRecord("owner").id, {
        role: "viewer",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows Owner to demote an Admin to Editor", async () => {
    const { prisma, access, service } = setup();
    const owner = memberRecord("owner", USER_OWNER_ID);
    delete (owner as { user?: unknown }).user;
    access.requireMembership.mockResolvedValue(owner);
    const admin = memberRecord("admin", USER_ADMIN_ID);
    prisma.client.workspaceMember.findFirst.mockResolvedValue(admin);
    const update = vi.fn().mockResolvedValue({ ...admin, role: "editor" });
    prisma.client.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        workspaceMember: { update },
      }),
    );

    const result = await service.update(makeActor(), WORKSPACE_A_ID, admin.id, {
      role: "editor",
    });

    expect(result.role).toBe("editor");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: admin.id },
        data: { role: "editor" },
      }),
    );
  });

  it("does not allow an Admin to grant the Admin role", async () => {
    const { prisma, access, service } = setup();
    const admin = memberRecord("admin", USER_ADMIN_ID);
    delete (admin as { user?: unknown }).user;
    access.requireMembership.mockResolvedValue(admin);
    prisma.client.workspaceMember.findFirst.mockResolvedValue(
      memberRecord("editor", USER_VIEWER_ID),
    );

    await expect(
      service.update(makeActor(USER_ADMIN_ID), WORKSPACE_A_ID, memberRecord("editor").id, {
        role: "admin",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
  });

  it("allows an Owner to suspend an Editor", async () => {
    const { prisma, access, service } = setup();
    const owner = memberRecord("owner", USER_OWNER_ID);
    delete (owner as { user?: unknown }).user;
    access.requireMembership.mockResolvedValue(owner);
    const editor = memberRecord("editor", USER_VIEWER_ID);
    prisma.client.workspaceMember.findFirst.mockResolvedValue(editor);
    const update = vi.fn().mockResolvedValue({ ...editor, status: "suspended" });
    prisma.client.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({ workspaceMember: { update } }),
    );

    const result = await service.update(makeActor(), WORKSPACE_A_ID, editor.id, {
      status: "suspended",
    });

    expect(result.status).toBe("suspended");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "suspended" } }));
  });

  it("rejects removing the Owner member, preserving the one-owner invariant", async () => {
    const { prisma, access, service } = setup();
    const owner = memberRecord("owner");
    delete (owner as { user?: unknown }).user;
    access.requireMembership.mockResolvedValue(owner);
    prisma.client.workspaceMember.findFirst.mockResolvedValue(memberRecord("owner"));

    await expect(
      service.remove(makeActor(), WORKSPACE_A_ID, memberRecord("owner").id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.client.workspaceMember.delete).not.toHaveBeenCalled();
  });

  it("rejects an Admin transferring ownership", async () => {
    const { prisma, access, ownership } = setup();
    const admin = memberRecord("admin", USER_ADMIN_ID);
    delete (admin as { user?: unknown }).user;
    access.requireMembership.mockResolvedValue(admin);

    await expect(
      ownership.transferOwnership(makeActor(USER_ADMIN_ID), WORKSPACE_A_ID, USER_VIEWER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
  });

  it("allows an Owner to remove an Editor while retaining authored content", async () => {
    const { prisma, access, service } = setup();
    const owner = memberRecord("owner", USER_OWNER_ID);
    delete (owner as { user?: unknown }).user;
    access.requireMembership.mockResolvedValue(owner);
    const editor = memberRecord("editor", USER_VIEWER_ID);
    prisma.client.workspaceMember.findFirst.mockResolvedValue(editor);
    prisma.client.trip.count.mockResolvedValue(0);
    const remove = vi.fn().mockResolvedValue(editor);
    prisma.client.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({ workspaceMember: { delete: remove } }),
    );

    const result = await service.remove(makeActor(), WORKSPACE_A_ID, editor.id);

    expect(result.message).toBe("Member removed.");
    expect(remove).toHaveBeenCalledWith({ where: { id: editor.id } });
  });

  it("transfers ownership atomically: demote old Owner, promote target, then update ownerId", async () => {
    const { prisma, access, ownership } = setup();
    const ownerMembership = memberRecord("owner", USER_OWNER_ID);
    delete (ownerMembership as { user?: unknown }).user;
    access.requireMembership.mockResolvedValue(ownerMembership);
    const targetMembership = memberRecord("editor", USER_VIEWER_ID);
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ ownerId: USER_OWNER_ID }]),
      workspaceMember: {
        findFirst: vi.fn().mockResolvedValue(targetMembership),
        update: vi.fn().mockResolvedValue({ ...targetMembership, role: "owner" }),
      },
      workspace: {
        findUnique: vi.fn().mockResolvedValue({
          id: WORKSPACE_A_ID,
          ownerId: USER_OWNER_ID,
          status: "active",
          deletedAt: null,
        }),
        update: vi.fn().mockResolvedValue({
          id: WORKSPACE_A_ID,
          name: "Atlas Studio",
          slug: "atlas-studio",
          logoMediaId: null,
          ownerId: USER_VIEWER_ID,
          plan: "team",
          status: "active",
          defaultCurrency: "CNY",
          timezone: "Asia/Shanghai",
          weekStartsOn: 1,
          settings: {},
          createdAt: NOW,
          updatedAt: NOW,
          deletedAt: null,
        }),
      },
    };
    prisma.client.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    );

    const result = await ownership.transferOwnership(makeActor(), WORKSPACE_A_ID, USER_VIEWER_ID);

    expect(result.ownerId).toBe(USER_VIEWER_ID);
    expect(tx.workspaceMember.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: ownerMembership.id },
        data: { role: "admin" },
      }),
    );
    expect(tx.workspaceMember.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: targetMembership.id },
        data: { role: "owner" },
      }),
    );
    expect(tx.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WORKSPACE_A_ID },
        data: { ownerId: USER_VIEWER_ID },
      }),
    );
  });
});
