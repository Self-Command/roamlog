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
  type PlacesResponseProvider,
  type PlacesSettings,
  type PlacesSettingsSource,
} from "./places.settings.js";
import { TencentClient } from "./tencent.client.js";

interface UpstreamFailure {
  readonly reason: string;
  readonly httpStatus?: number;
  /** Uppercase failure code, set by the Tencent client. */
  readonly code?: string;
  /** Tencent's JSON `status`, when the upstream answered with an error. */
  readonly upstreamStatus?: number;
}

/** Han script. `\p{Script=Han}` also covers the CJK ideographs outside the BMP. */
const HAN_SCRIPT = /\p{Script=Han}/u;

/**
 * Decides whether a query belongs to the mainland-China route.
 *
 * Three documented signals, any of which is enough:
 * - `country=CN` — the caller told us the place is in China;
 * - `lang=zh` — the UI is Chinese, so the door-plate-level Chinese source is the
 *   right one (`places.lang` defaults to `zh`);
 * - the keyword contains Han characters — the user is typing a Chinese address.
 *
 * A Chinese query must never be answered by a global gazetteer: Photon returns
 * wrong house numbers on the same street (`北京市朝阳区建国路87号` → `建国路75号`),
 * which is worse than returning nothing.
 */
export function isChinaQuery(query: {
  readonly q: string;
  readonly lang?: string | undefined;
  readonly country?: string | undefined;
}): boolean {
  return query.country === "CN" || query.lang === "zh" || HAN_SCRIPT.test(query.q);
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
 * Two routes, chosen by `isChinaQuery`:
 *
 * - **China** → `TencentClient` (`place/v1/suggestion`). This is the only route
 *   that can answer a Chinese street address at door-plate level. Photon is
 *   never consulted here; when Tencent is unconfigured, over quota or failing the
 *   response is `200 { items: [], degraded: true, fallback: "map_pick" }` so the
 *   client offers "pick on the map" instead of a wrong house number.
 * - **Global** → `settings.provider` (`geoapify` by default, `photon` as the
 *   rollback switch) with the existing Photon fallback when `fallbackToPhoton`.
 *   Geoapify is never called once its Redis daily cap is exhausted.
 *
 * Shared behaviour:
 * - When no source produces items the response is `200 { items: [], degraded:
 *   true }`; search never turns an upstream outage into a 5xx.
 * - `provider` names the source that produced the returned items (or the
 *   configured primary when no items exist), matching `items[].provider`.
 * - The cache key carries the route's provider, so a Tencent answer is never
 *   replayed for a global query (or the other way round).
 */
@Injectable()
export class PlacesService {
  constructor(
    @Inject(PlacesCacheService) private readonly cache: PlacesCacheService,
    @Inject(GeoapifyClient) private readonly geoapify: GeoapifyClient,
    @Inject(PhotonClient) private readonly photon: PhotonClient,
    @Inject(TencentClient) private readonly tencent: TencentClient,
    @Inject(PlacesQuotaService) private readonly quota: PlacesQuotaService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Inject(PLACES_SETTINGS) private readonly settings: PlacesSettingsSource,
  ) {}

  async search(rawQuery: unknown): Promise<PlaceSearchResponse> {
    const settings = await this.settings.resolve();
    const query = parseRequest(PlaceSearchQuerySchema, withSettingsDefaults(rawQuery, settings));
    const startedAt = Date.now();
    const china = isChinaQuery(query);
    const primary: PlacesResponseProvider = china ? "tencent" : settings.provider;
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
          route: china ? "china" : "global",
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
    let servedBy: PlacesResponseProvider = primary;
    let degraded = false;
    let fallbackUsed = false;
    let fallback: "map_pick" | undefined;
    let primaryFailure: UpstreamFailure | undefined;
    let fallbackFailure: UpstreamFailure | undefined;
    let upstreamDurationMs = 0;

    if (china) {
      // Mainland-China route. Photon is deliberately not reachable from here.
      if (settings.tencentApiKey === null) {
        primaryFailure = { reason: "not_configured", code: "NOT_CONFIGURED" };
        degraded = true;
        fallback = "map_pick";
      } else {
        const quota = await this.quota.consumeTencent();
        if (!quota.allowed) {
          primaryFailure = { reason: "quota_exceeded", code: "QUOTA_EXCEEDED" };
          degraded = true;
          fallback = "map_pick";
        } else {
          const outcome = await this.tencent.suggest(request);
          upstreamDurationMs += outcome.durationMs;
          if (outcome.ok) {
            items = outcome.items;
            servedBy = "tencent";
          } else {
            primaryFailure = {
              reason: outcome.reason,
              code: outcome.code,
              ...(outcome.httpStatus === undefined ? {} : { httpStatus: outcome.httpStatus }),
              ...(outcome.upstreamStatus === undefined
                ? {}
                : { upstreamStatus: outcome.upstreamStatus }),
            };
            degraded = true;
            fallback = "map_pick";
          }
        }
      }
    } else if (primary === "geoapify") {
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

    if (!china && degraded && primary === "geoapify" && settings.fallbackToPhoton) {
      const fallbackOutcome = await this.photon.search(request);
      upstreamDurationMs += fallbackOutcome.durationMs;
      if (fallbackOutcome.ok) {
        items = fallbackOutcome.items;
        servedBy = "photon";
        fallbackUsed = true;
      } else {
        fallbackFailure = {
          reason: fallbackOutcome.reason,
          ...(fallbackOutcome.httpStatus === undefined
            ? {}
            : { httpStatus: fallbackOutcome.httpStatus }),
        };
      }
    }

    const capped = items.slice(0, query.limit);
    const response = PlaceSearchResponseSchema.parse({
      items: capped,
      provider: degraded && capped.length === 0 ? primary : servedBy,
      degraded,
      cached: false,
      ...(fallback === undefined ? {} : { fallback }),
    });

    if (!degraded) {
      this.logger.log(
        {
          event: "places.search",
          cache: "miss",
          route: china ? "china" : "global",
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
          route: china ? "china" : "global",
          reason: primaryFailure?.reason ?? "unknown",
          ...(primaryFailure?.code === undefined ? {} : { code: primaryFailure.code }),
          ...(primaryFailure?.httpStatus === undefined
            ? {}
            : { httpStatus: primaryFailure.httpStatus }),
          ...(primaryFailure?.upstreamStatus === undefined
            ? {}
            : { upstreamStatus: primaryFailure.upstreamStatus }),
          fallback: china ? (fallback ?? null) : fallbackUsed ? "photon" : null,
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

    // `TENCENT_MAPS_CACHE_TTL_SECONDS` (300 s) bounds the China route; the other
    // routes keep `places.cacheTtlSeconds`.
    const ttlSeconds =
      response.degraded || response.items.length === 0
        ? settings.emptyCacheTtlSeconds
        : china
          ? settings.tencentCacheTtlSeconds
          : settings.cacheTtlSeconds;
    await this.cache.write(cacheKey, response, ttlSeconds);

    return response;
  }
}
