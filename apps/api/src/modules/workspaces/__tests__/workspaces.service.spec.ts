import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { WorkspacesService } from "../workspaces.service.js";
import {
  NOW,
  USER_OWNER_ID,
  USER_VIEWER_ID,
  WORKSPACE_A_ID,
  WORKSPACE_B_ID,
  makeActor,
} from "../../../../test/identity-fixtures.js";

function workspaceRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: WORKSPACE_A_ID,
    name: "Atlas Studio",
    slug: "atlas-studio",
    logoMediaId: null,
    ownerId: USER_OWNER_ID,
    plan: "team",
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

describe("WorkspacesService", () => {
  function setup() {
    const prisma = {
      client: {
        workspace: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
          findUnique: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          count: vi.fn(),
        },
        workspaceMember: {
          create: vi.fn(),
          count: vi.fn(),
        },
        $transaction: vi.fn(),
      },
    };
    const access = {
      requireMembership: vi.fn(),
    };
    const audit = {
      record: vi.fn().mockResolvedValue({ id: "audit" }),
    };
    const service = new WorkspacesService(prisma as never, access as never, audit as never);
    return { prisma, access, audit, service };
  }

  it("lists only active Workspace memberships with the caller's role", async () => {
    const { prisma, service } = setup();
    prisma.client.workspace.findMany.mockResolvedValue([
      {
        ...workspaceRecord(),
        members: [{ role: "owner" }],
      },
    ]);

    const result = await service.list(makeActor());

    expect(result).toEqual([expect.objectContaining({ id: WORKSPACE_A_ID, role: "owner" })]);
    expect(prisma.client.workspace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "active",
          deletedAt: null,
          members: {
            some: expect.objectContaining({
              userId: USER_OWNER_ID,
              status: "active",
            }),
          },
        }),
      }),
    );
  });

  it("never returns an entity when the caller has no membership in the requested tenant", async () => {
    const { access, service } = setup();
    access.requireMembership.mockRejectedValue(
      new NotFoundException({ code: "WORKSPACE_NOT_FOUND", message: "Workspace not found" }),
    );

    await expect(service.get(makeActor(USER_VIEWER_ID), WORKSPACE_B_ID)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("requires a verified email before creating a Workspace", async () => {
    const { service } = setup();
    await expect(
      service.create(makeActor(USER_OWNER_ID, { emailVerified: false }), {
        name: "Atlas Studio",
        slug: "atlas-studio",
        defaultCurrency: "CNY",
        timezone: "Asia/Shanghai",
      }),
    ).rejects.toMatchObject({ status: 403, response: { code: "EMAIL_VERIFICATION_REQUIRED" } });
  });

  it("creates the Workspace and exactly one Owner membership in one transaction", async () => {
    const { prisma, service } = setup();
    const transaction = {
      workspace: {
        create: vi.fn().mockResolvedValue(workspaceRecord()),
      },
      workspaceMember: {
        create: vi.fn().mockResolvedValue({ id: "member" }),
      },
    };
    prisma.client.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(transaction),
    );

    const result = await service.create(makeActor(), {
      name: "Atlas Studio",
      slug: "atlas-studio",
      defaultCurrency: "CNY",
      timezone: "Asia/Shanghai",
    });

    expect(result).toMatchObject({ id: WORKSPACE_A_ID, ownerId: USER_OWNER_ID });
    expect(transaction.workspace.create).toHaveBeenCalledTimes(1);
    expect(transaction.workspaceMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: WORKSPACE_A_ID,
          userId: USER_OWNER_ID,
          role: "owner",
          status: "active",
        }),
      }),
    );
  });

  it("rejects duplicate slugs without leaking a database exception", async () => {
    const { prisma, service } = setup();
    const duplicate = Object.assign(new Error("duplicate"), { code: "P2002" });
    prisma.client.$transaction.mockRejectedValue(duplicate);

    await expect(
      service.create(makeActor(), {
        name: "Atlas Studio",
        slug: "atlas-studio",
        defaultCurrency: "CNY",
        timezone: "Asia/Shanghai",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("only the Owner may soft-delete the Workspace", async () => {
    const { prisma, access, service } = setup();
    access.requireMembership.mockResolvedValue({
      role: "admin",
      workspaceId: WORKSPACE_A_ID,
      userId: USER_OWNER_ID,
      status: "active",
    });

    await expect(service.remove(makeActor(), WORKSPACE_A_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.client.workspace.update).not.toHaveBeenCalled();
  });

  it("allows an Admin to update Workspace settings", async () => {
    const { prisma, access, service } = setup();
    access.requireMembership.mockResolvedValue({
      role: "admin",
      workspaceId: WORKSPACE_A_ID,
      userId: USER_OWNER_ID,
      status: "active",
    });
    const update = vi.fn().mockResolvedValue(workspaceRecord({ name: "Atlas Field Notes" }));
    prisma.client.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        workspace: { update },
      }),
    );

    const result = await service.update(makeActor(), WORKSPACE_A_ID, {
      name: "Atlas Field Notes",
    });

    expect(result.name).toBe("Atlas Field Notes");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WORKSPACE_A_ID },
        data: { name: "Atlas Field Notes" },
      }),
    );
  });

  it("soft-deletes a Workspace for its Owner", async () => {
    const { prisma, access, service } = setup();
    access.requireMembership.mockResolvedValue({
      role: "owner",
      workspaceId: WORKSPACE_A_ID,
      userId: USER_OWNER_ID,
      status: "active",
    });
    const update = vi
      .fn()
      .mockResolvedValue(workspaceRecord({ status: "deleted", deletedAt: NOW }));
    prisma.client.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        workspace: { update },
      }),
    );

    const result = await service.remove(makeActor(), WORKSPACE_A_ID);

    expect(result.message).toBe("Workspace deleted.");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WORKSPACE_A_ID },
        data: expect.objectContaining({
          status: "deleted",
          deletedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("onboards exactly one default Workspace and does not recreate it later", async () => {
    const { prisma, service } = setup();
    prisma.client.workspace.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: WORKSPACE_A_ID });
    const create = vi.fn().mockResolvedValue(workspaceRecord());
    const memberCreate = vi.fn().mockResolvedValue({ id: "member" });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      workspace: {
        findFirst: vi.fn().mockResolvedValue(null),
        create,
      },
      workspaceMember: { create: memberCreate },
    };
    prisma.client.$transaction.mockImplementation(async (callback: (value: unknown) => unknown) =>
      callback(tx),
    );

    const onboarded = await service.ensureDefaultWorkspace(makeActor());
    const repeated = await service.ensureDefaultWorkspace(makeActor());

    expect(onboarded).toMatchObject({ ownerId: USER_OWNER_ID });
    expect(repeated).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(memberCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "owner", status: "active" }),
      }),
    );
  });
});
