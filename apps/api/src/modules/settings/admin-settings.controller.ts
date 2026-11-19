import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { UpdateAdminSettingsResponse } from "@roamlog/contracts";
import type { Response } from "express";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { AdminGuard } from "../admin/admin.guard.js";
import { RequireAdminAction } from "../admin/admin.decorator.js";
import { uuidV7FromString } from "../admin/admin-ids.js";
import { PlatformTwoFactorGuard } from "../admin/platform-two-factor.guard.js";
import { AuditService } from "../audit/audit.service.js";
import { SettingsService } from "./settings.service.js";
import {
  PROBE_UNAVAILABLE,
  SettingsSaveProbeService,
  probeTargetsFor,
  type ProbeCheck,
  type ProbeOutcome,
  type ProbeTarget,
  type SettingsUpdateInput,
} from "./settings-save-probe.service.js";

const SKIP_PROBE_HEADER = "x-skip-settings-probe";
const SYSTEM_SETTINGS_TARGET_ID = uuidV7FromString("system-settings");
const PROBE_FAILED_TYPE = "https://roamlog.app/errors/settings-probe-failed";

interface SettingsProbeFailureBody {
  type: string;
  title: string;
  status: 422;
  code: "SETTINGS_PROBE_FAILED";
  detail: string;
  probe: {
    target: ProbeTarget;
    code: string;
    checks: ProbeCheck[];
  };
}

/**
 * Admin settings read/write routes.
 *
 * A PATCH that touches storage/mail connectivity first proves the merged
 * configuration (stored values + this request + env fallback) against the live
 * transport. A failed probe returns 422 and the write path is never entered, so
 * an unproven configuration can neither be stored nor leave the previous one
 * half-replaced.
 *
 * The failure body is written directly with `@Res({ passthrough: true })`
 * because the global ProblemDetails filter only forwards its fixed fields and
 * would drop the operator-facing `probe` detail.
 */
@Controller("admin/settings")
@UseGuards(SessionGuard, PlatformTwoFactorGuard, AdminGuard)
export class AdminSettingsController {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SettingsSaveProbeService) private readonly probe: SettingsSaveProbeService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  @RequireAdminAction("admin:settings:read")
  list() {
    return this.settings.listAdminSettings();
  }

  @Get(":key")
  @RequireAdminAction("admin:settings:read")
  get(@Param("key") key: string) {
    return this.settings.getAdminSetting(key);
  }

  @Patch()
  @RequireAdminAction("admin:settings:write")
  async update(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Headers(SKIP_PROBE_HEADER) skipProbeHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UpdateAdminSettingsResponse | SettingsProbeFailureBody> {
    const updates = settingsUpdates(body);

    // Escape hatch: an operator may deliberately persist a configuration that
    // cannot be probed (migration windows). It is super_admin-only, explicitly
    // requested, and audited. The guard already restricts `admin:settings:write`
    // to super_admin; the check below keeps the bypass safe if that matrix ever
    // widens.
    if (skipProbeRequested(skipProbeHeader)) {
      if (actor.user.platformRole !== "super_admin") {
        throw new ForbiddenException({
          code: "SETTINGS_PROBE_SKIP_FORBIDDEN",
          message: "Only a super administrator may skip the settings probe.",
        });
      }
      await this.recordProbeSkipped(actor, updates);
      return this.settings.update(actor, body);
    }

    const outcome = await this.probeOrReject(updates);
    if (outcome.required && !outcome.ok) {
      return this.rejected(response, outcome);
    }

    return this.settings.update(actor, body);
  }

  @Post(":key/reveal")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:settings:read")
  reveal(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("key") key: string,
    @Body() body: unknown,
  ) {
    return this.settings.reveal(actor, key, body);
  }

  /**
   * The probe service already maps its own failures; this last line of defense
   * still refuses the save if it throws instead of letting an unverified
   * configuration through (fail-closed is the whole point).
   */
  private async probeOrReject(
    updates: readonly SettingsUpdateInput[],
  ): Promise<ProbeOutcome> {
    try {
      return await this.probe.probeForUpdate(updates);
    } catch {
      return {
        required: true,
        ok: false,
        target: fallbackTarget(updates),
        code: PROBE_UNAVAILABLE,
        message:
          "The configuration could not be verified because the probe did not complete. The settings were not saved.",
        checks: [],
      };
    }
  }

  private rejected(
    response: Response,
    outcome: Extract<ProbeOutcome, { required: true; ok: false }>,
  ): SettingsProbeFailureBody {
    response.status(HttpStatus.UNPROCESSABLE_ENTITY).type("application/problem+json");
    return {
      type: PROBE_FAILED_TYPE,
      title: "Configuration rejected",
      status: 422,
      code: "SETTINGS_PROBE_FAILED",
      detail: outcome.message,
      probe: {
        target: outcome.target,
        code: outcome.code,
        checks: outcome.checks,
      },
    };
  }

  private async recordProbeSkipped(
    actor: AuthenticatedActor,
    updates: readonly SettingsUpdateInput[],
  ): Promise<void> {
    const keys = updates
      .map((update) => (typeof update?.key === "string" ? update.key : undefined))
      .filter((key): key is string => key !== undefined)
      .slice(0, 50);

    try {
      await this.audit.record({
        actorId: actor.user.id,
        actorType: "admin",
        action: "admin.settings.probe_skipped",
        targetType: "system_setting",
        targetId: SYSTEM_SETTINGS_TARGET_ID,
        ip: actor.ip ?? undefined,
        userAgent: actor.userAgent ?? undefined,
        // The audit proves which keys escaped the probe; values never do.
        metadata: { keys },
      });
    } catch {
      // An unaudited bypass is not a bypass: refuse it.
      throw new ServiceUnavailableException({
        code: "SETTINGS_AUDIT_UNAVAILABLE",
        message: "The probe bypass could not be audited, so it was refused.",
      });
    }
  }
}

function skipProbeRequested(header: string | undefined): boolean {
  return typeof header === "string" && header.trim().toLowerCase() === "true";
}

function settingsUpdates(body: unknown): SettingsUpdateInput[] {
  if (typeof body !== "object" || body === null) {
    return [];
  }
  const updates = (body as { updates?: unknown }).updates;
  return Array.isArray(updates) ? (updates as SettingsUpdateInput[]) : [];
}

function fallbackTarget(updates: readonly SettingsUpdateInput[]): ProbeTarget {
  const keys = updates
    .map((update) => (typeof update?.key === "string" ? update.key : undefined))
    .filter((key): key is string => key !== undefined);
  return probeTargetsFor(keys)[0] ?? "storage";
}