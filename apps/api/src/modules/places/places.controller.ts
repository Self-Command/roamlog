import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { VerifiedEmailGuard } from "../../common/guards/verified-email.guard.js";
import { PlaceSearchRateLimitGuard } from "./places-rate-limit.guard.js";
import { PlacesService } from "./places.service.js";

/**
 * `GET /v1/places/search`
 *
 * Authenticated (same guard stack as `/v1/me` and `/v1/notifications`), but not
 * workspace-scoped: place search is needed before the first trip exists.
 */
@Controller("places")
@UseGuards(SessionGuard, VerifiedEmailGuard, PlaceSearchRateLimitGuard)
export class PlacesController {
  constructor(@Inject(PlacesService) private readonly places: PlacesService) {}

  @Get("search")
  search(@Query() query: unknown) {
    return this.places.search(query);
  }
}
