/**
 * Pelias dedupe.
 *
 * Upstream: `pelias/api@561e3e85f79b5388f88451cb1a49000764d29e35/middleware/dedupe.js:15-107`
 * and `helper/diffPlaces.js:13-398`, ported function by function:
 *
 * - `dedupeDocuments`              ← `dedupeResults` (dedupe.js:15-64)
 * - `isPreferred`                  ← `isPreferred` (dedupe.js:67-103)
 * - `isDifferent`                  ← `isDifferent` (diffPlaces.js:252-394)
 * - `isLayerDifferent`             ← `isLayerDifferent` (diffPlaces.js:31-47)
 * - `isParentHierarchyDifferent`   ← `isParentHierarchyDifferent` (diffPlaces.js:103-181)
 * - `isNameDifferent`              ← `isNameDifferent` (diffPlaces.js:186-227)
 * - `isAddressDifferent`           ← `isAddressDifferent` (diffPlaces.js:232-256)
 * - `layerDependentNormalization`  ← `layerDependentNormalization` (diffPlaces.js:330-390)
 * - `normalizeString`              ← `normalizeString` (diffPlaces.js:395-397)
 *
 * 【适配层，本仓库原创】Three provider-world translations:
 * 1. `canonical_sources` is a Pelias-config concept (`type_mapping.js`); our
 *    providers have no WOF/OA/OSM/GeoNames set, so `CANONICAL_SOURCES` is empty
 *    and the branch is inert.
 * 2. The source preferences in `isPreferred` (geonames/openstreetmap/
 *    who'sonfirst) are replaced with `SOURCE_PREFERENCE` for tencent / photon /
 *    geoapify, as required by spec §5.8. Lower number wins.
 * 3. `remove-accents` / `helper/unicode.js` are replaced with the platform
 *    `String.prototype.normalize` (NFKC + diacritic strip); the observable
 *    normalization for our name set is identical and no extra dependency is
 *    introduced.
 *
 * `isGeonamesConcordanceSame` stays false because Roamlog has no
 * whosonfirst/geonames documents with `addendum.concordances`.
 */

export interface PeliasDedupeDocument {
  readonly source: string;
  readonly layer: string;
  readonly source_id?: string;
  readonly name?: Record<string, string | string[]>;
  readonly parent?: Record<string, unknown>;
  readonly address_parts?: Record<string, unknown>;
  readonly addendum?: Record<string, unknown>;
}

/** `diffPlaces.js:13-23`. */
export const layerPreferences: readonly string[] = Object.freeze([
  "country",
  "locality",
  "localadmin",
  "county",
  "region",
  "neighbourhood",
  "macrocounty",
  "macroregion",
  "empire",
]);

/**
 * 【适配层，本仓库原创】Spec §5.8 source preference. Lower rank is preferred.
 * `tencent` = mainland address/POI priority; `photon` = multilingual place
 * names; `geoapify` = global address fallback.
 */
export const SOURCE_PREFERENCE: Readonly<Record<string, number>> = Object.freeze({
  tencent: 0,
  photon: 1,
  geoapify: 2,
});

/** No source is canonical in the Pelias WOF/OA/OSM sense for this adapter. */
const CANONICAL_SOURCES: readonly string[] = Object.freeze([]);

/** Standard Pelias layers (used by `isLayerDifferent`). */
const CANONICAL_LAYERS: ReadonlySet<string> = new Set([
  "venue",
  "address",
  "street",
  "neighbourhood",
  "borough",
  "postalcode",
  "locality",
  "localadmin",
  "county",
  "macrocounty",
  "region",
  "macroregion",
  "dependency",
  "country",
  "continent",
]);

/** `helper/placeTypes.js:4-20`, ascending granularity. */
const placeTypes: readonly string[] = Object.freeze([
  "ocean",
  "marinearea",
  "continent",
  "empire",
  "country",
  "dependency",
  "macroregion",
  "region",
  "macrocounty",
  "county",
  "localadmin",
  "locality",
  "borough",
  "neighbourhood",
  "postalcode",
]);

/** `fieldValue.js:getStringValue`. */
function getStringValue(property: unknown): string {
  if (typeof property === "number") {
    return String(property);
  }
  if (property === null || property === undefined || property === "") {
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

/** `fieldValue.js:getArrayValue`. */
function getArrayValue(property: unknown): unknown[] {
  if (typeof property === "number") {
    return [property];
  }
  if (property === null || property === undefined || property === "") {
    return [];
  }
  if (Array.isArray(property)) {
    return property;
  }
  return [property];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasPath(value: unknown, path: string): boolean {
  const parts = path.split(".");
  let current: unknown = value;
  for (const part of parts) {
    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, part)) {
      return false;
    }
    current = current[part];
  }
  return true;
}

function getPath(value: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = value;
  for (const part of parts) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

/**
 * `diffPlaces.js:395-397` + `helper/unicode.js:normalize`.
 *
 * The character classes are a direct transcription of `helper/unicode.js`
 * (`CONTROL_CODES` / `ALTERNATE_SPACES` / `COMBINING_MARKS`), which is why the
 * corresponding lint rules are disabled for this block.
 */
/* eslint-disable no-control-regex, no-misleading-character-class */
function unicodeNormalize(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, " ")
    .replace(/[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE00-\uFE0F\uFE20-\uFE2F\u3099\u309A]/g, "");
}
/* eslint-enable no-control-regex, no-misleading-character-class */

function removeDiacritics(input: string): string {
  return input.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export function normalizeString(value: string): string {
  return removeDiacritics(unicodeNormalize(value)).toLowerCase().split(/[ ,-.]+/).join(" ");
}

/** `diffPlaces.js:283-312` `isPropertyDifferent`. */
export function isPropertyDifferent(
  item1: unknown,
  item2: unknown,
  prop: string,
  normalizer: (value: string) => string = normalizeString,
): boolean {
  if (!hasPath(item1, prop) && !hasPath(item2, prop)) {
    return false;
  }

  const prop1 = getArrayValue(getPath(item1, prop));
  const prop2 = getArrayValue(getPath(item2, prop));

  for (const first of prop1) {
    const firstString = getStringValue(first);
    for (const second of prop2) {
      const secondString = getStringValue(second);
      if (normalizer(firstString) === normalizer(secondString)) {
        return false;
      }
    }
  }
  return true;
}

/** `diffPlaces.js:31-47` `isLayerDifferent`. */
export function isLayerDifferent(item1: PeliasDedupeDocument, item2: PeliasDedupeDocument): boolean {
  if (isPropertyDifferent(item1, item2, "layer")) {
    if (
      (item1.layer === "venue" || !CANONICAL_LAYERS.has(item1.layer)) &&
      (item2.layer === "venue" || !CANONICAL_LAYERS.has(item2.layer))
    ) {
      return false;
    }
    if (layerPreferences.includes(item1.layer) && layerPreferences.includes(item2.layer)) {
      return false;
    }
    return true;
  }
  return false;
}

/** `diffPlaces.js:49-54` `isCountryCode`. */
function isCountryCode(item: PeliasDedupeDocument, code: string): boolean {
  const parent = item.parent;
  return getStringValue(parent?.country_a) === code;
}

function isUsState(item: PeliasDedupeDocument): boolean {
  return isCountryCode(item, "USA") && item.layer === "region";
}

/**
 * `diffPlaces.js:59-77` `isGeonamesWithSelfParent`. Roamlog never ingests
 * GeoNames, so the special case cannot trigger.
 */
function isGeonamesWithSelfParent(item: PeliasDedupeDocument, placeType: string): boolean {
  if (item.source !== "geonames") {
    return false;
  }
  if (item.layer !== placeType) {
    return false;
  }
  if (!item.parent) {
    return false;
  }
  const parentRecords = getArrayValue(item.parent[`${placeType}_id`]);
  const sourceId = item.source_id;
  return parentRecords.some((value) => value === sourceId);
}

/** `diffPlaces.js:320-328` `getPlaceTypeRank`. */
function getPlaceTypeRank(item: PeliasDedupeDocument): number {
  const rank = placeTypes.findIndex((placeType) => placeType === item.layer);
  return rank > -1 ? rank : Number.POSITIVE_INFINITY;
}

/** `diffPlaces.js:103-181` `isParentHierarchyDifferent`. */
export function isParentHierarchyDifferent(
  item1: PeliasDedupeDocument,
  item2: PeliasDedupeDocument,
): boolean {
  let parent1 = item1.parent;
  let parent2 = item2.parent;

  const isPojo1 = isPlainObject(parent1);
  const isPojo2 = isPlainObject(parent2);
  if (!isPojo1 && !isPojo2) {
    return false;
  }
  if (!isPojo1 || !isPojo2) {
    return false;
  }

  if (isUsState(item1) || isUsState(item2)) {
    if (!isUsState(item1) || !isUsState(item2)) {
      return true;
    }
  }

  if (item1.layer === "postalcode" && item2.layer === "postalcode") {
    parent1 = {
      country_id: parent1?.country_id,
      dependency_id: parent1?.dependency_id,
    };
    parent2 = {
      country_id: parent2?.country_id,
      dependency_id: parent2?.dependency_id,
    };
  }

  const rank1 = getPlaceTypeRank(item1);
  const rank2 = getPlaceTypeRank(item2);
  const maxRank = rank1 === rank2 && rank1 !== Number.POSITIVE_INFINITY ? rank1 - 1 : Math.min(rank1, rank2);

  return placeTypes.some((placeType, rank) => {
    if (rank > maxRank) {
      return false;
    }
    if (isGeonamesWithSelfParent(item1, placeType) || isGeonamesWithSelfParent(item2, placeType)) {
      return false;
    }
    return isPropertyDifferent(parent1, parent2, `${placeType}_id`);
  });
}

/** `diffPlaces.js:330-390` `layerDependentNormalization`. */
export function layerDependentNormalization(
  names: Record<string, string | string[]>,
  layer: string | undefined,
): Record<string, string | string[]> {
  if (!isPlainObject(names) || typeof layer !== "string") {
    return names;
  }

  const copy: Record<string, string | string[]> = { ...names };

  const mapNames = (patterns: readonly [RegExp, string][]): void => {
    for (const [language, value] of Object.entries(names)) {
      copy[language] = getArrayValue(value).map((name) => {
        if (typeof name !== "string") {
          return String(name);
        }
        let result = name;
        for (const [pattern, replacement] of patterns) {
          result = result.replace(pattern, replacement);
        }
        return result.trim();
      });
    }
  };

  if (layer === "region") {
    mapNames([
      [/^state\sof(?!\s?the)\s?(.*)$/i, "$1"],
      [/^(.*)\sstate$/i, "$1"],
    ]);
  }
  if (layer === "county") {
    mapNames([
      [/^county\sof(?!\s?the)\s?(.*)$/i, "$1"],
      [/^(.*)\scounty$/i, "$1"],
    ]);
  }
  if (layer === "locality" || layer === "localadmin") {
    mapNames([
      [/^city\sof(?!\s?the)\s?(.*)$/i, "$1"],
      [/^(.*)\scity$/i, "$1"],
      [/^town\sof(?!\s?the)\s?(.*)$/i, "$1"],
      [/^(.*)\stown$/i, "$1"],
      [/^township\sof(?!\s?the)\s?(.*)$/i, "$1"],
      [/^(.*)\stownship$/i, "$1"],
    ]);
  }

  return copy;
}

/** `diffPlaces.js:186-227` `isNameDifferent`. */
export function isNameDifferent(
  item1: PeliasDedupeDocument,
  item2: PeliasDedupeDocument,
  requestLanguage?: string,
): boolean {
  const names1 = item1.name;
  const names2 = item2.name;

  const isPojo1 = isPlainObject(names1);
  const isPojo2 = isPlainObject(names2);
  if (!isPojo1 && !isPojo2) {
    return false;
  }
  if (!isPojo1 || !isPojo2) {
    return false;
  }

  const normalized1 = layerDependentNormalization(names1, item1.layer);
  const normalized2 = layerDependentNormalization(names2, item2.layer);

  for (const language of Object.keys(normalized2)) {
    if (!isPropertyDifferent({ [language]: normalized1.default }, normalized2, language)) {
      return false;
    }
    if (
      requestLanguage &&
      !isPropertyDifferent({ [language]: normalized1[requestLanguage] }, normalized2, language)
    ) {
      return false;
    }
  }

  for (const language of Object.keys(normalized1)) {
    if (!isPropertyDifferent({ [language]: normalized2.default }, normalized1, language)) {
      return false;
    }
    if (
      requestLanguage &&
      !isPropertyDifferent({ [language]: normalized2[requestLanguage] }, normalized1, language)
    ) {
      return false;
    }
  }

  return true;
}

/** `diffPlaces.js:258-279` `isZipDifferent`. */
function isZipDifferent(item1: PeliasDedupeDocument, item2: PeliasDedupeDocument): boolean {
  if (isCountryCode(item1, "USA") && isCountryCode(item2, "USA")) {
    const firstWordOnly = (value: string): string => {
      const first = normalizeString(value).split(" ")[0];
      return first ?? "";
    };
    return isPropertyDifferent(item1.address_parts, item2.address_parts, "zip", firstWordOnly);
  }
  return isPropertyDifferent(item1.address_parts, item2.address_parts, "zip");
}

/** `diffPlaces.js:232-256` `isAddressDifferent`. */
export function isAddressDifferent(
  item1: PeliasDedupeDocument,
  item2: PeliasDedupeDocument,
): boolean {
  const address1 = item1.address_parts;
  const address2 = item2.address_parts;

  const isPojo1 = isPlainObject(address1);
  const isPojo2 = isPlainObject(address2);
  if (!isPojo1 && !isPojo2) {
    return false;
  }
  if (!isPojo1 || !isPojo2) {
    return false;
  }

  if (isPropertyDifferent(address1, address2, "number")) {
    return true;
  }
  if (isPropertyDifferent(address1, address2, "street")) {
    return true;
  }
  if (hasPath(address1, "zip") && hasPath(address2, "zip")) {
    if (isZipDifferent(item1, item2)) {
      return true;
    }
  }
  return false;
}

/**
 * `diffPlaces.js:146-176` `isGeonamesConcordanceSame`: only WOF documents carry
 * the decoded `gn:id` concordance, and Roamlog has none.
 */
function isGeonamesConcordanceSame(
  _item1: PeliasDedupeDocument,
  _item2: PeliasDedupeDocument,
): boolean {
  return false;
}

/** `diffPlaces.js:252-394` `isDifferent`. */
export function isDifferent(
  item1: PeliasDedupeDocument,
  item2: PeliasDedupeDocument,
  requestLanguage?: string,
): boolean {
  if (isGeonamesConcordanceSame(item1, item2)) {
    return false;
  }
  if (isLayerDifferent(item1, item2)) {
    return true;
  }
  if (isParentHierarchyDifferent(item1, item2)) {
    return true;
  }
  if (isNameDifferent(item1, item2, requestLanguage)) {
    return true;
  }
  if (isAddressDifferent(item1, item2)) {
    return true;
  }
  return false;
}

/** `dedupe.js:67-103` `isPreferred` (second argument preferred when true). */
export function isPreferred(
  existingHit: PeliasDedupeDocument,
  candidateHit: PeliasDedupeDocument,
): boolean {
  if (!hasPath(existingHit, "address_parts.zip") && hasPath(candidateHit, "address_parts.zip")) {
    return true;
  }
  if (hasPath(existingHit, "address_parts.zip") && !hasPath(candidateHit, "address_parts.zip")) {
    return false;
  }

  if (
    !CANONICAL_SOURCES.includes(candidateHit.source) &&
    CANONICAL_SOURCES.includes(existingHit.source)
  ) {
    return true;
  }

  if (existingHit.layer !== candidateHit.layer) {
    for (const preferred of layerPreferences) {
      if (existingHit.layer === preferred) {
        return false;
      }
      if (candidateHit.layer === preferred) {
        return true;
      }
    }
  }

  if (existingHit.source !== candidateHit.source) {
    const existingRank = SOURCE_PREFERENCE[existingHit.source] ?? 99;
    const candidateRank = SOURCE_PREFERENCE[candidateHit.source] ?? 99;
    if (existingRank !== candidateRank) {
      return candidateRank < existingRank;
    }
  }

  return false;
}

/** `dedupe.js:15-64` `dedupeResults`, returning a new array. */
export function dedupeDocuments<T extends PeliasDedupeDocument>(
  documents: readonly T[],
  requestLanguage?: string,
): T[] {
  if (documents.length === 0) {
    return [];
  }

  const inferior = new Set<T>();
  const superior = new Set<T>();

  for (let i = 0; i < documents.length; i += 1) {
    const current = documents[i];
    if (current === undefined) {
      continue;
    }
    for (let j = i + 1; j < documents.length; j += 1) {
      const candidate = documents[j];
      if (candidate === undefined || isDifferent(current, candidate, requestLanguage)) {
        continue;
      }
      const preference = isPreferred(current, candidate);
      superior.add(preference ? candidate : current);
      inferior.add(preference ? current : candidate);
    }
    superior.add(current);
  }

  return Array.from(superior).filter((document) => !inferior.has(document));
}

export { getStringValue };
