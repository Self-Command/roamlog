import { DEFAULT_SETTINGS } from "@roamlog/db";

import type { WorkerDatabase, WorkerLoggerLike } from "./jobs/types.js";
import { SecretBox, SecretBoxError, type SecretBoxEnvironment } from "./secret-box.js";

/**
 * Worker-side reader for the Admin console's `mail.*` settings.
 *
 * The API resolves the same keys in `mail-settings.consumer.ts`; the worker is
 * an independent process, so it reads `SystemSetting` through its own Prisma
 * client. Keys, defaults and precedence match the API exactly:
 *
 *   1. a row flagged `envLocked` with an environment value -> environment
 *   2. a stored row with a non-empty value             -> database
 *   3. an environment value                             -> environment
 *   4. `DEFAULT_SETTINGS`                               -> default
 *
 * Secrets (`mail.resendApiKey`, `mail.smtpPassword`) live in `secretCipher` and
 * are decrypted with the worker's read-only copy of the API envelope. A row
 * that exists but cannot be decrypted fails loudly instead of silently falling
 * back to the environment: an unreadable password must never look "not
 * configured" or send through the old relay.
 *
 * The resolved runtime is cached for at most 30 seconds. The worker is a
 * long-lived process, so a settings change in the Admin console is picked up by
 * the next send within that window without a restart.
 */

export const MAIL_SETTING_KEYS = [
  "mail.provider",
  "mail.from",
  "mail.resendApiKey",
  "mail.smtpHost",
  "mail.smtpPort",
  "mail.smtpUser",
  "mail.smtpPassword",
] as const;

export type MailSettingKey = (typeof MAIL_SETTING_KEYS)[number];

export type MailRuntimeSource = "db" | "env" | "default";

export interface MailRuntimeSmtp {
  readonly configured: true;
  readonly provider: "smtp";
  readonly host: string;
  readonly port: number;
  /** Only sent to the relay when a username is configured. */
  readonly user?: string;
  readonly password?: string;
  /** Implicit TLS on 465, STARTTLS everywhere else. */
  readonly secure: boolean;
  readonly from: string;
  readonly source: MailRuntimeSource;
}

export interface MailRuntimeResend {
  readonly configured: true;
  readonly provider: "resend";
  readonly apiKey: string;
  readonly from: string;
  readonly source: MailRuntimeSource;
}

export interface MailRuntimeUnconfigured {
  /** Nothing usable is stored; callers must fail instead of pretending to send. */
  readonly configured: false;
  readonly provider: "smtp" | "resend";
  readonly missing: readonly MailSettingKey[];
  readonly source: MailRuntimeSource;
}

export type MailRuntime = MailRuntimeSmtp | MailRuntimeResend | MailRuntimeUnconfigured;

/** Indirection so the email sender can be tested without a database. */
export interface MailSettingsSource {
  resolve(): Promise<MailRuntime>;
  invalidate?(): void;
}

export type MailSettingsErrorCode = "MAIL_SETTINGS_SECRET_INVALID";

/** A stored secret exists but cannot be read; this is never a fallback case. */
export class MailSettingsError extends Error {
  constructor(
    readonly code: MailSettingsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MailSettingsError";
  }
}

export interface MailSettingRow {
  key: string;
  value?: unknown;
  secretCipher?: string | null;
  envLocked?: boolean;
}

/** The slice of Prisma the reader needs; jobs use the loose `WorkerDatabase`. */
export interface MailSettingsDatabase {
  systemSetting: {
    findMany(args: { where: { group: string } }): Promise<MailSettingRow[]>;
  };
}

export interface MailSettingsReaderOptions {
  db: MailSettingsDatabase | WorkerDatabase;
  logger?: WorkerLoggerLike;
  environment?: NodeJS.ProcessEnv;
  /** Test seam; production uses 30 seconds. */
  ttlMs?: number;
  /** Test seam for fake timers. */
  now?: () => number;
}

export const DEFAULT_MAIL_SETTINGS_TTL_MS = 30_000;

/** Environment variable that backs each admin key, mirroring the API consumer. */
const ENVIRONMENT_KEY: Record<MailSettingKey, string> = {
  "mail.provider": "EMAIL_PROVIDER",
  "mail.from": "EMAIL_FROM",
  "mail.resendApiKey": "RESEND_API_KEY",
  "mail.smtpHost": "SMTP_HOST",
  "mail.smtpPort": "SMTP_PORT",
  "mail.smtpUser": "SMTP_USER",
  "mail.smtpPassword": "SMTP_PASSWORD",
};

const SECRET_KEYS = new Set<MailSettingKey>(["mail.resendApiKey", "mail.smtpPassword"]);
const MAIL_KEY_SET: ReadonlySet<string> = new Set(MAIL_SETTING_KEYS);
const SECURE_SMTP_PORT = 465;
const EMPTY_FALLBACK_WARN_INTERVAL_MS = 60_000;

function defaultFor(key: MailSettingKey): unknown {
  return DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS];
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function portFrom(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65_535) {
    return value;
  }
  if (typeof value === "string" && /^\d{1,5}$/u.test(value.trim())) {
    const parsed = Number(value.trim());
    return parsed > 0 && parsed <= 65_535 ? parsed : undefined;
  }
  return undefined;
}

function secretBoxFrom(environment: NodeJS.ProcessEnv): SecretBox {
  const boxEnvironment: SecretBoxEnvironment = {};
  if (environment.CONFIG_ENCRYPTION_KEY !== undefined) {
    boxEnvironment.CONFIG_ENCRYPTION_KEY = environment.CONFIG_ENCRYPTION_KEY;
  }
  if (environment.CONFIG_ENCRYPTION_KEYS !== undefined) {
    boxEnvironment.CONFIG_ENCRYPTION_KEYS = environment.CONFIG_ENCRYPTION_KEYS;
  }
  return SecretBox.fromEnvironment(boxEnvironment);
}

interface LoadedMailSettings {
  /** Rows keyed by setting key; a row may still hold an empty value. */
  readonly rows: ReadonlyMap<string, MailSettingRow>;
}

export class MailSettingsReader implements MailSettingsSource {
  private readonly db: MailSettingsDatabase;
  private readonly logger: WorkerLoggerLike | undefined;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private cached: { expiresAt: number; runtime: MailRuntime } | null = null;
  private lastEmptyFallbackWarnAt = 0;

  constructor(options: MailSettingsReaderOptions) {
    this.db = options.db as MailSettingsDatabase;
    this.logger = options.logger;
    this.environment = options.environment ?? process.env;
    this.ttlMs = options.ttlMs ?? DEFAULT_MAIL_SETTINGS_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /** Read-through cache hook; also lets tests prove the ≤30s window. */
  invalidate(): void {
    this.cached = null;
  }

  async resolve(): Promise<MailRuntime> {
    const now = this.now();
    if (this.cached && this.cached.expiresAt > now) {
      return this.cached.runtime;
    }

    const runtime = await this.resolveUncached();
    this.cached = { expiresAt: this.now() + this.ttlMs, runtime };
    return runtime;
  }

  private async resolveUncached(): Promise<MailRuntime> {
    const loaded = await this.load();
    const emptyFallbacks: MailSettingKey[] = [];

    const resolveKey = (key: MailSettingKey): { value: unknown; source: MailRuntimeSource } => {
      const envRaw = nonEmptyString(this.environment[ENVIRONMENT_KEY[key]]);
      const row = loaded.rows.get(key);
      const storedPresent = row !== undefined;
      const storedValue = storedPresent ? this.storedValue(key, row, envRaw) : undefined;

      if (row?.envLocked === true && envRaw !== undefined) {
        return { value: envRaw, source: "env" };
      }
      if (storedPresent && storedValue !== undefined) {
        return { value: storedValue, source: "db" };
      }
      if (envRaw !== undefined) {
        if (storedPresent && storedValue === undefined) {
          emptyFallbacks.push(key);
        }
        return { value: envRaw, source: "env" };
      }
      return { value: defaultFor(key), source: "default" };
    };

    const providerValue = resolveKey("mail.provider");
    const provider = providerValue.value === "resend" ? "resend" : "smtp";

    const fromKey = resolveKey("mail.from");
    const from = nonEmptyString(fromKey.value) ?? "";

    if (provider === "resend") {
      const apiKeyKey = resolveKey("mail.resendApiKey");
      const apiKey = nonEmptyString(apiKeyKey.value);
      const missing: MailSettingKey[] = [];
      // A code default (null) is not a configured credential.
      if (apiKey === undefined || apiKeyKey.source === "default") {
        missing.push("mail.resendApiKey");
      }
      if (!from) {
        missing.push("mail.from");
      }
      this.warnEmptyFallbacks(emptyFallbacks);
      if (missing.length > 0 || apiKey === undefined) {
        return { configured: false, provider, missing, source: apiKeyKey.source };
      }
      return { configured: true, provider, apiKey, from, source: apiKeyKey.source };
    }

    const hostKey = resolveKey("mail.smtpHost");
    const portKey = resolveKey("mail.smtpPort");
    const userKey = resolveKey("mail.smtpUser");
    const passwordKey = resolveKey("mail.smtpPassword");

    const host = nonEmptyString(hostKey.value);
    const port = portFrom(portKey.value);
    const user = nonEmptyString(userKey.value);
    const password = nonEmptyString(passwordKey.value);
    const missing: MailSettingKey[] = [];

    // `localhost` in DEFAULT_SETTINGS is a placeholder, not a relay an operator
    // configured. Only an explicit env/DB value counts as "configured".
    if (host === undefined || hostKey.source === "default") {
      missing.push("mail.smtpHost");
    }
    if (!from) {
      missing.push("mail.from");
    }
    if (port === undefined) {
      missing.push("mail.smtpPort");
    }
    // Anonymous relays exist; auth is required only when a username is set.
    if (user !== undefined && password === undefined) {
      missing.push("mail.smtpPassword");
    }

    this.warnEmptyFallbacks(emptyFallbacks);
    if (missing.length > 0 || host === undefined || port === undefined) {
      return { configured: false, provider, missing, source: hostKey.source };
    }

    return {
      configured: true,
      provider: "smtp",
      host,
      port,
      ...(user === undefined ? {} : { user }),
      ...(password === undefined ? {} : { password }),
      secure: port === SECURE_SMTP_PORT,
      from,
      source: hostKey.source,
    };
  }

  private storedValue(
    key: MailSettingKey,
    row: MailSettingRow,
    envRaw: string | undefined,
  ): unknown {
    if (!SECRET_KEYS.has(key)) {
      return nonEmptyString(row.value);
    }
    if (!row.secretCipher) {
      return undefined;
    }
    // An env-locked key with an environment value never reads the stored
    // secret; skipping the decryption keeps a rotated-out key ring from
    // blocking a deployment that does not use the DB secret.
    if (row.envLocked === true && envRaw !== undefined) {
      return undefined;
    }

    try {
      return secretBoxFrom(this.environment).decrypt(key, row.secretCipher);
    } catch (error) {
      const reason = error instanceof SecretBoxError ? error.code : "SECRET_DECRYPT_FAILED";
      // The ciphertext and key material are deliberately absent from the
      // message: it reaches the EmailLog error column and the log sink.
      throw new MailSettingsError(
        "MAIL_SETTINGS_SECRET_INVALID",
        `mail.* secret "${key}" cannot be decrypted (${reason}); fix CONFIG_ENCRYPTION_KEY or re-save the secret`,
      );
    }
  }

  private async load(): Promise<LoadedMailSettings> {
    try {
      const rows = await this.db.systemSetting.findMany({ where: { group: "mail" } });
      const byKey = new Map<string, MailSettingRow>();
      for (const row of rows) {
        if (MAIL_KEY_SET.has(row.key)) {
          byKey.set(row.key, row);
        }
      }
      return { rows: byKey };
    } catch (error) {
      // Mirrors the API: a database outage degrades to environment + defaults.
      // A stored-but-unreadable secret is handled above and still fails loudly.
      this.logger?.warn(
        {
          event: "mail.settings_unavailable",
          reason: error instanceof Error ? error.name : "UnknownError",
        },
        "mail settings unavailable; falling back to environment",
      );
      return { rows: new Map() };
    }
  }

  private warnEmptyFallbacks(keys: readonly MailSettingKey[]): void {
    if (keys.length === 0) {
      return;
    }
    const now = this.now();
    if (now - this.lastEmptyFallbackWarnAt < EMPTY_FALLBACK_WARN_INTERVAL_MS) {
      return;
    }
    this.lastEmptyFallbackWarnAt = now;
    this.logger?.warn(
      { event: "mail.settings_empty_fallback", keys: [...new Set(keys)] },
      "mail settings row is empty; falling back to the environment",
    );
  }
}

export function createMailSettingsReader(
  options: MailSettingsReaderOptions,
): MailSettingsReader {
  return new MailSettingsReader(options);
}