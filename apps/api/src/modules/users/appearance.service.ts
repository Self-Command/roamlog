import {
  ForbiddenException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  AppearanceCookieSchema,
  AppearanceDefaultsSchema,
  DEFAULT_FONT_PAIRING_ID,
  DEFAULT_SKIN_ID,
  ResolvedAppearanceSchema,
  UpdateAppearancePreferenceSchema,
  normalizeFontPairingId,
  normalizeSkinId,
  type AppearanceCookie,
  type AppearanceDefaults,
  type ResolvedAppearance,
  type UpdateAppearancePreference,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { SettingsService } from "../settings/settings.service.js";

export const APPEARANCE_COOKIE_NAME = "roamlog_appearance";
export const APPEARANCE_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1_000;

interface AppearanceRow {
  userId: string;
  mode: string | null;
  skin: string | null;
  fontPairing: string | null;
  updatedAt: Date;
}

interface PlatformAppearance {
  defaults: AppearanceDefaults;
  canOverride: boolean;
}

export interface AppearanceResult {
  appearance: ResolvedAppearance;
  /** Null tells the controller to clear a stale cookie. */
  cookie: AppearanceCookie | null;
}

function hasOverride(row: AppearanceRow | null): row is AppearanceRow {
  return Boolean(row && (row.mode !== null || row.skin !== null || row.fontPairing !== null));
}

function cookieFor(row: AppearanceRow): AppearanceCookie {
  return AppearanceCookieSchema.parse({
    v: 1,
    ...(row.mode ? { mode: row.mode } : {}),
    ...(row.skin ? { skin: normalizeSkinId(row.skin) } : {}),
    ...(row.fontPairing
      ? { fontPairing: normalizeFontPairingId(row.fontPairing) }
      : {}),
    uid: row.userId,
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function serializeAppearanceCookie(cookie: AppearanceCookie): string {
  return JSON.stringify(cookie);
}

function parseUpdate(value: unknown): UpdateAppearancePreference {
  const parsed = UpdateAppearancePreferenceSchema.safeParse(value);
  if (!parsed.success) {
    throw new UnprocessableEntityException({
      code: "VALIDATION_ERROR",
      message: "The appearance preference did not pass validation.",
      errors: parsed.error.issues.map((issue) => ({
        field: issue.path.map(String).join(".") || undefined,
        code: "INVALID_INPUT",
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

@Injectable()
export class AppearanceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async get(actor: AuthenticatedActor): Promise<AppearanceResult> {
    const platform = await this.platformDefaults();
    const row = await this.findRow(actor.user.id);
    return this.present(platform, row);
  }

  async update(actor: AuthenticatedActor, rawInput: unknown): Promise<AppearanceResult> {
    const platform = await this.platformDefaults();
    if (!platform.canOverride) {
      throw new ForbiddenException({
        code: "APPEARANCE_OVERRIDE_DISABLED",
        message: "User appearance overrides are disabled by the platform administrator.",
      });
    }

    const input = parseUpdate(rawInput);
    const row = await this.prisma.client.$transaction(async (transaction) => {
      const updated = await transaction.userAppearancePreference.upsert({
        where: { userId: actor.user.id },
        create: {
          userId: actor.user.id,
          mode: input.mode ?? null,
          skin: input.skin ?? null,
          fontPairing: input.fontPairing ?? null,
        },
        update: this.updates(input),
        select: {
          userId: true,
          mode: true,
          skin: true,
          fontPairing: true,
          updatedAt: true,
        },
      });
      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "user",
          action: "user.appearance.updated",
          targetType: "user",
          targetId: actor.user.id,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
          metadata: { changedFields: Object.keys(input).sort() },
        },
        transaction,
      );
      return updated as AppearanceRow;
    });

    return this.present(platform, row);
  }

  async reset(actor: AuthenticatedActor): Promise<AppearanceResult> {
    const platform = await this.platformDefaults();
    await this.prisma.client.$transaction(async (transaction) => {
      const existing = await transaction.userAppearancePreference.findUnique({
        where: { userId: actor.user.id },
        select: {
          userId: true,
          mode: true,
          skin: true,
          fontPairing: true,
          updatedAt: true,
        },
      });
      const changedFields = existing
        ? (["mode", "skin", "fontPairing"] as const).filter((field) => existing[field] !== null)
        : [];
      await transaction.userAppearancePreference.deleteMany({
        where: { userId: actor.user.id },
      });
      if (existing) {
        await this.audit.record(
          {
            actorId: actor.user.id,
            actorType: "user",
            action: "user.appearance.updated",
            targetType: "user",
            targetId: actor.user.id,
            ip: actor.ip ?? undefined,
            userAgent: actor.userAgent ?? undefined,
            metadata: { reset: true, changedFields: [...changedFields] },
          },
          transaction,
        );
      }
    });

    return this.present(platform, null);
  }

  private async platformDefaults(): Promise<PlatformAppearance> {
    const group = await this.settings.getGroup("theme");
    const defaults = AppearanceDefaultsSchema.parse({
      mode: group["theme.defaultMode"],
      skin: normalizeSkinId(
        typeof group["theme.defaultSkin"] === "string"
          ? group["theme.defaultSkin"]
          : DEFAULT_SKIN_ID,
      ),
      fontPairing: normalizeFontPairingId(
        typeof group["theme.defaultFont"] === "string"
          ? group["theme.defaultFont"]
          : DEFAULT_FONT_PAIRING_ID,
      ),
    });
    return {
      defaults,
      canOverride: group["theme.allowUserOverride"] !== false,
    };
  }

  private findRow(userId: string): Promise<AppearanceRow | null> {
    return this.prisma.client.userAppearancePreference.findUnique({
      where: { userId },
      select: {
        userId: true,
        mode: true,
        skin: true,
        fontPairing: true,
        updatedAt: true,
      },
    }) as Promise<AppearanceRow | null>;
  }

  private present(platform: PlatformAppearance, row: AppearanceRow | null): AppearanceResult {
    const effectiveRow = platform.canOverride ? row : null;
    const appearance = ResolvedAppearanceSchema.parse({
      mode: effectiveRow?.mode ?? platform.defaults.mode,
      skin: normalizeSkinId(effectiveRow?.skin ?? platform.defaults.skin),
      fontPairing: normalizeFontPairingId(
        effectiveRow?.fontPairing ?? platform.defaults.fontPairing,
      ),
      source: hasOverride(effectiveRow) ? "user" : "platform",
      canOverride: platform.canOverride,
      updatedAt: effectiveRow?.updatedAt.toISOString() ?? null,
      defaults: platform.defaults,
    });
    return {
      appearance,
      cookie: platform.canOverride && effectiveRow ? cookieFor(effectiveRow) : null,
    };
  }

  private updates(input: UpdateAppearancePreference): Record<string, unknown> {
    return {
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
      ...(input.skin !== undefined ? { skin: input.skin } : {}),
      ...(input.fontPairing !== undefined ? { fontPairing: input.fontPairing } : {}),
    };
  }
}
