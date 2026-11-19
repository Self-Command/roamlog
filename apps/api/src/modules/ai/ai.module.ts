import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { ItineraryModule } from "../itinerary/itinerary.module.js";
import { PackingModule } from "../packing/packing.module.js";
import { GeoapifyClient } from "../places/geoapify.client.js";
import { PhotonClient } from "../places/photon.client.js";
import { PlacesCacheService } from "../places/places-cache.service.js";
import { PlacesQuotaService } from "../places/places-quota.service.js";
import { PlacesService } from "../places/places.service.js";
import { PLACES_SETTINGS, resolvePlacesSettings } from "../places/places.settings.js";
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
  ],
  controllers: [AiController],
  providers: [
    { provide: AI_SETTINGS, useFactory: () => resolveAiSettings() },
    {
      provide: AI_ADAPTER,
      useFactory: (settings: ReturnType<typeof resolveAiSettings>) => createAiAdapter(settings),
      inject: [AI_SETTINGS],
    },
    // `places.search` reuses the real PlacesService. PlacesModule does not export
    // it (that file is owned elsewhere this wave), so the provider graph is
    // registered here as well: the instances are stateless and share the same
    // Redis cache/quota keys, so behaviour is identical. Follow-up: import
    // PlacesModule once it exports PlacesService.
    { provide: PLACES_SETTINGS, useFactory: () => resolvePlacesSettings() },
    GeoapifyClient,
    PhotonClient,
    PlacesCacheService,
    PlacesQuotaService,
    PlacesService,
    AiToolbox,
    AiQuotaService,
    AiRunStore,
    AiPlanService,
    AiExecuteService,
  ],
})
export class AiModule {}