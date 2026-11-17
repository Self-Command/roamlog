import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { ActivitiesController } from "./activities.controller.js";
import { ActivitiesRepository } from "./activities.repository.js";
import { ActivitiesService } from "./activities.service.js";

@Module({
  imports: [AccessControlModule],
  controllers: [ActivitiesController],
  providers: [ActivitiesRepository, ActivitiesService],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
