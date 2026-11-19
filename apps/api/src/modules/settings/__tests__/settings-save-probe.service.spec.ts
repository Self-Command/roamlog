import type { AdminSettingItem, SettingValue, SystemSettingValueType } from "@roamlog/contracts";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import type { AppConfigService } from "../../../config/app-config.service.js";
import type { StorageSettings } from "../../../config/storage-settings.js";
import { PinoLoggerService } from "../../observability/pino-logger.service.js";
import type { MailRuntime } from "../mail-settings.consumer.js";
import {
  MAIL_SAVE_PROBE_TIMEOUT_MS,
  MISSING_CREDENTIALS,
  PROBE_UNAVAILABLE,
  SettingsSaveProbeService,
  probeRecipient,
  probeTargetsFor,
  type ProbeAttempt,
} from "../settings-save-probe.service.js";
import { SETTINGS_REGISTRY, type SettingDefinition } from "../settings.registry.js";
import type { SettingsService } from "../settings.service.js";

const MAIL_ENV_KEYS = [
  "EMAIL_PROVIDER",
  "EMAIL_FROM",
  "RESEND_API_KEY",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
] as const;

const STORAGE_ENV_KEYS = [
  "S3_ENDPOINT",
  "S3_PUBLIC_ENDPOINT",
  "S3_BUCKET",
  "S3_REGION",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "S3_FORCE_PATH_STYLE",
] as const;

const STORED_AT = "2026-11-19T00:00:00.000Z";

function itemFor(
  definition: SettingDefinition,
  storedKeys: ReadonlySet<string>,
  values: Record<string, unknown>,
): AdminSettingItem {
  const stored = storedKeys.has(definition.key);
  return {
    key: definition.key,
    group: definition.group,
    type: definition.type as SystemSettingValueType,
    label: definition.label,
    ...(definition.help ? { help: definition.help } : {}),
    ...(definition.options ? { options: [...definition.options] } : {}),
    default: definition.defaultValue as SettingValue,
    isSecret: definition.isSecret,
    isPublic: definition.isPublic,
    envLocked: false,
    ...(definition.isSecret
      ? { secret: { hasValue: stored, last4: null } }
      : { value: (stored ? values[definition.key] : definition.defaultValue) as SettingValue }),
    updatedAt: stored ? STORED_AT : null,
    updatedById: null,
  };
}

function fakeSettings(options: {
  stored?: readonly string[];
  values?: Record<string, unknown>;
}): SettingsService {
  const storedKeys = new Set(options.stored ?? []);
  const values = options.values ?? {};
  const item = (entry: SettingDefinition) => itemFor(entry, storedKeys, values);

  const groups = [...new Set(SETTINGS_REGISTRY.map((entry) => entry.group))].map((group) => ({
    group,
    label: group,
    items: SETTINGS_REGISTRY.filter((entry) => entry.group === group).map(item),
  }));

  return {
    getGroup: vi.fn(async (group: string) =>
      Object.fromEntries(
        SETTINGS_REGISTRY.filter((entry) => entry.group === group).map((entry) => [
          entry.key,
          storedKeys.has(entry.key) ? (values[entry.key] ?? null) : entry.defaultValue,
        ]),
      ),
    ),
    listAdminSettings: vi.fn(async () => ({ groups, generatedAt: STORED_AT })),
  } as unknown as SettingsService;
}

function fakeConfig(overrides: Partial<StorageSettings> = {}): {
  storageSettings: StorageSettings;
} {
  return {
    storageSettings: {
      endpoint: "http://baseline:9000",
      publicEndpoint: "http://public-baseline:9000",
      bucket: "baseline-bucket",
      region: "us-east-1",
      accessKey: "",
      secretKey: "",
      forcePathStyle: true,
      signedUrlTtlSeconds: 900,
      ...overrides,
    },
  };
}

function fakeLogger(): PinoLoggerService {
  return {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
  } as unknown as PinoLoggerService;
}

class ProbeHarness extends SettingsSaveProbeService {
  readonly storageCalls: StorageSettings[] = [];
  readonly mailCalls: Array<Extract<MailRuntime, { configured: true }>> = [];
  storageResult: ProbeAttempt = { ok: true, checks: [{ name: "HeadBucket", ok: true, ms: 1 }] };
  mailResult: ProbeAttempt = { ok: true, checks: [] };
  storageThrows: Error | undefined;
  mailThrows: Error | undefined;

  protected override async executeStorageProbe(settings: StorageSettings): Promise<ProbeAttempt> {
    this.storageCalls.push(settings);
    if (this.storageThrows) {
      throw this.storageThrows;
    }
    return this.storageResult;
  }

  protected override async executeMailProbe(
    runtime: Extract<MailRuntime, { configured: true }>,
  ): Promise<ProbeAttempt> {
    this.mailCalls.push(runtime);
    if (this.mailThrows) {
      throw this.mailThrows;
    }
    return this.mailResult;
  }
}

function harness(
  options: { stored?: readonly string[]; values?: Record<string, unknown> } = {},
  config: Partial<StorageSettings> = {},
): ProbeHarness {
  return new ProbeHarness(
    fakeSettings(options),
    fakeConfig(config) as unknown as AppConfigService,
    fakeLogger(),
  );
}

beforeEach(() => {
  for (const key of [...MAIL_ENV_KEYS, ...STORAGE_ENV_KEYS]) {
    vi.stubEnv(key, "");
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("SettingsSaveProbeService.probeForUpdate", () => {
  it("does not probe updates that cannot affect a live transport", async () => {
    const probe = harness();

    const outcome = await probe.probeForUpdate([
      { key: "site.title", value: "Roamlog" },
      { key: "media.maxEdge", value: 2_000 },
    ]);

    expect(outcome).toEqual({ required: false });
    expect(probe.storageCalls).toHaveLength(0);
    expect(probe.mailCalls).toHaveLength(0);
  });

  it("probes storage with the merged endpoint and the stored decrypted secret", async () => {
    const probe = harness({
      stored: [
        "storage.endpoint",
        "storage.bucket",
        "storage.accessKey",
        "storage.secretKey",
      ],
      values: {
        "storage.endpoint": "http://old:9000",
        "storage.bucket": "stored-bucket",
        "storage.accessKey": "AKIA_STORED",
        "storage.secretKey": "DB_SECRET_VALUE",
      },
    });

    const outcome = await probe.probeForUpdate([
      { key: "storage.endpoint", value: "http://new:9000" },
    ]);

    expect(outcome).toEqual({ required: true, ok: true, targets: ["storage"] });
    expect(probe.storageCalls).toHaveLength(1);
    expect(probe.storageCalls[0]).toMatchObject({
      endpoint: "http://new:9000",
      bucket: "stored-bucket",
      accessKey: "AKIA_STORED",
      // The request did not carry a secret; the stored (decrypted) one is used.
      secretKey: "DB_SECRET_VALUE",
    });
    // The plaintext secret must never travel in the observable outcome.
    expect(JSON.stringify(outcome)).not.toContain("DB_SECRET_VALUE");
  });

  it("returns the storage probe failure code and checks", async () => {
    const probe = harness(
      {
        stored: ["storage.endpoint", "storage.accessKey", "storage.secretKey"],
        values: {
          "storage.endpoint": "http://old:9000",
          "storage.accessKey": "AKIA_STORED",
          "storage.secretKey": "DB_SECRET_VALUE",
        },
      },
      { accessKey: "", secretKey: "" },
    );
    probe.storageResult = {
      ok: false,
      code: "STORAGE_ENDPOINT_UNREACHABLE",
      message: "The endpoint could not be reached.",
      checks: [{ name: "HeadBucket", ok: false, ms: 4 }],
    };

    const outcome = await probe.probeForUpdate([
      { key: "storage.publicEndpoint", value: "https://cdn.example.com" },
    ]);

    expect(outcome).toEqual({
      required: true,
      ok: false,
      target: "storage",
      code: "STORAGE_ENDPOINT_UNREACHABLE",
      message: "The endpoint could not be reached.",
      checks: [{ name: "HeadBucket", ok: false, ms: 4 }],
    });
    expect(JSON.stringify(outcome)).not.toContain("DB_SECRET_VALUE");
  });

  it("refuses storage when neither the database nor the environment has credentials", async () => {
    const probe = harness({
      stored: ["storage.endpoint"],
      values: { "storage.endpoint": "http://old:9000" },
    });

    const outcome = await probe.probeForUpdate([
      { key: "storage.endpoint", value: "http://new:9000" },
    ]);

    expect(outcome).toMatchObject({
      required: true,
      ok: false,
      target: "storage",
      code: MISSING_CREDENTIALS,
    });
    // No network call is attempted without credentials.
    expect(probe.storageCalls).toHaveLength(0);
  });

  it("uses an environment-provided secret when the database has none", async () => {
    vi.stubEnv("S3_ACCESS_KEY", "AKIA_ENV");
    vi.stubEnv("S3_SECRET_KEY", "ENV_SECRET_VALUE");
    const probe = harness({
      stored: ["storage.endpoint", "storage.bucket"],
      values: { "storage.endpoint": "http://old:9000", "storage.bucket": "stored-bucket" },
    });

    const outcome = await probe.probeForUpdate([
      { key: "storage.endpoint", value: "http://new:9000" },
    ]);

    expect(outcome).toMatchObject({ required: true, ok: true });
    expect(probe.storageCalls[0]).toMatchObject({
      accessKey: "AKIA_ENV",
      secretKey: "ENV_SECRET_VALUE",
    });
  });

  it("clears publicEndpoint when the update is null", async () => {
    const probe = harness(
      {
        stored: ["storage.publicEndpoint"],
        values: { "storage.publicEndpoint": "https://cdn.old.example.com" },
      },
      { accessKey: "AKIA_STORED", secretKey: "DB_SECRET_VALUE" },
    );

    const outcome = await probe.probeForUpdate([
      { key: "storage.publicEndpoint", value: null },
    ]);

    expect(outcome).toMatchObject({ required: true, ok: true });
    expect(probe.storageCalls[0]?.publicEndpoint).toBeUndefined();
  });

  it("probes mail with the merged SMTP transport", async () => {
    const probe = harness({
      stored: ["mail.from", "mail.smtpPort"],
      values: { "mail.from": "Roamlog <no-reply@roamlog.test>", "mail.smtpPort": 1_025 },
    });

    const outcome = await probe.probeForUpdate([
      { key: "mail.smtpHost", value: "127.0.0.1" },
    ]);

    expect(outcome).toEqual({ required: true, ok: true, targets: ["mail"] });
    expect(probe.mailCalls).toHaveLength(1);
    expect(probe.mailCalls[0]).toMatchObject({
      configured: true,
      provider: "smtp",
      host: "127.0.0.1",
      port: 1_025,
      from: "Roamlog <no-reply@roamlog.test>",
    });
  });

  it("returns the mail probe failure code", async () => {
    const probe = harness({
      stored: ["mail.from"],
      values: { "mail.from": "no-reply@roamlog.test" },
    });
    probe.mailResult = {
      ok: false,
      code: "CONNECTION_FAILED",
      message: "Could not reach the mail relay. Check the SMTP host and port.",
      checks: [],
    };

    const outcome = await probe.probeForUpdate([
      { key: "mail.smtpHost", value: "127.0.0.1" },
      { key: "mail.smtpPort", value: 1_025 },
    ]);

    expect(outcome).toMatchObject({
      required: true,
      ok: false,
      target: "mail",
      code: "CONNECTION_FAILED",
      checks: [],
    });
  });

  it("reports MISSING_CREDENTIALS when the SMTP password exists in no layer", async () => {
    const probe = harness({
      stored: ["mail.from", "mail.smtpHost", "mail.smtpPort", "mail.smtpUser"],
      values: {
        "mail.from": "no-reply@roamlog.test",
        "mail.smtpHost": "127.0.0.1",
        "mail.smtpPort": 1_025,
        "mail.smtpUser": "roamlog",
      },
    });

    const outcome = await probe.probeForUpdate([
      { key: "mail.smtpHost", value: "127.0.0.1" },
    ]);

    expect(outcome).toMatchObject({
      required: true,
      ok: false,
      target: "mail",
      code: MISSING_CREDENTIALS,
    });
    expect(probe.mailCalls).toHaveLength(0);
  });

  it("reports MISSING_CREDENTIALS when Resend has no API key", async () => {
    const probe = harness({
      stored: ["mail.provider", "mail.from"],
      values: { "mail.provider": "resend", "mail.from": "no-reply@roamlog.test" },
    });

    const outcome = await probe.probeForUpdate([
      { key: "mail.from", value: "no-reply@roamlog.test" },
    ]);

    expect(outcome).toMatchObject({
      required: true,
      ok: false,
      target: "mail",
      code: MISSING_CREDENTIALS,
    });
    expect(probe.mailCalls).toHaveLength(0);
  });

  it("fails closed with PROBE_UNAVAILABLE when the probe implementation throws", async () => {
    const probe = harness({
      stored: ["storage.endpoint", "storage.accessKey", "storage.secretKey"],
      values: {
        "storage.endpoint": "http://old:9000",
        "storage.accessKey": "AKIA_STORED",
        "storage.secretKey": "DB_SECRET_VALUE",
      },
    });
    probe.storageThrows = new Error("socket hang up");

    const outcome = await probe.probeForUpdate([
      { key: "storage.endpoint", value: "http://new:9000" },
    ]);

    expect(outcome).toMatchObject({
      required: true,
      ok: false,
      target: "storage",
      code: PROBE_UNAVAILABLE,
    });
    // The thrown error message is not echoed to the operator.
    expect(JSON.stringify(outcome)).not.toContain("socket hang up");
  });

  it("probes both groups when one PATCH touches storage and mail", async () => {
    const probe = harness({
      stored: [
        "storage.endpoint",
        "storage.accessKey",
        "storage.secretKey",
        "mail.from",
        "mail.smtpPort",
      ],
      values: {
        "storage.endpoint": "http://old:9000",
        "storage.accessKey": "AKIA_STORED",
        "storage.secretKey": "DB_SECRET_VALUE",
        "mail.from": "no-reply@roamlog.test",
        "mail.smtpPort": 1_025,
      },
    });

    const outcome = await probe.probeForUpdate([
      { key: "storage.endpoint", value: "http://new:9000" },
      { key: "mail.smtpHost", value: "127.0.0.1" },
    ]);

    expect(outcome).toEqual({ required: true, ok: true, targets: ["storage", "mail"] });
    expect(probe.storageCalls).toHaveLength(1);
    expect(probe.mailCalls).toHaveLength(1);
  });

  it("does not probe an update the write path will reject", async () => {
    const probe = harness();

    const outcome = await probe.probeForUpdate([
      { key: "storage.endpoint", value: "not-a-url" },
    ]);

    expect(outcome).toEqual({ required: false });
    expect(probe.storageCalls).toHaveLength(0);
    expect(probe.mailCalls).toHaveLength(0);
  });

  it("does not probe unknown or duplicate keys", async () => {
    const probe = harness();

    expect(await probe.probeForUpdate([{ key: "storage.nope", value: "x" }])).toEqual({
      required: false,
    });
    expect(
      await probe.probeForUpdate([
        { key: "storage.endpoint", value: "http://a:9000" },
        { key: "storage.endpoint", value: "http://b:9000" },
      ]),
    ).toEqual({ required: false });
    expect(probe.storageCalls).toHaveLength(0);
  });
});

describe("SettingsSaveProbeService helpers", () => {
  it("maps connectivity keys to probe targets, storage first", () => {
    expect(probeTargetsFor(["site.title", "media.maxEdge"])).toEqual([]);
    expect(probeTargetsFor(["mail.smtpHost"])).toEqual(["mail"]);
    expect(probeTargetsFor(["storage.endpoint", "mail.smtpHost"])).toEqual(["storage", "mail"]);
  });

  it("sends the mail probe to the configured from address when it parses", () => {
    expect(probeRecipient("Roamlog <no-reply@roamlog.test>")).toBe("no-reply@roamlog.test");
    expect(probeRecipient("no-reply@roamlog.test")).toBe("no-reply@roamlog.test");
    expect(probeRecipient("not-an-address")).toBe("probe@localhost");
  });

  it("bounds the mail probe so a save cannot hang", () => {
    expect(MAIL_SAVE_PROBE_TIMEOUT_MS).toBe(10_000);
  });
});