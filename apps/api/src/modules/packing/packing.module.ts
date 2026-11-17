import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { ActivitiesModule } from "../activities/activities.module.js";
import { TripsModule } from "../trips/trips.module.js";
import { PackingController } from "./packing.controller.js";
import { PackingRepository } from "./packing.repository.js";
import { PackingService } from "./packing.service.js";
import { PackingTenantGuard } from "./packing-tenant.guard.js";

@Module({
  imports: [AccessControlModule, ActivitiesModule, TripsModule],
  controllers: [PackingController],
  providers: [PackingRepository, PackingService, PackingTenantGuard],
  exports: [PackingService],
})
export class PackingModule {}
