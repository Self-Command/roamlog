import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { SecurityModule } from "../../common/security/security.module.js";
import { ActivitiesModule } from "../activities/activities.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { JobQueueModule } from "../exports/job-queue.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import {
  LIMITS_SETTINGS,
  LimitsSettingsResolver,
} from "../settings/limits-settings.consumer.js";
import { TripsModule } from "../trips/trips.module.js";
import { MediaController } from "./media.controller.js";
import { MediaRepository } from "./media.repository.js";
import { MediaService } from "./media.service.js";
import { MediaTenantGuard } from "./media-tenant.guard.js";
import { MediaUploadLimitsService } from "./media-upload-limits.service.js";
import { MediaUploadRateLimitGuard } from "./media-upload-rate-limit.guard.js";
// `MediaUrlModule` owns signed URLs and cover projection. Re-exporting it keeps
// `MediaUrlService` available to modules that import `MediaModule`
// (`share-links`), while `TripsModule` can import the small module directly
// instead of importing all of `MediaModule`.
import { MediaUrlModule } from "./media-url.module.js";

@Module({
  imports: [
    AccessControlModule,
    SecurityModule,
    ActivitiesModule,
    IdempotencyModule,
    JobQueueModule,
    SettingsModule,
    TripsModule,
    MediaUrlModule,
  ],
  controllers: [MediaController],
  providers: [
    MediaRepository,
    MediaService,
    MediaTenantGuard,
    // `limits.*` is resolved per request, so an admin save applies to the next
    // presign/limits call instead of the next deploy.
    LimitsSettingsResolver,
    { provide: LIMITS_SETTINGS, useExisting: LimitsSettingsResolver },
    MediaUploadLimitsService,
    MediaUploadRateLimitGuard,
  ],
  exports: [MediaService, MediaTenantGuard, MediaUrlModule],
})
export class MediaModule {}