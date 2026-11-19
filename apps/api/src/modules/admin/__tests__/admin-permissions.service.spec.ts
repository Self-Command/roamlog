import { ForbiddenException, UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import {
  ADMIN_ACTION_DESCRIPTIONS,
  ADMIN_ACTIONS,
  PLATFORM_ROLE_ACTIONS,
} from "@roamlog/contracts";

import { AdminPermissionsService, mergePermissionMatrix } from "../admin-permissions.service.js";
import { makeActor } from "../../../../test/identity-fixtures.js";

const SUPER_ADMIN_ID = "01942f30-1200-7000-8000-0000000000a1";

function setup(overrides: Array<{ role: string; action: string; granted: boolean }> = []) {
  const prisma = {
    client: {
      platformRoleOverride: {
        findMany: vi.fn().mockResolvedValue(overrides),
        upsert: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: vi.fn(),
    },
  };
  const audit = { record: vi.fn().mockResolvedValue({ id: "audit" }) };
  const service = new AdminPermissionsService(prisma as never, audit as never);
  return { prisma, audit, service };
}

function allowTransaction(prisma: ReturnType<typeof setup>["prisma"]) {
  const transaction = {
    platformRoleOverride: {
      upsert: prisma.client.platformRoleOverride.upsert,
      deleteMany: prisma.client.platformRoleOverride.deleteMany,
    },
  };
  prisma.client.$transaction.mockImplementation(
    async (callback: (value: unknown) => unknown) => callback(transaction),
  );
  return transaction;
}

function actor(role: "user" | "support" | "analyst" | "admin" | "super_admin" = "super_admin") {
  return makeActor(SUPER_ADMIN_ID, { platformRole: role });
}

describe("AdminPermissionsService", () => {
  it("derives the read-only matrix directly from the code constants", async () => {
    const { service } = setup();
    const matrix = await service.get(actor());

    expect(matrix.roles.map((entry) => entry.role)).toEqual([
      "user",
      "support",
      "analyst",
      "admin",
      "super_admin",
    ]);
    expect(matrix.actions.map((entry) => entry.action)).toEqual([...ADMIN_ACTIONS]);
    for (const role of matrix.roles) {
      expect(role.actions).toEqual(PLATFORM_ROLE_ACTIONS[role.role]);
    }
    for (const action of matrix.actions) {
      expect(action.description).toBe(
        ADMIN_ACTION_DESCRIPTIONS[action.action as keyof typeof ADMIN_ACTION_DESCRIPTIONS],
      );
    }
  });

  it("marks every security-sensitive action as not grantable", async () => {
    const { service } = setup();
    const matrix = await service.get(actor());
    const byAction = new Map(matrix.actions.map((entry) => [entry.action, entry]));

    for (const action of [
      "admin:users:delete",
      "admin:users:change-role",
      "admin:users:reset-2fa",
      "admin:users:update",
      "admin:settings:write",
      "admin:permissions:read",
      "admin:permissions:write",
    ]) {
      expect(byAction.get(action as (typeof ADMIN_ACTIONS)[number])?.grantable).toBe(false);
    }
    expect(byAction.get("admin:users:read")?.grantable).toBe(true);
    expect(byAction.get("admin:flags:update")?.grantable).toBe(true);
  });

  it("merges grants and revocations from the override table on top of the code matrix", async () => {
    const matrix = mergePermissionMatrix([
      { role: "support", action: "admin:flags:read", granted: true },
      { role: "admin", action: "admin:users:read", granted: false },
      // Stale rows for unknown actions or roles are ignored instead of failing.
      { role: "support", action: "admin:not-real", granted: true },
      { role: "intruder", action: "admin:metrics:read", granted: true },
    ]);

    expect(matrix.roles.find((entry) => entry.role === "support")?.actions).toContain(
      "admin:flags:read",
    );
    expect(matrix.roles.find((entry) => entry.role === "admin")?.actions).not.toContain(
      "admin:users:read",
    );
    expect(matrix.roles.find((entry) => entry.role === "admin")?.actions).toContain(
      "admin:metrics:read",
    );
  });

  it("rejects security-sensitive changes with 422 PERMISSION_NOT_GRANTABLE", async () => {
    const { prisma, service } = setup();
    allowTransaction(prisma);

    await expect(
      service.update(actor(), {
        changes: [{ role: "admin", action: "admin:users:delete", granted: true }],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "PERMISSION_NOT_GRANTABLE" }),
    });
    expect(prisma.client.$transaction).not.toHaveBeenCalled();

    await expect(
      service.update(actor(), {
        changes: [{ role: "admin", action: "admin:users:update", granted: true }],
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("stores only the diff and drops rows that match the code default", async () => {
    const { prisma, audit, service } = setup();
    const transaction = allowTransaction(prisma);

    await service.update(actor(), {
      changes: [
        // code default grants it, so this must be stored as an override
        { role: "support", action: "admin:users:read", granted: false },
        // code default already grants it, so this is a no-op row removal
        { role: "super_admin", action: "admin:users:read", granted: true },
      ],
    });

    expect(transaction.platformRoleOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role_action: { role: "support", action: "admin:users:read" } },
        create: expect.objectContaining({ granted: false, updatedById: SUPER_ADMIN_ID }),
      }),
    );
    expect(transaction.platformRoleOverride.deleteMany).toHaveBeenCalledWith({
      where: { role: "super_admin", action: "admin:users:read" },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.permissions.updated",
        metadata: expect.objectContaining({
          changeCount: 2,
          changedActions: expect.arrayContaining([
            "support:admin:users:read:false",
            "super_admin:admin:users:read:true",
          ]),
        }),
      }),
      expect.anything(),
    );
  });

  it("re-reads the merged matrix after a successful save", async () => {
    const { prisma, service } = setup([
      { role: "support", action: "admin:flags:update", granted: true },
    ]);
    allowTransaction(prisma);

    const matrix = await service.update(actor(), {
      changes: [{ role: "support", action: "admin:flags:update", granted: true }],
    });

    expect(prisma.client.platformRoleOverride.findMany).toHaveBeenCalledTimes(1);
    expect(matrix.roles.find((entry) => entry.role === "support")?.actions).toContain(
      "admin:flags:update",
    );
  });

  it("requires the platform permission actions and keeps them super_admin-only", async () => {
    const { service } = setup();
    await expect(service.get(actor("admin"))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.update(actor("support"), {
        changes: [{ role: "support", action: "admin:flags:read", granted: true }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});