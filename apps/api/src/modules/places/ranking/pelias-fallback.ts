import type { PeliasLayer } from "./pelias-document.js";
import type { ParsedText } from "./pelias-query-parser.js";

/**
 * Pelias fallback confidence / `match_type`.
 *
 * Upstream: `pelias/api@561e3e85f79b5388f88451cb1a49000764d29e35/middleware/confidenceScoreFallback.js:47-240`,
 * ported function by function:
 *
 * - `computeConfidenceScore`  ← `computeConfidenceScore` (line 47)
 * - `checkFallbackLevel`      ← `checkFallbackLevel` (line 68-105)
 * - `fallbackRules`           ← `fallbackRules` (line 124-185)
 * - `checkFallbackOccurred`   ← `checkFallbackOccurred` (line 187-208)
 * - `notSet` / `areSet`       ← `notSet` / `areSet` (line 210-233)
 *
 * 【适配层，本仓库原创】The upstream middleware mutates `hit.confidence`; here
 * the function is pure and returns the value, because `places.service.ts` does
 * not run Pelias' Express middleware chain and the main confidence formula must
 * not be overwritten (spec §5.5). Only `match_type` / the layer penalty are
 * consumed; `Place.importance` comes from `pelias-confidence.ts`.
 */

export interface FallbackRule {
  readonly name: string;
  readonly notSet: readonly string[];
  readonly set: readonly string[];
  readonly expectedLayers: readonly PeliasLayer[];
}

/** `confidenceScoreFallback.js:124-185`, in the upstream order. */
export const fallbackRules: readonly FallbackRule[] = Object.freeze([
  { name: "venue", notSet: [], set: ["query"], expectedLayers: ["venue"] },
  { name: "address", notSet: ["query"], set: ["housenumber", "street"], expectedLayers: ["address"] },
  {
    name: "street",
    notSet: ["query", "housenumber"],
    set: ["street"],
    expectedLayers: ["street"],
  },
  {
    name: "postalcode",
    notSet: ["query", "housenumber", "street"],
    set: ["postalcode"],
    expectedLayers: ["postalcode"],
  },
  {
    name: "neighbourhood",
    notSet: ["query", "housenumber", "street", "postalcode"],
    set: ["neighbourhood"],
    expectedLayers: ["neighbourhood"],
  },
  {
    name: "borough",
    notSet: ["query", "housenumber", "street", "postalcode", "neighbourhood"],
    set: ["borough"],
    expectedLayers: ["borough"],
  },
  {
    name: "city",
    notSet: ["query", "housenumber", "street", "postalcode", "neighbourhood", "borough"],
    set: ["city"],
    expectedLayers: ["borough", "locality", "localadmin"],
  },
  {
    name: "county",
    notSet: [
      "query",
      "housenumber",
      "street",
      "postalcode",
      "neighbourhood",
      "borough",
      "city",
    ],
    set: ["county"],
    expectedLayers: ["county"],
  },
  {
    name: "state",
    notSet: [
      "query",
      "housenumber",
      "street",
      "postalcode",
      "neighbourhood",
      "borough",
      "city",
      "county",
    ],
    set: ["state"],
    expectedLayers: ["region"],
  },
  {
    name: "country",
    notSet: [
      "query",
      "housenumber",
      "street",
      "postalcode",
      "neighbourhood",
      "borough",
      "city",
      "county",
      "state",
    ],
    set: ["country"],
    expectedLayers: ["country"],
  },
]);

function getProperty(parsedText: ParsedText, property: string): unknown {
  return (parsedText as unknown as Record<string, unknown>)[property];
}

/** `notSet` (`confidenceScoreFallback.js:210-221`): every listed property falsy. */
function notSet(parsedText: ParsedText, properties: readonly string[]): boolean {
  if (properties.length === 0) {
    return true;
  }
  return properties.every((property) => !getProperty(parsedText, property));
}

/** `areSet` (`confidenceScoreFallback.js:223-233`): every listed property truthy. */
function areSet(parsedText: ParsedText, properties: readonly string[]): boolean {
  return properties.every((property) => Boolean(getProperty(parsedText, property)));
}

/**
 * `checkFallbackOccurred` (`confidenceScoreFallback.js:187-208`): the first rule
 * whose less-granular properties are unset, whose own property is set, and whose
 * expected layers do not include the returned layer.
 */
export function checkFallbackOccurred(parsedText: ParsedText, hitLayer: string): boolean {
  return fallbackRules.some(
    (rule) =>
      notSet(parsedText, rule.notSet) &&
      areSet(parsedText, rule.set) &&
      !rule.expectedLayers.includes(hitLayer as PeliasLayer),
  );
}

/**
 * The expected layer(s) for a parsed query, i.e. the first rule whose `notSet`
 * and `set` conditions hold. This is the same rule `checkFallbackOccurred`
 * inspects; `pelias-granularity.ts` uses it to rebuild the
 * `trimByGranularity` intent without Elasticsearch `_matched_queries`.
 */
export function requestedLayers(parsedText: ParsedText | undefined): readonly PeliasLayer[] {
  if (parsedText === undefined) {
    return [];
  }
  const rule = fallbackRules.find(
    (candidate) => notSet(parsedText, candidate.notSet) && areSet(parsedText, candidate.set),
  );
  return rule ? rule.expectedLayers : [];
}

/** `checkFallbackLevel` switch (`confidenceScoreFallback.js:68-105`). */
export function fallbackPenalty(hitLayer: string): number {
  switch (hitLayer) {
    case "venue":
    case "address":
    case "street":
    case "postalcode":
      return 0.8;
    case "localadmin":
    case "locality":
    case "borough":
    case "neighbourhood":
      return 0.6;
    case "macrocounty":
    case "county":
      return 0.4;
    case "region":
      return 0.3;
    case "country":
    case "dependency":
    case "macroregion":
      return 0.1;
    default:
      return 0.1;
  }
}

export interface FallbackScore {
  readonly confidence: number;
  readonly matchType: "exact" | "fallback" | "unknown";
}

/** `computeConfidenceScore` (`confidenceScoreFallback.js:47-65`). */
export function computeFallbackScore(
  parsedText: ParsedText | undefined,
  hitLayer: string,
): FallbackScore {
  if (parsedText === undefined) {
    return { confidence: 0.1, matchType: "unknown" };
  }

  if (checkFallbackOccurred(parsedText, hitLayer)) {
    return { confidence: Number((1.0 * fallbackPenalty(hitLayer)).toFixed(3)), matchType: "fallback" };
  }

  return { confidence: 1.0, matchType: "exact" };
}
