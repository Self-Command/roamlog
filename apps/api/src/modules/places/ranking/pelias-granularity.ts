import type { PeliasLayer } from "./pelias-document.js";
import { requestedLayers } from "./pelias-fallback.js";
import type { ParsedText } from "./pelias-query-parser.js";

/**
 * Requested-layer filtering, the Roamlog rebuild of Pelias
 * `trimByGranularity.js`.
 *
 * Upstream: `pelias/api@561e3e85f79b5388f88451cb1a49000764d29e35/middleware/trimByGranularity.js:18-113`.
 * Pelias keeps the finest layer present in `_matched_queries` (an Elasticsearch
 * artefact); `trimByGranularity.js:36-44` is impossible to reproduce without ES,
 * so the same intent is rebuilt from `parsed_text` (spec §5.6).
 *
 * 【适配层，本仓库原创】Two differences, both required by the missing ES index:
 * 1. `_matched_queries` → `parsed_text` rule matching via
 *    `confidenceScoreFallback.js:124-185` (the same rules Pelias uses).
 * 2. A Tencent `level=9` (门址) signal can act as `expectedLayers=["address"]`;
 *    the Pelias parser has no solution for Chinese addresses (§5.5), so the
 *    provider's documented `level` is the only structured signal available.
 */

export interface GranularityOptions {
  readonly parsedText?: ParsedText;
  /** Explicit requested layer(s), e.g. from Tencent `level=9`. */
  readonly requestedLayer?: PeliasLayer | readonly PeliasLayer[];
  /**
   * When the requested layer is known but nothing matches it, drop the
   * candidates instead of keeping them. Used for a bare Han city query: a
   * mainland POI whose name merely contains the city name must never be shown
   * as that city when every global provider failed (wrong coordinate is worse
   * than an empty degraded answer).
   */
  readonly dropWhenUnmatched?: boolean;
}

export interface GranularityResult<T> {
  readonly hits: T[];
  readonly expectedLayers: readonly PeliasLayer[];
  /** `true` when at least one hit matched the requested layer. */
  readonly matched: boolean;
  /** `true` when at least one hit matched the requested layer and others were dropped. */
  readonly filtered: boolean;
}

export interface LayeredHit {
  readonly layer: PeliasLayer;
}

function normalizeRequestedLayer(
  requested: PeliasLayer | readonly PeliasLayer[] | undefined,
): readonly PeliasLayer[] {
  if (requested === undefined) {
    return [];
  }
  return Array.isArray(requested) ? requested : [requested as PeliasLayer];
}

/**
 * Keeps the most granular matching layer when the candidate set contains it;
 * when it does not, all candidates are retained so the caller can mark them as
 * a Pelias fallback (`match_type=fallback`).
 */
export function trimByGranularity<T extends LayeredHit>(
  hits: readonly T[],
  options: GranularityOptions,
): GranularityResult<T> {
  const explicit = normalizeRequestedLayer(options.requestedLayer);
  const expectedLayers = explicit.length > 0 ? explicit : requestedLayers(options.parsedText);
  if (expectedLayers.length === 0 || hits.length === 0) {
    return { hits: [...hits], expectedLayers, matched: false, filtered: false };
  }

  const matched = hits.filter((hit) => expectedLayers.includes(hit.layer));
  if (matched.length === 0) {
    return options.dropWhenUnmatched === true
      ? { hits: [], expectedLayers, matched: false, filtered: true }
      : { hits: [...hits], expectedLayers, matched: false, filtered: false };
  }
  return { hits: matched, expectedLayers, matched: true, filtered: matched.length !== hits.length };
}
