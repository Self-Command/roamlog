import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { GeoapifyClient } from "./geoapify.client.js";
import { PhotonClient } from "./photon.client.js";
import { PlacesCacheService } from "./places-cache.service.js";
import { PlaceSearchRateLimitGuard } from "./places-rate-limit.guard.js";
import { PlacesQuotaService } from "./places-quota.service.js";
import { PlacesRateLimiter } from "./places-rate-limiter.service.js";
import { PlacesController } from "./places.controller.js";
import { PlacesService } from "./places.service.js";
import { PLACES_SETTINGS, PlacesSettingsResolver } from "./places.settings.js";

/**
 * `places.*` rows are read through `SettingsService` on each request, so the
 * module imports `SettingsModule` instead of resolving the environment once at
 * construction. The resolver never touches the database in its constructor,
 * which keeps an unavailable DB from blocking API startup.
 */
@Module({
  imports: [AccessControlModule, SettingsModule],
  controllers: [PlacesController],
  providers: [
    PlacesSettingsResolver,
    { provide: PLACES_SETTINGS, useExisting: PlacesSettingsResolver },
    GeoapifyClient,
    PhotonClient,
    PlacesCacheService,
    PlacesQuotaService,
    PlacesRateLimiter,
    PlacesService,
    PlaceSearchRateLimitGuard,
  ],
  exports: [PlacesService],
})
export class PlacesModule {}