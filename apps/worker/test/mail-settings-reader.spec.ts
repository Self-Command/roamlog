import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SecretBox as ApiSecretBox } from "../../api/src/modules/settings/secret-box.js";
import type { WorkerLoggerLike } from "../src/jobs/types.js";
import {
  createEmailSender,
  NonRetryableEmailError,
} from "../src/dependencies.js";
import {
  createMailSettingsReader,
  DEFAULT_MAIL_SETTINGS_TTL_MS,
  type MailSettingRow,
} from "../src/settings-reader.js";

interface LoggedCall {
  level: "debug" | "info" | "warn" | "error";
  context: Record<string, unknown>;
  message: string;
}

const ORIGINAL_ENV = { ...process.env };

const MAIL_ENV_KEYS = [
  "APP_ENV",
  "NODE_ENV",
  "EMAIL_PROVIDER",
  "EMAIL_FROM",
  "RESEND_API_KEY",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
] as const;

function clearMailEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of MAIL_ENV_KEYS) {
    delete process.env[key];
  }
  return environment;
}

function mailDatabase(rows: MailSettingRow[]): {
  systemSetting: { findMany: ReturnType<typeof vi.fn> };
  rows: MailSettingRow[];
} {
  // Clone so a test that mutates a row cannot leak into the next test.
  const state = {
    systemSetting: {
      findMany: vi.fn(async () => state.rows),
    },
    rows: structuredClone(rows),
  };
  return state;
}

function createLoggerSpy(): { logger: WorkerLoggerLike; calls: LoggedCall[] } {
  const calls: LoggedCall[] = [];
  const record =
    (level: LoggedCall["level"]) => (context: Record<string, unknown>, message: string) => {
      calls.push({ level, context, message });
    };

  return {
    calls,
    logger: {
      debug: record("debug"),
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
    },
  };
}

const dbMailRows: MailSettingRow[] = [
  { key: "mail.provider", value: "smtp" },
  { key: "mail.from", value: "Roamlog DB <db@roamlog.test>" },
  { key: "mail.smtpHost", value: "127.0.0.1" },
  { key: "mail.smtpPort", value: 1025 },
];

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  clearMailEnvironment();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("worker mail settings reader: precedence", () => {
  it("prefers a stored DB value over the environment", async () => {
    const db = mailDatabase(dbMailRows);
    const reader = createMailSettingsReader({
      db,
      environment: {
        SMTP_HOST: "env-relay.test",
        SMTP_PORT: "2525",
        EMAIL_FROM: "Roamlog Env <env@roamlog.test>",
      },
    });

    const runtime = await reader.resolve();

    expect(runtime).toMatchObject({
      configured: true,
      provider: "smtp",
      host: "127.0.0.1",
      port: 1025,
      from: "Roamlog DB <db@roamlog.test>",
      source: "db",
      secure: false,
    });
    expect(db.systemSetting.findMany).toHaveBeenCalledWith({ where: { group: "mail" } });
  });

  it("lets an envLocked row fall back to the environment", async () => {
    const db = mailDatabase(
      dbMailRows.map((row) =>
        row.key === "mail.smtpHost" ? { ...row, envLocked: true } : row,
      ),
    );
    const reader = createMailSettingsReader({
      db,
      environment: {
        SMTP_HOST: "env-relay.test",
        SMTP_PORT: "2525",
        EMAIL_FROM: "Roamlog Env <env@roamlog.test>",
      },
    });

    await expect(reader.resolve()).resolves.toMatchObject({
      configured: true,
      host: "env-relay.test",
      // Only the envLocked key moves to the environment; the rest stay DB-first.
      port: 1025,
      from: "Roamlog DB <db@roamlog.test>",
      source: "env",
    });
  });

  it("treats the localhost code default as not configured instead of dialling it", async () => {
    const db = mailDatabase([]);
    const reader = createMailSettingsReader({ db, environment: {} });

    const runtime = await reader.resolve();

    expect(runtime).toMatchObject({
      configured: false,
      provider: "smtp",
      missing: expect.arrayContaining(["mail.smtpHost"]),
    });
  });

  it("resolves Resend from DB and reports a missing key as not configured", async () => {
    const key = randomBytes(32).toString("base64");
    const encrypted = ApiSecretBox.fromEnvironment({ CONFIG_ENCRYPTION_KEY: key }).encrypt(
      "mail.resendApiKey",
      "re_db_key",
    );
    const configured = createMailSettingsReader({
      db: mailDatabase([
        { key: "mail.provider", value: "resend" },
        { key: "mail.from", value: "Roamlog <db@roamlog.test>" },
        { key: "mail.resendApiKey", secretCipher: encrypted.ciphertext },
      ]),
      environment: { CONFIG_ENCRYPTION_KEY: key, RESEND_API_KEY: "re_env_key" },
    });

    const runtime = await configured.resolve();

    expect(runtime).toMatchObject({
      configured: true,
      provider: "resend",
      apiKey: "re_db_key",
      source: "db",
    });
    expect(JSON.stringify(runtime)).not.toContain("re_env_key");

    const missing = createMailSettingsReader({
      db: mailDatabase([
        { key: "mail.provider", value: "resend" },
        { key: "mail.from", value: "Roamlog <db@roamlog.test>" },
      ]),
      environment: {},
    });

    await expect(missing.resolve()).resolves.toMatchObject({
      configured: false,
      provider: "resend",
      missing: ["mail.resendApiKey"],
    });
  });

  it("falls back to the environment when the database is unavailable", async () => {
    const { logger, calls } = createLoggerSpy();
    const db = {
      systemSetting: { findMany: vi.fn(async () => Promise.reject(new Error("db down"))) },
    };
    const reader = createMailSettingsReader({
      db,
      logger,
      environment: {
        SMTP_HOST: "env-relay.test",
        SMTP_PORT: "2525",
        EMAIL_FROM: "Roamlog Env <env@roamlog.test>",
      },
    });

    await expect(reader.resolve()).resolves.toMatchObject({
      configured: true,
      host: "env-relay.test",
      source: "env",
    });
    expect(calls.some((call) => call.context.event === "mail.settings_unavailable")).toBe(true);
  });

  it("warns when an empty stored value falls back to the environment", async () => {
    const { logger, calls } = createLoggerSpy();
    const reader = createMailSettingsReader({
      db: mailDatabase([{ key: "mail.smtpHost", value: "" }]),
      logger,
      environment: {
        SMTP_HOST: "env-relay.test",
        SMTP_PORT: "2525",
        EMAIL_FROM: "Roamlog Env <env@roamlog.test>",
      },
    });

    await expect(reader.resolve()).resolves.toMatchObject({ host: "env-relay.test" });
    const warn = calls.find((call) => call.context.event === "mail.settings_empty_fallback");
    expect(warn?.context.keys).toEqual(["mail.smtpHost"]);
  });
});

describe("worker mail settings reader: refresh window", () => {
  it("picks up a changed value within 30 seconds without a restart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T00:00:00.000Z"));

    expect(DEFAULT_MAIL_SETTINGS_TTL_MS).toBe(30_000);
    const db = mailDatabase(dbMailRows);
    const reader = createMailSettingsReader({ db, environment: {} });

    await expect(reader.resolve()).resolves.toMatchObject({ port: 1025 });

    const portRow = db.rows.find((row) => row.key === "mail.smtpPort");
    if (portRow) {
      portRow.value = 2525;
    }

    // Still cached: the window is deliberately short, not instant.
    await expect(reader.resolve()).resolves.toMatchObject({ port: 1025 });

    vi.advanceTimersByTime(29_999);
    await expect(reader.resolve()).resolves.toMatchObject({ port: 1025 });

    vi.advanceTimersByTime(1);
    await expect(reader.resolve()).resolves.toMatchObject({ port: 2525 });
    expect(db.systemSetting.findMany).toHaveBeenCalledTimes(2);
  });

  it("invalidates immediately when asked", async () => {
    const db = mailDatabase(dbMailRows);
    const reader = createMailSettingsReader({ db, environment: {} });

    await expect(reader.resolve()).resolves.toMatchObject({ port: 1025 });
    const portRow = db.rows.find((row) => row.key === "mail.smtpPort");
    if (portRow) {
      portRow.value = 2525;
    }
    reader.invalidate();

    await expect(reader.resolve()).resolves.toMatchObject({ port: 2525 });
  });
});

describe("worker mail settings: incomplete configuration fails loudly", () => {
  it("rejects the send with a permanent configuration error", async () => {
    const { logger, calls } = createLoggerSpy();
    const reader = createMailSettingsReader({
      db: mailDatabase([]),
      logger,
      environment: {},
    });
    const send = createEmailSender(logger, reader);

    const error = await send({
      to: "explorer@roamlog.test",
      subject: "Export ready",
      html: "<p>ready</p>",
      text: "ready",
      idempotencyKey: "export-ready-1",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NonRetryableEmailError);
    expect((error as Error).message).toContain("not configured");
    expect((error as Error).message).toContain("mail.smtpHost");
    const warned = calls.find((call) => call.context.event === "mail.not_configured");
    expect(warned?.context.missing).toContain("mail.smtpHost");
  });

  it("rejects a SMTP username without a password as incomplete", async () => {
    const reader = createMailSettingsReader({
      db: mailDatabase([
        ...dbMailRows,
        { key: "mail.smtpUser", value: "relay-user" },
      ]),
      environment: {},
    });

    const runtime = await reader.resolve();

    expect(runtime).toMatchObject({
      configured: false,
      missing: ["mail.smtpPassword"],
    });
  });
});