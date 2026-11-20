import { ConflictException, BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { MediaUrlService } from "../../media/media-url.service.js";
import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import { UsersService } from "../users.service.js";
import { NOW, USER_OWNER_ID, makeActor, makeUserRecord } from "../../../../test/identity-fixtures.js";

const AVATAR_MEDIA_ID = "01942f30-1200-7000-8000-000000000901";
const SIGNED_AVATAR_URL = `http://127.0.0.1:9000/roamlog-local/01942f30-1200-7000-8000-0000000000aa/2026/11/${AVATAR_MEDIA_ID}/thumb.webp?X-Amz-Date=20261120T000000Z&X-Amz-Expires=900`;

describe("UsersService", () => {
  function setup() {
    const prisma = {
      client: {
        user: {
          findUnique: vi.fn(),
          update: vi.fn(),
        },
        media: {
          findFirst: vi.fn(),
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
    const mediaUrls = {
      sign: vi
        .fn()
        .mockResolvedValue({ url: SIGNED_AVATAR_URL, thumbUrl: SIGNED_AVATAR_URL, motionUrl: null, expiresAt: "2026-11-20T00:15:00.000Z" }),
    };
    const logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const service = new UsersService(
      prisma as never,
      workspaces as never,
      audit as never,
      mediaUrls as unknown as MediaUrlService,
      logger as unknown as PinoLoggerService,
    );
    return { prisma, workspaces, audit, mediaUrls, logger, service };
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

  it("stores the avatar media id instead of the 15-minute signed URL", async () => {
    const { prisma, mediaUrls, service } = setup();
    prisma.client.media.findFirst.mockResolvedValue({
      id: AVATAR_MEDIA_ID,
      uploaderId: USER_OWNER_ID,
    });
    const tx = {
      user: {
        update: vi
          .fn()
          .mockResolvedValue(makeUserRecord(USER_OWNER_ID, { image: AVATAR_MEDIA_ID })),
      },
    };
    prisma.client.$transaction.mockImplementation(
      async (callback: (value: unknown) => unknown) => callback(tx),
    );

    const updated = await service.updateMe(makeActor(), { image: SIGNED_AVATAR_URL });

    const data = tx.user.update.mock.calls[0]?.[0]?.data as { image?: string };
    expect(data.image).toBe(AVATAR_MEDIA_ID);
    expect(data.image).not.toContain("X-Amz-");
    // The response is a freshly signed URL, never the stored id.
    expect(updated.image).toBe(SIGNED_AVATAR_URL);
    expect(mediaUrls.sign).toHaveBeenCalledTimes(1);
  });

  it("re-signs the stored media id on every GET /v1/me", async () => {
    const { prisma, mediaUrls, service } = setup();
    prisma.client.user.findUnique.mockResolvedValue(
      makeUserRecord(USER_OWNER_ID, { image: AVATAR_MEDIA_ID }),
    );
    prisma.client.media.findFirst.mockResolvedValue({
      id: AVATAR_MEDIA_ID,
      uploaderId: USER_OWNER_ID,
    });

    const me = await service.getMe(makeActor());

    expect(mediaUrls.sign).toHaveBeenCalledTimes(1);
    expect(me.image).toBe(SIGNED_AVATAR_URL);
  });

  it("hands a legacy URL row back verbatim without signing", async () => {
    const { prisma, mediaUrls, service } = setup();
    const legacy = "https://cdn.example.com/avatar.png";
    prisma.client.user.findUnique.mockResolvedValue(
      makeUserRecord(USER_OWNER_ID, { image: legacy }),
    );

    const me = await service.getMe(makeActor());

    expect(me.image).toBe(legacy);
    expect(mediaUrls.sign).not.toHaveBeenCalled();
  });

  it("keeps an external avatar URL as-is", async () => {
    const { prisma, service } = setup();
    const external = "https://example.com/me.png";
    const tx = {
      user: {
        update: vi.fn().mockResolvedValue(makeUserRecord(USER_OWNER_ID, { image: external })),
      },
    };
    prisma.client.$transaction.mockImplementation(
      async (callback: (value: unknown) => unknown) => callback(tx),
    );

    await service.updateMe(makeActor(), { image: external });

    expect(tx.user.update.mock.calls[0]?.[0]?.data?.image).toBe(external);
  });

  it("refuses media uploaded by another account", async () => {
    const { prisma, service } = setup();
    prisma.client.media.findFirst.mockResolvedValue({
      id: AVATAR_MEDIA_ID,
      uploaderId: "01942f30-1200-7000-8000-0000000009ff",
    });

    await expect(service.updateMe(makeActor(), { image: SIGNED_AVATAR_URL })).rejects
      .toBeInstanceOf(BadRequestException);
  });

  it("degrades to initials instead of failing the profile when signing breaks", async () => {
    const { prisma, mediaUrls, logger, service } = setup();
    prisma.client.user.findUnique.mockResolvedValue(
      makeUserRecord(USER_OWNER_ID, { image: AVATAR_MEDIA_ID }),
    );
    prisma.client.media.findFirst.mockResolvedValue({
      id: AVATAR_MEDIA_ID,
      uploaderId: USER_OWNER_ID,
    });
    mediaUrls.sign.mockRejectedValue(new Error("storage down"));

    const me = await service.getMe(makeActor());

    expect(me.image).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: "AVATAR_SIGN_FAILED" }),
      "user.avatar_sign_failed",
    );
  });
});
