import { UnauthorizedException } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import type { PlatformRole } from "@roamlog/contracts";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminModule } from "../src/modules/admin/admin.module.js";
import { AdminQueueService } from "../src/modules/admin/admin-queue.service.js";
import { AppConfigModule } from "../src/config/app-config.module.js";
import { configureApp } from "../src/bootstrap/configure-app.js";
import { SessionGuard } from "../src/common/guards/session.guard.js";
import { PrismaService } from "../src/modules/prisma/prisma.service.js";
import { PrismaModule } from "../src/modules/prisma/prisma.module.js";
import { ObservabilityModule } from "../src/modules/observability/observability.module.js";
import { RedisService } from "../src/modules/redis/redis.service.js";
import { RedisModule } from "../src/modules/redis/redis.module.js";
import { StorageService } from "../src/modules/storage/storage.service.js";
import { StorageModule } from "../src/modules/storage/storage.module.js";
import { makeActor, USER_OWNER_ID } from "./identity-fixtures.js";

describe("admin route wiring", () => {
  let app: INestApplication;

  beforeAll(async () => {
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
      .useValue({ client: {}, healthCheck: async () => undefined })
      .overrideProvider(RedisService)
      .useValue({ ping: async () => undefined })
      .overrideProvider(StorageService)
      .useValue({ checkHealth: async () => undefined })
      .overrideProvider(AdminQueueService)
      .useValue({ stats: async () => [], listJobs: async () => ({ items: [] }) })
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
});
