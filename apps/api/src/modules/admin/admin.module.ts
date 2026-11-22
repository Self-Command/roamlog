import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { JobQueueModule } from "../exports/job-queue.module.js";
import { FeatureFlagsModule } from "../feature-flags/feature-flags.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { MediaUrlModule } from "../media/media-url.module.js";
import { AdminAuditService } from "./admin-audit.service.js";
import { AdminContentController } from "./admin-content.controller.js";
import { AdminContentService } from "./admin-content.service.js";
import { AdminDashboardController } from "./admin-dashboard.controller.js";
import { AdminEmailsService } from "./admin-emails.service.js";
import { AdminGuard } from "./admin.guard.js";
import { AdminJobsService } from "./admin-jobs.service.js";
import { AdminMediaService } from "./admin-media.service.js";
import { AdminMetricsService } from "./admin-metrics.service.js";
import { AdminOperationsController } from "./admin-operations.controller.js";
import { AdminPermissionsController } from "./admin-permissions.controller.js";
import { AdminPermissionsService } from "./admin-permissions.service.js";
import { AdminQueueService } from "./admin-queue.service.js";
import { AdminSystemService } from "./admin-system.service.js";
import { AdminUsersController } from "./admin-users.controller.js";
import { AdminUsersService } from "./admin-users.service.js";
import { AdminWorkspacesController } from "./admin-workspaces.controller.js";
import { AdminWorkspacesService } from "./admin-workspaces.service.js";
import { PlatformTwoFactorGuard } from "./platform-two-factor.guard.js";

@Module({
  imports: [
    AccessControlModule,
    AuditModule,
    FeatureFlagsModule,
    IdempotencyModule,
    JobQueueModule,
    MediaUrlModule,
  ],
  controllers: [
    AdminDashboardController,
    AdminUsersController,
    AdminWorkspacesController,
    AdminContentController,
    AdminOperationsController,
    AdminPermissionsController,
  ],
  providers: [
    AdminGuard,
    PlatformTwoFactorGuard,
    AdminQueueService,
    AdminMetricsService,
    AdminSystemService,
    AdminUsersService,
    AdminPermissionsService,
    AdminWorkspacesService,
    AdminContentService,
    AdminMediaService,
    AdminAuditService,
    AdminEmailsService,
    AdminJobsService,
  ],
  exports: [AdminQueueService, FeatureFlagsModule],
})
export class AdminModule {}
