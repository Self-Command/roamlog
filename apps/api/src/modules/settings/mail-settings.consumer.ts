import { Inject, Injectable, Optional } from "@nestjs/common";
import { DEFAULT_SETTINGS } from "@roamlog/db";

import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { SettingsService } from "./settings.service.js";

/**
 * The seven `mail.*` keys the admin console owns.
 *
 * The registry (read-only here) is the source of defaults/types; this consumer
 * only decides which layer wins for each key.
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

interface MailRuntimeCommon {
  /** Sender header, exactly as the operator wrote it. */
  readonly from: string;
  /** Layer that supplied the transport identity (host or API key). */
  readonly source: MailRuntimeSource;
}

export type MailRuntime =
  | (MailRuntimeCommon & {
      readonly configured: true;
      readonly provider: "smtp";
      readonly host: string;
      readonly port: number;
      /** Only sent to the relay when a username is configured. */
      readonly user?: string;
      readonly password?: string;
      /** Implicit TLS on 465, STARTTLS everywhere else (worker semantics). */
      readonly secure: boolean;
    })
  | (MailRuntimeCommon & {
      readonly configured: true;
      readonly provider: "resend";
      readonly apiKey: string;
    })
  | {
      /** Nothing usable is configured; callers must not pretend a send worked. */
      readonly configured: false;
      readonly provider: "smtp" | "resend";
      readonly missing: readonly MailSettingKey[];
      readonly source: MailRuntimeSource;
    };

/** Indirection so `MailService` can be built without Nest (bootstrap script). */
export interface MailSettingsSource {
  resolve(): Promise<MailRuntime>;
}

/** Environment variable that backs each admin key, if any. */
const ENVIRONMENT_KEY: Record<MailSettingKey, string | undefined> = {
  "mail.provider": "EMAIL_PROVIDER",
  "mail.from": "EMAIL_FROM",
  "mail.resendApiKey": "RESEND_API_KEY",
  "mail.smtpHost": "SMTP_HOST",
  "mail.smtpPort": "SMTP_PORT",
  "mail.smtpUser": "SMTP_USER",
  "mail.smtpPassword": "SMTP_PASSWORD",
};

const SECURE_SMTP_PORT = 465;

interface LoadedMailSettings {
  readonly values: Readonly<Record<string, unknown>>;
  /** Keys with a real `SystemSetting` row (a row may still hold an empty value). */
  readonly storedKeys: ReadonlySet<string>;
  /** Keys the DB/registry marks as environment-locked. */
  readonly envLockedKeys: ReadonlySet<string>;
  readonly databaseAvailable: boolean;
}

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

/**
 * Resolves the effective mail transport for one send.
 *
 * Precedence is deliberate: an environment-locked key always comes from the
 * environment; otherwise a stored admin value wins over the environment, which
 * wins over the code default. A database outage degrades to environment +
 * defaults with a warning instead of turning every login into a 500.
 */
@Injectable()
export class MailSettingsConsumer implements MailSettingsSource {
  private lastEmptyFallbackWarnAt = 0;

  constructor(
    @Optional()
    @Inject(SettingsService)
    private readonly settings: SettingsService | undefined,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  async resolve(environment: NodeJS.ProcessEnv = process.env): Promise<MailRuntime> {
    const loaded = await this.load();
    const emptyFallbacks: MailSettingKey[] = [];

    const resolveKey = (key: MailSettingKey): { value: unknown; source: MailRuntimeSource } => {
      const envRaw = nonEmptyString(
        ENVIRONMENT_KEY[key] ? environment[ENVIRONMENT_KEY[key] as string] : undefined,
      );
      const stored = loaded.values[key];
      const storedPresent = loaded.storedKeys.has(key);
      const storedValue = nonEmptyString(stored);

      if (loaded.envLockedKeys.has(key) && envRaw !== undefined) {
        return { value: envRaw, source: "env" };
      }
      if (storedPresent && storedValue !== undefined) {
        return { value: stored, source: "db" };
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
      if (missing.length > 0 || apiKey === undefined) {
        this.warnEmptyFallbacks(emptyFallbacks);
        return { configured: false, provider, missing, source: apiKeyKey.source };
      }
      this.warnEmptyFallbacks(emptyFallbacks);
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

    if (missing.length > 0 || host === undefined || port === undefined) {
      this.warnEmptyFallbacks(emptyFallbacks);
      return { configured: false, provider, missing, source: hostKey.source };
    }

    this.warnEmptyFallbacks(emptyFallbacks);
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

  private warnEmptyFallbacks(keys: readonly MailSettingKey[]): void {
    if (keys.length === 0) {
      return;
    }
    const now = Date.now();
    if (now - this.lastEmptyFallbackWarnAt < 60_000) {
      return;
    }
    this.lastEmptyFallbackWarnAt = now;
    this.logger.warn(
      { event: "mail.settings_empty_fallback", keys: [...new Set(keys)] },
      "mail.settings_empty_fallback",
    );
  }

  private async load(): Promise<LoadedMailSettings> {
    if (!this.settings) {
      // Standalone callers (bootstrap script) run environment-only.
      return {
        values: {},
        storedKeys: new Set(),
        envLockedKeys: new Set(),
        databaseAvailable: false,
      };
    }

    try {
      const [group, admin] = await Promise.all([
        this.settings.getGroup("mail"),
        this.settings.listAdminSettings(),
      ]);
      const mailItems = admin.groups
        .filter((entry) => entry.group === "mail")
        .flatMap((entry) => entry.items);
      const storedKeys = new Set(
        mailItems.filter((item) => item.updatedAt !== null).map((item) => item.key),
      );
      const envLockedKeys = new Set(
        mailItems.filter((item) => item.envLocked).map((item) => item.key),
      );
      return { values: group, storedKeys, envLockedKeys, databaseAvailable: true };
    } catch (error) {
      this.logger.warn(
        {
          event: "mail.settings_unavailable",
          reason: error instanceof Error ? error.name : "UnknownError",
        },
        "mail.settings_unavailable",
      );
      return {
        values: {},
        storedKeys: new Set(),
        envLockedKeys: new Set(),
        databaseAvailable: false,
      };
    }
  }
}