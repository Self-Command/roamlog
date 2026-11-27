import { randomBytes, randomUUID } from "node:crypto";

/**
 * UUIDv7-shaped fixture id. `AdminContentQuerySchema.workspaceId` is a
 * `UuidV7Schema`, so a v4 fixture would be rejected with a 400 before the code
 * under test ever ran.
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
import type { PlatformRole } from "@roamlog/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureApp } from "../src/bootstrap/configure-app.js";
import { SessionGuard } from "../src/common/guards/session.guard.js";
import { AppConfigModule } from "../src/config/app-config.module.js";
import { AdminModule } from "../src/modules/admin/admin.module.js";
import { AdminQueueService } from "../src/modules/admin/admin-queue.service.js";
import { AuditService } from "../src/modules/audit/audit.service.js";
import { ObservabilityModule } from "../src/modules/observability/observability.module.js";
import { PrismaModule } from "../src/modules/prisma/prisma.module.js";
import { PrismaService } from "../src/modules/prisma/prisma.service.js";
import { RedisModule } from "../src/modules/redis/redis.module.js";
import { RedisService } from "../src/modules/redis/redis.service.js";
import { StorageModule } from "../src/modules/storage/storage.module.js";
import { StorageService } from "../src/modules/storage/storage.service.js";
import { makeActor, USER_OWNER_ID } from "./identity-fixtures.js";

/**
 * Regression coverage for the two admin read endpoints that returned
 * `500 INTERNAL_SERVER_ERROR` against a real PostgreSQL database:
 *
 *  - `GET /v1/admin/audit` (and `/v1/admin/audit/export`) rejected an immutable
 *    audit row whose `targetId` is a PostgreSQL `uuid` that is not an RFC 4122
 *    value. `AuditService.record` stores the AI planner's `runId` (a 32-hex digit
 *    string, see `newRunId()`), PostgreSQL normalises it to
 *    `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`, and `z.uuid()` then rejects the
 *    variant nibble (`...-f34f-...`, variant `f`), so `ZodError` escalated to 500.
 *  - `GET /v1/admin/trips` passed `presentTrip` (whose second parameter is the
 *    resolved `cover`) straight to `toCursorPage`, which calls it as
 *    `Array.prototype.map`'s callback. Every row therefore received its array
 *    index as `cover` and `TripSchema.parse` threw "expected object, received
 *    number".
 *
 * Skipped unless ROAMLOG_TEST_DATABASE_URL points at a reachable PostgreSQL.
 */
const databaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;

if (!databaseUrl) {
  process.stderr.write(
    "SKIPPED admin 500 regression test: ROAMLOG_TEST_DATABASE_URL is not set. " +
      "Apply migrations, set the URL, and rerun to exercise a real PostgreSQL database.\n",
  );
}

integrationDescribe("admin audit/trips regression against PostgreSQL", () => {
  let app: INestApplication;
  const prisma = createPrismaClient({ connectionString: databaseUrl });
  const database = {
    client: prisma,
    healthCheck: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
  } as unknown as PrismaService;

  const userId = uuidV7();
  const workspaceId = uuidV7();
  const tripId = uuidV7();
  const auditValidId = uuidV7();
  const auditVariantId = uuidV7();
  // The AI planner's run id: 32 lowercase hex digits with no hyphens. This is
  // exactly what `newRunId()` writes into `AuditLog.targetId` (a `uuid` column).
  const hyphenlessTargetId = randomBytes(16).toString("hex");
  const hyphenatedTargetId = [
    hyphenlessTargetId.slice(0, 8),
    hyphenlessTargetId.slice(8, 12),
    hyphenlessTargetId.slice(12, 16),
    hyphenlessTargetId.slice(16, 20),
    hyphenlessTargetId.slice(20),
  ].join("-");
  const auditAction = `test.admin500.${auditValidId.slice(0, 8)}`;

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: userId,
        email: `admin-500-${userId.slice(0, 8)}@roamlog.test`,
        name: "Admin 500 Regression",
        emailVerified: true,
      },
    });
    // The `Workspace_owner_membership_check` constraint trigger is DEFERRABLE
    // INITIALLY DEFERRED, so the workspace and its owner membership must be
    // created in a single transaction.
    await prisma.$transaction(async (tx) => {
      await tx.workspace.create({
        data: {
          id: workspaceId,
          name: "Admin 500 Workspace",
          slug: `admin-500-${workspaceId}`,
          ownerId: userId,
        },
      });
      await tx.workspaceMember.create({
        data: { workspaceId, userId, role: "owner", status: "active" },
      });
    });
    await prisma.trip.create({
      data: {
        id: tripId,
        workspaceId,
        title: "Admin 500 regression trip",
        origin: "Kyoto",
        startDate: new Date("2026-05-01T00:00:00.000Z"),
        endDate: new Date("2026-05-03T00:00:00.000Z"),
        createdById: userId,
        updatedById: userId,
      },
    });
    await prisma.auditLog.create({
      data: {
        id: auditValidId,
        actorType: "system",
        action: auditAction,
        targetType: "test_fixture",
        targetId: tripId,
        workspaceId,
        ip: null,
        userAgent: "vitest-postgres",
        metadata: { source: "admin-api-500-regression" },
      },
    });
    // Written through raw SQL: PostgreSQL accepts the hyphenless form for a
    // `uuid` column and reads it back as a non-RFC value, which no application
    // validation can undo because audit rows are immutable.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AuditLog" ("id","actorId","actorType","action","targetType","targetId","workspaceId","ip","userAgent","metadata","createdAt")
       VALUES ($1::uuid, NULL, 'user', $2, 'ai_tool', $3::uuid, $4::uuid, NULL, 'vitest-postgres', '{"runId":"x"}'::jsonb, now() - interval '1 second')`,
      auditVariantId,
      `ai.tool_call.${auditVariantId.slice(0, 8)}`,
      hyphenlessTargetId,
      workspaceId,
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        ObservabilityModule,
        PrismaModule,
        RedisModule,
        StorageModule,
        AdminModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(database)
      .overrideProvider(RedisService)
      .useValue({ ping: async () => undefined })
      .overrideProvider(StorageService)
      .useValue({ checkHealth: async () => undefined })
      .overrideProvider(AdminQueueService)
      .useValue({
        stats: async () => [],
        listJobs: async () => ({ items: [], nextCursor: null, hasMore: false }),
        workerHealth: async () => ({ status: "up", consumers: 0 }),
      })
      .overrideProvider(AuditService)
      .useValue({ record: async () => ({ id: randomUUID() }) })
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) => {
          const incoming = context.switchToHttp().getRequest() as {
            headers?: Record<string, string>;
            user?: unknown;
          };
          const role = incoming.headers?.["x-test-role"] as PlatformRole | undefined;
          if (!role) {
            throw new UnauthorizedException({ code: "UNAUTHENTICATED" });
          }
          incoming.user = makeActor(USER_OWNER_ID, { platformRole: role }).user;
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
        await prisma.$executeRawUnsafe(
          `DELETE FROM "AuditLog" WHERE "id" IN ($1::uuid, $2::uuid)`,
          auditValidId,
          auditVariantId,
        );
        await prisma.trip.deleteMany({ where: { id: tripId } });
        // Both workspace triggers are deferred, so deleting the membership and
        // the workspace in one transaction lets each see the final state.
        await prisma.$transaction(async (tx) => {
          await tx.workspaceMember.deleteMany({ where: { workspaceId } });
          await tx.workspace.deleteMany({ where: { id: workspaceId } });
        });
        await prisma.user.deleteMany({ where: { id: userId } });
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  it("GET /v1/admin/audit returns 200 and keeps a non-RFC PostgreSQL uuid readable", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/admin/audit")
      .query({ limit: 100 })
      .set("x-test-role", "super_admin");

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(Array.isArray(response.body.items)).toBe(true);
    expect(response.body.items.length).toBeGreaterThanOrEqual(2);

    const variantRow = response.body.items.find(
      (item: { id: string }) => item.id === auditVariantId,
    );
    expect(variantRow).toBeDefined();
    expect(variantRow.targetId).toBe(hyphenatedTargetId);
    expect(variantRow.action).toContain("ai.tool_call.");

    const validRow = response.body.items.find((item: { id: string }) => item.id === auditValidId);
    expect(validRow).toMatchObject({ action: auditAction, targetId: tripId, workspaceId });
  });

  it("GET /v1/admin/audit/export returns 200 CSV including the same rows", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/admin/audit/export")
      .set("x-test-role", "super_admin");

    expect(response.status, response.text.slice(0, 500)).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.text).toContain(auditValidId);
    expect(response.text).toContain(auditVariantId);
    expect(response.text).toContain(hyphenatedTargetId);
    expect(response.text).toContain(auditAction);
  });

  it("filters list and export by q without applying contains to UUID columns", async () => {
    const list = await request(app.getHttpServer())
      .get("/v1/admin/audit")
      .query({ q: auditAction, limit: 100 })
      .set("x-test-role", "super_admin");
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: auditAction })]),
    );

    const exported = await request(app.getHttpServer())
      .get("/v1/admin/audit/export")
      .query({ q: auditAction, sort: "createdAt:desc" })
      .set("x-test-role", "super_admin");
    expect(exported.status, exported.text.slice(0, 500)).toBe(200);
    expect(exported.headers["content-type"]).toContain("text/csv");
    expect(exported.text).toContain(auditAction);
  });

  it("GET /v1/admin/trips returns 200 with presentable rows (no index-as-cover)", async () => {
    const scoped = await request(app.getHttpServer())
      .get("/v1/admin/trips")
      .query({ workspaceId })
      .set("x-test-role", "super_admin");

    expect(scoped.status, JSON.stringify(scoped.body)).toBe(200);
    const trip = scoped.body.items.find((item: { id: string }) => item.id === tripId);
    expect(trip).toBeDefined();
    expect(trip).toMatchObject({
      id: tripId,
      workspaceId,
      title: "Admin 500 regression trip",
      cover: null,
      durationDays: 3,
    });

    const unfiltered = await request(app.getHttpServer())
      .get("/v1/admin/trips")
      .query({ limit: 100 })
      .set("x-test-role", "super_admin");

    expect(unfiltered.status, JSON.stringify(unfiltered.body)).toBe(200);
    expect(unfiltered.body.items.some((item: { id: string }) => item.id === tripId)).toBe(true);
  });
});
