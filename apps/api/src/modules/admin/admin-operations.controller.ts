import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AdminJobQuerySchema, IdempotencyKeySchema } from "@roamlog/contracts";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { FeatureFlagsService } from "../feature-flags/feature-flags.service.js";
import { IdempotencyService } from "../idempotency/idempotency.service.js";
import { AdminGuard } from "./admin.guard.js";
import { RequireAdminAction } from "./admin.decorator.js";
import { AdminAuditService } from "./admin-audit.service.js";
import { AdminEmailsService } from "./admin-emails.service.js";
import { AdminJobsService } from "./admin-jobs.service.js";
import { PlatformTwoFactorGuard } from "./platform-two-factor.guard.js";

@Controller("admin")
@UseGuards(SessionGuard, PlatformTwoFactorGuard, AdminGuard)
export class AdminOperationsController {
  constructor(
    @Inject(AdminAuditService) private readonly audit: AdminAuditService,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService,
    @Inject(AdminEmailsService) private readonly emails: AdminEmailsService,
    @Inject(AdminJobsService) private readonly jobs: AdminJobsService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  @Get("audit")
  @RequireAdminAction("admin:audit:read")
  listAudit(@CurrentActor() actor: AuthenticatedActor, @Query() query: Record<string, unknown>) {
    return this.audit.list(actor, query);
  }

  @Get("audit/export")
  @RequireAdminAction("admin:audit:export")
  async exportAudit(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ): Promise<void> {
    const csv = await this.audit.exportCsv(actor, query);
    const generatedAt = new Date().toISOString();
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="roamlog-admin-audit-${generatedAt.slice(0, 19).replaceAll(":", "-")}.csv"`,
    );
    response.send(csv);
  }

  @Get("flags")
  @RequireAdminAction("admin:flags:read")
  listFlags(@CurrentActor() _actor: AuthenticatedActor) {
    return this.flags.list();
  }

  @Patch("flags/:key")
  @RequireAdminAction("admin:flags:update")
  updateFlag(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("key") key: string,
    @Body() body: unknown,
  ) {
    return this.flags.update(actor, key, body);
  }

  @Get("emails")
  @RequireAdminAction("admin:emails:read")
  listEmails(@CurrentActor() actor: AuthenticatedActor, @Query() query: Record<string, unknown>) {
    return this.emails.list(actor, query);
  }

  @Post("emails/:id/resend")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:emails:resend")
  resendEmail(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey) {
      return this.emails.resend(actor, id);
    }
    const key = parseRequest(IdempotencyKeySchema, idempotencyKey);
    return this.idempotency.run(`admin:email:resend:${actor.user.id}:${id}`, key, () =>
      this.emails.resend(actor, id),
    );
  }

  @Get("jobs")
  @RequireAdminAction("admin:jobs:read")
  listJobs(@CurrentActor() actor: AuthenticatedActor, @Query() query: Record<string, unknown>) {
    return this.jobs.list(actor, parseRequest(AdminJobQuerySchema, query));
  }

  @Post("jobs/:queue/:jobId/retry")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:jobs:retry")
  retryJob(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("queue") queue: string,
    @Param("jobId") jobId: string,
  ) {
    return this.jobs.retry(actor, queue, jobId);
  }

  @Post("jobs/:queue/pause")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:jobs:manage")
  pauseQueue(@CurrentActor() actor: AuthenticatedActor, @Param("queue") queue: string) {
    return this.jobs.pause(actor, queue);
  }

  @Post("jobs/:queue/resume")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:jobs:manage")
  resumeQueue(@CurrentActor() actor: AuthenticatedActor, @Param("queue") queue: string) {
    return this.jobs.resume(actor, queue);
  }

  @Post("jobs/:queue/clear")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:jobs:manage")
  clearQueue(@CurrentActor() actor: AuthenticatedActor, @Param("queue") queue: string) {
    return this.jobs.clear(actor, queue);
  }
}
