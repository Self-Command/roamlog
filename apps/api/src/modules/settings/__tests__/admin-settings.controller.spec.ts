import type { ExecutionContext, INestApplication } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AdminSettingsResponse, PublicSettingsResponse } from "@roamlog/contracts";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

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
import { PlatformTwoFactorGuard } from "../../admin/platform-two-factor.guard.js";
import { AdminSettingsController } from "../admin-settings.controller.js";
import { PublicSettingsController } from "../public-settings.controller.js";
import { SecretBox } from "../secret-box.js";
import { SettingsService, type SystemSettingRow } from "../settings.service.js";
import { SETTINGS_REGISTRY, SETTINGS_REGISTRY_TOKEN } from "../settings.registry.js";

const encryptionKey = randomBytes(32).toString("base64");
const secretBox = SecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: encryptionKey });
const STORED_PASSWORD = "smtp-password-4321";

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
  };

  const builder = Test.createTestingModule({
    controllers: [AdminSettingsController, PublicSettingsController],
    providers: [
      SettingsService,
      { provide: SETTINGS_REGISTRY_TOKEN, useValue: SETTINGS_REGISTRY },
      { provide: PrismaService, useValue: prisma },
      { provide: RedisService, useValue: redis },
      { provide: AppConfigService, useValue: config },
      { provide: PinoLoggerService, useValue: logger },
      { provide: AuditService, useValue: audit },
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

afterEach(async () => {
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
});
