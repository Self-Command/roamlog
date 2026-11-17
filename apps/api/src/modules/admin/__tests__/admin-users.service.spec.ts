import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AdminUsersService } from "../admin-users.service.js";
import {
  NOW,
  USER_ADMIN_ID,
  USER_OWNER_ID,
  USER_VIEWER_ID,
  makeActor,
  makeUserRecord,
} from "../../../../test/identity-fixtures.js";

describe("AdminUsersService", () => {
  function setup() {
    const prisma = {
      client: {
        user: {
          findMany: vi.fn(),
          findUnique: vi.fn(),
          update: vi.fn(),
          count: vi.fn(),
        },
        workspaceMember: {
          count: vi.fn(),
          updateMany: vi.fn(),
        },
        trip: { count: vi.fn() },
        journalEntry: { count: vi.fn() },
        session: {
          count: vi.fn(),
          deleteMany: vi.fn(),
        },
        twoFactor: { deleteMany: vi.fn(), count: vi.fn() },
        invitation: { updateMany: vi.fn() },
        $transaction: vi.fn(),
      },
    };
    const audit = { record: vi.fn().mockResolvedValue({ id: "audit" }) };
    const service = new AdminUsersService(prisma as never, audit as never);
    return { prisma, audit, service };
  }

  it("lets support suspend a user and records an audit entry", async () => {
    const { prisma, audit, service } = setup();
    prisma.client.user.findUnique.mockResolvedValue(
      makeUserRecord(USER_VIEWER_ID, { platformRole: "user", status: "active" }),
    );
    prisma.client.user.count.mockResolvedValue(1);
    prisma.client.workspaceMember.count.mockResolvedValue(1);
    prisma.client.trip.count.mockResolvedValue(2);
    prisma.client.journalEntry.count.mockResolvedValue(3);
    prisma.client.session.count.mockResolvedValue(1);
    prisma.client.user.update.mockResolvedValue(
      makeUserRecord(USER_VIEWER_ID, { status: "suspended" }),
    );

    const result = await service.update(
      makeActor(USER_ADMIN_ID, { platformRole: "support" }),
      USER_VIEWER_ID,
      { status: "suspended" },
    );

    expect(result.status).toBe("suspended");
    expect(prisma.client.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_VIEWER_ID },
        data: expect.objectContaining({ status: "suspended" }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: USER_ADMIN_ID,
        actorType: "admin",
        action: "admin.user.updated",
        targetType: "user",
        targetId: USER_VIEWER_ID,
      }),
    );
  });

  it("blocks support from changing a platform role", async () => {
    const { prisma, service } = setup();
    prisma.client.user.findUnique.mockResolvedValue(makeUserRecord(USER_VIEWER_ID));

    await expect(
      service.update(
        makeActor(USER_ADMIN_ID, { platformRole: "support" }),
        USER_VIEWER_ID,
        { platformRole: "admin" },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.client.user.update).not.toHaveBeenCalled();
  });

  it("lets super_admin change a platform role and audits the change", async () => {
    const { prisma, audit, service } = setup();
    prisma.client.user.findUnique.mockResolvedValue(
      makeUserRecord(USER_VIEWER_ID, { platformRole: "user" }),
    );
    prisma.client.user.count.mockResolvedValue(2);
    prisma.client.user.update.mockResolvedValue(
      makeUserRecord(USER_VIEWER_ID, { platformRole: "admin" }),
    );
    prisma.client.workspaceMember.count.mockResolvedValue(1);
    prisma.client.trip.count.mockResolvedValue(0);
    prisma.client.journalEntry.count.mockResolvedValue(0);
    prisma.client.session.count.mockResolvedValue(0);

    const result = await service.update(
      makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }),
      USER_VIEWER_ID,
      { platformRole: "admin" },
    );

    expect(result.platformRole).toBe("admin");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ platformRole: "admin" }),
      }),
    );
  });

  it("blocks deleting the last super_admin", async () => {
    const { prisma, service } = setup();
    prisma.client.user.findUnique.mockResolvedValue(
      makeUserRecord(USER_VIEWER_ID, { platformRole: "super_admin" }),
    );
    prisma.client.user.count.mockResolvedValue(1);

    await expect(
      service.remove(
        makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }),
        USER_VIEWER_ID,
      ),
    ).rejects.toThrow(/last super_admin/i);
  });

  it("soft-deletes a user, revokes sessions, and records an audit entry", async () => {
    const { prisma, audit, service } = setup();
    prisma.client.user.findUnique.mockResolvedValue(
      makeUserRecord(USER_VIEWER_ID, { platformRole: "user", status: "active" }),
    );
    prisma.client.user.count.mockResolvedValue(3);
    const tx = {
      user: { update: vi.fn().mockResolvedValue(makeUserRecord(USER_VIEWER_ID, { status: "deleted" })) },
      session: { deleteMany: vi.fn() },
      twoFactor: { deleteMany: vi.fn() },
      workspaceMember: { updateMany: vi.fn() },
      invitation: { updateMany: vi.fn() },
    };
    prisma.client.$transaction.mockImplementation(async (callback: (value: unknown) => unknown) =>
      callback(tx),
    );

    const result = await service.remove(
      makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
      USER_VIEWER_ID,
    );

    expect(result.message).toMatch(/deleted/i);
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_VIEWER_ID },
        data: expect.objectContaining({ status: "deleted", deletedAt: expect.any(Date) }),
      }),
    );
    expect(tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER_VIEWER_ID } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.user.deleted",
        targetId: USER_VIEWER_ID,
      }),
      tx,
    );
  });

  it("restores a soft-deleted user to active from PATCH", async () => {
    const { prisma, service } = setup();
    prisma.client.user.findUnique.mockResolvedValue(
      makeUserRecord(USER_VIEWER_ID, {
        status: "deleted",
        deletedAt: NOW.toISOString(),
      }),
    );
    prisma.client.user.update.mockResolvedValue(
      makeUserRecord(USER_VIEWER_ID, { status: "active", deletedAt: null }),
    );
    prisma.client.user.count.mockResolvedValue(4);
    prisma.client.workspaceMember.count.mockResolvedValue(0);
    prisma.client.trip.count.mockResolvedValue(0);
    prisma.client.journalEntry.count.mockResolvedValue(0);
    prisma.client.session.count.mockResolvedValue(0);

    const result = await service.update(
      makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
      USER_VIEWER_ID,
      { status: "active" },
    );

    expect(prisma.client.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "active", deletedAt: null }),
      }),
    );
    expect(result.deletedAt).toBeNull();
  });

  it("returns 404 for a missing user detail", async () => {
    const { prisma, service } = setup();
    prisma.client.user.findUnique.mockResolvedValue(null);

    await expect(service.get(makeActor(USER_ADMIN_ID, { platformRole: "support" }), USER_OWNER_ID))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
