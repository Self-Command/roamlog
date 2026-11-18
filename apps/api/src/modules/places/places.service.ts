import { Inject, Injectable } from "@nestjs/common";
import {
  PlaceSearchQuerySchema,
  PlaceSearchResponseSchema,
  type PlaceSearchResponse,
} from "@roamlog/contracts";

import { parseRequest } from "../../common/services/request-validation.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { PhotonClient } from "./photon.client.js";
import { PlacesCacheService } from "./places-cache.service.js";
import { PLACES_SETTINGS, type PlacesSettings } from "./places.settings.js";

/**
 * Orchestrates `GET /v1/places/search`:
 *
 * 1. validate the query with the shared contract (`422/400` style is inherited
 *    from `parseRequest` → `BadRequestException` with `VALIDATION_ERROR`);
 * 2. answer from Redis when possible;
 * 3. otherwise call Photon with a hard timeout;
 * 4. normalize and validate the response against `PlaceSearchResponseSchema`;
 * 5. cache normal results for 15 minutes and empty/degraded results for 30
 *    seconds;
 * 6. degrade to `200 { degraded: true, items: [] }` when the upstream fails.
 *
 * Logs deliberately contain `queryLength` (never the query text), timings,
 * counts and a `cache: "hit" | "miss"` marker.
 */
@Injectable()
export class PlacesService {
  constructor(
    @Inject(PlacesCacheService) private readonly cache: PlacesCacheService,
    @Inject(PhotonClient) private readonly photon: PhotonClient,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Inject(PLACES_SETTINGS) private readonly settings: PlacesSettings,
  ) {}

  async search(rawQuery: unknown): Promise<PlaceSearchResponse> {
    const query = parseRequest(PlaceSearchQuerySchema, rawQuery);
    const startedAt = Date.now();
    const cacheKey = this.cache.key(query);

    const cached = await this.cache.read(cacheKey);
    if (cached) {
      this.logger.log(
        {
          event: "places.search",
          cache: "hit",
          queryLength: query.q.length,
          limit: query.limit,
          lang: query.lang ?? null,
          resultCount: cached.items.length,
          degraded: cached.degraded,
          durationMs: Date.now() - startedAt,
        },
        "places.search_cache_hit",
      );
      return PlaceSearchResponseSchema.parse({ ...cached, cached: true });
    }

    const outcome = await this.photon.search({
      q: query.q,
      limit: query.limit,
      ...(query.lang ? { lang: query.lang } : {}),
    });

    const items = outcome.ok ? outcome.items.slice(0, query.limit) : [];
    const response = PlaceSearchResponseSchema.parse({
      items,
      provider: "photon",
      degraded: !outcome.ok,
      cached: false,
    });

    if (outcome.ok) {
      this.logger.log(
        {
          event: "places.search",
          cache: "miss",
          queryLength: query.q.length,
          limit: query.limit,
          lang: query.lang ?? null,
          resultCount: items.length,
          degraded: false,
          durationMs: Date.now() - startedAt,
        },
        "places.search_completed",
      );
    } else {
      this.logger.warn(
        {
          event: "places.upstream_failed",
          reason: outcome.reason,
          ...(outcome.httpStatus === undefined ? {} : { httpStatus: outcome.httpStatus }),
          durationMs: outcome.durationMs,
          queryLength: query.q.length,
          limit: query.limit,
          lang: query.lang ?? null,
        },
        "places.search_degraded",
      );
    }

    const ttlSeconds =
      response.degraded || response.items.length === 0
        ? this.settings.emptyCacheTtlSeconds
        : this.settings.cacheTtlSeconds;
    await this.cache.write(cacheKey, response, ttlSeconds);

    return response;
  }
}
