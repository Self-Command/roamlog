import { randomUUID } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { UpdateAdminSettingsRequestSchema, type AdminSettingItem } from "@roamlog/contracts";

import { withTimeout } from "../../common/utils/with-timeout.js";
import { AppConfigService } from "../../config/app-config.service.js";
import type { StorageSettings } from "../../config/storage-settings.js";
import { MailDeliveryError, MailService } from "../email/mail.service.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { StorageProbeService } from "../storage/storage-probe.service.js";
import type { MailRuntime } from "./mail-settings.consumer.js";
import {
  SETTINGS_REGISTRY,
  SETTINGS_REGISTRY_TOKEN,
  type SettingDefinition,
} from "./settings.registry.js";
import { SettingsService } from "./settings.service.js";
import {
  StorageSettingsConsumer,
  storageConfigVersion,
  type ResolvedStorageConfig,
  type StorageConfigField,
  type StorageConfigSource,
} from "./storage-settings.consumer.js";

/**
 * Connectivity-relevant keys. A PATCH that touches any of them must be proven
 * against a live endpoint before it may replace the stored configuration;
 * every other key (`site.title`, `media.maxEdge`, ...) is pure data and must not
 * pay for a network round-trip on every save.
 */
export const STORAGE_PROBE_KEYS = [
  "storage.endpoint",
  "storage.publicEndpoint",
  "storage.bucket",
  "storage.region",
  "storage.accessKey",
  "storage.secretKey",
  "storage.forcePathStyle",
] as const;

export const MAIL_PROBE_KEYS = [
  "mail.provider",
  "mail.from",
  "mail.resendApiKey",
  "mail.smtpHost",
  "mail.smtpPort",
  "mail.smtpUser",
  "mail.smtpPassword",
] as const;

export type ProbeTarget = "storage" | "mail";

export interface SettingsUpdateInput {
  key: string;
  value: unknown;
}

/** Shape of the `checks` array; storage fills it, mail has no steps. */
export interface ProbeCheck {
  name: string;
  ok: boolean;
  ms?: number;
}

/**
 * Outcome of the pre-save probe.
 *
 * `required: false` means the update cannot affect a live transport, so the
 * caller may proceed without a network probe. A required outcome carries either
 * a proven-good result or a stable failure code/message that is safe to return
 * to an operator (never a secret, never a raw provider error).
 */
export type ProbeOutcome =
  | { required: false }
  | { required: true; ok: true; targets: ProbeTarget[] }
  | {
      required: true;
      ok: false;
      target: ProbeTarget;
      code: string;
      message: string;
      checks: ProbeCheck[];
    };

/** Internal probe result, before it is wrapped in a {@link ProbeOutcome}. */
export interface ProbeAttempt {
  ok: boolean;
  code?: string;
  message?: string;
  checks?: ProbeCheck[];
}

export const MISSING_CREDENTIALS = "MISSING_CREDENTIALS";
export const PROBE_UNAVAILABLE = "PROBE_UNAVAILABLE";
export const MAIL_NOT_CONFIGURED = "MAIL_NOT_CONFIGURED";

/** The nodemailer transport has no built-in timeout; a save must not hang. */
export const MAIL_SAVE_PROBE_TIMEOUT_MS = 10_000;

const STORAGE_KEY_SET: ReadonlySet<string> = new Set(STORAGE_PROBE_KEYS);
const MAIL_KEY_SET: ReadonlySet<string> = new Set(MAIL_PROBE_KEYS);

/** Mirrors `MailSettingsConsumer`'s private environment map. */
const MAIL_ENV: Record<(typeof MAIL_PROBE_KEYS)[number], string | undefined> = {
  "mail.provider": "EMAIL_PROVIDER",
  "mail.from": "EMAIL_FROM",
  "mail.resendApiKey": "RESEND_API_KEY",
  "mail.smtpHost": "SMTP_HOST",
  "mail.smtpPort": "SMTP_PORT",
  "mail.smtpUser": "SMTP_USER",
  "mail.smtpPassword": "SMTP_PASSWORD",
};

type MailKey = (typeof MAIL_PROBE_KEYS)[number];
type MailSource = "db" | "env" | "default";

interface MailValue {
  value: unknown;
  source: MailSource;
}

interface MailValues {
  readonly values: Readonly<Record<MailKey, unknown>>;
  readonly items: ReadonlyMap<string, AdminSettingItem>;
  /** Keys the DB/registry marks as environment-locked. */
  readonly envLockedKeys: ReadonlySet<string>;
}

/**
 * Refuses to persist a storage or mail configuration that has not just worked.
 *
 * "Works" means the probe runs against the *merged* configuration (stored DB
 * values + this request's updates + environment fallback), i.e. exactly what
 * would become effective if the write succeeded. Running the probe after the
 * write would leave a broken configuration behind whenever it failed, which is
 * the failure mode this service exists to prevent.
 *
 * The existing probe implementations are reused unchanged: a throw-away
 * `StorageProbeService` is constructed with a read port that answers with the
 * merged settings, and a throw-away `MailService` is constructed with a source
 * that answers with the merged runtime. Neither module is modified.
 */
@Injectable()
export class SettingsSaveProbeService {
  private readonly definitions: ReadonlyMap<string, SettingDefinition>;
  private readonly registry: readonly SettingDefinition[];
  private storageConsumer: StorageSettingsConsumer | undefined;

  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Optional()
    @Inject(SETTINGS_REGISTRY_TOKEN)
    registry: readonly SettingDefinition[] = SETTINGS_REGISTRY,
  ) {
    this.registry = registry;
    this.definitions = new Map(registry.map((entry) => [entry.key, entry]));
  }

  /**
   * Decide whether `updates` needs a live probe and, when it does, run it
   * against the merged configuration.
   *
   * Invalid/unknown/env-locked updates return `required: false`: the write path
   * rejects the whole request before touching the database, so a network probe
   * would only waste a request and could mask the authoritative validation
   * error.
   */
  async probeForUpdate(updates: readonly SettingsUpdateInput[]): Promise<ProbeOutcome> {
    const validated = this.validate(updates);
    if (!validated) {
      return { required: false };
    }

    const targets = probeTargetsFor(validated.map((update) => update.key));
    if (targets.length === 0) {
      return { required: false };
    }

    for (const target of targets) {
      const attempt =
        target === "storage"
          ? await this.storageAttempt(validated)
          : await this.mailAttempt(validated);
      if (!attempt.ok) {
        return {
          required: true,
          ok: false,
          target,
          code: attempt.code ?? PROBE_UNAVAILABLE,
          message: attempt.message ?? unavailableMessage(target),
          checks: attempt.checks ?? [],
        };
      }
    }

    return { required: true, ok: true, targets };
  }

  /** Normalized update list, or `null` when the write path will reject it. */
  private validate(updates: readonly SettingsUpdateInput[]): SettingsUpdateInput[] | null {
    if (!Array.isArray(updates) || updates.length === 0) {
      return null;
    }
    const parsed = UpdateAdminSettingsRequestSchema.safeParse({ updates });
    if (!parsed.success) {
      return null;
    }

    const seen = new Set<string>();
    for (const update of parsed.data.updates) {
      const definition = this.definitions.get(update.key);
      if (!definition || seen.has(update.key)) {
        return null;
      }
      seen.add(update.key);
      // `SettingsService` refuses env-locked keys before writing; do not probe a
      // value that will never be stored.
      if (definition.envLocked && definition.envVar) {
        const raw = process.env[definition.envVar];
        if (raw !== undefined && raw !== "") {
          return null;
        }
      }
      if (!definition.schema.safeParse(update.value).success) {
        return null;
      }
    }
    return parsed.data.updates;
  }

  private async storageAttempt(updates: readonly SettingsUpdateInput[]): Promise<ProbeAttempt> {
    try {
      const settings = await this.mergedStorageSettings(updates);
      // Probe with the secret that will be effective, even when this request
      // did not replace it. A blank credential cannot reach S3 and is reported
      // before any network call.
      if (!settings.accessKey || !settings.secretKey) {
        return {
          ok: false,
          code: MISSING_CREDENTIALS,
          message:
            "The effective storage credentials are incomplete. Set storage.accessKey and storage.secretKey (or provide them through the environment).",
          checks: [],
        };
      }
      return await this.executeStorageProbe(settings);
    } catch (error) {
      return this.unavailable("storage", error);
    }
  }

  private async mailAttempt(updates: readonly SettingsUpdateInput[]): Promise<ProbeAttempt> {
    try {
      const runtime = await this.mergedMailRuntime(updates);
      if (!runtime.configured) {
        const secretMissing = runtime.missing.some(
          (key) => this.definitions.get(key)?.isSecret === true,
        );
        return {
          ok: false,
          code: secretMissing ? MISSING_CREDENTIALS : MAIL_NOT_CONFIGURED,
          message: secretMissing
            ? "The effective mail credentials are incomplete. Set the missing mail secret (or provide it through the environment)."
            : "The effective mail configuration is incomplete. Set the provider, from address, SMTP host and port (or the Resend API key).",
          checks: [],
        };
      }
      return await this.executeMailProbe(runtime);
    } catch (error) {
      return this.unavailable("mail", error);
    }
  }

  private async mergedStorageSettings(
    updates: readonly SettingsUpdateInput[],
  ): Promise<StorageSettings> {
    const consumer = this.storageConsumerInstance();
    // The probe must reflect what a save right now would produce, not a value
    // another instance cached up to 5s ago.
    consumer.invalidate();
    const resolved = await consumer.resolve();
    const settings: StorageSettings = { ...resolved.settings };

    for (const update of updates) {
      switch (update.key) {
        case "storage.endpoint":
          settings.endpoint = String(update.value);
          break;
        case "storage.publicEndpoint":
          if (typeof update.value === "string" && update.value.trim().length > 0) {
            settings.publicEndpoint = update.value;
          } else {
            delete settings.publicEndpoint;
          }
          break;
        case "storage.bucket":
          settings.bucket = String(update.value);
          break;
        case "storage.region":
          settings.region = String(update.value);
          break;
        case "storage.accessKey":
          settings.accessKey = String(update.value);
          break;
        case "storage.secretKey":
          settings.secretKey = String(update.value);
          break;
        case "storage.forcePathStyle":
          settings.forcePathStyle = update.value === true;
          break;
        default:
          break;
      }
    }
    return settings;
  }

  private storageConsumerInstance(): StorageSettingsConsumer {
    if (!this.storageConsumer) {
      this.storageConsumer = new StorageSettingsConsumer(
        this.settings,
        this.config.storageSettings,
        this.logger,
        this.registry,
      );
    }
    return this.storageConsumer;
  }

  private async mergedMailRuntime(updates: readonly SettingsUpdateInput[]): Promise<MailRuntime> {
    const loaded = await this.loadMailValues();
    const overrides = new Map(updates.map((update) => [update.key, update.value]));
    const values = {} as Record<MailKey, MailValue>;

    for (const key of MAIL_PROBE_KEYS) {
      if (overrides.has(key)) {
        values[key] = { value: overrides.get(key), source: "db" };
        continue;
      }

      const envRaw = MAIL_ENV[key];
      const env = nonEmptyString(envRaw ? process.env[envRaw] : undefined);
      const item = loaded.items.get(key);
      const storedPresent = item?.updatedAt !== null && item?.updatedAt !== undefined;
      const stored = nonEmptyString(loaded.values[key]);

      if (loaded.envLockedKeys.has(key) && env !== undefined) {
        values[key] = { value: env, source: "env" };
        continue;
      }
      if (storedPresent && stored !== undefined) {
        values[key] = { value: loaded.values[key], source: "db" };
        continue;
      }
      if (env !== undefined) {
        values[key] = { value: env, source: "env" };
        continue;
      }
      values[key] = { value: item?.default ?? null, source: "default" };
    }

    const providerValue = values["mail.provider"].value;
    const provider = providerValue === "resend" ? "resend" : "smtp";
    const from = nonEmptyString(values["mail.from"].value) ?? "";

    if (provider === "resend") {
      const apiKeyValue = values["mail.resendApiKey"];
      const apiKey = nonEmptyString(apiKeyValue.value);
      const missing: MailKey[] = [];
      if (apiKey === undefined || apiKeyValue.source === "default") {
        missing.push("mail.resendApiKey");
      }
      if (!from) {
        missing.push("mail.from");
      }
      if (missing.length > 0 || apiKey === undefined) {
        return { configured: false, provider, missing, source: apiKeyValue.source };
      }
      return { configured: true, provider, apiKey, from, source: apiKeyValue.source };
    }

    const hostValue = values["mail.smtpHost"];
    const portValue = values["mail.smtpPort"];
    const userValue = values["mail.smtpUser"];
    const passwordValue = values["mail.smtpPassword"];
    const host = nonEmptyString(hostValue.value);
    const port = portFrom(portValue.value);
    const user = nonEmptyString(userValue.value);
    const password = nonEmptyString(passwordValue.value);
    const missing: MailKey[] = [];

    // `localhost` is the code default, not a relay an operator configured.
    if (host === undefined || hostValue.source === "default") {
      missing.push("mail.smtpHost");
    }
    if (!from) {
      missing.push("mail.from");
    }
    if (port === undefined) {
      missing.push("mail.smtpPort");
    }
    if (user !== undefined && password === undefined) {
      missing.push("mail.smtpPassword");
    }

    if (missing.length > 0 || host === undefined || port === undefined) {
      return { configured: false, provider, missing, source: hostValue.source };
    }

    return {
      configured: true,
      provider: "smtp",
      host,
      port,
      ...(user === undefined ? {} : { user }),
      ...(password === undefined ? {} : { password }),
      secure: port === 465,
      from,
      source: hostValue.source,
    };
  }

  private async loadMailValues(): Promise<MailValues> {
    const [values, admin] = await Promise.all([
      this.settings.getGroup("mail"),
      this.settings.listAdminSettings(),
    ]);
    const items = new Map(
      admin.groups
        .filter((group) => group.group === "mail")
        .flatMap((group) => group.items)
        .map((item) => [item.key, item]),
    );
    return {
      values: values as Record<MailKey, unknown>,
      items,
      envLockedKeys: new Set(
        [...items.values()].filter((item) => item.envLocked).map((item) => item.key),
      ),
    };
  }

  /**
   * Run the real storage probe against a merged configuration.
   *
   * `StorageSettingsConsumer.resolve()` returns the config that the *current*
   * read port yields; here it is a one-shot read port that answers with the
   * merged settings, so the storage module's probe implementation can stay
   * untouched and still exercise the candidate configuration.
   */
  protected async executeStorageProbe(settings: StorageSettings): Promise<ProbeAttempt> {
    const resolved: ResolvedStorageConfig = {
      settings,
      version: storageConfigVersion(settings),
      sources: mergedStorageSources,
      envLockedKeys: [],
      warnings: [],
    };
    const readPort = {
      invalidate: () => undefined,
      resolve: async () => resolved,
    } as unknown as StorageSettingsConsumer;

    const result = await new StorageProbeService(readPort, this.logger).run();
    if (result.ok) {
      return { ok: true, checks: result.checks };
    }
    return {
      ok: false,
      code: result.code,
      message: result.message,
      checks: result.checks,
    };
  }

  /**
   * Send one real message through the existing mail implementation, using a
   * source that answers with the merged runtime instead of the stored one.
   */
  protected async executeMailProbe(
    runtime: Extract<MailRuntime, { configured: true }>,
  ): Promise<ProbeAttempt> {
    const mail = new MailService({ resolve: async () => runtime }, this.logger);
    try {
      await withTimeout(
        mail.send({
          to: probeRecipient(runtime.from),
          subject: "Roamlog settings save probe",
          text: "This is a probe from the Roamlog admin settings. The configuration was accepted if you received it.",
          html: [
            '<div style="background:#000;color:#fcfdff;font-family:Georgia,serif;padding:32px">',
            '<h1 style="font-size:24px;font-weight:500;margin:0 0 20px">Settings save probe</h1>',
            '<p style="color:#acb1ba;line-height:1.6">This message proves the mail configuration saved by Roamlog can deliver.</p>',
            "</div>",
          ].join(""),
          idempotencyKey: `settings-save-probe-${randomUUID()}`,
        }),
        MAIL_SAVE_PROBE_TIMEOUT_MS,
        "The mail settings save probe timed out.",
      );
      return { ok: true, checks: [] };
    } catch (error) {
      if (error instanceof MailDeliveryError) {
        return { ok: false, code: error.code, message: error.message, checks: [] };
      }
      this.logger.warn(
        {
          event: "settings.save_probe_unavailable",
          target: "mail",
          reason: error instanceof Error ? error.name : "UnknownError",
        },
        "settings.save_probe_unavailable",
      );
      return {
        ok: false,
        code: PROBE_UNAVAILABLE,
        message: unavailableMessage("mail"),
        checks: [],
      };
    }
  }

  private unavailable(target: ProbeTarget, error: unknown): ProbeAttempt {
    // Never log the error message: it can contain a host, a key id or a
    // connection string. The class name is enough for diagnostics.
    this.logger.warn(
      {
        event: "settings.save_probe_unavailable",
        target,
        reason: error instanceof Error ? error.name : "UnknownError",
      },
      "settings.save_probe_unavailable",
    );
    return { ok: false, code: PROBE_UNAVAILABLE, message: unavailableMessage(target), checks: [] };
  }
}

const mergedStorageSources = {
  endpoint: "database",
  publicEndpoint: "database",
  bucket: "database",
  region: "database",
  accessKey: "database",
  secretKey: "database",
  forcePathStyle: "database",
} satisfies Record<StorageConfigField, StorageConfigSource>;

/** Targets named by a list of setting keys, in probe order (storage first). */
export function probeTargetsFor(keys: readonly string[]): ProbeTarget[] {
  const targets: ProbeTarget[] = [];
  if (keys.some((key) => STORAGE_KEY_SET.has(key))) {
    targets.push("storage");
  }
  if (keys.some((key) => MAIL_KEY_SET.has(key))) {
    targets.push("mail");
  }
  return targets;
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
 * Recipient for the mail probe: the configured `from` address when it parses,
 * otherwise a local address. Sending to the same mailbox the product sends from
 * verifies both envelope directions against the operator's real relay.
 */
export function probeRecipient(from: string): string {
  const bracketed = /<([^<>\s]+@[^<>\s]+)>/u.exec(from)?.[1];
  const candidate = (bracketed ?? from).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(candidate) ? candidate : "probe@localhost";
}

function unavailableMessage(target: ProbeTarget): string {
  return target === "storage"
    ? "The storage configuration could not be verified because the probe did not complete. The settings were not saved."
    : "The mail configuration could not be verified because the probe did not complete. The settings were not saved.";
}