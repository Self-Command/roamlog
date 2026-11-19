import type { ExecutionContext, INestApplication } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AdminSettingsResponse, PublicSettingsResponse } from "@roamlog/contracts";
import { PLATFORM_ROLE_ACTIONS } from "@roamlog/contracts";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedRequest } from "../../../common/guards/actor-context.js";
import { SessionGuard } from "../../../common/guards/session.guard.js";
import { ProblemDetailsFilter } from "../../../common/filters/problem-details.filter.js";
import { makeActor, USER_ADMIN_ID } from "../../../../test/identity-fixtures.js";
import { AppConfigService } from "../../../config/app-config.service.js";
import { AuditService } from "../../audit/audit.service.js";
import { PinoLoggerService } from "../../observability/pino-logger.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { RedisService } from "../../redis/redis.service.js";
import { AdminGuard } from "../../admin/admin.guard.js";
import { ADMIN_AUTHZ_PORT, type AdminAuthzPort } from "../../admin/admin-authz.service.js";
import { PlatformTwoFactorGuard } from "../../admin/platform-two-factor.guard.js";
import { AdminSettingsController } from "../admin-settings.controller.js";
import { PublicSettingsController } from "../public-settings.controller.js";
import { SecretBox } from "../secret-box.js";
import { SettingsSaveProbeService } from "../settings-save-probe.service.js";
import { SettingsService, type SystemSettingRow } from "../settings.service.js";
import { SETTINGS_REGISTRY, SETTINGS_REGISTRY_TOKEN } from "../settings.registry.js";

const encryptionKey = randomBytes(32).toString("base64");
const secretBox = SecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: encryptionKey });
const STORED_PASSWORD = "smtp-password-4321";

const codeMatrixAuthz: AdminAuthzPort = {
  getEffectiveActions: async (role) => new Set(PLATFORM_ROLE_ACTIONS[role]),
  invalidate: () => undefined,
};

function settingRow(key: string, group: string, value: unknown): SystemSettingRow {
  const now = new Date();
  return {
    key,
    group,
    valueType: "string",
    value,
    secretCipher: null,
    secretLast4: null,
    keyVersion: 1,
    envLocked: false,
    isPublic: false,
    updatedById: null,
    updatedAt: now,
    createdAt: now,
  };
}

function fakePrisma() {
  const store = new Map<string, ReturnType<typeof settingRow>>();
  store.set("mail.smtpPassword", {
    ...settingRow("mail.smtpPassword", "mail", null),
    valueType: "secret",
    value: null,
    secretCipher: secretBox.encrypt("mail.smtpPassword", STORED_PASSWORD).ciphertext,
    secretLast4: "4321",
  });

  const client = {
    systemSetting: {
      findUnique: vi.fn(
        async ({ where }: { where: { key: string } }) => store.get(where.key) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where?: { key?: { in?: string[] } } }) => {
        const keys = where?.key?.in;
        return [...store.values()].filter((row) => !keys || keys.includes(row.key));
      }),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { key: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const now = new Date();
          const existing = store.get(where.key);
          const next = (
            existing
              ? { ...existing, ...update, updatedAt: now }
              : {
                  ...settingRow(where.key, "general", null),
                  ...create,
                  createdAt: now,
                  updatedAt: now,
                }
          ) as ReturnType<typeof settingRow>;
          store.set(where.key, next);
          return next;
        },
      ),
    },
    user: { findUnique: vi.fn(async (): Promise<unknown> => null) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
  };
  return { client, store };
}

function fakeRedis() {
  const values = new Map<string, string>();
  const client = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
      return "OK";
    }),
    incr: vi.fn(async (key: string) => {
      const next = Number(values.get(key) ?? "0") + 1;
      values.set(key, String(next));
      return next;
    }),
    publish: vi.fn(async () => 0),
    duplicate: () => ({
      status: "ready",
      on: vi.fn(),
      subscribe: vi.fn(async () => 1),
      quit: vi.fn(async () => "OK"),
      disconnect: vi.fn(),
    }),
  };
  return { client, values };
}

const apps: INestApplication[] = [];

async function createApp(options: { user?: AuthenticatedActorUser }) {
  const prisma = fakePrisma();
  const redis = fakeRedis();
  const audit = { record: vi.fn(async (_input: unknown) => ({ id: "audit-id" })) };
  const logger = {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  };
  const config = {
    adminTwoFactorEnforced: false,
    configEncryptionKey: encryptionKey,
    configEncryptionKeys: undefined,
    storageSettings: {
      endpoint: "http://127.0.0.1:19999",
      publicEndpoint: "http://127.0.0.1:19999",
      bucket: "roamlog-probe",
      region: "us-east-1",
      accessKey: "test-access-key",
      secretKey: "test-secret-key",
      forcePathStyle: true,
      signedUrlTtlSeconds: 900,
    },
  };

  const builder = Test.createTestingModule({
    controllers: [AdminSettingsController, PublicSettingsController],
    providers: [
      SettingsService,
      SettingsSaveProbeService,
      { provide: SETTINGS_REGISTRY_TOKEN, useValue: SETTINGS_REGISTRY },
      { provide: PrismaService, useValue: prisma },
      { provide: RedisService, useValue: redis },
      { provide: AppConfigService, useValue: config },
      { provide: PinoLoggerService, useValue: logger },
      { provide: AuditService, useValue: audit },
      { provide: ADMIN_AUTHZ_PORT, useValue: codeMatrixAuthz },
      PlatformTwoFactorGuard,
      AdminGuard,
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
  return { app, prisma, audit };
}

type AuthenticatedActorUser = ReturnType<typeof makeActor>["user"];

type ProbeInternals = Record<
  "executeStorageProbe" | "executeMailProbe",
  (input: unknown) => Promise<unknown>
>;

function probeInternals(app: INestApplication): ProbeInternals {
  return app.get(SettingsSaveProbeService) as unknown as ProbeInternals;
}

const MAIL_ENV_KEYS = [
  "EMAIL_PROVIDER",
  "EMAIL_FROM",
  "RESEND_API_KEY",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
] as const;

beforeEach(() => {
  // The merge step reads environment fallbacks; keep these tests deterministic
  // regardless of the developer's shell.
  for (const key of MAIL_ENV_KEYS) {
    vi.stubEnv(key, "");
  }
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const superAdmin = makeActor(USER_ADMIN_ID, { platformRole: "super_admin" }).user;
const platformAdmin = makeActor(USER_ADMIN_ID, { platformRole: "admin" }).user;

describe("admin settings routes", () => {
  it("rejects anonymous requests with 401", async () => {
    const { app } = await createApp({});

    await request(app.getHttpServer())
      .get("/v1/admin/settings")
      .expect(401)
      .expect(({ body }) => {
        expect(body).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
      });
  });

  it("returns grouped settings and masks configured secrets", async () => {
    const { app } = await createApp({ user: superAdmin });

    const response = await request(app.getHttpServer()).get("/v1/admin/settings").expect(200);

    const body = response.body as AdminSettingsResponse;
    expect(body.groups.map((group) => group.group)).toEqual([
      "general",
      "seo",
      "theme",
      "mail",
      "storage",
      "media",
      "ai",
      "places",
      "limits",
    ]);
    const secret = body.groups
      .flatMap((group) => group.items)
      .find((item) => item.key === "mail.smtpPassword");
    expect(secret?.secret).toEqual({ hasValue: true, last4: "4321" });
    expect(secret?.value).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(STORED_PASSWORD);
  });

  it("returns one setting by key and 404s an unknown key", async () => {
    const { app } = await createApp({ user: superAdmin });

    const response = await request(app.getHttpServer())
      .get("/v1/admin/settings/site.title")
      .expect(200);
    expect(response.body).toMatchObject({
      key: "site.title",
      group: "general",
      value: "Roamlog",
    });

    await request(app.getHttpServer())
      .get("/v1/admin/settings/nope.key")
      .expect(404)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: "SETTINGS_KEY_NOT_FOUND" });
      });
  });

  it("returns 403 for a platform admin below super_admin", async () => {
    const { app } = await createApp({ user: platformAdmin });

    const response = await request(app.getHttpServer())
      .patch("/v1/admin/settings")
      .send({ updates: [{ key: "site.title", value: "Nope" }] })
      .expect(403);

    expect(response.body).toMatchObject({ status: 403, code: "ADMIN_ACCESS_DENIED" });
  });

  it("serves SEO values anonymously and never a secret key name", async () => {
    const { app } = await createApp({});

    const response = await request(app.getHttpServer()).get("/v1/public/settings").expect(200);
    const body = response.body as PublicSettingsResponse;
    const keys = Object.keys(body.settings);

    expect(keys).toEqual(
      expect.arrayContaining([
        "seo.titleTemplate",
        "seo.descriptionTemplate",
        "seo.ogImageUrl",
        "seo.robots",
        "media.maxEdge",
        "media.quality",
        "media.targetBytes",
        "media.maxUploadBytes",
      ]),
    );
    for (const key of ["media.keepOriginal", "media.livePhotoEnabled"]) {
      expect(keys, key).not.toContain(key);
      expect(JSON.stringify(body), key).not.toContain(key);
    }
    for (const key of [
      "mail.resendApiKey",
      "mail.smtpPassword",
      "storage.accessKey",
      "storage.secretKey",
      "places.apiKey",
      "ai.timeoutMs",
      "limits.searchPerMinute",
    ]) {
      expect(keys, key).not.toContain(key);
      expect(JSON.stringify(body), key).not.toContain(key);
    }
    expect(JSON.stringify(body)).not.toContain(STORED_PASSWORD);
  });

  it("returns a 422 SETTINGS_INVALID problem without echoing rejected values", async () => {
    const { app, prisma } = await createApp({ user: superAdmin });

    const response = await request(app.getHttpServer())
      .patch("/v1/admin/settings")
      .send({
        updates: [
          { key: "unknown.key", value: "x" },
          { key: "media.maxEdge", value: "leaked-candidate-value" },
        ],
      })
      .expect(422);

    expect(response.body).toMatchObject({ status: 422, code: "SETTINGS_INVALID" });
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "unknown.key", code: "UNKNOWN_SETTING" }),
        expect.objectContaining({ field: "media.maxEdge", code: "INVALID_VALUE" }),
      ]),
    );
    expect(JSON.stringify(response.body)).not.toContain("leaked-candidate-value");
    expect(prisma.client.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it("rejects the removed light theme mode with 422", async () => {
    const { app, prisma } = await createApp({ user: superAdmin });

    const response = await request(app.getHttpServer())
      .patch("/v1/admin/settings")
      .send({ updates: [{ key: "theme.defaultMode", value: "light" }] })
      .expect(422);

    expect(response.body).toMatchObject({ status: 422, code: "SETTINGS_INVALID" });
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "theme.defaultMode", code: "INVALID_VALUE" }),
      ]),
    );
    expect(prisma.client.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it("writes a valid batch and audits keys without values", async () => {
    const { app, audit } = await createApp({ user: superAdmin });

    const response = await request(app.getHttpServer())
      .patch("/v1/admin/settings")
      .send({ updates: [{ key: "site.title", value: "Roamlog HTTP" }] })
      .expect(200);

    expect(response.body).toMatchObject({ version: 1 });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.settings.updated",
        metadata: { keys: ["site.title"], secrets: [false] },
      }),
    );
  });

  it("returns 403 SETTINGS_REVEAL_FORBIDDEN when 2FA is not verified", async () => {
    const { app, prisma } = await createApp({ user: superAdmin });
    prisma.client.user.findUnique.mockResolvedValue({ twoFactorEnabled: false, twoFactors: [] });

    const response = await request(app.getHttpServer())
      .post("/v1/admin/settings/mail.smtpPassword/reveal")
      .send({ confirm: true })
      .expect(403);

    expect(response.body).toMatchObject({ status: 403, code: "SETTINGS_REVEAL_FORBIDDEN" });
    expect(JSON.stringify(response.body)).not.toContain(STORED_PASSWORD);
  });

  it("reveals plaintext with explicit confirmation and verified 2FA", async () => {
    const { app, prisma } = await createApp({ user: superAdmin });
    prisma.client.user.findUnique.mockResolvedValue({
      twoFactorEnabled: true,
      twoFactors: [{ id: "factor" }],
    });

    const response = await request(app.getHttpServer())
      .post("/v1/admin/settings/mail.smtpPassword/reveal")
      .send({ confirm: true })
      .expect(200);

    expect(response.body).toMatchObject({
      key: "mail.smtpPassword",
      value: STORED_PASSWORD,
    });
  });
});

describe("admin settings save probe gate", () => {
  it("does not probe a PATCH that only touches non-connectivity keys", async () => {
    const { app } = await createApp({ user: superAdmin });
    const internals = probeInternals(app);
    const storageProbe = vi.spyOn(internals, "executeStorageProbe").mockResolvedValue({ ok: true, checks: [] });
    const mailProbe = vi.spyOn(internals, "executeMailProbe").mockResolvedValue({ ok: true, checks: [] });

    await request(app.getHttpServer())
      .patch("/v1/admin/settings")
      .send({ updates: [{ key: "site.title", value: "Roamlog probe gate" }] })
      .expect(200);

    expect(storageProbe).not.toHaveBeenCalled();
    expect(mailProbe).not.toHaveBeenCalled();
  });

  it("rejects a storage change whose probe fails without writing or auditing", async () => {
    const { app, prisma, audit } = await createApp({ user: superAdmin });
    vi.spyOn(probeInternals(app), "executeStorageProbe").mockResolvedValue({
      ok: false,
      code: "STORAGE_ENDPOINT_UNREACHABLE",
      message: "The endpoint could not be reached (ECONNREFUSED).",
      checks: [{ name: "HeadBucket", ok: false, ms: 4 }],
    });

    const response = await request(app.getHttpServer())
      .patch("/v1/admin/settings")
      .send({ updates: [{ key: "storage.endpoint", value: "http://127.0.0.1:19999" }] })
      .expect(422);

    expect(response.body).toEqual({
      type: "https://roamlog.app/errors/settings-probe-failed",
      title: "Configuration rejected",
      status: 422,
      code: "SETTINGS_PROBE_FAILED",
      detail: "The endpoint could not be reached (ECONNREFUSED).",
      probe: {
        target: "storage",
        code: "STORAGE_ENDPOINT_UNREACHABLE",
        checks: [{ name: "HeadBucket", ok: false, ms: 4 }],
      },
    });
    // The critical invariant: a rejected probe must not leave any trace.
    expect(prisma.client.systemSetting.upsert).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects a mail change whose probe fails without writing or auditing", async () => {
    const { app, prisma, audit } = await createApp({ user: superAdmin });
    vi.spyOn(probeInternals(app), "executeMailProbe").mockResolvedValue({
      ok: false,
      code: "CONNECTION_FAILED",
      message: "Could not reach the mail relay. Check the SMTP host and port.",
      checks: [],
    });

    const response = await request(app.getHttpServer())
      .patch("/v1/admin/settings")
      .send({ updates: [{ key: "mail.smtpHost", value: "127.0.0.1" }] })
      .expect(422);

    expect(response.body).toMatchObject({
      type: "https://roamlog.app/errors/settings-probe-failed",
      title: "Configuration rejected",
      status: 422,
      code: "SETTINGS_PROBE_FAILED",
      probe: { target: "mail", code: "CONNECTION_FAILED", checks: [] },
    });
    expect(JSON.stringify(response.body)).not.toContain(STORED_PASSWORD);
    expect(prisma.client.systemSetting.upsert).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("accepts a storage change after a successful probe and keeps the write semantics", async () => {
    const { app, prisma, audit } = await createApp({ user: superAdmin });
    vi.spyOn(probeInternals(app), "executeStorageProbe").mockResolvedValue({
      ok: true,
      checks: [{ name: "HeadBucket", ok: true, ms: 3 }],
    });

    const response = await request(app.getHttpServer())
      .patch("/v1/admin/settings")
      .send({ updates: [{ key: "storage.endpoint", value: "http://127.0.0.1:19998" }] })
      .expect(200);

    expect(response.body).toMatchObject({ version: 1 });
    expect(prisma.client.systemSetting.upsert).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.settings.updated",
        metadata: { keys: ["storage.endpoint"], secrets: [false] },
      }),
    );
  });

  it("probes with the stored decrypted secret when the request does not replace it", async () => {
    const { app, prisma } = await createApp({ user: superAdmin });
    prisma.store.set("mail.smtpUser", settingRow("mail.smtpUser", "mail", "roamlog"));
    let captured: { password?: string } | undefined;
    vi.spyOn(probeInternals(app), "executeMailProbe").mockImplementation(async (runtime) => {
      captured = runtime as { password?: string };
      return { ok: true, checks: [] };
    });

    const response = await request(app.getHttpServer())
      .patch("/v1/admin/settings")
      .send({ updates: [{ key: "mail.smtpHost", value: "127.0.0.1" }] })
      .expect(200);

    expect(captured?.password).toBe(STORED_PASSWORD);
    expect(JSON.stringify(response.body)).not.toContain(STORED_PASSWORD);
  });

  it("fails closed with 422 SETTINGS_PROBE_FAILED when the probe throws", async () => {
    const { app, prisma, audit } = await createApp({ user: superAdmin });
    vi.spyOn(probeInternals(app), "executeMailProbe").mockRejectedValue(new Error("socket hang up"));

    const response = await request(app.getHttpServer())
      .patch("/v1/admin/settings")
      .send({ updates: [{ key: "mail.smtpHost", value: "127.0.0.1" }] })
      .expect(422);

    expect(response.body).toMatchObject({
      status: 422,
      code: "SETTINGS_PROBE_FAILED",
      probe: { target: "mail", code: "PROBE_UNAVAILABLE" },
    });
    expect(JSON.stringify(response.body)).not.toContain("socket hang up");
    expect(prisma.client.systemSetting.upsert).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("lets a super_admin skip the probe and records the bypass", async () => {
    const { app, prisma, audit } = await createApp({ user: superAdmin });
    const mailProbe = vi.spyOn(probeInternals(app), "executeMailProbe").mockResolvedValue({
      ok: true,
      checks: [],
    });

    const response = await request(app.getHttpServer())
      .patch("/v1/admin/settings")
      .set("x-skip-settings-probe", "true")
      .send({ updates: [{ key: "mail.smtpHost", value: "127.0.0.1" }] })
      .expect(200);

    expect(response.body).toMatchObject({ version: 1 });
    expect(mailProbe).not.toHaveBeenCalled();
    expect(prisma.client.systemSetting.upsert).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.settings.probe_skipped",
        targetType: "system_setting",
        metadata: { keys: ["mail.smtpHost"] },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.settings.updated" }),
    );
  });

  it("rejects the skip header for a platform admin below super_admin", async () => {
    const { app, prisma, audit } = await createApp({ user: platformAdmin });

    await request(app.getHttpServer())
      .patch("/v1/admin/settings")
      .set("x-skip-settings-probe", "true")
      .send({ updates: [{ key: "mail.smtpHost", value: "127.0.0.1" }] })
      .expect(403);

    expect(prisma.client.systemSetting.upsert).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe("public settings route", () => {
  it("serves only public non-secret settings without authentication", async () => {
    const { app } = await createApp({});

    const response = await request(app.getHttpServer()).get("/v1/public/settings").expect(200);
    const body = response.body as PublicSettingsResponse;

    expect(body.settings["site.title"]).toBe("Roamlog");
    expect(body.settings["general.defaultLanguage"]).toBe("zh-CN");
    expect(body.settings).not.toHaveProperty("general.registrationEnabled");
    expect(body.settings).not.toHaveProperty("mail.smtpPassword");
    expect(JSON.stringify(body)).not.toContain(STORED_PASSWORD);
  });

  it("publishes the four client-consumed media keys with their numeric defaults", async () => {
    const { app } = await createApp({});

    const response = await request(app.getHttpServer()).get("/v1/public/settings").expect(200);
    const body = response.body as PublicSettingsResponse;

    expect(body.settings["media.maxEdge"]).toBe(2000);
    expect(body.settings["media.quality"]).toBe(0.82);
    expect(body.settings["media.targetBytes"]).toBe(1_500_000);
    expect(body.settings["media.maxUploadBytes"]).toBe(25_000_000);
    expect(body.settings).not.toHaveProperty("media.keepOriginal");
    expect(body.settings).not.toHaveProperty("media.livePhotoEnabled");
  });
});
