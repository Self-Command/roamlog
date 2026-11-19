import {
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  SETTINGS_GROUP_LABELS,
  SETTINGS_GROUPS,
  UpdateAdminSettingsRequestSchema,
  type AdminSettingItem,
  type AdminSettingsGroup,
  type AdminSettingsResponse,
  type PublicSettingsResponse,
  type RevealAdminSettingResponse,
  type SettingValue,
  type SystemSettingValueType,
  type UpdateAdminSettingsResponse,
} from "@roamlog/contracts";
import { Prisma } from "@roamlog/db";
import type Redis from "ioredis";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { AuditService } from "../audit/audit.service.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RedisService } from "../redis/redis.service.js";
import { assertAdminAction } from "../admin/admin-access.js";
import { uuidV7FromString } from "../admin/admin-ids.js";
import { SecretBox, SecretBoxError } from "./secret-box.js";
import {
  SETTINGS_REGISTRY,
  SETTINGS_REGISTRY_TOKEN,
  type SettingDefinition,
} from "./settings.registry.js";

export const SETTINGS_CACHE_VERSION_KEY = "settings:version";
export const SETTINGS_INVALIDATION_CHANNEL = "settings.invalidated";
const REDIS_CACHE_PREFIX = "settings:v";
const PROCESS_CACHE_TTL_MS = 5_000;
const REDIS_CACHE_TTL_SECONDS = 300;
const SETTINGS_AUDIT_TARGET_ID = uuidV7FromString("system-settings");

interface ProcessCacheEntry {
  value: SettingValue;
  expiresAt: number;
}

export interface SystemSettingRow {
  key: string;
  group: string;
  valueType: string;
  value: unknown;
  secretCipher: string | null;
  secretLast4: string | null;
  keyVersion: number;
  envLocked: boolean;
  isPublic: boolean;
  updatedById: string | null;
  updatedAt: Date;
  createdAt: Date;
}

interface PlannedUpdate {
  definition: SettingDefinition;
  value: SettingValue;
}

@Injectable()
export class SettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly definitions: ReadonlyMap<string, SettingDefinition>;
  private readonly registry: readonly SettingDefinition[];
  private readonly processCache = new Map<string, ProcessCacheEntry>();
  private subscriber: Redis | undefined;
  private secretBox: SecretBox | undefined;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional()
    @Inject(SETTINGS_REGISTRY_TOKEN)
    registry: readonly SettingDefinition[] = SETTINGS_REGISTRY,
  ) {
    this.registry = registry;
    this.definitions = new Map(registry.map((entry) => [entry.key, entry]));
  }

  async onModuleInit(): Promise<void> {
    try {
      const subscriber = this.redis.client.duplicate();
      subscriber.on("error", (error: Error) => this.warnRedis("subscriber_error", error));
      subscriber.on("message", (channel: string) => {
        if (channel === SETTINGS_INVALIDATION_CHANNEL) {
          this.processCache.clear();
        }
      });
      // Store before awaiting so a temporarily unavailable Redis still gets a
      // client that reconnects (and re-subscribes) on its own.
      this.subscriber = subscriber;
      await subscriber.subscribe(SETTINGS_INVALIDATION_CHANNEL);
    } catch (error) {
      this.warnRedis("subscribe_failed", error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    const subscriber = this.subscriber;
    this.subscriber = undefined;
    if (!subscriber) {
      return;
    }
    try {
      if (subscriber.status === "ready") {
        await subscriber.quit();
      } else {
        subscriber.disconnect();
      }
    } catch {
      subscriber.disconnect();
    }
  }

  /** Test/ops hook; normal invalidation arrives through the pub/sub channel. */
  invalidateLocalCache(): void {
    this.processCache.clear();
  }

  async get(key: string): Promise<SettingValue> {
    const definition = this.definitions.get(key);
    if (!definition) {
      throw new NotFoundException({
        code: "SETTINGS_KEY_NOT_FOUND",
        message: "The setting key was not found.",
      });
    }

    const cached = this.processCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    // Secrets are intentionally never written to Redis: the shared cache would
    // hold plaintext credentials. The 5s process cache still bounds DB reads.
    if (definition.isSecret) {
      const row = await this.findRow(key);
      const value = this.resolveReadValue(definition, row);
      this.remember(key, value);
      return value;
    }

    const version = await this.readCacheVersion();
    if (version !== null) {
      const payload = await this.readRedisValue(version, key);
      if (payload !== undefined) {
        const value = this.validateRead(definition, payload);
        this.remember(key, value);
        return value;
      }
    }

    const row = await this.findRow(key);
    const value = this.resolveReadValue(definition, row);
    this.remember(key, value);

    if (version !== null) {
      await this.writeRedisValue(version, key, value);
    }
    return value;
  }

  async getGroup(group: string): Promise<Record<string, SettingValue>> {
    if (!(SETTINGS_GROUPS as readonly string[]).includes(group)) {
      throw new NotFoundException({
        code: "SETTINGS_GROUP_NOT_FOUND",
        message: "The setting group was not found.",
      });
    }

    const definitions = this.registry.filter((entry) => entry.group === group);
    const values = await Promise.all(
      definitions.map(async (entry) => [entry.key, await this.get(entry.key)] as const),
    );
    return Object.fromEntries(values);
  }

  async getPublicSettings(): Promise<PublicSettingsResponse> {
    const definitions = this.registry.filter((entry) => entry.isPublic && !entry.isSecret);
    const pairs = await Promise.all(
      definitions.map(async (entry) => [entry.key, await this.get(entry.key)] as const),
    );
    return {
      settings: Object.fromEntries(pairs),
      generatedAt: new Date().toISOString(),
    };
  }

  async listAdminSettings(): Promise<AdminSettingsResponse> {
    const rows = await this.prisma.client.systemSetting.findMany({
      where: { key: { in: this.registry.map((entry) => entry.key) } },
    });
    const byKey = new Map(rows.map((row) => [row.key, row as SystemSettingRow]));

    const groups: AdminSettingsGroup[] = SETTINGS_GROUPS.map((group) => ({
      group,
      label: SETTINGS_GROUP_LABELS[group],
      items: this.registry
        .filter((entry) => entry.group === group)
        .map((entry) => this.presentAdminItem(entry, byKey.get(entry.key) ?? null)),
    }));

    return { groups, generatedAt: new Date().toISOString() };
  }

  async getAdminSetting(key: string): Promise<AdminSettingItem> {
    const definition = this.definitions.get(key);
    if (!definition) {
      throw new NotFoundException({
        code: "SETTINGS_KEY_NOT_FOUND",
        message: "The setting key was not found.",
      });
    }
    const row = await this.findRow(key);
    return this.presentAdminItem(definition, row);
  }

  async update(actor: AuthenticatedActor, rawBody: unknown): Promise<UpdateAdminSettingsResponse> {
    assertAdminAction(actor, "admin:settings:write");
    const body = parseRequest(UpdateAdminSettingsRequestSchema, rawBody);

    const errors: Array<{ field: string; code: string; message: string }> = [];
    const planned: PlannedUpdate[] = [];
    const seen = new Set<string>();

    for (const update of body.updates) {
      const definition = this.definitions.get(update.key);
      if (!definition) {
        errors.push({
          field: update.key,
          code: "UNKNOWN_SETTING",
          message: "Unknown setting key.",
        });
        continue;
      }
      if (seen.has(update.key)) {
        errors.push({
          field: update.key,
          code: "DUPLICATE_SETTING",
          message: "A key may only appear once per request.",
        });
        continue;
      }
      seen.add(update.key);

      if (this.environmentOverride(definition).present) {
        errors.push({
          field: update.key,
          code: "SETTING_ENV_LOCKED",
          message: definition.envVar
            ? `This setting is locked by ${definition.envVar}.`
            : "This setting is locked by the environment.",
        });
        continue;
      }

      const parsed = definition.schema.safeParse(update.value);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          // Zod messages describe the rule; the supplied value is never part of
          // the response, which matters most for secret fields.
          errors.push({
            field: update.key,
            code: "INVALID_VALUE",
            message: issue.message,
          });
        }
        continue;
      }

      planned.push({ definition, value: parsed.data as SettingValue });
    }

    if (errors.length > 0) {
      throw new UnprocessableEntityException({
        code: "SETTINGS_INVALID",
        message: "One or more settings were rejected.",
        errors,
      });
    }

    const secretUpdates = planned.filter((entry) => entry.definition.isSecret);
    let secretBox: SecretBox | undefined;
    if (secretUpdates.length > 0) {
      secretBox = this.box();
    }

    const rows = await this.prisma.client.$transaction(async (transaction) => {
      const written: SystemSettingRow[] = [];
      for (const entry of planned) {
        const definition = entry.definition;
        const data = this.prepareWrite(definition, entry.value, secretBox);
        const row = await transaction.systemSetting.upsert({
          where: { key: definition.key },
          create: {
            key: definition.key,
            group: definition.group,
            isPublic: definition.isPublic,
            updatedById: actor.user.id,
            envLocked: false,
            ...data,
          } as never,
          update: {
            group: definition.group,
            isPublic: definition.isPublic,
            updatedById: actor.user.id,
            ...data,
          } as never,
        });
        written.push(row as SystemSettingRow);
      }
      return written;
    });

    // Local instance reflects the write immediately; Redis/version is what
    // lets the other instances drop their 5s cache.
    this.processCache.clear();

    const version = await this.bumpCacheVersion();
    await this.publishInvalidation(
      version,
      planned.map((entry) => entry.definition.key),
    );

    await this.audit.record({
      actorId: actor.user.id,
      actorType: "admin",
      action: "admin.settings.updated",
      targetType: "system_setting",
      targetId: SETTINGS_AUDIT_TARGET_ID,
      ip: actor.ip ?? undefined,
      userAgent: actor.userAgent ?? undefined,
      // Metadata records which keys changed and whether each held a secret,
      // never the values themselves.
      metadata: {
        keys: planned.map((entry) => entry.definition.key),
        secrets: planned.map((entry) => entry.definition.isSecret),
      },
    });

    return {
      updated: rows.map((row) => ({
        key: row.key,
        secret: row.secretCipher !== null,
        updatedAt: row.updatedAt.toISOString(),
      })),
      version,
      generatedAt: new Date().toISOString(),
    };
  }

  async reveal(
    actor: AuthenticatedActor,
    key: string,
    rawBody: unknown,
  ): Promise<RevealAdminSettingResponse> {
    if (actor.user.platformRole !== "super_admin") {
      throw revealForbidden();
    }
    assertAdminAction(actor, "admin:settings:read");

    const definition = this.definitions.get(key);
    if (!definition) {
      throw new NotFoundException({
        code: "SETTINGS_KEY_NOT_FOUND",
        message: "The setting key was not found.",
      });
    }
    if (!definition.isSecret) {
      throw new UnprocessableEntityException({
        code: "SETTINGS_NOT_SECRET",
        message: "Only secret settings can be revealed.",
      });
    }

    const body = rawBody as { confirm?: unknown } | null | undefined;
    if (body?.confirm !== true) {
      throw revealForbidden("explicit_confirmation_required");
    }

    const state = await this.prisma.client.user.findUnique({
      where: { id: actor.user.id },
      select: {
        twoFactorEnabled: true,
        twoFactors: {
          where: { verified: true },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!state?.twoFactorEnabled || state.twoFactors.length === 0) {
      throw revealForbidden("two_factor_required");
    }

    const row = await this.findRow(key);
    if (!row?.secretCipher) {
      throw new NotFoundException({
        code: "SETTING_SECRET_NOT_CONFIGURED",
        message: "This secret has not been configured yet.",
      });
    }

    let plaintext: string;
    try {
      plaintext = this.box().decrypt(definition.key, row.secretCipher);
    } catch (error) {
      throw this.secretFailure(definition.key, error);
    }

    await this.audit.record({
      actorId: actor.user.id,
      actorType: "admin",
      action: "admin.settings.revealed",
      targetType: "system_setting",
      targetId: SETTINGS_AUDIT_TARGET_ID,
      ip: actor.ip ?? undefined,
      userAgent: actor.userAgent ?? undefined,
      metadata: { key: definition.key },
    });

    return {
      key: definition.key,
      value: plaintext,
      revealedAt: new Date().toISOString(),
    };
  }

  private async findRow(key: string): Promise<SystemSettingRow | null> {
    const row = await this.prisma.client.systemSetting.findUnique({ where: { key } });
    return (row as SystemSettingRow | null) ?? null;
  }

  private resolveReadValue(
    definition: SettingDefinition,
    row: SystemSettingRow | null,
  ): SettingValue {
    const override = this.environmentOverride(definition);
    if (override.present) {
      return this.validateRead(definition, override.value);
    }

    if (definition.isSecret) {
      if (!row?.secretCipher) {
        return null;
      }
      let plaintext: string;
      try {
        plaintext = this.box().decrypt(definition.key, row.secretCipher);
      } catch (error) {
        throw this.secretFailure(definition.key, error);
      }
      return this.validateRead(definition, plaintext);
    }

    return this.validateRead(definition, row ? row.value : definition.defaultValue);
  }

  private validateRead(definition: SettingDefinition, value: unknown): SettingValue {
    const parsed = definition.schema.safeParse(value);
    if (!parsed.success) {
      this.logger.error(
        { key: definition.key, issues: parsed.error.issues.map((issue) => issue.message) },
        "settings.stored_value_invalid",
      );
      throw new InternalServerErrorException({
        code: "SETTINGS_VALUE_INVALID",
        message: `The stored value for ${definition.key} is invalid.`,
      });
    }
    return parsed.data as SettingValue;
  }

  private presentAdminItem(
    definition: SettingDefinition,
    row: SystemSettingRow | null,
  ): AdminSettingItem {
    const override = this.environmentOverride(definition);
    const secret = definition.isSecret
      ? {
          hasValue: override.present || Boolean(row?.secretCipher),
          last4: override.present ? lastFour(override.value) : (row?.secretLast4 ?? null),
        }
      : undefined;

    const item: AdminSettingItem = {
      key: definition.key,
      group: definition.group,
      type: definition.type,
      label: definition.label,
      ...(definition.help ? { help: definition.help } : {}),
      ...(definition.options ? { options: [...definition.options] } : {}),
      default: definition.defaultValue as SettingValue,
      isSecret: definition.isSecret,
      isPublic: definition.isPublic,
      envLocked: definition.envLocked || row?.envLocked === true,
      ...(secret ? { secret } : { value: this.effectiveAdminValue(definition, row) }),
      updatedAt: row ? row.updatedAt.toISOString() : null,
      updatedById: row?.updatedById ?? null,
    };
    return item;
  }

  private effectiveAdminValue(
    definition: SettingDefinition,
    row: SystemSettingRow | null,
  ): SettingValue {
    const override = this.environmentOverride(definition);
    if (override.present) {
      return this.validateRead(definition, override.value);
    }
    return this.validateRead(definition, row ? row.value : definition.defaultValue);
  }

  private prepareWrite(
    definition: SettingDefinition,
    value: SettingValue,
    secretBox: SecretBox | undefined,
  ): Record<string, unknown> {
    const type: SystemSettingValueType = definition.type;
    if (definition.isSecret) {
      if (!secretBox) {
        throw new InternalServerErrorException({
          code: "SETTINGS_ENCRYPTION_UNAVAILABLE",
          message: "Secret storage is not configured.",
        });
      }
      const encrypted = secretBox.encrypt(definition.key, String(value));
      return {
        valueType: type,
        // Prisma maps a plain `null` on a JSON column to JSON null; the DB check
        // constraint requires SQL NULL for secret rows.
        value: Prisma.DbNull,
        secretCipher: encrypted.ciphertext,
        secretLast4: lastFour(value),
        keyVersion: encrypted.keyVersion,
      };
    }

    return {
      valueType: type,
      value: value === null ? Prisma.DbNull : (value as never),
      secretCipher: null,
      secretLast4: null,
      keyVersion: 1,
    };
  }

  private box(): SecretBox {
    if (!this.secretBox) {
      try {
        this.secretBox = SecretBox.fromEnvironment({
          CONFIG_ENCRYPTION_KEY: this.config.configEncryptionKey,
          CONFIG_ENCRYPTION_KEYS: this.config.configEncryptionKeys,
        });
      } catch (error) {
        if (error instanceof SecretBoxError) {
          this.logger.error({ code: error.code }, "settings.encryption_key_unavailable");
          throw new ServiceUnavailableException({
            code: "SETTINGS_ENCRYPTION_UNAVAILABLE",
            message: "Secret storage is not configured. Set CONFIG_ENCRYPTION_KEY.",
          });
        }
        throw error;
      }
    }
    return this.secretBox;
  }

  private secretFailure(key: string, error: unknown): Error {
    if (error instanceof SecretBoxError) {
      this.logger.error({ code: error.code, key }, "settings.secret_unreadable");
      return new InternalServerErrorException({
        code: "SETTINGS_SECRET_UNREADABLE",
        message: `The stored secret for ${key} cannot be decrypted.`,
      });
    }
    return error instanceof Error ? error : new Error("Secret decryption failed");
  }

  private remember(key: string, value: SettingValue): void {
    this.processCache.set(key, { value, expiresAt: Date.now() + PROCESS_CACHE_TTL_MS });
  }

  private async readCacheVersion(): Promise<number | null> {
    try {
      const raw = await this.redis.client.get(SETTINGS_CACHE_VERSION_KEY);
      if (raw === null) {
        return 0;
      }
      const parsed = Number(raw);
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
    } catch (error) {
      this.warnRedis("read_version_failed", error);
      return null;
    }
  }

  private async readRedisValue(version: number, key: string): Promise<SettingValue | undefined> {
    try {
      const raw = await this.redis.client.get(redisCacheKey(version, key));
      if (raw === null) {
        return undefined;
      }
      const parsed = JSON.parse(raw) as { value?: SettingValue };
      if (!parsed || typeof parsed !== "object" || !("value" in parsed)) {
        return undefined;
      }
      return parsed.value as SettingValue;
    } catch (error) {
      this.warnRedis("read_value_failed", error);
      return undefined;
    }
  }

  private async writeRedisValue(version: number, key: string, value: SettingValue): Promise<void> {
    try {
      await this.redis.client.set(
        redisCacheKey(version, key),
        JSON.stringify({ value }),
        "EX",
        REDIS_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.warnRedis("write_value_failed", error);
    }
  }

  private async bumpCacheVersion(): Promise<number | null> {
    try {
      return await this.redis.client.incr(SETTINGS_CACHE_VERSION_KEY);
    } catch (error) {
      this.warnRedis("increment_version_failed", error);
      return null;
    }
  }

  private async publishInvalidation(
    version: number | null,
    keys: readonly string[],
  ): Promise<void> {
    try {
      await this.redis.client.publish(
        SETTINGS_INVALIDATION_CHANNEL,
        JSON.stringify({ version, keys, at: new Date().toISOString() }),
      );
    } catch (error) {
      this.warnRedis("publish_invalidation_failed", error);
    }
  }

  private environmentOverride(definition: SettingDefinition): {
    present: boolean;
    value?: unknown;
  } {
    if (!definition.envLocked || !definition.envVar) {
      return { present: false };
    }
    const raw = process.env[definition.envVar];
    if (raw === undefined || raw === "") {
      return { present: false };
    }

    switch (definition.type) {
      case "boolean":
        return { present: true, value: /^(1|true|yes|on)$/iu.test(raw) };
      case "number": {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) {
          throw new InternalServerErrorException({
            code: "SETTINGS_ENV_INVALID",
            message: `The environment override for ${definition.key} is not a number.`,
          });
        }
        return { present: true, value: parsed };
      }
      case "json":
        try {
          return { present: true, value: JSON.parse(raw) as unknown };
        } catch {
          throw new InternalServerErrorException({
            code: "SETTINGS_ENV_INVALID",
            message: `The environment override for ${definition.key} is not valid JSON.`,
          });
        }
      default:
        return { present: true, value: raw };
    }
  }

  private warnRedis(operation: string, error: unknown): void {
    this.logger.warn({ err: error, operation }, "settings.redis_degraded");
  }
}

function redisCacheKey(version: number, key: string): string {
  return `${REDIS_CACHE_PREFIX}${version}:${key}`;
}

function lastFour(value: unknown): string | null {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text ? text.slice(-4) : null;
}

function revealForbidden(reason?: string): ForbiddenException {
  return new ForbiddenException({
    code: "SETTINGS_REVEAL_FORBIDDEN",
    message:
      reason === "two_factor_required"
        ? "Enable and verify two-factor authentication before revealing a secret."
        : reason === "explicit_confirmation_required"
          ? "Revealing a secret requires confirm: true in the request body."
          : "Only a super administrator with two-factor authentication can reveal secrets.",
  });
}
