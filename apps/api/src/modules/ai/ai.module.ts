import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { ItineraryModule } from "../itinerary/itinerary.module.js";
import { PackingModule } from "../packing/packing.module.js";
import { PlacesModule } from "../places/places.module.js";
import { TripsModule } from "../trips/trips.module.js";
import { AI_ADAPTER, createAiAdapter } from "./adapters/index.js";
import { AiController } from "./ai.controller.js";
import { AiExecuteService } from "./ai-execute.service.js";
import { AiPlanService } from "./ai-plan.service.js";
import { AiQuotaService } from "./ai-quota.service.js";
import { AiRunStore } from "./ai-run.store.js";
import { AI_SETTINGS, resolveAiSettings } from "./ai.settings.js";
import { AiToolbox } from "./ai-tools.js";

@Module({
  imports: [
    AccessControlModule,
    AuditModule,
    IdempotencyModule,
    TripsModule,
    ItineraryModule,
    PackingModule,
    PlacesModule,
  ],
  controllers: [AiController],
  providers: [
    { provide: AI_SETTINGS, useFactory: () => resolveAiSettings() },
    {
      provide: AI_ADAPTER,
      useFactory: (settings: ReturnType<typeof resolveAiSettings>) => createAiAdapter(settings),
      inject: [AI_SETTINGS],
    },
    AiToolbox,
    AiQuotaService,
    AiRunStore,
    AiPlanService,
    AiExecuteService,
  ],
})
export class AiModule {}