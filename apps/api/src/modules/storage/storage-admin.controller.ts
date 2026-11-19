import { randomUUID } from "node:crypto";

import { Controller, HttpCode, HttpStatus, Inject, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { AuditService } from "../audit/audit.service.js";
import { AdminGuard } from "../admin/admin.guard.js";
import { RequireAdminAction } from "../admin/admin.decorator.js";
import { PlatformTwoFactorGuard } from "../admin/platform-two-factor.guard.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import type { StorageProbeResult } from "./storage-probe.service.js";
import { StorageProbeService } from "./storage-probe.service.js";

/**
 * "Test connection" for the effective storage bucket.
 *
 * The success shape (`200 { ok, checks, bucket, endpoint, publicEndpoint }`) and
 * the failure shape (`422 { ok:false, checks, failedAt, code, message }`) are the
 * operator-facing contract from the storage design, so this handler writes its
 * own status instead of going through the ProblemDetails exception filter.
 */
@Controller("admin/settings/storage")
@UseGuards(SessionGuard, PlatformTwoFactorGuard, AdminGuard)
export class StorageAdminController {
  constructor(
    @Inject(StorageProbeService) private readonly probe: StorageProbeService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  @Post("test")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:settings:write")
  async test(
    @CurrentActor() actor: AuthenticatedActor,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StorageProbeResult> {
    const result = await this.probe.run();

    await this.recordAudit(actor, result);

    if (!result.ok) {
      response.status(HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return result;
  }

  private async recordAudit(actor: AuthenticatedActor, result: StorageProbeResult): Promise<void> {
    try {
      await this.audit.record({
        actorId: actor.user.id,
        actorType: "admin",
        action: "admin.storage.probe",
        targetType: "storage",
        // The audit table stores UUID targets; metadata carries the bucket and
        // endpoint that identify what was probed.
        targetId: randomUUID(),
        ...(actor.ip ? { ip: actor.ip } : {}),
        ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
        // Operator-facing audit only: bucket and endpoint identify the target,
        // credentials and presigned URLs never reach the audit table.
        metadata: { ok: result.ok, bucket: result.bucket, endpoint: result.endpoint },
      });
    } catch {
      this.logger.warn(
        { action: "admin.storage.probe", ok: result.ok },
        "storage.probe_audit_failed",
      );
    }
  }
}