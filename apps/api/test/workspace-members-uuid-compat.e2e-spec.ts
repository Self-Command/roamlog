import { randomBytes, randomUUID } from "node:crypto";

/**
 * UUIDv7-shaped fixture id. `TenantGuard` and the request contracts pin
 * `workspaceId` to `UuidV7Schema`, so every fixture that travels through a
 * request must be v7; only the *stored row* under test is allowed to be legacy.
 */
function uuidV7(): string {
  const bytes = randomBytes(16);
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createPrismaClient } from "@roamlog/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureApp } from "../src/bootstrap/configure-app.js";
import { SessionGuard } from "../src/common/guards/session.guard.js";
import { AppConfigModule } from "../src/config/app-config.module.js";
import { AuditService } from "../src/modules/audit/audit.service.js";
import { ObservabilityModule } from "../src/modules/observability/observability.module.js";
import { PrismaModule } from "../src/modules/prisma/prisma.module.js";
import { PrismaService } from "../src/modules/prisma/prisma.service.js";
import { RedisModule } from "../src/modules/redis/redis.module.js";
import { RedisService } from "../src/modules/redis/redis.service.js";
import { StorageModule } from "../src/modules/storage/storage.module.js";
import { StorageService } from "../src/modules/storage/storage.service.js";
import { WorkspacesModule } from "../src/modules/workspaces/workspaces.module.js";
import { makeActor } from "./identity-fixtures.js";

/**
 * Regression coverage for `GET /v1/workspaces/:id/members` (`MEMBERS_500`).
 *
 * The local `roamlog-crew` workspace holds five memberships: the three seeded
 * UUIDv7 rows from `packages/db/src/seed/core.ts` plus two rows an e2e fixture
 * script inserted with `randomUUID()` (a v4 id). PostgreSQL stores either form
 * in a `uuid` column, but `WorkspaceMemberWithUserSchema` pins `id` to
 * `UuidV7Schema`, so `presentMember` threw a `ZodError` and the endpoint
 * answered `500 INTERNAL_SERVER_ERROR` for the whole page — the ownership
 * transfer picker and `/w/<slug>/members` were unusable while a workspace with
 * only v7 rows (`travel-archive-2f2fa4e4fda6`) kept working.
 *
 * This spec rebuilds that exact shape on a real database and drives the HTTP
 * route through the same guards the API uses.
 *
 * Skipped unless ROAMLOG_TEST_DATABASE_URL points at a reachable PostgreSQL.
 */
const databaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;

if (!databaseUrl) {
  process.stderr.write(
    "SKIPPED workspace members UUID compatibility test: ROAMLOG_TEST_DATABASE_URL is not set. " +
      "Apply migrations, set the URL, and rerun to exercise a real PostgreSQL database.\n",
  );
}

integrationDescribe("workspace members against PostgreSQL", () => {
  let app: INestApplication;
  const prisma = createPrismaClient({ connectionString: databaseUrl });
  const database = {
    client: prisma,
    healthCheck: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
  } as unknown as PrismaService;

  const ownerUserId = uuidV7();
  const editorUserId = uuidV7();
  const legacyUserId = uuidV7();
  const workspaceId = uuidV7();
  const slug = `members-500-${workspaceId.slice(0, 8)}`;
  const ownerMemberId = uuidV7();
  const editorMemberId = uuidV7();
  // Exactly what a `randomUUID()`-based fixture writes: a v4 id in a `uuid`
  // column. No application code mints this; the read path must still serve it.
  const legacyMemberId = randomUUID();
  const legacyJoinedAt = new Date("2026-11-20T06:03:25.188Z");

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: [
        {
          id: ownerUserId,
          email: `members-500-owner-${ownerUserId.slice(0, 8)}@roamlog.test`,
          name: "Members 500 Owner",
          emailVerified: true,
        },
        {
          id: editorUserId,
          email: `members-500-editor-${editorUserId.slice(0, 8)}@roamlog.test`,
          name: "Members 500 Editor",
          emailVerified: true,
        },
        {
          id: legacyUserId,
          email: `members-500-legacy-${legacyUserId.slice(0, 8)}@roamlog.test`,
          name: "Members 500 Legacy",
          emailVerified: true,
          image: null,
          lastActiveAt: null,
        },
      ],
    });

    // The `Workspace_owner_membership_check` trigger is DEFERRABLE INITIALLY
    // DEFERRED, so the workspace and its owner membership share a transaction.
    await prisma.$transaction(async (tx) => {
      await tx.workspace.create({
        data: {
          id: workspaceId,
          name: "Members 500 Workspace",
          slug,
          ownerId: ownerUserId,
        },
      });
      await tx.workspaceMember.create({
        data: {
          id: ownerMemberId,
          workspaceId,
          userId: ownerUserId,
          role: "owner",
          joinedAt: new Date("2026-01-05T00:00:00.000Z"),
        },
      });
    });
    await prisma.workspaceMember.create({
      data: {
        id: editorMemberId,
        workspaceId,
        userId: editorUserId,
        role: "editor",
        joinedAt: new Date("2026-01-05T19:10:00.000Z"),
        invitedById: ownerUserId,
      },
    });
    await prisma.workspaceMember.create({
      data: {
        id: legacyMemberId,
        workspaceId,
        userId: legacyUserId,
        role: "viewer",
        joinedAt: legacyJoinedAt,
        invitedById: null,
      },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        ObservabilityModule,
        PrismaModule,
        RedisModule,
        StorageModule,
        WorkspacesModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(database)
      .overrideProvider(RedisService)
      .useValue({ ping: async () => undefined })
      .overrideProvider(StorageService)
      .useValue({ checkHealth: async () => undefined })
      .overrideProvider(AuditService)
      .useValue({ record: async () => ({ id: randomUUID() }) })
      // `TenantGuard` injects `SessionGuard` through DI, so the stub must be a
      // provider override rather than `overrideGuard` (which only rebinds the
      // `@UseGuards(SessionGuard)` token on the controller).
      .overrideProvider(SessionGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) => {
          const incoming = context.switchToHttp().getRequest() as {
            headers?: Record<string, string>;
            user?: unknown;
          };
          if (!incoming.headers?.["x-test-user"]) {
            throw new UnauthorizedException({ code: "UNAUTHENTICATED" });
          }
          incoming.user = makeActor(ownerUserId).user;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      try {
        await prisma.auditLog.deleteMany({ where: { workspaceId } });
        // Both workspace triggers are deferred, so membership and workspace
        // deletion share one transaction and each sees the final state.
        await prisma.$transaction(async (tx) => {
          await tx.workspaceMember.deleteMany({ where: { workspaceId } });
          await tx.workspace.deleteMany({ where: { id: workspaceId } });
        });
        await prisma.user.deleteMany({
          where: { id: { in: [ownerUserId, editorUserId, legacyUserId] } },
        });
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  it("GET /v1/workspaces/:id/members returns 200 and lists the legacy-id member", async () => {
    const response = await request(app.getHttpServer())
      .get(`/v1/workspaces/${workspaceId}/members`)
      .set("x-test-user", ownerUserId);

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.hasMore).toBe(false);
    expect(response.body.items).toHaveLength(3);

    const items = response.body.items as Array<{
      id: string;
      userId: string;
      role: string;
      joinedAt: string;
      user: { email: string; name: string; image: string | null };
    }>;
    expect(items.map((item) => item.id)).toEqual([ownerMemberId, editorMemberId, legacyMemberId]);
    expect(items.map((item) => item.role)).toEqual(["owner", "editor", "viewer"]);

    const legacy = items[2]!;
    expect(legacy.id).toBe(legacyMemberId);
    expect(legacy.joinedAt).toBe(legacyJoinedAt.toISOString());
    expect(legacy.user).toMatchObject({
      email: `members-500-legacy-${legacyUserId.slice(0, 8)}@roamlog.test`,
      name: "Members 500 Legacy",
      image: null,
    });
  });

  it("GET /v1/workspaces/:id/members?limit=24 returns 200 with every member", async () => {
    const response = await request(app.getHttpServer())
      .get(`/v1/workspaces/${workspaceId}/members`)
      .query({ limit: 24 })
      .set("x-test-user", ownerUserId);

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.items).toHaveLength(3);
    expect(
      (response.body.items as Array<{ id: string }>).some((item) => item.id === legacyMemberId),
    ).toBe(true);
  });

  it("keeps paging and filtering working across a legacy-id row", async () => {
    const filtered = await request(app.getHttpServer())
      .get(`/v1/workspaces/${workspaceId}/members`)
      .query({ role: "viewer", limit: 1 })
      .set("x-test-user", ownerUserId);

    expect(filtered.status, JSON.stringify(filtered.body)).toBe(200);
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0].id).toBe(legacyMemberId);

    const next = await request(app.getHttpServer())
      .get(`/v1/workspaces/${workspaceId}/members`)
      .query({ limit: 2 })
      .set("x-test-user", ownerUserId);
    expect(next.status, JSON.stringify(next.body)).toBe(200);
    expect(next.body.items).toHaveLength(2);
    expect(next.body.hasMore).toBe(true);
    expect(typeof next.body.nextCursor).toBe("string");

    const page2 = await request(app.getHttpServer())
      .get(`/v1/workspaces/${workspaceId}/members`)
      .query({ limit: 2, cursor: next.body.nextCursor })
      .set("x-test-user", ownerUserId);
    expect(page2.status, JSON.stringify(page2.body)).toBe(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].id).toBe(legacyMemberId);
  });
});