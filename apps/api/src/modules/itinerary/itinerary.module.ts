import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { ActivitiesModule } from "../activities/activities.module.js";
import { TripsModule } from "../trips/trips.module.js";
import { ItineraryController } from "./itinerary.controller.js";
import { ItineraryRepository } from "./itinerary.repository.js";
import { ItineraryService } from "./itinerary.service.js";

@Module({
  imports: [AccessControlModule, ActivitiesModule, TripsModule],
  controllers: [ItineraryController],
  providers: [ItineraryRepository, ItineraryService],
  exports: [ItineraryService],
})
export class ItineraryModule {}
