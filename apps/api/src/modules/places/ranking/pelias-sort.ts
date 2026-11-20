import type { Document } from "pelias-model";
import peliasSort from "pelias-sorting";

/**
 * `pelias-sorting@2.0.0` wrapper.
 *
 * Upstream: `pelias/sorting@5eab078c6ad19039cc081bc087ac57f75549ff95/index.js:1-187`
 * (MIT). The npm package is the implementation; this file only adapts the
 * Roamlog hit shape and the `focus.point` request shape:
 *
 * ```js
 * const comparator = require('pelias-sorting')({
 *   'focus.point.lat': request.focus?.lat,
 *   'focus.point.lon': request.focus?.lon
 * });
 * results.sort(comparator);
 * ```
 *
 * `Array.prototype.sort` is stable per ECMAScript 2019; when population and
 * popularity are equal, the provider order assembled by the merge service is
 * preserved (spec §5.7).
 *
 * 【适配层，本仓库原创】`focus.point` is optional and comes from settings /
 * request; Pelias receives it from its own cleaned request object.
 */
export interface FocusPoint {
  readonly lat: number;
  readonly lon: number;
}

export interface SortableCall {
  readonly document: Document;
}

export function createPeliasComparator(focus?: FocusPoint): (a: Document, b: Document) => number {
  const clean: Record<string, number> = {};
  if (focus !== undefined) {
    clean["focus.point.lat"] = focus.lat;
    clean["focus.point.lon"] = focus.lon;
  }
  return peliasSort(clean) as unknown as (a: Document, b: Document) => number;
}

/**
 * Sorts hits by the Pelias comparator. The comparator is bound to the
 * `Document` because that is where `layer` / `population` / `popularity` /
 * `center_point` / `_score` live.
 */
export function sortPeliasHits<T extends SortableCall>(
  hits: readonly T[],
  focus?: FocusPoint,
): T[] {
  const comparator = createPeliasComparator(focus);
  return [...hits].sort((left, right) => comparator(left.document, right.document));
}
