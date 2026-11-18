import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { ActivitiesModule } from "../activities/activities.module.js";
import { MediaUrlModule } from "../media/media-url.module.js";
import { ContentTenantGuard } from "./content-tenant.guard.js";
import { StopsRepository } from "./stops.repository.js";
import { StopsService } from "./stops.service.js";
import { TripsController } from "./trips.controller.js";
import { TripsRepository } from "./trips.repository.js";
import { TripsService } from "./trips.service.js";

@Module({
  // `MediaUrlModule` (not all of `MediaModule`) provides signed URLs and the
  // cover projector; importing `MediaModule` here would close a module cycle.
  imports: [AccessControlModule, ActivitiesModule, MediaUrlModule],
  controllers: [TripsController],
  providers: [
    TripsRepository,
    StopsRepository,
    TripsService,
    StopsService,
    ContentTenantGuard,
  ],
  exports: [TripsService, StopsService, ContentTenantGuard, TripsRepository],
})
export class TripsModule {}
