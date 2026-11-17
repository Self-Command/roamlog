import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { UsersService } from "../users.service.js";
import { NOW, USER_OWNER_ID, makeActor } from "../../../../test/identity-fixtures.js";

describe("UsersService", () => {
  function setup() {
    const prisma = {
      client: {
        user: {
          findUnique: vi.fn(),
          update: vi.fn(),
        },
        session: {
          findMany: vi.fn(),
        },
        workspace: {
          count: vi.fn(),
        },
        account: { deleteMany: vi.fn() },
        twoFactor: { deleteMany: vi.fn() },
        notificationPreference: { deleteMany: vi.fn() },
        workspaceMember: { updateMany: vi.fn() },
        invitation: { updateMany: vi.fn() },
        emailLog: { updateMany: vi.fn() },
        $transaction: vi.fn(),
      },
    };
    const workspaces = {
      ensureDefaultWorkspace: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue([]),
    };
    const audit = { record: vi.fn().mockResolvedValue({ id: "audit" }) };
    const service = new UsersService(prisma as never, workspaces as never, audit as never);
    return { prisma, workspaces, audit, service };
  }

  it("runs idempotent onboarding before listing the caller's Workspaces", async () => {
    const { workspaces, service } = setup();
    await service.listMyWorkspaces(makeActor());
    expect(workspaces.ensureDefaultWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: USER_OWNER_ID }) }),
    );
    expect(workspaces.list).toHaveBeenCalledTimes(1);
  });

  it("does not include session tokens in the session response", async () => {
    const { prisma, service } = setup();
    prisma.client.session.findMany.mockResolvedValue([
      {
        id: "01942f30-1200-7000-8000-000000000401",
        userId: USER_OWNER_ID,
        expiresAt: new Date(NOW.getTime() + 60_000),
        createdAt: NOW,
        ipAddress: "127.0.0.1",
        userAgent: "vitest",
      },
    ]);

    const sessions = await service.listSessions(makeActor());

    expect(sessions).toEqual([expect.objectContaining({ userId: USER_OWNER_ID, ip: "127.0.0.1" })]);
    const query = prisma.client.session.findMany.mock.calls[0]?.[0] as {
      select: Record<string, boolean>;
    };
    expect(query.select).not.toHaveProperty("token");
  });

  it("rejects account deletion while the user owns an active Workspace", async () => {
    const { prisma, service } = setup();
    prisma.client.workspace.count.mockResolvedValue(1);

    await expect(service.deleteMe(makeActor(), { confirmation: "DELETE" })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
  });

  it("soft-deletes and anonymizes an account without owned Workspaces", async () => {
    const { prisma, service } = setup();
    prisma.client.workspace.count.mockResolvedValue(0);
    const tx = {
      user: { update: vi.fn().mockResolvedValue({}) },
      session: { deleteMany: vi.fn() },
      account: { deleteMany: vi.fn() },
      twoFactor: { deleteMany: vi.fn() },
      notificationPreference: { deleteMany: vi.fn() },
      invitation: { updateMany: vi.fn() },
      emailLog: { updateMany: vi.fn() },
      workspaceMember: { updateMany: vi.fn() },
    };
    prisma.client.$transaction.mockImplementation(async (callback: (value: unknown) => unknown) =>
      callback(tx),
    );

    const result = await service.deleteMe(makeActor(), { confirmation: "DELETE" });

    expect(result.message).toBe("Account deleted.");
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_OWNER_ID },
        data: expect.objectContaining({ status: "deleted", name: "Deleted user" }),
      }),
    );
    expect(tx.workspaceMember.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_OWNER_ID, status: "active" },
      data: { status: "suspended" },
    });
  });
});
