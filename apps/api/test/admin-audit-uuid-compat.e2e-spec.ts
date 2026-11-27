import { randomUUID } from "node:crypto";

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

const databaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;

if (!databaseUrl) {
  process.stderr.write(
    "SKIPPED admin audit UUID compatibility integration test: ROAMLOG_TEST_DATABASE_URL is not set. " +
      "Apply migrations, set the URL, and rerun to exercise a real PostgreSQL database.\n",
  );
}

integrationDescribe("admin audit UUID compatibility against PostgreSQL", () => {
  let app: INestApplication;
  const prisma = createPrismaClient({ connectionString: databaseUrl });
  const legacyAuditId = randomUUID();
  const legacyTargetId = randomUUID();
  const action = `test.audit.legacy_uuid.${legacyAuditId.slice(0, 8)}`;
  const database = {
    client: prisma,
    healthCheck: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
  } as unknown as PrismaService;

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.auditLog.create({
      data: {
        id: legacyAuditId,
        actorId: null,
        actorType: "system",
        action,
        targetType: "test_fixture",
        targetId: legacyTargetId,
        workspaceId: null,
        ip: null,
        userAgent: "vitest-postgres",
        metadata: { source: "admin-audit-uuid-compat" },
      },
    });

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
      .useValue({
        ping: async () => undefined,
        subscribeChannel: () => ({ close: async () => undefined }),
      })
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
          const request = context.switchToHttp().getRequest() as {
            headers?: Record<string, string>;
            user?: unknown;
          };
          const role = request.headers?.["x-test-role"] as PlatformRole | undefined;
          if (!role) {
            throw new UnauthorizedException({ code: "UNAUTHENTICATED" });
          }
          request.user = makeActor(USER_OWNER_ID, { platformRole: role }).user;
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
        await prisma.auditLog.deleteMany({ where: { id: legacyAuditId } });
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  it("returns 200 for audit, export, metrics, and emails with a legacy UUIDv4 audit row", async () => {
    const auditResponse = await request(app.getHttpServer())
      .get("/v1/admin/audit")
      .query({ limit: 100 })
      .set("x-test-role", "super_admin");

    expect(auditResponse.status).toBe(200);
    expect(auditResponse.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: legacyAuditId,
          targetId: legacyTargetId,
          action,
        }),
      ]),
    );

    const exportResponse = await request(app.getHttpServer())
      .get("/v1/admin/audit/export")
      .set("x-test-role", "super_admin");

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.text).toContain(legacyAuditId);

    for (const path of ["/v1/admin/metrics", "/v1/admin/emails"]) {
      const response = await request(app.getHttpServer())
        .get(path)
        .set("x-test-role", "super_admin");
      expect(response.status, `${path} should not fail because of the legacy audit row`).toBe(200);
    }
  });
});
