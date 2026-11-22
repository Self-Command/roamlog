/**
 * Full Provider lifecycle against a disposable PostgreSQL schema and Redis.
 *
 * The test deliberately uses the real Prisma/Redis services and the real
 * Provider HTTP controllers. Only the upstream AI/map adapter is replaced by a
 * local HTTP stub so the test can prove failover, model discovery and merged
 * map recall without crossing the network boundary.
 */
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type {
  ProviderConnection,
  ProviderGroupResponse,
  ProviderModelDiscoveryResponse,
} from "@roamlog/contracts";
import { createPrismaClient } from "@roamlog/db";
import request from "supertest";

import { AppConfigModule } from "../../../config/app-config.module.js";
import { AppConfigService } from "../../../config/app-config.service.js";
import { configureApp } from "../../../bootstrap/configure-app.js";
import { SessionGuard } from "../../../common/guards/session.guard.js";
import type { AuthenticatedActor } from "../../../common/guards/actor-context.js";
import { AuditService } from "../../audit/audit.service.js";
import { AdminGuard } from "../../admin/admin.guard.js";
import { PlatformTwoFactorGuard } from "../../admin/platform-two-factor.guard.js";
import { AiProviderRouter } from "../../ai/ai-provider-router.service.js";
import { OpenAiChatAdapter } from "../../ai/adapters/openai-chat.adapter.js";
import { AiUpstreamError } from "../../ai/adapters/http.js";
import { staticAiSettingsSource } from "../../ai/ai.settings.js";
import { GeoapifyClient } from "../../places/geoapify.client.js";
import { PhotonClient } from "../../places/photon.client.js";
import { TencentClient } from "../../places/tencent.client.js";
import { PlacesCacheService } from "../../places/places-cache.service.js";
import { PlacesMergeService } from "../../places/places-merge.service.js";
import { PlacesProviderRuntimeService } from "../../places/places-provider-runtime.service.js";
import { PlacesQuotaService } from "../../places/places-quota.service.js";
import { PlacesService } from "../../places/places.service.js";
import { staticPlacesSettingsSource } from "../../places/places.settings.js";
import {
  asLogger,
  fakeRedis,
  geoapifyFeature,
  geoapifyPayload,
  makeLogger,
  tencentGeocodePayload,
  tencentGeocodeResult,
  tencentSuggestionPayload,
  tencentSuggestItem,
  testSettings,
} from "../../places/__tests__/place-fixtures.js";
import { uuidV7FromString } from "../../admin/admin-ids.js";
import { ObservabilityModule } from "../../observability/observability.module.js";
import { PinoLoggerService } from "../../observability/pino-logger.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { RedisService } from "../../redis/redis.service.js";
import { ProviderConfigService } from "../provider-config.service.js";
import { ProviderImportService } from "../provider-import.service.js";
import { ProviderRuntimeService } from "../provider-runtime.service.js";
import { ProviderSecretService } from "../provider-secret.service.js";
import { ProvidersModule } from "../providers.module.js";
import { makeActor } from "../../../../test/identity-fixtures.js";

const providerConfigBootstrap = vi.hoisted(() => {
  const previousProviderConfigMode = process.env.PROVIDER_CONFIG_MODE;
  process.env.APP_ENV = "test";
  process.env.NODE_ENV = "test";
  process.env.PROVIDER_CONFIG_MODE = "v2";
  process.env.PROVIDER_EGRESS_ALLOW_PRIVATE = "true";
  process.env.CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.REDIS_PREFIX = `roamlog:test:provider-e2e:${process.pid}:${Date.now().toString(36)}:`;
  return { previousProviderConfigMode };
});

const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const enabled = Boolean(testDatabaseUrl && process.env.REDIS_URL);
const integration = enabled ? describe : describe.skip;

if (!enabled) {
  process.stderr.write(
    "SKIPPED provider runtime e2e: ROAMLOG_TEST_DATABASE_URL and REDIS_URL are required.\n",
  );
}

const runId = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
const actorId = uuidV7FromString(`provider-runtime-e2e-actor:${runId}`);
const actor = makeActor(actorId, {
  email: `provider-runtime-${runId}@roamlog.test`,
  name: "Provider Runtime E2E Admin",
  platformRole: "super_admin",
});
const labels = {
  aiFail: `e2e-${runId}-ai-fail`,
  aiOk: `e2e-${runId}-ai-ok`,
  tencent: `e2e-${runId}-tencent`,
  geoapify: `e2e-${runId}-geoapify`,
};
const secrets = {
  aiFail: `sk-e2e-fail-1111`,
  aiOk: `sk-e2e-ok-2222`,
  tencent: `e2e-tencent-key-3333`,
  geoapify: `e2e-geoapify-key-4444`,
};
const providerIds: string[] = [];
const upstreamCalls: string[] = [];
const envKeys = [
  "DATABASE_URL",
  "REDIS_PREFIX",
  "REDIS_REQUIRED",
  "PROVIDER_CONFIG_MODE",
  "PROVIDER_EGRESS_ALLOW_PRIVATE",
  "APP_ENV",
  "NODE_ENV",
  "CONFIG_ENCRYPTION_KEY",
] as const;
const previousEnv = new Map<string, string | undefined>();

type SeedClient = ReturnType<typeof createPrismaClient>;
let seedPrisma: SeedClient | undefined;
let app: INestApplication | undefined;
let stub: Server | undefined;
let stubBaseUrl = "";

function json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function modelCatalog() {
  return {
    data: [
      { id: "stub-model", display_name: "Stub Model", owned_by: "stub" },
      { id: "stub-model-2", display_name: "Stub Model Two", owned_by: "stub" },
    ],
  };
}

function createStubServer(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      upstreamCalls.push(`${req.method ?? "GET"} ${url.pathname}`);
      req.resume();

      if (url.pathname.endsWith("/models")) {
        json(res, 200, modelCatalog());
        return;
      }

      if (url.pathname.endsWith("/chat/completions")) {
        if (url.pathname.startsWith("/fail/")) {
          json(res, 500, { error: "stub failure" });
          return;
        }
        if (url.pathname.startsWith("/unauth/")) {
          json(res, 401, { error: "stub unauthorized" });
          return;
        }
        json(res, 200, {
          choices: [
            {
              message: { role: "assistant", content: "ok from stub provider" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        });
        return;
      }

      if (url.pathname.includes("/tencent/ws/place/v1/suggestion")) {
        json(
          res,
          200,
          tencentSuggestionPayload([
            tencentSuggestItem({
              title: "北京市",
              location: { lat: 39.9042, lng: 116.4074 },
            }),
          ]),
        );
        return;
      }
      if (url.pathname.includes("/tencent/ws/geocoder/v1")) {
        json(
          res,
          200,
          tencentGeocodePayload(
            tencentGeocodeResult({
              title: "北京市",
              location: { lat: 39.9042, lng: 116.4074 },
            }),
          ),
        );
        return;
      }
      if (url.pathname.includes("/geoapify/")) {
        json(
          res,
          200,
          geoapifyPayload([
            geoapifyFeature({
              name: "北京市",
              country: "中国",
              country_code: "cn",
              city: "北京市",
              coordinates: [116.4074, 39.9042],
            }),
          ]),
        );
        return;
      }

      json(res, 404, { error: "stub route not found" });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not determine provider stub address."));
        return;
      }
      stubBaseUrl = `http://127.0.0.1:${address.port}`;
      resolve(server);
    });
  });
}

async function createApp(): Promise<INestApplication> {
  if (!seedPrisma) {
    throw new Error("Provider e2e seed Prisma client is not initialized.");
  }
  const moduleRef = await Test.createTestingModule({
    imports: [AppConfigModule, ObservabilityModule, ProvidersModule],
  })
    .overrideProvider(PrismaService)
    .useValue({
      client: seedPrisma,
      healthCheck: async () => undefined,
    })
    .overrideGuard(SessionGuard)
    .useValue({
      canActivate(context: ExecutionContext): boolean {
        const req = context.switchToHttp().getRequest<{
          headers: Record<string, string | string[] | undefined>;
          user?: AuthenticatedActor["user"];
          ip?: string;
        }>();
        if (req.headers["x-test-auth"] !== "yes") {
          throw new UnauthorizedException({
            code: "UNAUTHENTICATED",
            message: "A valid session is required.",
          });
        }
        req.user = actor.user;
        Object.defineProperty(req, "ip", {
          value: actor.ip ?? "127.0.0.1",
          configurable: true,
        });
        req.headers["user-agent"] = actor.userAgent ?? "provider-runtime-e2e";
        return true;
      },
    })
    .overrideGuard(PlatformTwoFactorGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(AdminGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const application = moduleRef.createNestApplication({ logger: false });
  configureApp(application);
  await application.init();
  await waitForRedis(application.get(RedisService));
  return application;
}

async function waitForRedis(redis: RedisService): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await redis.ping();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

function http() {
  if (!app) {
    throw new Error("Provider e2e app is not initialized.");
  }
  return request.agent(app.getHttpServer()).set("x-test-auth", "yes");
}

async function getGroup(
  group: "ai" | "places" | "mail" | "storage",
): Promise<ProviderGroupResponse> {
  const response = await http().get(`/v1/admin/provider-groups/${group}`).expect(200);
  return response.body as ProviderGroupResponse;
}

async function createAiProvider(
  label: string,
  baseUrl: string,
  key: string,
  priority = 10,
): Promise<ProviderConnection> {
  const response = await http()
    .post("/v1/admin/providers")
    .send({
      group: "ai",
      adapter: "openai-chat",
      preset: "custom-openai-compatible",
      label,
      enabled: true,
      priority,
      config: {
        baseUrl,
        timeoutMs: 5_000,
        maxOutputTokens: 512,
      },
      secrets: { apiKey: key },
    })
    .expect(201);
  const provider = response.body as ProviderConnection;
  providerIds.push(provider.id);
  expect(provider.secrets).toEqual([
    expect.objectContaining({ field: "apiKey", hasValue: true, last4: key.slice(-4) }),
  ]);
  expect(JSON.stringify(provider)).not.toContain(key);
  return provider;
}

async function discoverAndSetDefault(providerId: string): Promise<string> {
  let group = await getGroup("ai");
  let provider = group.providers.find((entry) => entry.id === providerId);
  if (!provider) throw new Error(`Provider ${providerId} was not returned by the group.`);

  const discovery = await http()
    .post("/v1/admin/provider-models/discover")
    .send({
      providerId,
      group: "ai",
      adapter: provider.adapter,
      preset: provider.preset,
      expectedVersion: provider.version,
    })
    .expect(200);
  const discovered = discovery.body as ProviderModelDiscoveryResponse;
  expect(discovered.models.map((model) => model.modelId)).toContain("stub-model");

  group = await getGroup("ai");
  provider = group.providers.find((entry) => entry.id === providerId);
  if (!provider) throw new Error(`Provider ${providerId} disappeared after discovery.`);

  await http()
    .patch(`/v1/admin/providers/${providerId}/models/${encodeURIComponent("stub-model")}`)
    .send({ enabled: true, isDefault: true, expectedVersion: provider.version })
    .expect(200);
  return "stub-model";
}

async function patchProviderConfig(
  providerId: string,
  groupName: "ai" | "places",
  baseUrl: string,
): Promise<void> {
  const group = await getGroup(groupName);
  const provider = group.providers.find((entry) => entry.id === providerId);
  if (!provider) throw new Error(`Provider ${providerId} was not found.`);
  await http()
    .patch(`/v1/admin/providers/${providerId}`)
    .send({
      config: { ...provider.config, baseUrl },
      expectedVersion: provider.version,
    })
    .expect(200);
}

function createPlacesService(): PlacesService {
  if (!app) throw new Error("Provider e2e app is not initialized.");
  const settings = testSettings();
  const source = staticPlacesSettingsSource(settings);
  const logger = asLogger(makeLogger());
  const redis = fakeRedis();
  const cache = new PlacesCacheService(redis as unknown as RedisService, logger, source);
  const runtime = new PlacesProviderRuntimeService(app.get(ProviderRuntimeService), source);
  return new PlacesService(
    cache,
    new GeoapifyClient(source),
    new PhotonClient(source),
    new TencentClient(source),
    new PlacesQuotaService(redis as unknown as RedisService, logger, source),
    new PlacesMergeService(),
    logger,
    source,
    runtime,
  );
}

function aiSettingsSource() {
  return staticAiSettingsSource({
    protocol: "openai-chat",
    baseUrl: null,
    apiKey: null,
    model: "",
    allowedModels: [],
    timeoutMs: 5_000,
    maxOutputTokens: 512,
    dailyQuota: 0,
    vision: false,
    configured: false,
  });
}

integration("Provider runtime against PostgreSQL, Redis and a local upstream stub", () => {
  beforeAll(async () => {
    if (!testDatabaseUrl) return;

    for (const key of envKeys) {
      previousEnv.set(
        key,
        key === "PROVIDER_CONFIG_MODE"
          ? providerConfigBootstrap.previousProviderConfigMode
          : process.env[key],
      );
    }
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.REDIS_REQUIRED = "false";

    seedPrisma = createPrismaClient({ connectionString: testDatabaseUrl });
    await seedPrisma.user.create({
      data: {
        id: actorId,
        email: actor.user.email,
        emailVerified: true,
        name: actor.user.name,
        platformRole: "super_admin",
        status: "active",
      },
    });

    stub = await createStubServer();
    app = await createApp();
    expect(app.get(AppConfigService).providerConfigMode).toBe("v2");
  }, 60_000);

  afterAll(async () => {
    await app?.close();

    if (seedPrisma) {
      const leftovers = await seedPrisma.providerConnection.findMany({
        where: { label: { startsWith: `e2e-${runId}` } },
        select: { id: true },
      });
      const cleanupIds = [...new Set([...providerIds, ...leftovers.map((row) => row.id)])];
      if (cleanupIds.length > 0) {
        await seedPrisma.auditLog.deleteMany({
          where: { targetId: { in: cleanupIds } },
        });
        await seedPrisma.providerConnection.deleteMany({
          where: { id: { in: cleanupIds } },
        });
      }
      await seedPrisma.user.deleteMany({ where: { id: actorId } });
      await seedPrisma.$disconnect();
    }

    if (stub) {
      await new Promise<void>((resolve) => stub?.close(() => resolve()));
    }

    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }, 60_000);

  it("proves discovery, failover, map routing, ordering and audit without leaking keys", async () => {
    const catalog = await http().get("/v1/admin/provider-catalog");
    if (catalog.status !== 200) {
      throw new Error(
        `Provider catalog returned HTTP ${catalog.status}: ${JSON.stringify(catalog.body)}`,
      );
    }
    expect(catalog.body.groups.map((group: { group: string }) => group.group)).toEqual([
      "ai",
      "places",
      "mail",
      "storage",
    ]);

    await request(app!.getHttpServer()).get("/v1/admin/provider-catalog").expect(401);

    const aiFail = await createAiProvider(
      labels.aiFail,
      `${stubBaseUrl}/fail/v1`,
      secrets.aiFail,
      10,
    );
    const aiOk = await createAiProvider(labels.aiOk, `${stubBaseUrl}/ok/v1`, secrets.aiOk, 20);

    const initialAiGroup = await getGroup("ai");
    expect(initialAiGroup.providers.map((provider) => provider.id)).toEqual([aiFail.id, aiOk.id]);
    expect(initialAiGroup.providers.map((provider) => provider.priority)).toEqual([10, 20]);

    await discoverAndSetDefault(aiFail.id);
    await discoverAndSetDefault(aiOk.id);

    const router = new AiProviderRouter(
      app!.get(ProviderRuntimeService),
      app!.get(PrismaService),
      aiSettingsSource(),
      app!.get(PinoLoggerService),
    );
    const candidates = await router.candidates();
    expect(candidates.map((candidate) => candidate.runtime.id)).toEqual([aiFail.id, aiOk.id]);

    const callsBeforeFailover = upstreamCalls.length;
    const result = await router.runWithFailover(candidates, async (candidate) => {
      const adapter = new OpenAiChatAdapter(candidate.settings);
      return adapter.step({
        system: "Return a short travel note.",
        messages: [{ role: "user", content: "Write one line." }],
        tools: [],
        maxTokens: 64,
        timeoutMs: 5_000,
      });
    });
    expect(result.text).toBe("ok from stub provider");
    expect(upstreamCalls.slice(callsBeforeFailover)).toEqual([
      "POST /fail/v1/chat/completions",
      "POST /ok/v1/chat/completions",
    ]);

    await patchProviderConfig(aiFail.id, "ai", `${stubBaseUrl}/unauth/v1`);
    const unauthCandidates = await router.candidates();
    await expect(
      router.runWithFailover(unauthCandidates, async (candidate) => {
        const adapter = new OpenAiChatAdapter(candidate.settings);
        return adapter.step({
          system: "Return a short travel note.",
          messages: [{ role: "user", content: "Write one line." }],
          tools: [],
          maxTokens: 64,
          timeoutMs: 5_000,
        });
      }),
    ).rejects.toBeInstanceOf(AiUpstreamError);

    const streamAttempts: string[] = [];
    const stream = router.streamWithFailover(
      unauthCandidates,
      async function* (candidate) {
        streamAttempts.push(candidate.runtime.id);
        yield { type: "meta" as const };
        yield { type: "text.delta" as const, text: "first token" };
        throw new AiUpstreamError("network");
      },
      (event) => event.type === "text.delta",
    );
    const streamed: string[] = [];
    await expect(
      (async () => {
        for (;;) {
          const next = await stream.next();
          if (next.done) return next.value;
          streamed.push(next.value.event.type);
        }
      })(),
    ).rejects.toBeInstanceOf(AiUpstreamError);
    expect(streamAttempts).toEqual([aiFail.id]);
    expect(streamed).toEqual(["meta", "text.delta"]);

    const importer = new ProviderImportService(
      app!.get(ProviderConfigService),
      app!.get(ProviderSecretService),
      app!.get(AuditService),
    );
    const tencentImport = await importer.importProvider(actor, {
      group: "places",
      adapter: "tencent",
      preset: "tencent",
      label: labels.tencent,
      priority: 10,
      secret: secrets.tencent,
      replaceSecret: false,
      dryRun: false,
    });
    const geoImport = await importer.importProvider(actor, {
      group: "places",
      adapter: "geoapify",
      preset: "geoapify",
      label: labels.geoapify,
      priority: 20,
      secret: secrets.geoapify,
      replaceSecret: false,
      dryRun: false,
    });
    if (tencentImport.providerId) providerIds.push(tencentImport.providerId);
    if (geoImport.providerId) providerIds.push(geoImport.providerId);

    await patchProviderConfig(tencentImport.providerId!, "places", `${stubBaseUrl}/tencent/ws`);
    await patchProviderConfig(
      geoImport.providerId!,
      "places",
      `${stubBaseUrl}/geoapify/v1/geocode/autocomplete`,
    );

    const placesGroup = await getGroup("places");
    expect(placesGroup.providers.map((provider) => provider.adapter)).toEqual([
      "tencent",
      "geoapify",
    ]);
    expect(placesGroup.providers.map((provider) => provider.secrets[0]?.last4)).toEqual([
      secrets.tencent.slice(-4),
      secrets.geoapify.slice(-4),
    ]);

    const places = createPlacesService();
    const mergeCalls = upstreamCalls.length;
    const merged = await places.search({ q: "北京", limit: 2 });
    expect(merged.items.length).toBeGreaterThan(0);
    expect(upstreamCalls.slice(mergeCalls).some((call) => call.includes("/tencent/ws/"))).toBe(
      true,
    );
    expect(upstreamCalls.slice(mergeCalls).some((call) => call.includes("/geoapify/"))).toBe(true);

    const policy = await getGroup("places");
    await http()
      .patch("/v1/admin/provider-groups/places")
      .send({
        routingMode: "priority_failover",
        maxAttempts: 3,
        cooldownSeconds: 30,
        expectedVersion: policy.version,
      })
      .expect(200);

    const failoverCalls = upstreamCalls.length;
    const failedOver = await places.search({ q: "上海", limit: 1 });
    expect(failedOver.items.length).toBeGreaterThan(0);
    expect(upstreamCalls.slice(failoverCalls).some((call) => call.includes("/tencent/ws/"))).toBe(
      true,
    );
    expect(upstreamCalls.slice(failoverCalls).some((call) => call.includes("/geoapify/"))).toBe(
      false,
    );

    const beforeReorder = await getGroup("ai");
    const reordered = await http()
      .put("/v1/admin/provider-groups/ai/order")
      .send({
        ids: [aiOk.id, aiFail.id],
        expectedGroupVersion: beforeReorder.version,
      })
      .expect(200);
    expect(
      (reordered.body as ProviderGroupResponse).providers.map((provider) => provider.id),
    ).toEqual([aiOk.id, aiFail.id]);

    const secondApp = await createApp();
    try {
      const persisted = await request(secondApp.getHttpServer())
        .get("/v1/admin/provider-groups/ai")
        .set("x-test-auth", "yes")
        .expect(200);
      expect(
        (persisted.body as ProviderGroupResponse).providers.map((provider) => provider.id),
      ).toEqual([aiOk.id, aiFail.id]);
    } finally {
      await secondApp.close();
    }

    const audits = await seedPrisma!.auditLog.findMany({
      where: { targetId: { in: providerIds } },
      select: { action: true, metadata: true },
    });
    expect(audits.some((entry) => entry.action === "admin.provider.created")).toBe(true);
    expect(audits.some((entry) => entry.action === "admin.provider.models_refreshed")).toBe(true);
    expect(audits.some((entry) => entry.action === "admin.provider.reordered")).toBe(true);
    expect(JSON.stringify(audits)).not.toContain(secrets.aiFail);
    expect(JSON.stringify(audits)).not.toContain(secrets.aiOk);
    expect(JSON.stringify(audits)).not.toContain(secrets.tencent);
    expect(JSON.stringify(audits)).not.toContain(secrets.geoapify);
  }, 120_000);
});
