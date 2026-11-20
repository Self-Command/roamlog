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
import { PlacesCacheService, type PlacesCacheRoute } from "./places-cache.service.js";
import {
  PlacesMergeService,
  type ProviderFailureInfo,
  type ProviderRecall,
} from "./places-merge.service.js";
import { PlacesQuotaService } from "./places-quota.service.js";
import {
  PLACES_SETTINGS,
  type PlacesResponseProvider,
  type PlacesSettings,
  type PlacesSettingsSource,
  type PlacesSource,
} from "./places.settings.js";
import { TencentClient } from "./tencent.client.js";
import type { ProviderCandidate } from "./ranking/pelias-document.js";
import { HAN_SCRIPT, queryVariants } from "./ranking/query-variants.js";

/**
 * Multi-source place search.
 *
 * Pelias is the only ranking authority: every provider answer is normalized to
 * a Pelias `Document` (`ranking/pelias-document.ts`) and merged by
 * `PlacesMergeService` with Pelias confidence + `pelias-sorting`. This service
 * only does the parts Pelias' own service does outside the ranking middleware:
 * request validation, parallel querying of its data sources, daily quotas,
 * caching, `degraded`/`map_pick` reporting, and observability.
 *
 * 【适配层，本仓库原创】Provider eligibility (`eligibleSources`) is a routing
 * policy, not Pelias: Tencent is only eligible for mainland queries (country=CN
 * or Han script without an explicit foreign country), Geoapify only when a key
 * is configured, Photon always (spec §5.2). Provider order in the recall array
 * follows `PLACES_SOURCE_ORDER` and is Pelias' stable-sort tie-break (§5.7).
 */

/** Han script. `\p{Script=Han}` also covers the CJK ideographs outside the BMP. */
export { HAN_SCRIPT };

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
 * Recall route (cache namespace):
 * - `china`: explicit `country=CN`;
 * - `mixed`: Han query without a country — Tencent participates together with
 *   the global providers (this is the `东京` / `京都` case);
 * - `global`: everything else.
 */
export function routeFor(query: {
  readonly q: string;
  readonly country?: string | undefined;
}): PlacesCacheRoute {
  if (query.country === "CN") {
    return "china";
  }
  if (query.country === undefined && HAN_SCRIPT.test(query.q)) {
    return "mixed";
  }
  return "global";
}

/** `eligible` from spec §5.2, ordered by `settings.sourceOrder`. */
export function eligibleSources(
  query: { readonly q: string; readonly country?: string | undefined },
  settings: PlacesSettings,
): PlacesSource[] {
  const enabled = new Set(settings.sources);
  const hanRoute = query.country === "CN" || (query.country === undefined && HAN_SCRIPT.test(query.q));
  const eligible: PlacesSource[] = [];

  if (enabled.has("tencent") && hanRoute) {
    eligible.push("tencent");
  }
  if (enabled.has("geoapify") && settings.geoapifyApiKey !== null) {
    eligible.push("geoapify");
  }
  if (enabled.has("photon")) {
    eligible.push("photon");
  }

  const order = settings.sourceOrder;
  return eligible.sort((left, right) => {
    const leftIndex = order.indexOf(left);
    const rightIndex = order.indexOf(right);
    return (leftIndex === -1 ? order.length : leftIndex) - (rightIndex === -1 ? order.length : rightIndex);
  });
}

interface RecallInput {
  readonly q: string;
  readonly limit: number;
  readonly lang?: "zh" | "en";
}

function failureOf(outcome: {
  readonly reason: string;
  readonly code?: string;
  readonly httpStatus?: number;
  readonly upstreamStatus?: number;
}): ProviderFailureInfo {
  return {
    reason: outcome.reason,
    ...(outcome.code === undefined ? {} : { code: outcome.code }),
    ...(outcome.httpStatus === undefined ? {} : { httpStatus: outcome.httpStatus }),
    ...(outcome.upstreamStatus === undefined ? {} : { upstreamStatus: outcome.upstreamStatus }),
  };
}

function withRank(candidates: readonly ProviderCandidate[], offset: number): ProviderCandidate[] {
  return candidates.map((candidate, index) => ({ ...candidate, providerRank: offset + index }));
}

function servedProvider(item: Place | undefined, fallback: PlacesResponseProvider): PlacesResponseProvider {
  const provider = item?.provider;
  return provider === "tencent" || provider === "geoapify" || provider === "photon"
    ? provider
    : fallback;
}

/**
 * `GET /v1/places/search` use case.
 *
 * A query runs every eligible source in parallel. Each source has its own
 * timeout and quota, and one failing source never blocks the others. The merge
 * service then applies Pelias confidence, layer filtering, dedupe, sorting and
 * `degraded`.
 *
 * Shared behaviour:
 * - No source produces items → `200 { items: [], degraded: true }`; search
 *   never turns an upstream outage into a 5xx.
 * - `provider` names the source of the first returned item, or the route's
 *   primary source when the list is empty.
 * - The cache key carries the recall route, so a China answer is never replayed
 *   for a global query (or the other way round).
 */
@Injectable()
export class PlacesService {
  constructor(
    @Inject(PlacesCacheService) private readonly cache: PlacesCacheService,
    @Inject(GeoapifyClient) private readonly geoapify: GeoapifyClient,
    @Inject(PhotonClient) private readonly photon: PhotonClient,
    @Inject(TencentClient) private readonly tencent: TencentClient,
    @Inject(PlacesQuotaService) private readonly quota: PlacesQuotaService,
    @Inject(PlacesMergeService) private readonly merge: PlacesMergeService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
    @Inject(PLACES_SETTINGS) private readonly settings: PlacesSettingsSource,
  ) {}

  async search(rawQuery: unknown): Promise<PlaceSearchResponse> {
    const settings = await this.settings.resolve();
    const query = parseRequest(PlaceSearchQuerySchema, withSettingsDefaults(rawQuery, settings));
    const startedAt = Date.now();
    const route = routeFor(query);
    const primary: PlacesResponseProvider = route === "china" ? "tencent" : settings.provider;
    const focus = settings.focusPoint ?? undefined;
    const cacheKey = this.cache.key({
      q: query.q,
      limit: query.limit,
      ...(query.lang ? { lang: query.lang } : {}),
      route,
      ...(query.country ? { country: query.country } : {}),
      ...(focus ? { focus } : {}),
    });

    const cached = await this.cache.read(cacheKey);
    if (cached) {
      this.logger.log(
        {
          event: "places.search",
          cache: "hit",
          route,
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

    const input: RecallInput = {
      q: query.q,
      limit: query.limit,
      ...(query.lang ? { lang: query.lang } : {}),
    };
    const sources = eligibleSources(query, settings);
    const recalls = await Promise.all(
      sources.map((source) => this.recall(source, input, settings)),
    );

    const merged = this.merge.merge({
      q: query.q,
      limit: query.limit,
      ...(query.lang ? { lang: query.lang } : {}),
      ...(query.country ? { country: query.country } : {}),
      ...(focus ? { focus } : {}),
      recalls,
    });

    const degraded = merged.degraded;
    const fallback = degraded && merged.items.length === 0 ? "map_pick" : undefined;
    const response = PlaceSearchResponseSchema.parse({
      items: merged.items,
      provider: servedProvider(merged.items[0], primary),
      degraded,
      cached: false,
      ...(fallback === undefined ? {} : { fallback }),
    });

    const failedRecalls = recalls.filter((recall) => recall.failure !== undefined);
    const upstreamDurationMs = recalls.reduce((total, recall) => total + recall.durationMs, 0);

    if (degraded || failedRecalls.length > 0) {
      const firstFailure = failedRecalls[0];
      this.logger.warn(
        {
          event: "places.upstream_failed",
          provider: firstFailure?.provider ?? primary,
          route,
          reason: firstFailure?.failure?.reason ?? "all_results_fallback",
          ...(firstFailure?.failure?.code === undefined ? {} : { code: firstFailure.failure.code }),
          ...(firstFailure?.failure?.httpStatus === undefined
            ? {}
            : { httpStatus: firstFailure.failure.httpStatus }),
          ...(firstFailure?.failure?.upstreamStatus === undefined
            ? {}
            : { upstreamStatus: firstFailure.failure.upstreamStatus }),
          providers: recalls.map((recall) => ({
            provider: recall.provider,
            candidates: recall.candidates.length,
            failed: recall.failure !== undefined,
            durationMs: recall.durationMs,
          })),
          fallback: fallback ?? null,
          durationMs: upstreamDurationMs,
          queryLength: query.q.length,
          limit: query.limit,
          lang: query.lang ?? null,
        },
        "places.search_degraded",
      );
    }

    if (!degraded) {
      this.logger.log(
        {
          event: "places.search",
          cache: "miss",
          route,
          queryLength: query.q.length,
          limit: query.limit,
          lang: query.lang ?? null,
          provider: response.provider,
          resultCount: merged.items.length,
          layers: merged.layers,
          providers: recalls.map((recall) => ({
            provider: recall.provider,
            candidates: recall.candidates.length,
            failed: recall.failure !== undefined,
            durationMs: recall.durationMs,
          })),
          degraded: false,
          durationMs: Date.now() - startedAt,
        },
        "places.search_completed",
      );
    }

    // Tencent results are cached for 5 minutes; the global-only route keeps the
    // 15-minute `places.cacheTtlSeconds`.
    const ttlSeconds =
      response.degraded || response.items.length === 0
        ? settings.emptyCacheTtlSeconds
        : route === "global"
          ? settings.cacheTtlSeconds
          : settings.tencentCacheTtlSeconds;
    await this.cache.write(cacheKey, response, ttlSeconds);

    return response;
  }

  private async recall(
    source: PlacesSource,
    input: RecallInput,
    settings: PlacesSettings,
  ): Promise<ProviderRecall> {
    switch (source) {
      case "tencent":
        return this.recallTencent(input, settings);
      case "geoapify":
        return this.recallGeoapify(input, settings);
      case "photon":
        return this.recallPhoton(input, settings);
    }
  }

  /**
   * Tencent has two documented endpoints that answer different questions:
   * `geocoder/v1?address=` returns the structured administrative level
   * (`level=1` city … `level=9` door plate), while `place/v1/suggestion`
   * returns POI/address autocomplete rows. Both are queried in parallel so a
   * city query gets the authoritative `locality` and an address query gets the
   * POI. One quota decision covers the provider call, not each endpoint.
   */
  private async recallTencent(input: RecallInput, settings: PlacesSettings): Promise<ProviderRecall> {
    if (settings.tencentApiKey === null) {
      return {
        provider: "tencent",
        candidates: [],
        failure: { reason: "not_configured", code: "NOT_CONFIGURED" },
        durationMs: 0,
      };
    }
    const quota = await this.quota.consumeTencent();
    if (!quota.allowed) {
      return {
        provider: "tencent",
        candidates: [],
        failure: { reason: "quota_exceeded", code: "QUOTA_EXCEEDED" },
        durationMs: 0,
      };
    }

    const [geocode, suggest] = await Promise.all([
      this.tencent.geocodeCandidate({ address: input.q }),
      this.tencent.suggestCandidates({ q: input.q, limit: input.limit }),
    ]);

    const geocodeCandidates = geocode.ok ? [geocode.candidate] : [];
    const suggestCandidates = suggest.ok ? suggest.candidates : [];
    const candidates = [
      ...withRank(geocodeCandidates, 0),
      ...withRank(suggestCandidates, geocodeCandidates.length),
    ];
    const durationMs = geocode.durationMs + suggest.durationMs;
    const failures = [geocode, suggest].filter((outcome) => !outcome.ok);
    const firstFailure = failures[0];

    return {
      provider: "tencent",
      candidates,
      ...(candidates.length === 0 && firstFailure !== undefined
        ? { failure: failureOf(firstFailure) }
        : {}),
      durationMs,
    };
  }

  private async recallGeoapify(input: RecallInput, settings: PlacesSettings): Promise<ProviderRecall> {
    if (settings.geoapifyApiKey === null) {
      return {
        provider: "geoapify",
        candidates: [],
        failure: { reason: "not_configured" },
        durationMs: 0,
      };
    }
    const quota = await this.quota.consume();
    if (!quota.allowed) {
      return {
        provider: "geoapify",
        candidates: [],
        failure: { reason: "quota_exceeded" },
        durationMs: 0,
      };
    }

    const variants = queryVariants("geoapify", input.q);
    const outcomes = await Promise.all(
      variants.map((variant) =>
        this.geoapify.searchCandidates({
          q: variant,
          limit: input.limit,
          ...(input.lang ? { lang: input.lang } : {}),
        }),
      ),
    );

    const candidates: ProviderCandidate[] = [];
    let durationMs = 0;
    let firstFailure: ProviderFailureInfo | undefined;
    for (const outcome of outcomes) {
      durationMs += outcome.durationMs;
      if (outcome.ok) {
        candidates.push(...withRank(outcome.candidates, candidates.length));
      } else {
        firstFailure ??= failureOf(outcome);
      }
    }

    return {
      provider: "geoapify",
      candidates,
      ...(candidates.length === 0 && firstFailure !== undefined ? { failure: firstFailure } : {}),
      durationMs,
    };
  }

  private async recallPhoton(input: RecallInput, _settings: PlacesSettings): Promise<ProviderRecall> {
    const variants = queryVariants("photon", input.q);
    const outcomes = await Promise.all(
      variants.map((variant) =>
        this.photon.searchCandidates({
          q: variant,
          limit: input.limit,
          ...(input.lang ? { lang: input.lang } : {}),
        }),
      ),
    );

    const candidates: ProviderCandidate[] = [];
    let durationMs = 0;
    let firstFailure: ProviderFailureInfo | undefined;
    for (const outcome of outcomes) {
      durationMs += outcome.durationMs;
      if (outcome.ok) {
        candidates.push(...withRank(outcome.candidates, candidates.length));
      } else {
        firstFailure ??= failureOf(outcome);
      }
    }

    return {
      provider: "photon",
      candidates,
      ...(candidates.length === 0 && firstFailure !== undefined ? { failure: firstFailure } : {}),
      durationMs,
    };
  }
}
