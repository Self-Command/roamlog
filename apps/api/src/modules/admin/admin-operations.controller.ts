import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AdminJobQuerySchema } from "@roamlog/contracts";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { FeatureFlagsService } from "../feature-flags/feature-flags.service.js";
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
  ) {}

  @Get("audit")
  @RequireAdminAction("admin:audit:read")
  listAudit(@CurrentActor() actor: AuthenticatedActor, @Query() query: Record<string, unknown>) {
    return this.audit.list(actor, query);
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
  resendEmail(@CurrentActor() actor: AuthenticatedActor, @Param("id") id: string) {
    return this.emails.resend(actor, id);
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
}
