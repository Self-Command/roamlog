import { UnauthorizedException } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import type { PlatformRole } from "@roamlog/contracts";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AdminModule } from "../src/modules/admin/admin.module.js";
import { AdminQueueService } from "../src/modules/admin/admin-queue.service.js";
import { AdminEmailsService } from "../src/modules/admin/admin-emails.service.js";
import { AuditService } from "../src/modules/audit/audit.service.js";
import { AppConfigModule } from "../src/config/app-config.module.js";
import { configureApp } from "../src/bootstrap/configure-app.js";
import { SessionGuard } from "../src/common/guards/session.guard.js";
import { IdempotencyService } from "../src/modules/idempotency/idempotency.service.js";
import { PrismaService } from "../src/modules/prisma/prisma.service.js";
import { PrismaModule } from "../src/modules/prisma/prisma.module.js";
import { ObservabilityModule } from "../src/modules/observability/observability.module.js";
import { RedisService } from "../src/modules/redis/redis.service.js";
import { RedisModule } from "../src/modules/redis/redis.module.js";
import { StorageService } from "../src/modules/storage/storage.service.js";
import { StorageModule } from "../src/modules/storage/storage.module.js";
import { makeActor, NOW, USER_ADMIN_ID, USER_OWNER_ID } from "./identity-fixtures.js";

describe("admin route wiring", () => {
  let app: INestApplication;
  const idempotencyCache = new Map<string, unknown>();
  const resendEmail = vi.fn();

  beforeAll(async () => {
    idempotencyCache.clear();
    resendEmail.mockReset().mockResolvedValue({
      id: "01942f30-1200-7000-8000-000000000801",
      userId: USER_ADMIN_ID,
      to: "viewer@roamlog.test",
      template: "auth.verify-email",
      subject: "Verify your email",
      providerId: null,
      status: "queued",
      error: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
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
      .useValue({
        client: {
          user: {
            findMany: async () => [],
          },
          workspace: {
            findMany: async () => [],
          },
          auditLog: {
            findMany: async () => [
              {
                id: "01942f30-1200-7000-8000-000000000701",
                actorId: USER_ADMIN_ID,
                actorType: "admin",
                action: "admin.user.suspend",
                targetType: "user",
                targetId: "01942f30-1200-7000-8000-000000000702",
                workspaceId: null,
                ip: "127.0.0.1",
                userAgent: "supertest",
                metadata: { source: "admin-routes" },
                createdAt: NOW,
              },
            ],
          },
        },
        healthCheck: async () => undefined,
      })
      .overrideProvider(RedisService)
      .useValue({ ping: async () => undefined })
      .overrideProvider(StorageService)
      .useValue({ checkHealth: async () => undefined })
      .overrideProvider(AdminQueueService)
      .useValue({
        stats: async () => [],
        listJobs: async () => ({ items: [], nextCursor: null, hasMore: false }),
        pauseQueue: async () => undefined,
        resumeQueue: async () => undefined,
        clearFailed: async () => 2,
        workerHealth: async () => ({ status: "up", consumers: 5 }),
      })
      .overrideProvider(AuditService)
      .useValue({ record: async () => ({ id: "01942f30-1200-7000-8000-000000000799" }) })
      .overrideProvider(AdminEmailsService)
      .useValue({ resend: resendEmail })
      .overrideProvider(IdempotencyService)
      .useValue({
        run: async (scope: string, key: string, operation: () => Promise<unknown>) => {
          const cacheKey = `${scope}:${key}`;
          if (idempotencyCache.has(cacheKey)) {
            return idempotencyCache.get(cacheKey);
          }
          const result = await operation();
          idempotencyCache.set(cacheKey, result);
          return result;
        },
      })
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) => {
          const headers = context.switchToHttp().getRequest() as {
            headers?: Record<string, string>;
            user?: unknown;
          };
          const role = headers.headers?.["x-test-role"] as PlatformRole | undefined;
          if (!role) {
            throw new UnauthorizedException({ code: "UNAUTHENTICATED" });
          }
          headers.user = makeActor(USER_OWNER_ID, { platformRole: role }).user;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ["get", "/v1/admin/metrics"],
    ["get", "/v1/admin/users"],
    ["get", "/v1/admin/workspaces"],
    ["get", "/v1/admin/trips"],
    ["get", "/v1/admin/media"],
    ["get", "/v1/admin/audit"],
    ["get", "/v1/admin/flags"],
    ["get", "/v1/admin/emails"],
    ["get", "/v1/admin/jobs"],
    ["post", "/v1/admin/jobs/email/pause"],
    ["post", "/v1/admin/jobs/email/resume"],
    ["post", "/v1/admin/jobs/email/clear"],
    ["get", "/v1/admin/audit/export"],
    ["get", "/v1/admin/users/export"],
    ["get", "/v1/admin/workspaces/export"],
    ["get", "/v1/admin/system"],
  ] as const)("requires authentication for %s %s", async (method, path) => {
    const response = await request(app.getHttpServer())[method](path);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a normal user from admin routes", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/admin/metrics")
      .set("x-test-role", "user");

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("ADMIN_ACCESS_DENIED");
  });

  it.each(["admin", "support", "analyst"] as const)(
    "reserves queue lifecycle management for super_admin, not %s",
    async (role) => {
      for (const action of ["pause", "resume", "clear"] as const) {
        const response = await request(app.getHttpServer())
          .post(`/v1/admin/jobs/email/${action}`)
          .set("x-test-role", role);
        expect(response.status).toBe(403);
        expect(response.body.code).toBe("ADMIN_ACCESS_DENIED");
      }
    },
  );

  it("allows super_admin to manage queue lifecycle", async () => {
    const pause = await request(app.getHttpServer())
      .post("/v1/admin/jobs/email/pause")
      .set("x-test-role", "super_admin");
    expect(pause.status).toBe(200);
    expect(pause.body).toEqual({ queue: "email", paused: true });

    const resume = await request(app.getHttpServer())
      .post("/v1/admin/jobs/email/resume")
      .set("x-test-role", "super_admin");
    expect(resume.status).toBe(200);
    expect(resume.body).toEqual({ queue: "email", paused: false });

    const clear = await request(app.getHttpServer())
      .post("/v1/admin/jobs/email/clear")
      .set("x-test-role", "super_admin");
    expect(clear.status).toBe(200);
    expect(clear.body).toEqual({ queue: "email", cleared: true, removedJobs: 2 });
  });

  it("allows analysts to export audit CSV", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/admin/audit/export")
      .set("x-test-role", "analyst")
      .query({ actorType: "admin" });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.text).toContain("admin.user.suspend");
    expect(response.text).toContain("source");
  });

  it("streams user and workspace CSV exports without shadowing the :id route", async () => {
    const users = await request(app.getHttpServer())
      .get("/v1/admin/users/export")
      .set("x-test-role", "admin")
      .query({ q: "viewer" });

    expect(users.status).toBe(200);
    expect(users.headers["content-type"]).toContain("text/csv");
    expect(users.headers["content-disposition"]).toContain("roamlog-admin-users-");
    expect(users.text.startsWith("\uFEFFid,email,emailVerified,name,platformRole,status,")).toBe(
      true,
    );

    const workspaces = await request(app.getHttpServer())
      .get("/v1/admin/workspaces/export")
      .set("x-test-role", "admin")
      .query({ plan: "free" });

    expect(workspaces.status).toBe(200);
    expect(workspaces.headers["content-type"]).toContain("text/csv");
    expect(workspaces.headers["content-disposition"]).toContain("roamlog-admin-workspaces-");
    expect(workspaces.text.startsWith("\uFEFFid,name,slug,ownerId,plan,status,")).toBe(true);
  });

  it("rejects support and analysts from exporting user or workspace CSV", async () => {
    for (const role of ["support", "analyst"] as const) {
      for (const path of ["/v1/admin/users/export", "/v1/admin/workspaces/export"]) {
        const response = await request(app.getHttpServer())
          .get(path)
          .set("x-test-role", role);
        expect(response.status).toBe(403);
        expect(response.body.code).toBe("ADMIN_ACCESS_DENIED");
      }
    }
  });

  it("rejects support from exporting audit CSV", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/admin/audit/export")
      .set("x-test-role", "support");

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("ADMIN_ACCESS_DENIED");
  });

  it("honors Idempotency-Key when an email is resent", async () => {
    const first = await request(app.getHttpServer())
      .post("/v1/admin/emails/01942f30-1200-7000-8000-000000000801/resend")
      .set("x-test-role", "support")
      .set("Idempotency-Key", "resend-once");
    const second = await request(app.getHttpServer())
      .post("/v1/admin/emails/01942f30-1200-7000-8000-000000000801/resend")
      .set("x-test-role", "support")
      .set("Idempotency-Key", "resend-once");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(resendEmail).toHaveBeenCalledTimes(1);
  });
});
