import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { SecurityModule } from "../../common/security/security.module.js";
import { ActivitiesModule } from "../activities/activities.module.js";
import { MediaModule } from "../media/media.module.js";
import { TripsModule } from "../trips/trips.module.js";
import { ShareLinkTenantGuard } from "./share-link-tenant.guard.js";
import { PublicShareController, ShareLinksController } from "./share-links.controller.js";
import { ShareLinksRepository } from "./share-links.repository.js";
import { ShareLinksService } from "./share-links.service.js";

@Module({
  imports: [AccessControlModule, SecurityModule, ActivitiesModule, TripsModule, MediaModule],
  controllers: [ShareLinksController, PublicShareController],
  providers: [ShareLinksRepository, ShareLinksService, ShareLinkTenantGuard],
})
export class ShareLinksModule {}
