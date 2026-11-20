import type { ParsedText } from "./pelias-query-parser.js";

/**
 * Pelias confidence score (positive geocoding).
 *
 * Upstream: `pelias/api@561e3e85f79b5388f88451cb1a49000764d29e35/middleware/confidenceScore.js:28-273`,
 * ported function by function:
 *
 * - `computeConfidenceScore`           ← `computeConfidenceScore` (line 58)
 * - `checkForDealBreakers`             ← `checkForDealBreakers` (line 93)
 * - `checkDistanceFromMean`             ← `checkDistanceFromMean` (line 119)
 * - `checkName`                         ← `checkName` (line 132)
 * - `checkQueryType`                    ← `checkQueryType` (line 158)
 * - `propMatch`                         ← `propMatch` (line 173)
 * - `checkAddress`                      ← `checkAddress` (line 215)
 * - `computeZScore`                     ← `computeZScore` (line 249)
 * - `computeStandardDeviation`          ← `computeStandardDeviation` (line 268)
 *
 * `checkCount = 3 + 2 * relativeScores`; `confidence = round((D + Z + N + Q +
 * A) / checkCount, 3)`.
 *
 * 【适配层，本仓库原创】`hit._score` cannot be Elasticsearch BM25 here; the
 * caller passes the provider proxy documented in spec §5.5 (Geoapify
 * `rank.confidence`, otherwise `1 / (1 + providerRank)`). `D`/`Z` consume that
 * proxy unchanged; `N`/`Q`/`A` remain the upstream formula.
 *
 * `undefined` vs `null` is preserved deliberately: upstream uses
 * `_.isUndefined` in some branches and `_.isNil` in others, and the upstream
 * tests depend on the difference (`propMatch` returns 0.7 for a `null` hit
 * value but 0 for `undefined`).
 */

export interface ConfidenceAddressParts {
  readonly number?: string | number | null;
  readonly street?: string | number | null;
  readonly zip?: string | number | null;
}

export interface ConfidenceParent {
  readonly country?: readonly (string | null)[];
  readonly region?: readonly (string | null)[];
  readonly county?: readonly (string | null)[];
  readonly region_a?: readonly (string | null)[];
  readonly country_a?: readonly (string | null)[];
}

export interface ConfidenceHit {
  readonly _score: number;
  readonly name?: { readonly default?: string | readonly string[] | null };
  readonly address_parts?: ConfidenceAddressParts;
  readonly parent?: ConfidenceParent;
}

export interface ConfidenceInput {
  readonly text: string;
  readonly parsedText?: ParsedText;
  readonly hit: ConfidenceHit;
  readonly scores: readonly number[];
  /** `peliasConfig.relativeScores`, default `true` (`confidenceScore.js:19-24`). */
  readonly relativeScores?: boolean;
}

/** `helper/fieldValue.js:getStringValue` — arrays resolve to their first item. */
export function getStringValue(property: unknown): string {
  if (typeof property === "number") {
    return String(property);
  }
  if (property === null || property === undefined) {
    return "";
  }
  if (typeof property === "string") {
    return property;
  }
  if (Array.isArray(property)) {
    const first = property[0];
    return first === null || first === undefined ? "" : String(first);
  }
  if (typeof property === "object") {
    return "";
  }
  return String(property);
}

function isNil(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

export function mean(scores: readonly number[]): number {
  if (scores.length === 0) {
    return Number.NaN;
  }
  let total = 0;
  for (const score of scores) {
    total += score;
  }
  return total / scores.length;
}

/**
 * `stats-lite@2.2.0` `stdev` is its *population* standard deviation
 * (`stats-lite/stats.js`: `module.exports.stdev = populationStdev`,
 * `populationVariance = mean(valuesMinusMeanSquared(vals))`).
 */
export function populationStdev(scores: readonly number[]): number {
  if (scores.length === 0) {
    return Number.NaN;
  }
  const average = mean(scores);
  let squares = 0;
  for (const score of scores) {
    squares += (score - average) ** 2;
  }
  return Math.sqrt(squares / scores.length);
}

/** `computeStandardDeviation` (`confidenceScore.js:266-269`). */
export function computeStandardDeviation(scores: readonly number[]): number {
  const stdev = populationStdev(scores);
  return stdev < 0.01 ? 0 : stdev;
}

/** `checkForDealBreakers` (`confidenceScore.js:93-108`). */
export function checkForDealBreakers(parsedText: ParsedText | undefined, hit: ConfidenceHit): boolean {
  if (parsedText === undefined) {
    return false;
  }

  if (
    !isNil(parsedText.state) &&
    !isNil(hit.parent) &&
    hit.parent.region_a !== undefined &&
    parsedText.state !== hit.parent.region_a[0]
  ) {
    return true;
  }

  if (
    !isNil(parsedText.postalcode) &&
    !isNil(hit.address_parts) &&
    parsedText.postalcode !== hit.address_parts.zip
  ) {
    return true;
  }

  return false;
}

/** `checkDistanceFromMean` (`confidenceScore.js:119-121`). */
export function checkDistanceFromMean(score: number, average: number, stdev: number): number {
  return score - average > stdev ? 1 : 0;
}

/** `checkName` (`confidenceScore.js:132-146`). */
export function checkName(text: string, parsedText: ParsedText | undefined, hit: ConfidenceHit): number {
  const hitName = getStringValue(hit.name?.default).toLowerCase();

  if (!isNil(parsedText) && !isNil(parsedText.name) && hitName === parsedText.name.toLowerCase()) {
    return 1;
  }

  if (hitName === text.toLowerCase()) {
    return 1;
  }

  return 0.7;
}

/** `checkQueryType` (`confidenceScore.js:158-168`). */
export function checkQueryType(parsedText: ParsedText | undefined, hit: ConfidenceHit): number {
  if (
    !isNil(parsedText) &&
    !isNil(parsedText.housenumber) &&
    (hit.address_parts === undefined ||
      (hit.address_parts !== undefined && hit.address_parts.number === undefined))
  ) {
    return 0;
  }
  return 1;
}

/**
 * `propMatch` (`confidenceScore.js:173-196`).
 *
 * `expectEnriched` mirrors the upstream argument: it is `false`/`true` in
 * `checkAddress`, so `!_.isNil(false)` is true and the "both missing but
 * enrichment expected" branch fires even for `false`.
 */
export function propMatch(
  textProp: string | number | null | undefined,
  hitProp: string | number | null | undefined,
  expectEnriched: boolean,
): number {
  if (textProp === undefined && hitProp === undefined && !isNil(expectEnriched)) {
    return 0;
  }
  if (textProp === undefined && hitProp === undefined) {
    return 1;
  }
  if (!isNil(textProp) && hitProp === undefined) {
    return 0;
  }
  if (textProp === undefined && !isNil(hitProp) && !isNil(expectEnriched)) {
    return 1;
  }
  if (textProp === undefined && !isNil(hitProp)) {
    return 0.5;
  }
  if (!isNil(textProp) && !isNil(hitProp) && String(textProp).toLowerCase() === String(hitProp).toLowerCase()) {
    return 1;
  }
  return 0.7;
}

/** `checkAddress` (`confidenceScore.js:215-241`). */
export function checkAddress(parsedText: ParsedText | undefined, hit: ConfidenceHit): number {
  if (!isNil(parsedText) && !isNil(parsedText.housenumber) && !isNil(parsedText.street)) {
    let result = 0;
    const addressParts = hit.address_parts;
    const parent = hit.parent;

    result += propMatch(
      parsedText.housenumber,
      addressParts ? addressParts.number : null,
      false,
    );
    result += propMatch(parsedText.street, addressParts ? addressParts.street : null, false);
    result += propMatch(parsedText.postalcode, addressParts ? addressParts.zip : null, true);
    result += propMatch(
      parsedText.state,
      parent && parent.region_a ? parent.region_a[0] : null,
      true,
    );
    result += propMatch(
      parsedText.country,
      parent && parent.country_a ? parent.country_a[0] : null,
      true,
    );
    return result / 5;
  }

  return 1;
}

/** `computeZScore` (`confidenceScore.js:249-259`). */
export function computeZScore(score: number, average: number, stdev: number): number {
  if (stdev < 0.01) {
    return 0;
  }
  return (score - average) / stdev / 16 + 10 / 16;
}

/**
 * `computeConfidenceScore` (`confidenceScore.js:58-83`). Returns the rounded
 * confidence; a deal breaker short-circuits to `0.5`.
 */
export function computeConfidenceScore(input: ConfidenceInput): number {
  const { text, parsedText, hit, scores } = input;
  const relativeScores = input.relativeScores ?? true;

  if (checkForDealBreakers(parsedText, hit)) {
    return 0.5;
  }

  let checkCount = 3;
  let confidence = 0;

  if (relativeScores) {
    checkCount += 2;
    const average = mean(scores);
    const stdev = computeStandardDeviation(scores);
    confidence += checkDistanceFromMean(hit._score, average, stdev);
    confidence += computeZScore(hit._score, average, stdev);
  }

  confidence += checkName(text, parsedText, hit);
  confidence += checkQueryType(parsedText, hit);
  confidence += checkAddress(parsedText, hit);

  return Number((confidence / checkCount).toFixed(3));
}

/**
 * The `res.data.map(...)` loop of `computeScores` (`confidenceScore.js:43-53`),
 * exposed as a pure function so the merge service computes the distribution
 * once and applies it to every hit.
 */
export function computeConfidenceScores(input: {
  readonly text: string;
  readonly parsedText?: ParsedText;
  readonly hits: readonly ConfidenceHit[];
  /** Defaults to the hits' `_score` values, like `res.meta.scores`. */
  readonly scores?: readonly number[];
  readonly relativeScores?: boolean;
}): number[] {
  const scores = input.scores ?? input.hits.map((hit) => hit._score);
  return input.hits.map((hit) =>
    computeConfidenceScore({
      text: input.text,
      ...(input.parsedText === undefined ? {} : { parsedText: input.parsedText }),
      hit,
      scores,
      ...(input.relativeScores === undefined ? {} : { relativeScores: input.relativeScores }),
    }),
  );
}
