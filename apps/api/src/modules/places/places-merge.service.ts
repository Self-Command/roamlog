import { Injectable } from "@nestjs/common";
import { PlaceSchema, type Place } from "@roamlog/contracts";

import { accuracyForLayer } from "./ranking/pelias-accuracy.js";
import { computeConfidenceScores, type ConfidenceHit } from "./ranking/pelias-confidence.js";
import { dedupeDocuments } from "./ranking/pelias-dedupe.js";
import {
  buildPeliasHit,
  candidateLayer,
  type PeliasHit,
  type PeliasLayer,
  type PeliasSource,
  type ProviderCandidate,
} from "./ranking/pelias-document.js";
import { computeFallbackScore } from "./ranking/pelias-fallback.js";
import { trimByGranularity } from "./ranking/pelias-granularity.js";
import { parseQuery } from "./ranking/pelias-query-parser.js";
import { sortPeliasHits, type FocusPoint } from "./ranking/pelias-sort.js";

/**
 * Parallel recall → Pelias normalization → confidence → granularity → dedupe →
 * sorting → contract `Place[]`.
 *
 * Everything algorithmic comes from Pelias:
 * - normalization: `pelias/model/Document.js` + spec §5.4 field tables
 *   (`ranking/pelias-document.ts`);
 * - confidence: `pelias/api/middleware/confidenceScore.js:58-273`
 *   (`ranking/pelias-confidence.ts`);
 * - fallback `match_type`/layer penalty:
 *   `pelias/api/middleware/confidenceScoreFallback.js:47-240`
 *   (`ranking/pelias-fallback.ts`);
 * - requested-layer filtering: `pelias/api/middleware/trimByGranularity.js:18-113`
 *   (`ranking/pelias-granularity.ts`);
 * - dedupe: `pelias/api/middleware/dedupe.js:15-107` + `helper/diffPlaces.js:13-398`
 *   (`ranking/pelias-dedupe.ts`);
 * - sorting: `pelias-sorting@2.0.0` (`ranking/pelias-sort.ts`).
 *
 * 【适配层，本仓库原创】`degraded` is a Roamlog response field that Pelias
 * does not have (spec §5.9). The provider `_score` proxy and the Tencent
 * `level=9` address signal are also ours — both impossible to take from
 * Elasticsearch / pelias-parser, see the individual files.
 */

export interface ProviderFailureInfo {
  readonly reason: string;
  readonly code?: string;
  readonly httpStatus?: number;
  readonly upstreamStatus?: number;
}

export interface ProviderRecall {
  readonly provider: PeliasSource;
  readonly candidates: readonly ProviderCandidate[];
  readonly failure?: ProviderFailureInfo;
  readonly durationMs: number;
}

export interface MergeInput {
  readonly q: string;
  readonly limit: number;
  readonly lang?: "zh" | "en";
  readonly country?: string;
  readonly focus?: FocusPoint;
  /** Recalls in `settings.sourceOrder` order. */
  readonly recalls: readonly ProviderRecall[];
}

export interface MergeOutcome {
  readonly items: Place[];
  readonly degraded: boolean;
  /** Layer histogram of the returned items, for `places.search_completed` logs. */
  readonly layers: Readonly<Record<string, number>>;
  /** Failed providers, for `places.search_degraded` logs. */
  readonly failures: readonly ProviderFailureInfo[];
}

function scoreFor(candidate: ProviderCandidate): number {
  if (
    candidate.source === "geoapify" &&
    candidate.providerConfidence !== undefined &&
    Number.isFinite(candidate.providerConfidence)
  ) {
    return Math.min(1, Math.max(0, candidate.providerConfidence));
  }
  return 1 / (1 + Math.max(0, candidate.providerRank));
}

/**
 * 【适配层，本仓库原创】Pelias' parser is Latin-only (spec §5.5), so a Chinese
 * door-plate query has no `parsed_text`. Tencent's documented `level=9` (门址)
 * is the one structured "this is an address" signal available, and §5.6
 * explicitly allows it to stand in for `expectedLayers=["address"]`.
 */
function tencentRequestedLayer(recalls: readonly ProviderRecall[]): PeliasLayer | undefined {
  for (const recall of recalls) {
    if (recall.provider !== "tencent") {
      continue;
    }
    for (const candidate of recall.candidates) {
      if (candidate.source === "tencent" && candidate.level === 9) {
        return "address";
      }
    }
  }
  return undefined;
}

function dedupeHits(hits: readonly PeliasHit[]): PeliasHit[] {
  const byDocument = new Map(hits.map((hit) => [hit.document, hit] as const));
  const documents = hits.map((hit) => hit.document);
  const deduped = dedupeDocuments(documents);
  return deduped
    .map((document) => byDocument.get(document))
    .filter((hit): hit is PeliasHit => hit !== undefined);
}

function countLayers(hits: readonly PeliasHit[]): Record<string, number> {
  const layers: Record<string, number> = {};
  for (const hit of hits) {
    layers[hit.layer] = (layers[hit.layer] ?? 0) + 1;
  }
  return layers;
}

@Injectable()
export class PlacesMergeService {
  merge(input: MergeInput): MergeOutcome {
    const parsedText = parseQuery(input.q);
    const candidates = input.recalls.flatMap((recall) => recall.candidates);
    const failures = input.recalls
      .map((recall) => recall.failure)
      .filter((failure): failure is ProviderFailureInfo => failure !== undefined);

    const hits: PeliasHit[] = [];
    for (const candidate of candidates) {
      if (candidateLayer(candidate) === undefined) {
        // Tencent `level=0` is documented "cannot determine, untrustworthy".
        continue;
      }
      hits.push(buildPeliasHit(candidate, scoreFor(candidate)));
    }

    if (hits.length === 0) {
      return { items: [], degraded: true, layers: {}, failures };
    }

    const scores = hits.map((hit) => hit.score);
    const confidences = computeConfidenceScores({
      text: input.q,
      ...(parsedText === undefined ? {} : { parsedText }),
      hits: hits.map((hit) => hit.document as unknown as ConfidenceHit),
      scores,
      relativeScores: true,
    });

    hits.forEach((hit, index) => {
      const confidence = confidences[index] ?? 0;
      const fallbackScore = computeFallbackScore(parsedText, hit.layer);
      hit.confidence = confidence;
      hit.fallbackConfidence = fallbackScore.confidence;
      hit.matchType = fallbackScore.matchType;
      hit.accuracy = accuracyForLayer(hit.layer);
      hit.place.importance = Number.isFinite(confidence) ? confidence : 0;
    });

    const requestedLayer = tencentRequestedLayer(input.recalls);
    const trimmed = trimByGranularity(hits, {
      ...(parsedText === undefined ? {} : { parsedText }),
      ...(requestedLayer === undefined ? {} : { requestedLayer }),
      dropWhenUnmatched: parsedText?.city !== undefined,
    });
    if (trimmed.expectedLayers.length > 0 && !trimmed.matched) {
      // A granularity was requested but no candidate reached it: everything is
      // a Pelias fallback (spec §5.6 step 2).
      for (const hit of trimmed.hits) {
        hit.matchType = "fallback";
      }
    }

    const deduped = dedupeHits(trimmed.hits);
    const sorted = sortPeliasHits(deduped, input.focus);
    const selected = sorted.slice(0, input.limit);

    const items = selected.map((hit) =>
      PlaceSchema.parse({
        ...hit.place,
        importance: hit.confidence === undefined ? hit.place.importance : hit.confidence,
      }),
    );

    const allProvidersFailed =
      input.recalls.length > 0 && input.recalls.every((recall) => recall.failure !== undefined);
    const allFallbackAndWeak =
      selected.length > 0 &&
      selected.every(
        (hit) =>
          hit.matchType === "fallback" && (hit.fallbackConfidence ?? hit.confidence ?? 1) <= 0.4,
      );

    return {
      items,
      degraded: items.length === 0 || allProvidersFailed || allFallbackAndWeak,
      layers: countLayers(selected),
      failures,
    };
  }
}
