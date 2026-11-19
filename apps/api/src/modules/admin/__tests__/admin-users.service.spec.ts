import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AdminUsersService } from "../admin-users.service.js";
import {
  NOW,
  USER_ADMIN_ID,
  USER_OWNER_ID,
  USER_VIEWER_ID,
  makeActor,
  makeUserRecord as baseMakeUserRecord,
} from "../../../../test/identity-fixtures.js";

function makeUserRecord(id: string, overrides: Record<string, unknown> = {}) {
  return {
    ...baseMakeUserRecord(id, overrides),
    ...overrides,
    twoFactorEnabled:
      typeof overrides.twoFactorEnabled === "boolean" ? overrides.twoFactorEnabled : false,
  };
}

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
          findMany: vi.fn(),
        },
        trip: { count: vi.fn() },
        journalEntry: { count: vi.fn() },
        comment: { count: vi.fn() },
        media: { count: vi.fn() },
        session: {
          count: vi.fn(),
          deleteMany: vi.fn(),
          groupBy: vi.fn(),
          findMany: vi.fn(),
        },
        twoFactor: { deleteMany: vi.fn(), count: vi.fn() },
        invitation: { updateMany: vi.fn() },
        emailLog: { findFirst: vi.fn() },
        $transaction: vi.fn(),
      },
    };
    const audit = { record: vi.fn().mockResolvedValue({ id: "audit" }) };
    const auth = {
      handleWebRequest: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: true }), { status: 200 }),
      ),
    };
    const config = { apiUrl: "http://127.0.0.1:4000", adminUrl: "http://localhost:3001" };
    prisma.client.workspaceMember.findMany.mockResolvedValue([]);
    prisma.client.session.findMany.mockResolvedValue([]);
    prisma.client.session.groupBy.mockResolvedValue([]);
    prisma.client.comment.count.mockResolvedValue(0);
    prisma.client.media.count.mockResolvedValue(0);
    const service = new AdminUsersService(
      prisma as never,
      audit as never,
      auth as never,
      config as never,
    );
    return { prisma, audit, auth, service };
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
        metadata: expect.objectContaining({
          changedFields: ["platformRole"],
        }),
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

  it("applies server-side search, role/status filters and active-session counts", async () => {
    const { prisma, service } = setup();
    prisma.client.user.findMany.mockResolvedValue([makeUserRecord(USER_VIEWER_ID)]);
    prisma.client.session.groupBy.mockResolvedValue([
      { userId: USER_VIEWER_ID, _count: { _all: 2 } },
    ]);

    const page = await service.list(makeActor(USER_ADMIN_ID, { platformRole: "support" }), {
      q: "atlas",
      status: "active",
      platformRole: "user",
      limit: 5,
    });

    expect(prisma.client.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 6,
        where: expect.objectContaining({
          status: "active",
          platformRole: "user",
          OR: expect.arrayContaining([
            { name: { contains: "atlas", mode: "insensitive" } },
            { email: { contains: "atlas", mode: "insensitive" } },
            {
              memberships: {
                some: { workspace: { name: { contains: "atlas", mode: "insensitive" } } },
              },
            },
          ]),
        }),
      }),
    );
    expect(page.items[0]?.activeSessionCount).toBe(2);
  });

  it("returns cursor pagination boundaries and forwards the decoded cursor", async () => {
    const { prisma, service } = setup();
    prisma.client.user.findMany
      .mockResolvedValueOnce([
        makeUserRecord(USER_ADMIN_ID),
        makeUserRecord(USER_OWNER_ID),
        makeUserRecord(USER_VIEWER_ID),
      ])
      .mockResolvedValueOnce([makeUserRecord(USER_VIEWER_ID)]);

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

    expect(prisma.client.user.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        take: 3,
        cursor: { id: USER_OWNER_ID },
        skip: 1,
      }),
    );
  });

  it("rejects an invalid pagination limit with a validation error", async () => {
    const { service } = setup();

    await expect(
      service.list(makeActor(USER_ADMIN_ID, { platformRole: "support" }), { limit: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns real detail counters, memberships, sessions and 2FA state", async () => {
    const { prisma, service } = setup();
    prisma.client.user.findUnique.mockResolvedValue(
      makeUserRecord(USER_VIEWER_ID, { twoFactorEnabled: true }),
    );
    prisma.client.workspaceMember.count.mockResolvedValue(2);
    prisma.client.trip.count.mockResolvedValue(3);
    prisma.client.journalEntry.count.mockResolvedValue(4);
    prisma.client.session.count.mockResolvedValue(5);
    prisma.client.comment.count.mockResolvedValue(6);
    prisma.client.media.count.mockResolvedValue(7);
    prisma.client.workspaceMember.findMany.mockResolvedValue([
      {
        role: "owner",
        status: "active",
        joinedAt: NOW,
        workspace: { id: "01942f30-1200-7000-8000-000000000010", name: "Atlas", slug: "atlas" },
      },
    ]);
    prisma.client.session.findMany.mockResolvedValue([
      {
        id: "01942f30-1200-7000-8000-000000000901",
        ipAddress: "10.0.0.1",
        userAgent: "Chrome",
        createdAt: NOW,
        expiresAt: NOW,
      },
    ]);

    const detail = await service.get(
      makeActor(USER_ADMIN_ID, { platformRole: "support" }),
      USER_VIEWER_ID,
    );

    expect(detail).toMatchObject({
      workspaceCount: 2,
      tripCount: 3,
      entryCount: 4,
      activeSessionCount: 5,
      commentCount: 6,
      mediaCount: 7,
      twoFactorEnabled: true,
    });
    expect(detail.workspaces?.[0]).toMatchObject({ workspaceName: "Atlas", role: "owner" });
    expect(detail.sessions?.[0]).toMatchObject({ ipAddress: "10.0.0.1", userAgent: "Chrome" });
  });

  it("streams a filtered CSV export with a header, BOM and spreadsheet-safe values", async () => {
    const { prisma, service } = setup();
    prisma.client.user.findMany.mockResolvedValue([
      makeUserRecord(USER_VIEWER_ID, { name: "=cmd", email: "viewer@roamlog.test" }),
    ]);

    const chunks: string[] = [];
    for await (const chunk of service.exportCsv(
      makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
      { q: "viewer" },
    )) {
      chunks.push(chunk);
    }

    const csv = chunks.join("");
    expect(csv.startsWith("\uFEFFid,email,emailVerified,name,platformRole,status,")).toBe(true);
    expect(csv).toContain('"viewer@roamlog.test"');
    expect(csv).toContain('"\'=cmd"');
    expect(prisma.client.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: expect.any(Array) }) }),
    );
  });

  it("lets a super_admin edit name, email, locale and timezone and resets email verification", async () => {
    const { prisma, audit, auth, service } = setup();
    const record = makeUserRecord(USER_VIEWER_ID, {
      platformRole: "user",
      email: "old@roamlog.test",
      emailVerified: true,
      name: "Old Name",
    });
    prisma.client.user.findUnique.mockResolvedValueOnce(record).mockResolvedValueOnce(null);
    prisma.client.user.update.mockResolvedValue(
      makeUserRecord(USER_VIEWER_ID, {
        platformRole: "user",
        email: "new@roamlog.test",
        emailVerified: false,
        name: "New Name",
        locale: "en-US",
        timezone: "Europe/Berlin",
      }),
    );
    prisma.client.emailLog.findFirst.mockResolvedValue({ status: "sent" });
    prisma.client.workspaceMember.count.mockResolvedValue(0);
    prisma.client.trip.count.mockResolvedValue(0);
    prisma.client.journalEntry.count.mockResolvedValue(0);
    prisma.client.session.count.mockResolvedValue(0);

    const result = await service.update(
      makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }),
      USER_VIEWER_ID,
      {
        name: "New Name",
        email: "New@Roamlog.test",
        locale: "en-US",
        timezone: "Europe/Berlin",
      },
    );

    expect(prisma.client.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_VIEWER_ID },
        data: {
          name: "New Name",
          email: "new@roamlog.test",
          emailVerified: false,
          locale: "en-US",
          timezone: "Europe/Berlin",
        },
      }),
    );
    expect(auth.handleWebRequest).toHaveBeenCalledTimes(1);
    expect(result.delivery).toBe("sent");
    expect(result.emailVerified).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.user.updated",
        targetId: USER_VIEWER_ID,
        metadata: {
          changedFields: ["name", "email", "locale", "timezone"],
          emailVerificationSent: true,
        },
      }),
    );
    // Audit metadata must never carry the changed values themselves.
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.not.objectContaining({
          email: expect.anything(),
          name: expect.anything(),
        }),
      }),
    );
  });

  it("keeps the profile change when the verification email fails and reports delivery failed", async () => {
    const { prisma, audit, auth, service } = setup();
    prisma.client.user.findUnique
      .mockResolvedValueOnce(
        makeUserRecord(USER_VIEWER_ID, {
          email: "old@roamlog.test",
          emailVerified: true,
        }),
      )
      .mockResolvedValueOnce(null);
    prisma.client.user.update.mockResolvedValue(
      makeUserRecord(USER_VIEWER_ID, {
        email: "new@roamlog.test",
        emailVerified: false,
      }),
    );
    auth.handleWebRequest.mockRejectedValue(new Error("smtp offline"));
    prisma.client.workspaceMember.count.mockResolvedValue(0);
    prisma.client.trip.count.mockResolvedValue(0);
    prisma.client.journalEntry.count.mockResolvedValue(0);
    prisma.client.session.count.mockResolvedValue(0);

    const result = await service.update(
      makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }),
      USER_VIEWER_ID,
      { email: "new@roamlog.test" },
    );

    expect(prisma.client.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "new@roamlog.test", emailVerified: false }),
      }),
    );
    expect(result.delivery).toBe("failed");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { changedFields: ["email"], emailVerificationSent: false },
      }),
    );
  });

  it("rejects an email that another account already uses with EMAIL_TAKEN", async () => {
    const { prisma, service } = setup();
    prisma.client.user.findUnique
      .mockResolvedValueOnce(makeUserRecord(USER_VIEWER_ID, { email: "old@roamlog.test" }))
      .mockResolvedValueOnce({ id: USER_OWNER_ID });

    await expect(
      service.update(makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }), USER_VIEWER_ID, {
        email: "taken@roamlog.test",
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "EMAIL_TAKEN" }),
    });
    expect(prisma.client.user.update).not.toHaveBeenCalled();
  });

  it("refuses to demote the last super_admin", async () => {
    const { prisma, service } = setup();
    prisma.client.user.findUnique.mockResolvedValue(
      makeUserRecord(USER_OWNER_ID, { platformRole: "super_admin" }),
    );
    prisma.client.user.count.mockResolvedValue(1);

    await expect(
      service.update(makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }), USER_OWNER_ID, {
        platformRole: "admin",
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "LAST_SUPER_ADMIN" }),
    });
    expect(prisma.client.user.update).not.toHaveBeenCalled();
  });

  it("refuses to let a super_admin demote themselves", async () => {
    const { prisma, service } = setup();
    prisma.client.user.findUnique.mockResolvedValue(
      makeUserRecord(USER_ADMIN_ID, { platformRole: "super_admin" }),
    );
    prisma.client.user.count.mockResolvedValue(4);

    await expect(
      service.update(makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }), USER_ADMIN_ID, {
        platformRole: "admin",
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "SELF_DEMOTION_FORBIDDEN" }),
    });
  });

  it("rejects an invalid locale or timezone before touching the database", async () => {
    const { prisma, service } = setup();
    prisma.client.user.findUnique.mockResolvedValue(makeUserRecord(USER_VIEWER_ID));

    await expect(
      service.update(makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }), USER_VIEWER_ID, {
        locale: "x",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.update(makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }), USER_VIEWER_ID, {
        timezone: "../../etc/passwd",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.client.user.update).not.toHaveBeenCalled();
  });

  it("forbids support and admin from editing profile fields", async () => {
    const { prisma, service } = setup();
    prisma.client.user.findUnique.mockResolvedValue(makeUserRecord(USER_VIEWER_ID));

    for (const role of ["support", "admin"] as const) {
      await expect(
        service.update(makeActor(USER_ADMIN_ID, { platformRole: role }), USER_VIEWER_ID, {
          name: "Renamed",
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(prisma.client.user.update).not.toHaveBeenCalled();
  });

  it("rejects CSV export for support", async () => {
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
