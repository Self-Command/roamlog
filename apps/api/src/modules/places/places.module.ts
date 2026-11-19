import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { GeoapifyClient } from "./geoapify.client.js";
import { PhotonClient } from "./photon.client.js";
import { PlacesCacheService } from "./places-cache.service.js";
import { PlaceSearchRateLimitGuard } from "./places-rate-limit.guard.js";
import { PlacesQuotaService } from "./places-quota.service.js";
import { PlacesRateLimiter } from "./places-rate-limiter.service.js";
import { PlacesController } from "./places.controller.js";
import { PlacesService } from "./places.service.js";
import { PLACES_SETTINGS, resolvePlacesSettings } from "./places.settings.js";

@Module({
  imports: [AccessControlModule],
  controllers: [PlacesController],
  providers: [
    { provide: PLACES_SETTINGS, useFactory: () => resolvePlacesSettings() },
    GeoapifyClient,
    PhotonClient,
    PlacesCacheService,
    PlacesQuotaService,
    PlacesRateLimiter,
    PlacesService,
    PlaceSearchRateLimitGuard,
  ],
})
export class PlacesModule {}
