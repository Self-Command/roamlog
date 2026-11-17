import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { ActivitiesModule } from "../activities/activities.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { JobQueueModule } from "../exports/job-queue.module.js";
import { TripsModule } from "../trips/trips.module.js";
import { MediaController } from "./media.controller.js";
import { MediaRepository } from "./media.repository.js";
import { MediaService } from "./media.service.js";
import { MediaTenantGuard } from "./media-tenant.guard.js";

@Module({
  imports: [AccessControlModule, ActivitiesModule, IdempotencyModule, JobQueueModule, TripsModule],
  controllers: [MediaController],
  providers: [MediaRepository, MediaService, MediaTenantGuard],
  exports: [MediaService, MediaTenantGuard],
})
export class MediaModule {}
