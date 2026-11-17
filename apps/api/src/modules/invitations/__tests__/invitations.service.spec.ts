import {
  ConflictException,
  ForbiddenException,
  GoneException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { InvitationsService } from "../invitations.service.js";
import { InvitationAcceptanceService } from "../invitation-acceptance.service.js";
import { InvitationQueryService } from "../invitation-query.service.js";
import { PermissionService } from "../../../common/services/permission.service.js";
import {
  INVITATION_ID,
  NOW,
  SEVEN_DAYS_MS,
  USER_ADMIN_ID,
  USER_EDITOR_ID,
  USER_OWNER_ID,
  WORKSPACE_A_ID,
  makeActor,
} from "../../../../test/identity-fixtures.js";

function invitationRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: INVITATION_ID,
    workspaceId: WORKSPACE_A_ID,
    email: "friend@roamlog.test",
    role: "editor",
    tokenHash: "hash",
    invitedById: USER_OWNER_ID,
    expiresAt: new Date(NOW.getTime() + SEVEN_DAYS_MS),
    acceptedAt: null,
    revokedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

function memberRecord(role: "owner" | "admin" | "editor" | "viewer", userId: string) {
  return {
    id: "01942f30-1200-7000-8000-000000000204",
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
      email: "friend@roamlog.test",
      emailVerified: true,
      name: "Friend",
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

describe("InvitationsService", () => {
  function setup(now = NOW) {
    const prisma = {
      client: {
        $transaction: vi.fn(),
        $queryRaw: vi.fn(),
        invitation: {
          findFirst: vi.fn(),
          findUnique: vi.fn(),
          findMany: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
        },
        workspaceMember: {
          findFirst: vi.fn(),
          create: vi.fn(),
        },
        user: {
          findUnique: vi.fn(),
        },
      },
    };
    const access = { requireMembership: vi.fn() };
    const audit = { record: vi.fn().mockResolvedValue({ id: "audit" }) };
    const email = {
      sendInvitation: vi.fn().mockResolvedValue(undefined),
    };
    const service = new InvitationsService(
      prisma as never,
      access as never,
      audit as never,
      email as never,
      new PermissionService(),
      () => now,
    );
    const acceptance = new InvitationAcceptanceService(prisma as never, audit as never, () => now);
    const queries = new InvitationQueryService(
      prisma as never,
      access as never,
      new PermissionService(),
      () => now,
    );
    return { prisma, access, audit, email, service, acceptance, queries };
  }

  it("stores only a token hash and sends the plaintext token exactly once by email", async () => {
    const { prisma, access, email, service } = setup();
    access.requireMembership.mockResolvedValue({
      ...memberRecord("owner", USER_OWNER_ID),
      user: undefined,
    });
    const tx = {
      invitation: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi
          .fn()
          .mockImplementation(async (args: { data: Record<string, unknown> }) =>
            invitationRecord(args.data),
          ),
      },
      workspaceMember: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    prisma.client.$transaction.mockImplementation(async (callback: (value: unknown) => unknown) =>
      callback(tx),
    );

    await service.create(makeActor(), WORKSPACE_A_ID, {
      email: "friend@roamlog.test",
      role: "editor",
    });

    const created = tx.invitation.create.mock.calls[0]?.[0].data as {
      tokenHash: string;
      expiresAt: Date;
    };
    const sent = email.sendInvitation.mock.calls[0]?.[0] as { url: string };
    const token = new URL(sent.url).pathname.split("/").at(-1) as string;

    expect(token).toHaveLength(43);
    expect(created.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(created.tokenHash).not.toContain(token);
    expect(new Date(created.expiresAt).getTime() - NOW.getTime()).toBe(SEVEN_DAYS_MS);
    expect(email.sendInvitation).toHaveBeenCalledTimes(1);
  });

  it("blocks an Admin from inviting another Admin", async () => {
    const { prisma, access, service } = setup();
    access.requireMembership.mockResolvedValue({
      ...memberRecord("admin", USER_ADMIN_ID),
      user: undefined,
    });

    await expect(
      service.create(makeActor(USER_ADMIN_ID), WORKSPACE_A_ID, {
        email: "friend@roamlog.test",
        role: "admin",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
  });

  it("lists only pending invitations for the current tenant", async () => {
    const { prisma, access, queries } = setup();
    access.requireMembership.mockResolvedValue({
      ...memberRecord("admin", USER_ADMIN_ID),
      user: undefined,
    });
    prisma.client.invitation.findMany.mockResolvedValue([invitationRecord()]);

    const page = await queries.list(makeActor(USER_ADMIN_ID), WORKSPACE_A_ID, {
      status: "pending",
    });

    expect(page.items[0]).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      email: "friend@roamlog.test",
    });
    expect(prisma.client.invitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: WORKSPACE_A_ID,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: NOW },
        }),
      }),
    );
  });

  it("rotates an expired pending invitation instead of violating the pending unique index", async () => {
    const { prisma, access, email, service } = setup();
    access.requireMembership.mockResolvedValue({
      ...memberRecord("owner", USER_OWNER_ID),
      user: undefined,
    });
    const expired = invitationRecord({
      expiresAt: new Date(NOW.getTime() - 1_000),
    });
    const tx = {
      invitation: {
        findFirst: vi.fn().mockResolvedValue(expired),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({
          ...expired,
          expiresAt: new Date(NOW.getTime() + SEVEN_DAYS_MS),
        }),
      },
      workspaceMember: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    prisma.client.$transaction.mockImplementation(async (callback: (value: unknown) => unknown) =>
      callback(tx),
    );

    await service.create(makeActor(), WORKSPACE_A_ID, {
      email: "friend@roamlog.test",
      role: "editor",
    });

    expect(tx.invitation.create).not.toHaveBeenCalled();
    expect(tx.invitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: expired.id },
        data: expect.objectContaining({
          acceptedAt: null,
          revokedAt: null,
        }),
      }),
    );
    expect(email.sendInvitation).toHaveBeenCalledTimes(1);
  });

  it("rejects a second live invitation for the same Workspace and email", async () => {
    const { prisma, access, service } = setup();
    access.requireMembership.mockResolvedValue({
      ...memberRecord("owner", USER_OWNER_ID),
      user: undefined,
    });
    const tx = {
      invitation: {
        findFirst: vi.fn().mockResolvedValue(invitationRecord()),
        create: vi.fn(),
      },
      workspaceMember: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    prisma.client.$transaction.mockImplementation(async (callback: (value: unknown) => unknown) =>
      callback(tx),
    );

    await expect(
      service.create(makeActor(), WORKSPACE_A_ID, {
        email: "friend@roamlog.test",
        role: "editor",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("revokes a failed-delivery invitation so retry is not blocked", async () => {
    const { prisma, access, audit, email, service } = setup();
    access.requireMembership.mockResolvedValue({
      ...memberRecord("owner", USER_OWNER_ID),
      user: undefined,
    });
    const created = invitationRecord({ tokenHash: "hash" });
    const tx = {
      invitation: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(created),
      },
      workspaceMember: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const cleanupTx = {
      invitation: {
        update: vi.fn().mockResolvedValue({ ...created, revokedAt: NOW }),
      },
    };
    prisma.client.$transaction
      .mockImplementationOnce(async (callback: (value: unknown) => unknown) => callback(tx))
      .mockImplementationOnce(async (callback: (value: unknown) => unknown) => callback(cleanupTx));
    email.sendInvitation.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(
      service.create(makeActor(), WORKSPACE_A_ID, {
        email: "friend@roamlog.test",
        role: "editor",
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(cleanupTx.invitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: created.id },
        data: { revokedAt: NOW },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "invitation.delivery_failed" }),
      expect.anything(),
    );
  });

  it("rejects an expired invitation", async () => {
    const { prisma, acceptance } = setup();
    const expired = invitationRecord({
      expiresAt: new Date(NOW.getTime() - 1_000),
      tokenHash: createHash("sha256").update("a".repeat(43)).digest("hex"),
    });
    prisma.client.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        $queryRaw: vi.fn().mockResolvedValue([{ id: expired.id }]),
        invitation: { findUnique: vi.fn().mockResolvedValue(expired) },
      }),
    );

    await expect(acceptance.accept(makeActor(), "a".repeat(43))).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it("rejects a revoked invitation", async () => {
    const { prisma, acceptance } = setup();
    const revoked = invitationRecord({
      revokedAt: NOW,
      tokenHash: createHash("sha256").update("b".repeat(43)).digest("hex"),
    });
    prisma.client.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        $queryRaw: vi.fn().mockResolvedValue([{ id: revoked.id }]),
        invitation: { findUnique: vi.fn().mockResolvedValue(revoked) },
      }),
    );

    await expect(acceptance.accept(makeActor(), "b".repeat(43))).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it("prevents an Admin from revoking an Admin invitation", async () => {
    const { prisma, access, service } = setup();
    access.requireMembership.mockResolvedValue({
      ...memberRecord("admin", USER_ADMIN_ID),
      user: undefined,
    });
    prisma.client.invitation.findFirst.mockResolvedValue(invitationRecord({ role: "admin" }));

    await expect(
      service.revoke(makeActor(USER_ADMIN_ID), WORKSPACE_A_ID, INVITATION_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("blocks unverified users from accepting an invitation", async () => {
    const { acceptance } = setup();
    await expect(
      acceptance.accept(makeActor(USER_EDITOR_ID, { emailVerified: false }), "c".repeat(43)),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: "EMAIL_VERIFICATION_REQUIRED" },
    });
  });

  it("accepts a valid invitation for the matching verified email", async () => {
    const { prisma, acceptance } = setup();
    const token = "d".repeat(43);
    const invitation = invitationRecord({
      email: "friend@roamlog.test",
      tokenHash: createHash("sha256").update(token).digest("hex"),
    });
    const joined = memberRecord("editor", USER_EDITOR_ID);
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: invitation.id }]),
      invitation: {
        findUnique: vi.fn().mockResolvedValue(invitation),
        update: vi.fn().mockResolvedValue({ ...invitation, acceptedAt: NOW }),
      },
      workspaceMember: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(joined),
      },
      workspace: {
        findFirst: vi.fn().mockResolvedValue({ id: WORKSPACE_A_ID, status: "active" }),
      },
    };
    prisma.client.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    );

    const result = await acceptance.accept(
      makeActor(USER_EDITOR_ID, { email: "friend@roamlog.test" }),
      token,
    );

    expect(result.role).toBe("editor");
    expect(tx.workspaceMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: WORKSPACE_A_ID,
          userId: USER_EDITOR_ID,
          role: "editor",
          status: "active",
        }),
      }),
    );
    expect(tx.invitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: invitation.id },
        data: { acceptedAt: NOW },
      }),
    );
  });
});
