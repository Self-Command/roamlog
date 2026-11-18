import { Module } from "@nestjs/common";

import { MediaUrlService } from "./media-url.service.js";
import { TripCoverService } from "./trip-cover.service.js";

/**
 * Signed media URL primitives with no dependency on `TripsModule`.
 *
 * Both `TripsModule` (cover projection on trip reads) and `MediaModule` (media
 * reads and cover setting) import this module, so neither has to import the other
 * just to sign a key. `StorageService` is provided by the `@Global()` StorageModule.
 */
@Module({
  providers: [MediaUrlService, TripCoverService],
  exports: [MediaUrlService, TripCoverService],
})
export class MediaUrlModule {}
