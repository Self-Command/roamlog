import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { uuidV7FromString } from "../admin/admin-ids.js";
import { AdminGuard } from "../admin/admin.guard.js";
import { RequireAdminAction } from "../admin/admin.decorator.js";
import { PlatformTwoFactorGuard } from "../admin/platform-two-factor.guard.js";
import { AuditService } from "../audit/audit.service.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { MailDeliveryError, type MailFailureCode, MailService } from "./mail.service.js";
import { MailTestRateLimitGuard } from "./mail-test-rate-limit.guard.js";

const MailTestRequestSchema = z
  .object({
    to: z.email().max(254),
  })
  .strict();

interface MailTestSuccess {
  ok: true;
  provider: "smtp" | "resend";
  latencyMs: number;
}

interface MailTestFailure {
  ok: false;
  code: MailFailureCode | "INVALID_REQUEST";
  message: string;
}

// AuditLog.targetId is a UUID column; match the settings audit target.
const PROBE_TARGET_ID = uuidV7FromString("system-settings");

/**
 * Real (not dry-run) test send for the mail settings group.
 *
 * The operator gets a 200 only after the configured transport accepted the
 * message; every failure is a 422 with an actionable code.
 */
@Controller("admin/settings/mail")
@UseGuards(SessionGuard, PlatformTwoFactorGuard, AdminGuard, MailTestRateLimitGuard)
export class MailTestController {
  constructor(
    @Inject(MailService) private readonly mail: MailService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  @Post("test")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:settings:write")
  async test(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MailTestSuccess | MailTestFailure> {
    const parsed = MailTestRequestSchema.safeParse(body);
    if (!parsed.success) {
      return this.fail(response, "INVALID_REQUEST", "A valid recipient address is required.");
    }
    const input = parsed.data;

    const runtime = await this.mail.resolveRuntime();
    const provider = runtime.provider;

    try {
      const result = await this.mail.send({
        to: input.to,
        subject: "Roamlog mail settings test",
        text: "This is a test message from Roamlog Admin settings. If you received it, outbound mail works.",
        html: [
          '<div style="background:#000;color:#fcfdff;font-family:Georgia,serif;padding:32px">',
          '<h1 style="font-size:24px;font-weight:500;margin:0 0 20px">Mail settings test</h1>',
          '<p style="color:#acb1ba;line-height:1.6">This message was sent by the Roamlog Admin settings probe over ',
          `${provider === "smtp" ? "SMTP" : "Resend"}.`,
          "</p>",
          '<p style="color:#8a8f98;font-size:12px;margin-top:24px">Roamlog · transactional mail</p>',
          "</div>",
        ].join(""),
        idempotencyKey: `mail-test-${actor.user.id}-${Date.now()}`,
      });

      await this.recordAudit(actor, { ok: true, provider: result.provider });
      return { ok: true, provider: result.provider, latencyMs: result.latencyMs };
    } catch (error) {
      const failure =
        error instanceof MailDeliveryError
          ? { code: error.code, message: error.message }
          : { code: "UNKNOWN" as const, message: "Mail delivery failed." };
      await this.recordAudit(actor, { ok: false, provider });
      this.logger.warn(
        { event: "mail.test_failed", provider, code: failure.code },
        "mail.test_failed",
      );
      return this.fail(response, failure.code, failure.message);
    }
  }

  private fail(
    response: Response,
    code: MailTestFailure["code"],
    message: string,
  ): MailTestFailure {
    response.status(HttpStatus.UNPROCESSABLE_ENTITY);
    return { ok: false, code, message };
  }

  private async recordAudit(
    actor: AuthenticatedActor,
    metadata: { ok: boolean; provider: "smtp" | "resend" },
  ): Promise<void> {
    try {
      await this.audit.record({
        actorId: actor.user.id,
        actorType: "admin",
        action: "admin.mail.probe",
        targetType: "system_setting",
        targetId: PROBE_TARGET_ID,
        ip: actor.ip ?? undefined,
        userAgent: actor.userAgent ?? undefined,
        // Never the recipient or any credential.
        metadata: { ok: metadata.ok, provider: metadata.provider },
      });
    } catch (error) {
      this.logger.warn(
        {
          event: "mail.probe_audit_failed",
          reason: error instanceof Error ? error.name : "UnknownError",
        },
        "mail.probe_audit_failed",
      );
    }
  }
}