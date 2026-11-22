import type { ExecutionContext, INestApplication } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PLATFORM_ROLE_ACTIONS, ProviderModelSchema, type ProviderModel } from "@roamlog/contracts";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProblemDetailsFilter } from "../../common/filters/problem-details.filter.js";
import type { AuthenticatedRequest } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { makeActor, USER_ADMIN_ID } from "../../../test/identity-fixtures.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { AdminGuard } from "../admin/admin.guard.js";
import { ADMIN_AUTHZ_PORT, type AdminAuthzPort } from "../admin/admin-authz.service.js";
import { PlatformTwoFactorGuard } from "../admin/platform-two-factor.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ProviderModelDiscoveryService } from "./provider-model-discovery.service.js";
import { ProviderModelService } from "./provider-model.service.js";
import { ProviderModelsController } from "./provider-models.controller.js";

const PROVIDER_ID = "01942f30-1200-7000-8000-000000000901";
const model: ProviderModel = ProviderModelSchema.parse({
  id: "01942f30-1200-7000-8000-000000000902",
  providerId: PROVIDER_ID,
  modelId: "gpt-4o",
  displayName: "GPT-4o",
  ownedBy: "openai",
  enabled: true,
  isDefault: true,
  capabilities: {},
  discoveredAt: "2026-11-22T00:00:00.000Z",
  updatedAt: "2026-11-22T00:00:00.000Z",
});

const codeMatrixAuthz: AdminAuthzPort = {
  getEffectiveActions: async (role) => new Set(PLATFORM_ROLE_ACTIONS[role]),
  invalidate: () => undefined,
};

const discoveryResult = {
  models: [
    {
      modelId: "gpt-4o",
      displayName: "GPT-4o",
      ownedBy: "openai",
      capabilities: {},
    },
  ],
  fetchedAt: "2026-11-22T00:00:00.000Z",
  manualEntryRequired: false,
};

const apps: INestApplication[] = [];

async function createApp() {
  const discovery = {
    discoverDraft: vi.fn(async () => discoveryResult),
    refreshSaved: vi.fn(async () => discoveryResult),
  };
  const models = { update: vi.fn(async () => model) };
  const logger = {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  };
  const prisma = {
    client: {
      user: {
        findUnique: vi.fn(async () => ({
          twoFactorEnabled: true,
          twoFactors: [{ id: "factor-id" }],
        })),
      },
    },
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [ProviderModelsController],
    providers: [
      { provide: ProviderModelDiscoveryService, useValue: discovery },
      { provide: ProviderModelService, useValue: models },
      { provide: ADMIN_AUTHZ_PORT, useValue: codeMatrixAuthz },
      {
        provide: AppConfigService,
        useValue: { adminTwoFactorEnforced: false },
      },
      { provide: PrismaService, useValue: prisma },
      AdminGuard,
      PlatformTwoFactorGuard,
    ],
  })
    .overrideGuard(SessionGuard)
    .useValue({
      canActivate: (context: ExecutionContext) => {
        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        const user = makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }).user;
        if (!user) {
          throw new UnauthorizedException();
        }
        request.user = user;
        return true;
      },
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(
    new ProblemDetailsFilter(logger as never, { captureException: vi.fn() } as never),
  );
  await app.init();
  apps.push(app);
  return { app, discovery, models };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Provider models HTTP routes", () => {
  it("discovers draft and saved models, refreshes, and updates model settings", async () => {
    const { app, discovery, models } = await createApp();

    await request(app.getHttpServer())
      .post("/v1/admin/provider-models/discover")
      .send({
        group: "ai",
        adapter: "openai-chat",
        preset: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-draft",
      })
      .expect(200);
    expect(discovery.discoverDraft).toHaveBeenCalled();

    await request(app.getHttpServer())
      .post("/v1/admin/provider-models/discover")
      .send({
        providerId: PROVIDER_ID,
        group: "ai",
        adapter: "openai-chat",
        preset: "openai",
        expectedVersion: 2,
      })
      .expect(200);
    expect(discovery.refreshSaved).toHaveBeenCalledWith(expect.anything(), PROVIDER_ID, 2);

    await request(app.getHttpServer())
      .post(`/v1/admin/providers/${PROVIDER_ID}/models/refresh?expectedVersion=2`)
      .expect(200);
    expect(discovery.refreshSaved).toHaveBeenCalledWith(expect.anything(), PROVIDER_ID, 2);

    await request(app.getHttpServer())
      .patch(`/v1/admin/providers/${PROVIDER_ID}/models/gpt-4o`)
      .send({ isDefault: true, expectedVersion: 2 })
      .expect(200);
    expect(models.update).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ platformRole: "super_admin" }) }),
      PROVIDER_ID,
      "gpt-4o",
      { isDefault: true, expectedVersion: 2 },
    );
  });
});
