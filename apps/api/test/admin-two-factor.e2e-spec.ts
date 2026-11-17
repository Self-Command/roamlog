import { UnauthorizedException } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureApp } from "../src/bootstrap/configure-app.js";
import { SessionGuard } from "../src/common/guards/session.guard.js";
import { AppConfigModule } from "../src/config/app-config.module.js";
import { AdminModule } from "../src/modules/admin/admin.module.js";
import { AdminQueueService } from "../src/modules/admin/admin-queue.service.js";
import { ObservabilityModule } from "../src/modules/observability/observability.module.js";
import { PrismaModule } from "../src/modules/prisma/prisma.module.js";
import { PrismaService } from "../src/modules/prisma/prisma.service.js";
import { RedisModule } from "../src/modules/redis/redis.module.js";
import { RedisService } from "../src/modules/redis/redis.service.js";
import { StorageModule } from "../src/modules/storage/storage.module.js";
import { StorageService } from "../src/modules/storage/storage.service.js";
import { makeActor, USER_ADMIN_ID } from "./identity-fixtures.js";

describe("Admin 2FA enforcement route gate", () => {
  let app: INestApplication;
  const previousEnforcement = process.env.ADMIN_2FA_ENFORCED;

  beforeAll(async () => {
    process.env.ADMIN_2FA_ENFORCED = "true";
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
            findUnique: async () => ({
              twoFactorEnabled: false,
              twoFactors: [],
            }),
          },
        },
        healthCheck: async () => undefined,
      })
      .overrideProvider(RedisService)
      .useValue({ ping: async () => undefined })
      .overrideProvider(StorageService)
      .useValue({ checkHealth: async () => undefined })
      .overrideProvider(AdminQueueService)
      .useValue({ stats: async () => [] })
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) => {
          const requestContext = context.switchToHttp().getRequest() as {
            user?: unknown;
            headers?: Record<string, string>;
          };
          if (requestContext.headers?.["x-test-role"] !== "admin") {
            throw new UnauthorizedException({ code: "UNAUTHENTICATED" });
          }
          requestContext.user = makeActor(USER_ADMIN_ID, {
            platformRole: "admin",
          }).user;
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
    if (previousEnforcement === undefined) {
      delete process.env.ADMIN_2FA_ENFORCED;
    } else {
      process.env.ADMIN_2FA_ENFORCED = previousEnforcement;
    }
  });

  it("returns 403 before Admin handlers when the Admin has no TOTP factor", async () => {
    const response = await request(app.getHttpServer())
      .get("/v1/admin/metrics")
      .set("x-test-role", "admin");

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("ADMIN_2FA_REQUIRED");
  });
});
