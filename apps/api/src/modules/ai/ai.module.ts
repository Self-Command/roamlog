import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { ItineraryModule } from "../itinerary/itinerary.module.js";
import { PackingModule } from "../packing/packing.module.js";
import { PlacesModule } from "../places/places.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { TripsModule } from "../trips/trips.module.js";
import { AI_ADAPTER_FACTORY, createAiAdapter } from "./adapters/index.js";
import { AiController } from "./ai.controller.js";
import { AiExecuteService } from "./ai-execute.service.js";
import { AiPlanService } from "./ai-plan.service.js";
import { AiQuotaService } from "./ai-quota.service.js";
import { AiRewriteService } from "./ai-rewrite.service.js";
import { AiRunStore } from "./ai-run.store.js";
import { AI_CLOCK, AI_SETTINGS_SOURCE, AiSettingsResolver } from "./ai.settings.js";
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
    SettingsModule,
  ],
  controllers: [AiController],
  providers: [
    AiSettingsResolver,
    // A token, not a snapshot: every request resolves `ai.*` from the settings
    // service (DB > env > default) before the adapter and the quota are used.
    { provide: AI_SETTINGS_SOURCE, useExisting: AiSettingsResolver },
    { provide: AI_ADAPTER_FACTORY, useValue: createAiAdapter },
    { provide: AI_CLOCK, useValue: () => new Date() },
    AiToolbox,
    AiQuotaService,
    AiRunStore,
    AiPlanService,
    AiExecuteService,
    AiRewriteService,
  ],
})
export class AiModule {}