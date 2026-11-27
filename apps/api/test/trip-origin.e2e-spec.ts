import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { configureApp } from "../src/bootstrap/configure-app.js";
import { TenantGuard } from "../src/common/guards/tenant.guard.js";
import { SanitizeModule } from "../src/common/services/sanitize.module.js";
import { AppConfigModule } from "../src/config/app-config.module.js";
import { ActivitiesService } from "../src/modules/activities/activities.service.js";
import { ObservabilityModule } from "../src/modules/observability/observability.module.js";
import { PrismaModule } from "../src/modules/prisma/prisma.module.js";
import { PrismaService } from "../src/modules/prisma/prisma.service.js";
import { RedisModule } from "../src/modules/redis/redis.module.js";
import { RedisService } from "../src/modules/redis/redis.service.js";
import { StorageModule } from "../src/modules/storage/storage.module.js";
import { StorageService } from "../src/modules/storage/storage.service.js";
import { TripsModule } from "../src/modules/trips/trips.module.js";
import { TripsRepository } from "../src/modules/trips/trips.repository.js";
import { membership, tripRecord } from "./content-fixtures.js";
import { NOW, USER_OWNER_ID, WORKSPACE_A_ID, makeActor } from "./identity-fixtures.js";

describe("trip origin normalization", () => {
  let app: INestApplication;
  const createTrip = vi.fn();
  const findTrip = vi.fn();
  let storedTrip: ReturnType<typeof tripRecord> | null = null;

  beforeAll(async () => {
    createTrip.mockImplementation(async (_tx: unknown, data: Record<string, unknown>) => {
      storedTrip = tripRecord({
        ...data,
        id: "01942f30-1200-7000-8000-000000000901",
        version: 1,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      });
      return storedTrip;
    });
    // `TripsService.create` re-reads the row inside the same transaction right
    // after it writes destinations (`trips.service.ts:241/262`). The real
    // repository returns the created row for the caller's workspace and `null`
    // for anything else; the mock mirrors that contract instead of resolving
    // to the first row unconditionally.
    findTrip.mockImplementation(
      async (workspaceId: string, tripId: string, _tx?: unknown) =>
        storedTrip !== null &&
        workspaceId === WORKSPACE_A_ID &&
        tripId === storedTrip.id
          ? storedTrip
          : null,
    );
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        ObservabilityModule,
        PrismaModule,
        RedisModule,
        StorageModule,
        SanitizeModule,
        TripsModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ client: {}, healthCheck: vi.fn() })
      .overrideProvider(RedisService)
      .useValue({
        ping: vi.fn(),
        subscribeChannel: () => ({ close: async () => undefined }),
      })
      .overrideProvider(StorageService)
      .useValue({ checkHealth: vi.fn() })
      .overrideProvider(ActivitiesService)
      .useValue({ record: vi.fn().mockResolvedValue({ id: "activity" }) })
      .overrideProvider(TripsRepository)
      .useValue({
        transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({})),
        findMedia: vi.fn(),
        createTrip,
        createDestinations: vi.fn().mockResolvedValue(undefined),
        findTrip,
        createParticipant: vi.fn().mockResolvedValue({ id: "participant" }),
      })
      .overrideGuard(TenantGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) => {
          const requestContext = context.switchToHttp().getRequest() as {
            user?: unknown;
            workspaceMembership?: unknown;
          };
          requestContext.user = makeActor(USER_OWNER_ID).user;
          requestContext.workspaceMembership = membership("owner");
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("creates a trip with a normalized origin when the optional field is omitted", async () => {
    const response = await request(app.getHttpServer())
      .post(`/v1/workspaces/${WORKSPACE_A_ID}/trips`)
      .send({
        title: "Origin omitted",
        startDate: "2027-08-01",
        endDate: "2027-08-02",
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      title: "Origin omitted",
      origin: "未填写",
    });
    expect(createTrip).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ origin: "未填写" }),
    );
  });

  it("trims a supplied origin before storing it", async () => {
    const response = await request(app.getHttpServer())
      .post(`/v1/workspaces/${WORKSPACE_A_ID}/trips`)
      .send({
        title: "Origin supplied",
        startDate: "2027-08-03",
        endDate: "2027-08-04",
        origin: "  Shanghai  ",
      });

    expect(response.status).toBe(201);
    expect(response.body.origin).toBe("Shanghai");
  });
});
