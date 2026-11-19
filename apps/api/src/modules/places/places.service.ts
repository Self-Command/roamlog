import { Inject, Injectable } from "@nestjs/common";
import {
  PlaceSearchQuerySchema,
  PlaceSearchResponseSchema,
  type Place,
  type PlaceSearchResponse,
} from "@roamlog/contracts";

import { parseRequest } from "../../common/services/request-validation.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { GeoapifyClient } from "./geoapify.client.js";
import { PhotonClient } from "./photon.client.js";
import { PlacesCacheService } from "./places-cache.service.js";
import { PlacesQuotaService } from "./places-quota.service.js";
import {
  PLACES_SETTINGS,
  type PlacesProvider,
  type PlacesSettings,
  type PlacesSettingsSource,
} from "./places.settings.js";

interface UpstreamFailure {
  readonly reason: string;
  readonly httpStatus?: number;
}

/**
 * Applies `places.limit` / `places.lang` only when the caller omitted them.
 * An explicit query value always wins; the contract then validates the range.
 */
function withSettingsDefaults(rawQuery: unknown, settings: PlacesSettings): unknown {
  if (rawQuery === null || typeof rawQuery !== "object" || Array.isArray(rawQuery)) {
    return rawQuery;
  }
  const query = { ...(rawQuery as Record<string, unknown>) };
  if (query.limit === undefined || query.limit === "") {
    query.limit = settings.defaultLimit;
  }
  if (query.lang === undefined || query.lang === "") {
    query.lang = settings.defaultLang;
  }
  return query;
}

/**
 * `GET /v1/places/search` use case.
 *
 * - Primary source is `settings.provider` (`geoapify` by default; `photon`
 *   keeps the legacy path as a one-switch rollback).
 * - Geoapify is never called once the Redis daily cap is exhausted; the request
 *   degrades instead of spending quota.
 * - When the primary fails/timeouts/over-quota and `fallbackToPhoton` is on,
 *   Photon serves the items and the response stays `degraded: true`.
 * - When both sources fail the response is `200 { items: [], degraded: true }`;
 *   search never turns an upstream outage into a 5xx.
 * - `provider` names the source that produced the returned items (or the
 *   configured primary when no items exist), matching `items[].provider`.
 */
@Injectable()
export class PlacesService {
  constructor(
    @Inject(PlacesCacheService) private readonly cache: PlacesCacheService,
    @Inject(GeoapifyClient) private readonly geoapify: GeoapifyClient,
    @Inject(PhotonClient) private readonly photon: PhotonClient,
    @Inject(PlacesQuotaService) private readonly quota: PlacesQuotaService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Inject(PLACES_SETTINGS) private readonly settings: PlacesSettingsSource,
  ) {}

  async search(rawQuery: unknown): Promise<PlaceSearchResponse> {
    const settings = await this.settings.resolve();
    const query = parseRequest(PlaceSearchQuerySchema, withSettingsDefaults(rawQuery, settings));
    const startedAt = Date.now();
    const primary = settings.provider;
    const cacheKey = this.cache.key({
      q: query.q,
      limit: query.limit,
      ...(query.lang ? { lang: query.lang } : {}),
      provider: primary,
    });

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

    const request = {
      q: query.q,
      limit: query.limit,
      ...(query.lang ? { lang: query.lang } : {}),
    };

    let items: Place[] = [];
    let servedBy: PlacesProvider = primary;
    let degraded = false;
    let fallbackUsed = false;
    let primaryFailure: UpstreamFailure | undefined;
    let fallbackFailure: UpstreamFailure | undefined;
    let upstreamDurationMs = 0;

    if (primary === "geoapify") {
      const quota = await this.quota.consume();
      if (!quota.allowed) {
        primaryFailure = { reason: "quota_exceeded" };
        degraded = true;
      } else {
        const outcome = await this.geoapify.search(request);
        upstreamDurationMs += outcome.durationMs;
        if (outcome.ok) {
          items = outcome.items;
          servedBy = "geoapify";
        } else {
          primaryFailure = {
            reason: outcome.reason,
            ...(outcome.httpStatus === undefined ? {} : { httpStatus: outcome.httpStatus }),
          };
          degraded = true;
        }
      }
    } else {
      const outcome = await this.photon.search(request);
      upstreamDurationMs += outcome.durationMs;
      if (outcome.ok) {
        items = outcome.items;
        servedBy = "photon";
      } else {
        primaryFailure = {
          reason: outcome.reason,
          ...(outcome.httpStatus === undefined ? {} : { httpStatus: outcome.httpStatus }),
        };
        degraded = true;
      }
    }

    if (degraded && primary === "geoapify" && settings.fallbackToPhoton) {
      const fallback = await this.photon.search(request);
      upstreamDurationMs += fallback.durationMs;
      if (fallback.ok) {
        items = fallback.items;
        servedBy = "photon";
        fallbackUsed = true;
      } else {
        fallbackFailure = {
          reason: fallback.reason,
          ...(fallback.httpStatus === undefined ? {} : { httpStatus: fallback.httpStatus }),
        };
      }
    }

    const capped = items.slice(0, query.limit);
    const response = PlaceSearchResponseSchema.parse({
      items: capped,
      provider: degraded && capped.length === 0 ? primary : servedBy,
      degraded,
      cached: false,
    });

    if (!degraded) {
      this.logger.log(
        {
          event: "places.search",
          cache: "miss",
          queryLength: query.q.length,
          limit: query.limit,
          lang: query.lang ?? null,
          provider: servedBy,
          resultCount: capped.length,
          degraded: false,
          durationMs: Date.now() - startedAt,
        },
        "places.search_completed",
      );
    } else {
      this.logger.warn(
        {
          event: "places.upstream_failed",
          provider: primary,
          reason: primaryFailure?.reason ?? "unknown",
          ...(primaryFailure?.httpStatus === undefined
            ? {}
            : { httpStatus: primaryFailure.httpStatus }),
          fallback: fallbackUsed ? "photon" : null,
          ...(fallbackFailure === undefined
            ? {}
            : {
                fallbackReason: fallbackFailure.reason,
                ...(fallbackFailure.httpStatus === undefined
                  ? {}
                  : { fallbackHttpStatus: fallbackFailure.httpStatus }),
              }),
          durationMs: upstreamDurationMs,
          queryLength: query.q.length,
          limit: query.limit,
          lang: query.lang ?? null,
        },
        "places.search_degraded",
      );
    }

    const ttlSeconds =
      response.degraded || response.items.length === 0
        ? settings.emptyCacheTtlSeconds
        : settings.cacheTtlSeconds;
    await this.cache.write(cacheKey, response, ttlSeconds);

    return response;
  }
}