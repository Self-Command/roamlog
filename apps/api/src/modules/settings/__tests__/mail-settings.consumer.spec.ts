import { afterEach, describe, expect, it, vi } from "vitest";

import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import type { ProviderRuntimeService } from "../../providers/provider-runtime.service.js";
import type { SettingsService } from "../settings.service.js";
import { MailSettingsConsumer } from "../mail-settings.consumer.js";

interface MailItem {
  key: string;
  group: "mail";
  envLocked: boolean;
  updatedAt: string | null;
}

function settingsService(options: {
  values: Record<string, unknown>;
  storedKeys?: string[];
  envLockedKeys?: string[];
  fail?: boolean;
}) {
  const stored = new Set(options.storedKeys ?? []);
  const envLocked = new Set(options.envLockedKeys ?? []);
  const items: MailItem[] = Object.keys(options.values).map((key) => ({
    key,
    group: "mail",
    envLocked: envLocked.has(key),
    updatedAt: stored.has(key) ? "2026-11-19T00:00:00.000Z" : null,
  }));
  return {
    getGroup: vi.fn(async () => {
      if (options.fail) {
        throw new Error("database is down");
      }
      return options.values;
    }),
    listAdminSettings: vi.fn(async () => {
      if (options.fail) {
        throw new Error("database is down");
      }
      return { groups: [{ group: "mail", label: "Mail", items }], generatedAt: "now" };
    }),
  } as unknown as SettingsService;
}

function logger() {
  return {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as PinoLoggerService;
}

function completeSmtp(overrides: Record<string, unknown> = {}) {
  return {
    "mail.provider": "smtp",
    "mail.from": "Roamlog <verify@roamlog.test>",
    "mail.resendApiKey": null,
    "mail.smtpHost": "127.0.0.1",
    "mail.smtpPort": 1025,
    "mail.smtpUser": "",
    "mail.smtpPassword": null,
    ...overrides,
  };
}

const NO_ENV: NodeJS.ProcessEnv = {};

function providerRuntime(
  providers: Array<{
    adapter: "resend" | "smtp";
    config: Record<string, unknown>;
    secrets?: Record<string, string>;
  }>,
) {
  const resolveGroup = vi.fn(async () => ({
    policy: {
      group: "mail",
      routingMode: "single",
      maxAttempts: 1,
      cooldownSeconds: 0,
      version: 1,
    },
    providers: providers.map((provider, index) => ({
      id: `provider-${index + 1}`,
      group: "mail",
      adapter: provider.adapter,
      preset: provider.adapter,
      label: provider.adapter,
      priority: (index + 1) * 10,
      config: provider.config,
      secrets: provider.secrets ?? {},
      health: {
        status: "unknown",
        lastCheckedAt: null,
        lastErrorCode: null,
        cooldownUntil: null,
      },
    })),
  }));
  return { resolveGroup } as unknown as ProviderRuntimeService & {
    resolveGroup: typeof resolveGroup;
  };
}

describe("MailSettingsConsumer", () => {
  it("prefers a stored admin value over the environment and the default", async () => {
    const settings = settingsService({
      values: completeSmtp(),
      storedKeys: Object.keys(completeSmtp()),
    });
    const consumer = new MailSettingsConsumer(settings, logger());

    const runtime = await consumer.resolve({
      SMTP_HOST: "mail.env.example",
      EMAIL_FROM: "Env <env@example.com>",
      SMTP_PORT: "587",
    });

    expect(runtime.configured).toBe(true);
    expect(runtime.provider).toBe("smtp");
    if (runtime.provider === "smtp" && runtime.configured) {
      expect(runtime.host).toBe("127.0.0.1");
      expect(runtime.port).toBe(1025);
      expect(runtime.from).toBe("Roamlog <verify@roamlog.test>");
      expect(runtime.source).toBe("db");
    }
  });

  it("lets an environment-locked key win over the stored value", async () => {
    const settings = settingsService({
      values: completeSmtp(),
      storedKeys: Object.keys(completeSmtp()),
      envLockedKeys: ["mail.smtpHost"],
    });
    const consumer = new MailSettingsConsumer(settings, logger());

    const runtime = await consumer.resolve({
      SMTP_HOST: "locked.env.example",
      EMAIL_FROM: "Roamlog <verify@roamlog.test>",
    });

    expect(runtime.configured).toBe(true);
    if (runtime.configured && runtime.provider === "smtp") {
      expect(runtime.host).toBe("locked.env.example");
      expect(runtime.source).toBe("env");
    }
  });

  it("falls back to env then defaults when the database is unavailable, with a warning", async () => {
    const log = logger();
    const consumer = new MailSettingsConsumer(settingsService({ values: {}, fail: true }), log);

    const runtime = await consumer.resolve({
      SMTP_HOST: "env.relay.example",
      SMTP_PORT: "587",
      EMAIL_FROM: "Env <env@example.com>",
    });

    expect(runtime.configured).toBe(true);
    if (runtime.configured && runtime.provider === "smtp") {
      expect(runtime.host).toBe("env.relay.example");
      expect(runtime.port).toBe(587);
      expect(runtime.secure).toBe(false);
      expect(runtime.source).toBe("env");
    }
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "mail.settings_unavailable" }),
      "mail.settings_unavailable",
    );

    const defaults = await consumer.resolve({});
    // The code default host `localhost` is a placeholder, not a relay the
    // operator configured, so the consumer reports "not configured".
    expect(defaults.configured).toBe(false);
    if (!defaults.configured) {
      expect(defaults.missing).toContain("mail.smtpHost");
    }
  });

  it("warns when a stored value is empty and the environment fills the gap", async () => {
    const log = logger();
    const values = completeSmtp({ "mail.smtpHost": "" });
    const consumer = new MailSettingsConsumer(
      settingsService({ values, storedKeys: Object.keys(values) }),
      log,
    );

    const runtime = await consumer.resolve({
      SMTP_HOST: "env.relay.example",
      EMAIL_FROM: "Env <env@example.com>",
    });

    expect(runtime.configured).toBe(true);
    if (runtime.configured && runtime.provider === "smtp") {
      expect(runtime.host).toBe("env.relay.example");
    }
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "mail.settings_empty_fallback" }),
      "mail.settings_empty_fallback",
    );
  });

  it.each([
    [465, true],
    [587, false],
    [25, false],
    [1025, false],
  ])("derives secure=%s -> %s from the port", async (port, secure) => {
    const values = completeSmtp({ "mail.smtpPort": port });
    const consumer = new MailSettingsConsumer(
      settingsService({ values, storedKeys: Object.keys(values) }),
      logger(),
    );

    const runtime = await consumer.resolve(NO_ENV);

    expect(runtime.configured).toBe(true);
    if (runtime.configured && runtime.provider === "smtp") {
      expect(runtime.secure).toBe(secure);
    }
  });

  it("reports missing keys instead of throwing when SMTP is incomplete", async () => {
    const values = completeSmtp({ "mail.smtpHost": "" });
    const consumer = new MailSettingsConsumer(
      settingsService({ values, storedKeys: Object.keys(values) }),
      logger(),
    );

    const runtime = await consumer.resolve(NO_ENV);

    expect(runtime.configured).toBe(false);
    expect(runtime.provider).toBe("smtp");
    if (!runtime.configured) {
      expect(runtime.missing).toContain("mail.smtpHost");
    }
  });

  it("requires a password when an SMTP username is configured", async () => {
    const values = completeSmtp({ "mail.smtpUser": "roamlog", "mail.smtpPassword": null });
    const consumer = new MailSettingsConsumer(
      settingsService({ values, storedKeys: Object.keys(values) }),
      logger(),
    );

    const runtime = await consumer.resolve(NO_ENV);

    expect(runtime.configured).toBe(false);
    if (!runtime.configured) {
      expect(runtime.missing).toContain("mail.smtpPassword");
    }
  });

  it("resolves Resend from a stored key and never leaks it", async () => {
    const apiKey = "re_sentinel_api_key_value";
    const values = {
      "mail.provider": "resend",
      "mail.from": "Roamlog <verify@roamlog.test>",
      "mail.resendApiKey": apiKey,
      "mail.smtpHost": "",
      "mail.smtpPort": 587,
      "mail.smtpUser": "",
      "mail.smtpPassword": null,
    };
    const consumer = new MailSettingsConsumer(
      settingsService({ values, storedKeys: Object.keys(values) }),
      logger(),
    );

    const runtime = await consumer.resolve(NO_ENV);

    expect(runtime.configured).toBe(true);
    if (runtime.configured && runtime.provider === "resend") {
      expect(runtime.apiKey).toBe(apiKey);
      expect(runtime.source).toBe("db");
      expect(runtime.from).toContain("@roamlog.test");
    }
  });

  it("reports Resend as not configured without a key", async () => {
    const values = {
      "mail.provider": "resend",
      "mail.from": "Roamlog <verify@roamlog.test>",
      "mail.resendApiKey": null,
    };
    const consumer = new MailSettingsConsumer(
      settingsService({ values, storedKeys: Object.keys(values) }),
      logger(),
    );

    const runtime = await consumer.resolve(NO_ENV);

    expect(runtime.configured).toBe(false);
    if (!runtime.configured) {
      expect(runtime.provider).toBe("resend");
      expect(runtime.missing).toContain("mail.resendApiKey");
    }
  });

  it("uses environment credentials when the database has none (env-only deployment)", async () => {
    const consumer = new MailSettingsConsumer(
      settingsService({ values: {}, storedKeys: [] }),
      logger(),
    );

    const runtime = await consumer.resolve({
      SMTP_HOST: "smtp.gmail.com",
      SMTP_PORT: "465",
      SMTP_USER: "ops@example.com",
      SMTP_PASSWORD: "app-password-sentinel",
      EMAIL_FROM: "Roamlog <ops@example.com>",
    });

    expect(runtime.configured).toBe(true);
    if (runtime.configured && runtime.provider === "smtp") {
      expect(runtime.host).toBe("smtp.gmail.com");
      expect(runtime.secure).toBe(true);
      expect(runtime.user).toBe("ops@example.com");
      expect(runtime.password).toBe("app-password-sentinel");
      expect(runtime.source).toBe("env");
    }
  });

  it("uses the single active Resend Provider and does not read scalar settings", async () => {
    const settings = settingsService({ values: {}, storedKeys: [] });
    const providers = providerRuntime([
      {
        adapter: "resend",
        config: { from: "provider@roamlog.test" },
        secrets: { apiKey: "re_provider_sentinel" },
      },
    ]);
    const consumer = new MailSettingsConsumer(settings, logger(), providers);

    const runtime = await consumer.resolve({ PROVIDER_CONFIG_MODE: "v2" });

    expect(runtime.configured).toBe(true);
    if (runtime.configured && runtime.provider === "resend") {
      expect(runtime.apiKey).toBe("re_provider_sentinel");
      expect(runtime.from).toBe("provider@roamlog.test");
      expect(runtime.source).toBe("db");
      expect(runtime.providerId).toBe("provider-1");
    }
    expect(settings.getGroup).not.toHaveBeenCalled();
  });

  it("maps the active SMTP Provider and keeps implicit TLS on port 465", async () => {
    const consumer = new MailSettingsConsumer(
      settingsService({ values: {}, storedKeys: [] }),
      logger(),
      providerRuntime([
        {
          adapter: "smtp",
          config: {
            from: "smtp@roamlog.test",
            host: "smtp.provider.test",
            port: 465,
            secure: false,
            user: "mailer",
          },
          secrets: { password: "provider-smtp-password" },
        },
      ]),
    );

    const runtime = await consumer.resolve({ PROVIDER_CONFIG_MODE: "v2" });

    expect(runtime.configured).toBe(true);
    if (runtime.configured && runtime.provider === "smtp") {
      expect(runtime.host).toBe("smtp.provider.test");
      expect(runtime.port).toBe(465);
      expect(runtime.secure).toBe(true);
      expect(runtime.user).toBe("mailer");
      expect(runtime.password).toBe("provider-smtp-password");
      expect(runtime.providerId).toBe("provider-1");
    }
  });

  it("reports a missing Provider credential as not configured", async () => {
    const consumer = new MailSettingsConsumer(
      settingsService({ values: {}, storedKeys: [] }),
      logger(),
      providerRuntime([
        {
          adapter: "resend",
          config: { from: "provider@roamlog.test" },
        },
      ]),
    );

    const runtime = await consumer.resolve({ PROVIDER_CONFIG_MODE: "v2" });

    expect(runtime.configured).toBe(false);
    if (!runtime.configured) {
      expect(runtime.provider).toBe("resend");
      expect(runtime.missing).toContain("mail.resendApiKey");
    }
  });

  it("does not fake a Provider when none is active", async () => {
    const consumer = new MailSettingsConsumer(
      settingsService({ values: {}, storedKeys: [] }),
      logger(),
      providerRuntime([]),
    );

    const runtime = await consumer.resolve({ PROVIDER_CONFIG_MODE: "v2" });

    expect(runtime.configured).toBe(false);
    if (!runtime.configured) {
      expect(runtime.missing).toContain("mail.provider");
    }
  });
});

afterEach(() => {
  delete process.env.PROVIDER_CONFIG_MODE;
});
