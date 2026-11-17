import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { ActivitiesModule } from "../activities/activities.module.js";
import { TripsModule } from "../trips/trips.module.js";
import { EntriesController } from "./entries.controller.js";
import { EntriesRepository } from "./entries.repository.js";
import { EntriesService } from "./entries.service.js";

@Module({
  imports: [AccessControlModule, ActivitiesModule, TripsModule],
  controllers: [EntriesController],
  providers: [EntriesRepository, EntriesService],
  exports: [EntriesService],
})
export class EntriesModule {}
