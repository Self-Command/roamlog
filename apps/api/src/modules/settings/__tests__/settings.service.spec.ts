import { UnprocessableEntityException } from "@nestjs/common";
import { DEFAULT_SETTINGS } from "@roamlog/db";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { USER_ADMIN_ID } from "../../../../test/identity-fixtures.js";
import { makeActor } from "../../../../test/identity-fixtures.js";
import { SettingsService, type SystemSettingRow } from "../settings.service.js";
import { SETTINGS_CACHE_VERSION_KEY, SETTINGS_INVALIDATION_CHANNEL } from "../settings.service.js";
import { SecretBox } from "../secret-box.js";
import type { SettingDefinition } from "../settings.registry.js";
import { SETTINGS_BY_KEY } from "../settings.registry.js";

type SubscriberHandler = (channel: string, message: string) => void;

class FakeRedisBroker {
  readonly values = new Map<string, string>();
  readonly publish = vi.fn(async (channel: string, payload: string) => {
    for (const handler of this.handlers.get(channel) ?? []) {
      handler(channel, payload);
    }
    return 1;
  });
  readonly set = vi.fn(async (key: string, value: string) => {
    this.values.set(key, value);
    return "OK";
  });
  readonly get = vi.fn(async (key: string) => this.values.get(key) ?? null);
  readonly incr = vi.fn(async (key: string) => {
    const next = Number(this.values.get(key) ?? "0") + 1;
    this.values.set(key, String(next));
    return next;
  });
  private readonly handlers = new Map<string, Set<SubscriberHandler>>();

  readonly client = {
    get: this.get,
    set: this.set,
    incr: this.incr,
    publish: this.publish,
    duplicate: () => this.createSubscriber(),
  };

  private createSubscriber() {
    const local = new Map<string, SubscriberHandler>();
    return {
      status: "ready",
      on: (event: string, handler: SubscriberHandler) => {
        if (event === "message") {
          local.set("message", handler);
        }
      },
      subscribe: async (channel: string) => {
        const handler = local.get("message");
        if (!handler) {
          throw new Error("subscriber has no message handler");
        }
        const set = this.handlers.get(channel) ?? new Set<SubscriberHandler>();
        set.add(handler);
        this.handlers.set(channel, set);
        return 1;
      },
      quit: async () => "OK",
      disconnect: vi.fn(),
    };
  }

  failAll(): void {
    const failure = new Error("redis down");
    this.get.mockRejectedValue(failure);
    this.set.mockRejectedValue(failure);
    this.incr.mockRejectedValue(failure);
    this.publish.mockRejectedValue(failure);
  }
}

function makeRow(overrides: Partial<SystemSettingRow>): SystemSettingRow {
  const now = new Date();
  return {
    key: "site.title",
    group: "general",
    valueType: "string",
    value: "Roamlog",
    secretCipher: null,
    secretLast4: null,
    keyVersion: 1,
    envLocked: false,
    isPublic: true,
    updatedById: null,
    updatedAt: now,
    createdAt: now,
    ...overrides,
  };
}

function fakePrisma(seed: SystemSettingRow[] = []) {
  const store = new Map(seed.map((row) => [row.key, row]));
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
                  secretCipher: null,
                  secretLast4: null,
                  keyVersion: 1,
                  envLocked: false,
                  isPublic: false,
                  updatedById: null,
                  createdAt: now,
                  updatedAt: now,
                  ...create,
                }
          ) as SystemSettingRow;
          store.set(where.key, next);
          return next;
        },
      ),
    },
    user: {
      findUnique: vi.fn(async (): Promise<unknown> => {
        throw new Error("test did not configure a user lookup");
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
  };
  return { client, store };
}

function fakeLogger() {
  return { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

function fakeAudit() {
  return { record: vi.fn(async (_input: unknown) => ({ id: "audit-id" })) };
}

const encryptionKey = randomBytes(32).toString("base64");
const encryptionBox = SecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: encryptionKey });

function encryptForFixture(key: string, plaintext: string): string {
  return encryptionBox.encrypt(key, plaintext).ciphertext;
}

function setup(
  options: {
    seed?: SystemSettingRow[];
    registry?: readonly SettingDefinition[];
    redis?: FakeRedisBroker;
    prisma?: ReturnType<typeof fakePrisma>;
    config?: { configEncryptionKey?: string; configEncryptionKeys?: string };
  } = {},
) {
  const redis = options.redis ?? new FakeRedisBroker();
  const prisma = options.prisma ?? fakePrisma(options.seed ?? []);
  const audit = fakeAudit();
  const logger = fakeLogger();
  const config = options.config ?? {
    configEncryptionKey: encryptionKey,
    configEncryptionKeys: undefined,
  };
  const service = new SettingsService(
    prisma as never,
    { client: redis.client } as never,
    config as never,
    logger as never,
    audit as never,
    options.registry,
  );
  return { service, redis, prisma, audit, logger };
}

const superAdmin = () => makeActor(USER_ADMIN_ID, { platformRole: "super_admin" });

afterEach(() => {
  vi.useRealTimers();
  delete process.env.ROAMLOG_TEST_LOCKED_SETTING;
});

describe("SettingsService read cache", () => {
  it("serves repeated reads from the 5s process cache", async () => {
    const { service, prisma, redis } = setup({
      seed: [makeRow({ key: "media.maxEdge", value: 3000, valueType: "number", isPublic: false })],
    });

    expect(await service.get("media.maxEdge")).toBe(3000);
    expect(await service.get("media.maxEdge")).toBe(3000);
    expect(prisma.client.systemSetting.findUnique).toHaveBeenCalledTimes(1);
    expect(redis.get).toHaveBeenCalledWith(`${SETTINGS_CACHE_VERSION_KEY}`);
  });

  it("re-reads the database after the 5s TTL even without a version change", async () => {
    vi.useFakeTimers();
    const { service, prisma, redis } = setup({
      seed: [makeRow({ key: "media.maxEdge", value: 3000, valueType: "number", isPublic: false })],
    });

    await service.get("media.maxEdge");
    vi.advanceTimersByTime(5_001);
    redis.values.set("settings:v0:media.maxEdge", JSON.stringify({ value: 2500 }));

    expect(await service.get("media.maxEdge")).toBe(2500);
    expect(prisma.client.systemSetting.findUnique).toHaveBeenCalledTimes(1);
  });

  it("switches Redis cache keys when the version changes", async () => {
    vi.useFakeTimers();
    const { service, redis } = setup({
      seed: [makeRow({ key: "site.title", value: "Old title" })],
    });

    expect(await service.get("site.title")).toBe("Old title");
    redis.values.set(SETTINGS_CACHE_VERSION_KEY, "7");
    redis.values.set("settings:v7:site.title", JSON.stringify({ value: "New title" }));
    vi.advanceTimersByTime(5_001);

    expect(await service.get("site.title")).toBe("New title");
  });

  it("falls back to PostgreSQL when Redis is unavailable", async () => {
    const redis = new FakeRedisBroker();
    redis.failAll();
    const { service, logger } = setup({
      redis,
      seed: [makeRow({ key: "site.description", value: "Stored description" })],
    });

    expect(await service.get("site.description")).toBe("Stored description");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("does not hide a database outage behind defaults", async () => {
    const { service, prisma } = setup();
    prisma.client.systemSetting.findUnique.mockRejectedValueOnce(new Error("db down"));

    await expect(service.get("site.title")).rejects.toThrow("db down");
  });

  it("keeps secrets out of the shared Redis cache", async () => {
    const { service, redis } = setup({
      seed: [
        makeRow({
          key: "mail.smtpPassword",
          group: "mail",
          valueType: "secret",
          value: null,
          secretCipher: encryptForFixture("mail.smtpPassword", "smtp-password"),
          secretLast4: "word",
          isPublic: false,
        }),
      ],
    });

    expect(await service.get("mail.smtpPassword")).toBe("smtp-password");
    expect([...redis.values.keys()].some((key) => key.endsWith("mail.smtpPassword"))).toBe(false);
  });

  it("returns only public, non-secret settings on the public projection", async () => {
    const { service } = setup();
    const response = await service.getPublicSettings();
    const keys = Object.keys(response.settings);

    expect(keys).toContain("site.title");
    expect(keys).toContain("general.defaultLanguage");
    expect(keys).toContain("theme.accent");
    expect(keys).toEqual(
      expect.arrayContaining([
        "seo.titleTemplate",
        "seo.descriptionTemplate",
        "seo.ogImageUrl",
        "seo.robots",
      ]),
    );
    for (const key of keys) {
      const definition = SETTINGS_BY_KEY.get(key);
      expect(definition?.isPublic, key).toBe(true);
      expect(definition?.isSecret, key).toBe(false);
    }

    const SECRET_KEYS = [
      "mail.resendApiKey",
      "mail.smtpPassword",
      "storage.accessKey",
      "storage.secretKey",
      "places.apiKey",
    ];
    for (const key of SECRET_KEYS) {
      expect(keys, key).not.toContain(key);
      expect(JSON.stringify(response), key).not.toContain(key);
    }
    expect(keys).not.toContain("general.registrationEnabled");
    expect(keys).not.toContain("ai.timeoutMs");
    expect(keys).not.toContain("limits.searchPerMinute");
  });

  it("normalizes a stored legacy light mode to system and warns once", async () => {
    const { service, logger } = setup({
      seed: [
        makeRow({
          key: "theme.defaultMode",
          group: "theme",
          value: "light",
          isPublic: true,
        }),
      ],
    });

    await expect(service.get("theme.defaultMode")).resolves.toBe("system");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ key: "theme.defaultMode", stored: "light", normalized: "system" }),
      "settings.legacy_value_normalized",
    );

    // The admin projection shows the same READ normalization without logging twice.
    await expect(service.getAdminSetting("theme.defaultMode")).resolves.toMatchObject({
      value: "system",
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("normalizes a legacy light value cached in Redis", async () => {
    const redis = new FakeRedisBroker();
    redis.values.set("settings:v0:theme.defaultMode", JSON.stringify({ value: "light" }));
    const { service, logger } = setup({ redis });

    await expect(service.get("theme.defaultMode")).resolves.toBe("system");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("returns defaults when the row does not exist", async () => {
    const { service } = setup();
    expect(await service.get("media.quality")).toBe(DEFAULT_SETTINGS["media.quality"]);
  });

  it("reads a whole group and rejects an unknown group", async () => {
    const { service } = setup();
    const general = await service.getGroup("general");

    expect(general["site.title"]).toBe(DEFAULT_SETTINGS["site.title"]);
    expect(general["general.defaultLanguage"]).toBe("zh-CN");
    expect(general).not.toHaveProperty("mail.smtpPassword");

    await expect(service.getGroup("nope")).rejects.toMatchObject({
      response: { code: "SETTINGS_GROUP_NOT_FOUND" },
    });
  });
});

describe("SettingsService writes", () => {
  it("writes, encrypts, bumps the version, publishes, and audits without values", async () => {
    const { service, redis, prisma, audit } = setup();
    await service.onModuleInit();

    const result = await service.update(superAdmin(), {
      updates: [
        { key: "site.title", value: "Roamlog Next" },
        { key: "mail.resendApiKey", value: "re_live_secret_9876" },
      ],
    });

    expect(result.version).toBe(1);
    expect(result.updated).toHaveLength(2);
    expect(result.updated.find((entry) => entry.key === "mail.resendApiKey")?.secret).toBe(true);

    const storedSecret = prisma.store.get("mail.resendApiKey");
    expect(storedSecret?.value).not.toBe("re_live_secret_9876");
    expect(storedSecret?.secretCipher).toMatch(/^v1:[0-9a-f]{8}:/u);
    expect(storedSecret?.secretLast4).toBe("9876");

    expect(redis.publish).toHaveBeenCalledWith(SETTINGS_INVALIDATION_CHANNEL, expect.any(String));
    const auditInput = audit.record.mock.calls[0]?.[0] as {
      action: string;
      metadata: Record<string, unknown>;
    };
    expect(auditInput.action).toBe("admin.settings.updated");
    expect(auditInput.metadata).toEqual({
      keys: ["site.title", "mail.resendApiKey"],
      secrets: [false, true],
    });
    expect(JSON.stringify(auditInput)).not.toContain("re_live_secret_9876");
    expect(JSON.stringify(auditInput)).not.toContain("Roamlog Next");

    const item = await service.getAdminSetting("mail.resendApiKey");
    expect(item.secret).toEqual({ hasValue: true, last4: "9876" });
    expect(item.value).toBeUndefined();
  });

  it("lets another instance observe the new value after pub/sub invalidation", async () => {
    const redis = new FakeRedisBroker();
    const prisma = fakePrisma();
    const writer = setup({ redis, prisma }).service;
    const reader = setup({ redis, prisma }).service;
    await writer.onModuleInit();
    await reader.onModuleInit();

    expect(await reader.get("site.title")).toBe(DEFAULT_SETTINGS["site.title"]);

    await writer.update(superAdmin(), {
      updates: [{ key: "site.title", value: "Published from another instance" }],
    });

    expect(await reader.get("site.title")).toBe("Published from another instance");
  });

  it("still succeeds with a null version when Redis is down", async () => {
    const redis = new FakeRedisBroker();
    redis.failAll();
    const { service, audit } = setup({ redis });

    const result = await service.update(superAdmin(), {
      updates: [{ key: "site.title", value: "DB only" }],
    });

    expect(result.version).toBeNull();
    expect(await service.get("site.title")).toBe("DB only");
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it("returns 422 SETTINGS_INVALID for unknown keys and type errors without echoing values", async () => {
    const { service, prisma } = setup();

    let error: UnprocessableEntityException | undefined;
    try {
      await service.update(superAdmin(), {
        updates: [
          { key: "site.title", value: "valid" },
          { key: "unknown.key", value: "x" },
          { key: "media.maxEdge", value: "top-secret-value" },
          { key: "mail.smtpPassword", value: 12345 },
        ],
      });
    } catch (caught) {
      error = caught as UnprocessableEntityException;
    }

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error?.getStatus()).toBe(422);
    const response = error?.getResponse() as {
      code: string;
      errors: Array<{ field: string; code: string; message: string }>;
    };
    expect(response.code).toBe("SETTINGS_INVALID");
    expect(response.errors.map((entry) => entry.field)).toEqual([
      "unknown.key",
      "media.maxEdge",
      "mail.smtpPassword",
    ]);
    expect(JSON.stringify(response)).not.toContain("top-secret-value");
    expect(JSON.stringify(response)).not.toContain("12345");
    expect(prisma.client.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it("rejects secrets without a configured encryption key", async () => {
    const { service } = setup({
      config: { configEncryptionKey: undefined, configEncryptionKeys: undefined },
    });

    await expect(
      service.update(superAdmin(), {
        updates: [{ key: "mail.smtpPassword", value: "x" }],
      }),
    ).rejects.toMatchObject({
      response: { code: "SETTINGS_ENCRYPTION_UNAVAILABLE" },
    });
  });

  it("rejects writes to environment-locked settings and reads the env value", async () => {
    const locked: SettingDefinition = {
      key: "test.locked",
      group: "general",
      type: "string",
      defaultValue: "db-default",
      schema: z.string().min(1),
      isPublic: false,
      isSecret: false,
      envLocked: true,
      envVar: "ROAMLOG_TEST_LOCKED_SETTING",
      label: "Locked",
      help: "Locked by env.",
    };
    const { service } = setup({ registry: [locked] });
    process.env.ROAMLOG_TEST_LOCKED_SETTING = "from-env";

    expect(await service.get("test.locked")).toBe("from-env");

    await expect(
      service.update(superAdmin(), { updates: [{ key: "test.locked", value: "manual" }] }),
    ).rejects.toMatchObject({
      response: {
        code: "SETTINGS_INVALID",
        errors: [{ field: "test.locked", code: "SETTING_ENV_LOCKED" }],
      },
    });
  });

  it("rejects non-super-admin writers with HTTP 403", async () => {
    const { service } = setup();

    let status: number | undefined;
    try {
      await service.update(makeActor(USER_ADMIN_ID, { platformRole: "admin" }), {
        updates: [{ key: "site.title", value: "nope" }],
      });
    } catch (error) {
      status = (error as { getStatus?: () => number }).getStatus?.();
      expect(error).toMatchObject({ response: { code: "ADMIN_ACTION_FORBIDDEN" } });
    }
    expect(status).toBe(403);
  });
});

describe("SettingsService reveal", () => {
  it("rejects non-super-admin actors with HTTP 403", async () => {
    const { service } = setup();

    let status: number | undefined;
    try {
      await service.reveal(
        makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
        "mail.smtpPassword",
        {
          confirm: true,
        },
      );
    } catch (error) {
      status = (error as { getStatus?: () => number }).getStatus?.();
      expect(error).toMatchObject({ response: { code: "SETTINGS_REVEAL_FORBIDDEN" } });
    }
    expect(status).toBe(403);
  });

  it("requires explicit confirmation", async () => {
    const { service } = setup();
    await expect(service.reveal(superAdmin(), "mail.smtpPassword", {})).rejects.toMatchObject({
      response: { code: "SETTINGS_REVEAL_FORBIDDEN" },
    });
  });

  it("requires enabled and verified two-factor authentication with HTTP 403", async () => {
    const { service, prisma } = setup();
    prisma.client.user.findUnique.mockResolvedValue({
      twoFactorEnabled: false,
      twoFactors: [],
    });

    let status: number | undefined;
    try {
      await service.reveal(superAdmin(), "mail.smtpPassword", { confirm: true });
    } catch (error) {
      status = (error as { getStatus?: () => number }).getStatus?.();
      expect(error).toMatchObject({ response: { code: "SETTINGS_REVEAL_FORBIDDEN" } });
    }
    expect(status).toBe(403);

    prisma.client.user.findUnique.mockResolvedValue({
      twoFactorEnabled: true,
      twoFactors: [],
    });
    await expect(
      service.reveal(superAdmin(), "mail.smtpPassword", { confirm: true }),
    ).rejects.toMatchObject({ response: { code: "SETTINGS_REVEAL_FORBIDDEN" } });
  });

  it("returns plaintext only for a super admin with 2FA and records an audit entry", async () => {
    const { service, prisma, audit } = setup();
    await service.onModuleInit();
    await service.update(superAdmin(), {
      updates: [{ key: "mail.smtpPassword", value: "smtp-secret-4321" }],
    });
    prisma.client.user.findUnique.mockResolvedValue({
      twoFactorEnabled: true,
      twoFactors: [{ id: "factor-1" }],
    });

    const revealed = await service.reveal(superAdmin(), "mail.smtpPassword", { confirm: true });
    expect(revealed.value).toBe("smtp-secret-4321");

    const revealAudit = audit.record.mock.calls.at(-1)?.[0] as {
      action: string;
      metadata: Record<string, unknown>;
    };
    expect(revealAudit.action).toBe("admin.settings.revealed");
    expect(revealAudit.metadata).toEqual({ key: "mail.smtpPassword" });
    expect(JSON.stringify(revealAudit)).not.toContain("smtp-secret-4321");
  });

  it("never reveals a non-secret setting", async () => {
    const { service } = setup();
    await expect(
      service.reveal(superAdmin(), "site.title", { confirm: true }),
    ).rejects.toMatchObject({ response: { code: "SETTINGS_NOT_SECRET" } });
  });
});

describe("SettingsService admin projection", () => {
  it("groups every registered key and masks secrets", async () => {
    const { service } = setup({
      seed: [
        makeRow({
          key: "storage.secretKey",
          group: "storage",
          valueType: "secret",
          value: null,
          secretCipher: encryptForFixture("storage.secretKey", "storage-secret-abcd"),
          secretLast4: "abcd",
        }),
      ],
    });

    const response = await service.listAdminSettings();
    const keys = response.groups.flatMap((group) => group.items.map((item) => item.key));
    expect(keys).toEqual([...SETTINGS_BY_KEY.keys()]);

    const secret = response.groups
      .flatMap((group) => group.items)
      .find((item) => item.key === "storage.secretKey");
    expect(secret?.secret).toEqual({ hasValue: true, last4: "abcd" });
    expect(secret?.value).toBeUndefined();
    expect(JSON.stringify(response)).not.toContain("storage-secret-abcd");
  });
});

/** Small independent box so read fixtures do not depend on the service's key handling. */
