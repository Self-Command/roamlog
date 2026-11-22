import type { ExecutionContext, INestApplication } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  PLATFORM_ROLE_ACTIONS,
  ProviderConnectionSchema,
  ProviderGroupResponseSchema,
  type ProviderConnection,
  type ProviderGroupResponse,
} from "@roamlog/contracts";
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
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { providerProblem } from "./provider-errors.js";
import { ProviderCatalogController } from "./provider-catalog.controller.js";
import { ProviderConfigService } from "./provider-config.service.js";
import { ProviderGroupsController } from "./provider-groups.controller.js";
import { ProviderProbeService } from "./provider-probe.service.js";
import { ProviderSecretService } from "./provider-secret.service.js";
import { ProvidersController } from "./providers.controller.js";

const PROVIDER_ID = "01942f30-1200-7000-8000-000000000901";

const connection: ProviderConnection = ProviderConnectionSchema.parse({
  id: PROVIDER_ID,
  group: "ai",
  adapter: "openai-chat",
  preset: "openai",
  label: "OpenAI",
  enabled: true,
  priority: 10,
  config: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o" },
  version: 2,
  secrets: [{ field: "apiKey", hasValue: true, last4: "9abc", version: 2 }],
  health: {
    status: "unknown",
    lastCheckedAt: null,
    lastErrorCode: null,
    cooldownUntil: null,
  },
  createdAt: "2026-11-22T00:00:00.000Z",
  updatedAt: "2026-11-22T00:00:00.000Z",
});

const group: ProviderGroupResponse = ProviderGroupResponseSchema.parse({
  group: "ai",
  label: "AI 服务",
  routingMode: "priority",
  maxAttempts: 3,
  cooldownSeconds: 30,
  version: 1,
  providers: [connection],
});

const codeMatrixAuthz: AdminAuthzPort = {
  getEffectiveActions: async (role) => new Set(PLATFORM_ROLE_ACTIONS[role]),
  invalidate: () => undefined,
};

const apps: INestApplication[] = [];

function fakeConfigService() {
  return {
    getGroup: vi.fn(async () => group),
    patchPolicy: vi.fn(async () => group),
    create: vi.fn(async () => connection),
    update: vi.fn(async () => connection),
    remove: vi.fn(async () => ({ message: "Provider deleted." })),
    reorder: vi.fn(async () => group),
    groupForProvider: vi.fn(async () => "ai"),
  };
}

function fakeSecretService() {
  return {
    replace: vi.fn(async () => ({
      field: "apiKey",
      hasValue: true,
      last4: "5678",
      version: 3,
    })),
    resolvePlaintext: vi.fn(async () => ({ apiKey: "sk-live-provider-5678" })),
  };
}

function fakeProbeService() {
  return {
    probeDraft: vi.fn(async () => ({
      ok: true,
      providerId: null,
      testedAt: "2026-11-22T00:00:00.000Z",
      checks: [],
    })),
    probeSaved: vi.fn(async () => ({
      ok: true,
      providerId: PROVIDER_ID,
      testedAt: "2026-11-22T00:00:00.000Z",
      checks: [],
    })),
  };
}

async function createApp(options: {
  user?: ReturnType<typeof makeActor>["user"];
  twoFactorEnforced?: boolean;
  twoFactorState?: {
    twoFactorEnabled: boolean;
    twoFactors: Array<{ id: string }>;
  };
}) {
  const config = fakeConfigService();
  const secrets = fakeSecretService();
  const probes = fakeProbeService();
  const audit = { record: vi.fn(async () => ({ id: "audit-id" })) };
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
        findUnique: vi.fn(
          async () =>
            options.twoFactorState ?? {
              twoFactorEnabled: true,
              twoFactors: [{ id: "factor-id" }],
            },
        ),
      },
    },
  };

  const builder = Test.createTestingModule({
    controllers: [ProviderCatalogController, ProviderGroupsController, ProvidersController],
    providers: [
      { provide: ProviderConfigService, useValue: config },
      { provide: ProviderSecretService, useValue: secrets },
      { provide: ProviderProbeService, useValue: probes },
      { provide: AuditService, useValue: audit },
      { provide: ADMIN_AUTHZ_PORT, useValue: codeMatrixAuthz },
      {
        provide: AppConfigService,
        useValue: { adminTwoFactorEnforced: options.twoFactorEnforced ?? false },
      },
      { provide: PrismaService, useValue: prisma },
      AdminGuard,
      PlatformTwoFactorGuard,
    ],
  });

  builder.overrideGuard(SessionGuard).useValue({
    canActivate: (context: ExecutionContext) => {
      const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
      if (!options.user) {
        throw new UnauthorizedException({
          code: "UNAUTHENTICATED",
          message: "A valid session is required.",
        });
      }
      request.user = options.user;
      return true;
    },
  });

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(
    new ProblemDetailsFilter(logger as never, { captureException: vi.fn() } as never),
  );
  await app.init();
  apps.push(app);
  return { app, config, secrets, audit, probes };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Provider Admin HTTP routes", () => {
  it("returns 401 without a session", async () => {
    const { app } = await createApp({});

    await request(app.getHttpServer()).get("/v1/admin/provider-catalog").expect(401);
  });

  it("allows a super_admin to read the catalog and group", async () => {
    const user = makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }).user;
    const { app, config } = await createApp({ user });

    const catalog = await request(app.getHttpServer())
      .get("/v1/admin/provider-catalog")
      .expect(200);
    expect(catalog.body.groups[0]?.group).toBe("ai");

    const response = await request(app.getHttpServer())
      .get("/v1/admin/provider-groups/ai")
      .expect(200);
    expect(response.body.group).toBe("ai");
    expect(config.getGroup).toHaveBeenCalledWith("ai");
  });

  it("rejects non-super-admin roles", async () => {
    const user = makeActor(USER_ADMIN_ID, { platformRole: "analyst" }).user;
    const { app } = await createApp({ user });

    await request(app.getHttpServer()).get("/v1/admin/provider-catalog").expect(403);
  });

  it("requires verified TOTP when enforcement is on", async () => {
    const user = makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }).user;
    const { app } = await createApp({
      user,
      twoFactorEnforced: true,
      twoFactorState: { twoFactorEnabled: false, twoFactors: [] },
    });

    const response = await request(app.getHttpServer())
      .get("/v1/admin/provider-catalog")
      .expect(403);
    expect(response.body.code).toBe("ADMIN_2FA_REQUIRED");
  });

  it("validates policy bodies and maps version conflicts", async () => {
    const user = makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }).user;
    const { app, config } = await createApp({ user });

    await request(app.getHttpServer())
      .patch("/v1/admin/provider-groups/ai")
      .send({ routingMode: "priority" })
      .expect(400);

    config.patchPolicy.mockRejectedValueOnce(providerProblem("PROVIDER_VERSION_CONFLICT"));
    const conflict = await request(app.getHttpServer())
      .patch("/v1/admin/provider-groups/ai")
      .send({
        routingMode: "priority",
        maxAttempts: 3,
        cooldownSeconds: 30,
        expectedVersion: 1,
      })
      .expect(409);
    expect(conflict.body.code).toBe("PROVIDER_VERSION_CONFLICT");
  });

  it("creates a provider with initial secrets without echoing plaintext", async () => {
    const user = makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }).user;
    const { app, config } = await createApp({ user });

    const response = await request(app.getHttpServer())
      .post("/v1/admin/providers")
      .send({
        group: "ai",
        adapter: "openai-chat",
        preset: "openai",
        label: "OpenAI",
        config: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o" },
        secrets: { apiKey: "sk-test-secret" },
      })
      .expect(201);

    expect(response.body.secrets[0]).toMatchObject({
      field: "apiKey",
      hasValue: true,
      last4: "9abc",
    });
    expect(JSON.stringify(response.body)).not.toContain("sk-test-secret");
    expect(config.create).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ platformRole: "super_admin" }) }),
      expect.objectContaining({ secrets: { apiKey: "sk-test-secret" } }),
    );
  });

  it("replaces and reveals a secret through dedicated routes", async () => {
    const user = makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }).user;
    const { app, secrets, audit } = await createApp({ user });

    const replaced = await request(app.getHttpServer())
      .put(`/v1/admin/providers/${PROVIDER_ID}/secrets/apiKey`)
      .send({ value: "sk-new-5678", expectedVersion: 2 })
      .expect(200);
    expect(replaced.body).toMatchObject({ last4: "5678", version: 3 });
    expect(secrets.replace).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: PROVIDER_ID, field: "apiKey" }),
    );

    const revealed = await request(app.getHttpServer())
      .post(`/v1/admin/providers/${PROVIDER_ID}/secrets/apiKey/reveal`)
      .send({ confirm: true })
      .expect(200);
    expect(revealed.body.value).toBe("sk-live-provider-5678");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.provider.secret_revealed",
        metadata: { field: "apiKey", last4: "5678" },
      }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("sk-live-provider-5678");
  });

  it("routes draft and saved probes through the guarded provider service", async () => {
    const user = makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }).user;
    const { app, probes } = await createApp({ user });

    await request(app.getHttpServer())
      .post("/v1/admin/providers/probe")
      .send({
        group: "ai",
        adapter: "openai-chat",
        preset: "openai",
        config: { baseUrl: "https://api.openai.com/v1" },
        secrets: { apiKey: "sk-draft" },
      })
      .expect(200);
    expect(probes.probeDraft).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ platformRole: "super_admin" }) }),
      expect.objectContaining({ group: "ai", adapter: "openai-chat" }),
    );

    await request(app.getHttpServer())
      .post(`/v1/admin/providers/${PROVIDER_ID}/probe?expectedVersion=2`)
      .expect(200);
    expect(probes.probeSaved).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ platformRole: "super_admin" }) }),
      PROVIDER_ID,
      2,
    );
  });
});
