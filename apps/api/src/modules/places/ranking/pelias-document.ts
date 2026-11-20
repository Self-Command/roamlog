import type { Place } from "@roamlog/contracts";
import { createHash } from "node:crypto";
import { Document } from "pelias-model";

/**
 * Pelias `Document` adapter.
 *
 * Upstream: `pelias/model@583b91a415b90fa3cfabdcc51604c26098ebe2ab/Document.js:70-185`
 * (source / layer / source_id / name / parent / address_parts / center_point /
 * bounding_box / population / popularity / category). The class is consumed
 * directly from `pelias-model@11.1.0`; nothing from that file is copied.
 *
 * 【适配层，本仓库原创】The provider → `Document` field mapping below is ours:
 * Pelias gets its documents from importers (OpenStreetMap / OpenAddresses /
 * Who's on First / GeoNames), while Roamlog receives provider JSON at request
 * time, so the mapping has to live here. Field names and semantics follow
 * `pelias/documentation/search.md:341-363` and the layer tables in the task
 * spec §5.4.1–§5.4.3. No place-name list is involved: every decision reads a
 * provider enum (`level`, `result_type`, `type`, `osm_value`, `adcode`).
 */

export type PeliasSource = "tencent" | "geoapify" | "photon";

/** Pelias layers, ordered from finest to coarsest in `search.md:341-363`. */
export type PeliasLayer =
  | "venue"
  | "address"
  | "street"
  | "neighbourhood"
  | "borough"
  | "postalcode"
  | "locality"
  | "localadmin"
  | "county"
  | "macrocounty"
  | "region"
  | "macroregion"
  | "dependency"
  | "country"
  | "other";

export type MatchType = "exact" | "fallback" | "unknown";
export type Accuracy = "point" | "centroid";

export interface TencentCandidate {
  readonly source: "tencent";
  readonly place: Place;
  /** Zero-based position inside this provider's answer. */
  readonly providerRank: number;
  readonly level?: number;
  readonly adcode?: string;
  readonly category?: string;
  /** `place/v1/suggestion` `type` (0 POI / 4 administrative division). */
  readonly sourceType?: number;
  readonly province?: string;
  readonly city?: string;
  readonly district?: string;
  readonly street?: string;
  readonly streetNumber?: string;
}

export interface GeoapifyCandidate {
  readonly source: "geoapify";
  readonly place: Place;
  readonly providerRank: number;
  /** `properties.rank.confidence`, the documented 0–1 provider score. */
  readonly providerConfidence?: number;
  readonly resultType?: string;
  readonly country?: string;
  readonly state?: string;
  readonly county?: string;
  readonly city?: string;
  readonly suburb?: string;
  readonly district?: string;
  readonly street?: string;
  readonly housenumber?: string;
  readonly postcode?: string;
}

export interface PhotonCandidate {
  readonly source: "photon";
  readonly place: Place;
  readonly providerRank: number;
  readonly type?: string;
  readonly osmValue?: string;
  readonly osmKey?: string;
  readonly population?: number;
  readonly country?: string;
  readonly state?: string;
  readonly county?: string;
  readonly city?: string;
  readonly district?: string;
  readonly street?: string;
  readonly housenumber?: string;
  readonly postcode?: string;
}

export type ProviderCandidate = TencentCandidate | GeoapifyCandidate | PhotonCandidate;

/** A ranked Pelias document plus the contract `Place` it came from. */
export interface PeliasHit {
  readonly document: Document;
  readonly place: Place;
  readonly candidate: ProviderCandidate;
  /** The Pelias layer, mirrored here so filtering does not re-open the Document. */
  readonly layer: PeliasLayer;
  /** `_score` proxy: Geoapify `rank.confidence`, otherwise `1 / (1 + rank)`. */
  readonly score: number;
  confidence?: number;
  /** `confidenceScoreFallback.js` value, used only for the `degraded` rule. */
  fallbackConfidence?: number;
  matchType?: MatchType;
  accuracy?: Accuracy;
}

/**
 * Tencent `geocoder/v1` `level` → Pelias layer (spec §5.4.1, `level` table from
 * https://lbs.qq.com/service/webService/webServiceGuide/address/Geocoder).
 * `level=0` means "cannot determine, result untrustworthy" and is discarded.
 */
const TENCENT_LEVEL_LAYER: Readonly<Record<number, PeliasLayer>> = Object.freeze({
  1: "locality",
  2: "localadmin",
  3: "localadmin",
  4: "neighbourhood",
  5: "localadmin",
  6: "neighbourhood",
  7: "street",
  8: "street",
  9: "address",
  10: "venue",
  11: "venue",
}) as Readonly<Record<number, PeliasLayer>>;

export function tencentLayerForLevel(level: number | undefined): PeliasLayer | undefined {
  if (level === undefined) {
    return undefined;
  }
  if (level === 0) {
    return undefined;
  }
  return TENCENT_LEVEL_LAYER[level] ?? (level >= 21 ? "venue" : "other");
}

/**
 * `place/v1/suggestion` `type=4` has no `level`; the adcode rule below is the
 * documented 6-digit structure (2 province + 2 city + 2 district), spec §5.4.1.
 */
export function tencentSuggestionLayer(input: {
  readonly sourceType: number | undefined;
  readonly adcode?: string;
  readonly province?: string;
  readonly city?: string;
  readonly title?: string;
}): PeliasLayer {
  if (input.sourceType !== 4) {
    return "venue";
  }
  if (
    input.province !== undefined &&
    input.city !== undefined &&
    input.title !== undefined &&
    input.province === input.city &&
    input.city === input.title
  ) {
    // Municipalities: 北京/上海/天津/重庆 repeat the name at every level.
    return "locality";
  }
  const adcode = input.adcode !== undefined ? Number.parseInt(input.adcode, 10) : Number.NaN;
  if (!Number.isInteger(adcode) || adcode <= 0) {
    return "localadmin";
  }
  if (adcode % 10_000 === 0) {
    return "region";
  }
  if (adcode % 100 === 0) {
    return "locality";
  }
  return "localadmin";
}

/** Geoapify `result_type` → Pelias layer (spec §5.4.2). */
export function geoapifyLayer(resultType: string | undefined): PeliasLayer {
  switch (resultType) {
    case "country":
      return "country";
    case "state":
      return "region";
    case "county":
      return "county";
    case "city":
      return "locality";
    case "suburb":
    case "district":
      return "neighbourhood";
    case "street":
      return "street";
    case "postcode":
      return "postalcode";
    case "amenity":
    case "shop":
    case "tourism":
    case "building":
      return "venue";
    default:
      return "other";
  }
}

/** Photon `type` / `osm_value` → Pelias layer (spec §5.4.3). */
export function photonLayer(input: {
  readonly type?: string;
  readonly osmValue?: string;
  readonly hasHousenumber: boolean;
}): PeliasLayer {
  const candidate = input.type ?? input.osmValue;
  switch (candidate) {
    case "country":
      return "country";
    case "state":
      return "region";
    case "county":
      return "county";
    case "city":
      return "locality";
    case "district":
      return "neighbourhood";
    case "locality":
      return "locality";
    case "street":
      return "street";
    case "house":
      return input.hasHousenumber ? "address" : "venue";
    case "other":
      return "other";
    default:
      return "other";
  }
}

export function candidateLayer(candidate: ProviderCandidate): PeliasLayer | undefined {
  switch (candidate.source) {
    case "tencent":
      if (candidate.level !== undefined) {
        return tencentLayerForLevel(candidate.level);
      }
      return tencentSuggestionLayer({
        sourceType: candidate.sourceType,
        ...(candidate.adcode === undefined ? {} : { adcode: candidate.adcode }),
        ...(candidate.province === undefined ? {} : { province: candidate.province }),
        ...(candidate.city === undefined ? {} : { city: candidate.city }),
        title: candidate.place.name,
      });
    case "geoapify":
      return geoapifyLayer(candidate.resultType);
    case "photon":
      return photonLayer({
        ...(candidate.type === undefined ? {} : { type: candidate.type }),
        ...(candidate.osmValue === undefined ? {} : { osmValue: candidate.osmValue }),
        hasHousenumber: candidate.housenumber !== undefined,
      });
  }
}

interface CandidateParents {
  readonly country?: string;
  readonly region?: string;
  readonly locality?: string;
  readonly localadmin?: string;
  readonly neighbourhood?: string;
}

function parentsOf(candidate: ProviderCandidate): CandidateParents {
  switch (candidate.source) {
    case "tencent":
      return {
        country: candidate.place.country,
        ...(candidate.province === undefined ? {} : { region: candidate.province }),
        ...(candidate.city === undefined ? {} : { locality: candidate.city }),
        ...(candidate.district === undefined ? {} : { localadmin: candidate.district }),
        ...(candidate.district === undefined || candidateLayer(candidate) !== "neighbourhood"
          ? {}
          : { neighbourhood: candidate.district }),
      };
    case "geoapify":
      return {
        country: candidate.country ?? candidate.place.country,
        ...(candidate.state === undefined ? {} : { region: candidate.state }),
        ...(candidate.city === undefined ? {} : { locality: candidate.city }),
        ...(candidate.county === undefined ? {} : { localadmin: candidate.county }),
        ...(candidate.suburb === undefined ? {} : { neighbourhood: candidate.suburb }),
      };
    case "photon":
      return {
        country: candidate.country ?? candidate.place.country,
        ...(candidate.state === undefined ? {} : { region: candidate.state }),
        ...(candidate.city === undefined ? {} : { locality: candidate.city }),
        ...(candidate.county === undefined ? {} : { localadmin: candidate.county }),
        ...(candidate.district === undefined || candidateLayer(candidate) !== "neighbourhood"
          ? {}
          : { neighbourhood: candidate.district }),
      };
  }
}

function addressPartsOf(candidate: ProviderCandidate): {
  readonly number?: string;
  readonly street?: string;
  readonly zip?: string;
} {
  switch (candidate.source) {
    case "tencent":
      return {
        ...(candidate.streetNumber === undefined ? {} : { number: candidate.streetNumber }),
        ...(candidate.street === undefined ? {} : { street: candidate.street }),
      };
    case "geoapify":
      return {
        ...(candidate.housenumber === undefined ? {} : { number: candidate.housenumber }),
        ...(candidate.street === undefined ? {} : { street: candidate.street }),
        ...(candidate.postcode === undefined ? {} : { zip: candidate.postcode }),
      };
    case "photon":
      return {
        ...(candidate.housenumber === undefined ? {} : { number: candidate.housenumber }),
        ...(candidate.street === undefined ? {} : { street: candidate.street }),
        ...(candidate.postcode === undefined ? {} : { zip: candidate.postcode }),
      };
  }
}

/**
 * Stable source id for providers that do not expose one (Tencent's forward
 * geocoder). `Document` requires a non-empty `source_id`; hashing the normalized
 * identity keeps two searches of the same place on the same id without inventing
 * a provider identifier.
 */
function sourceIdFor(candidate: ProviderCandidate): string {
  if (candidate.place.providerPlaceId !== null) {
    return candidate.place.providerPlaceId;
  }
  const identity = [
    candidate.source,
    candidate.place.name,
    candidate.place.lat.toFixed(6),
    candidate.place.lng.toFixed(6),
  ].join("|");
  return `roamlog-${createHash("sha1").update(identity, "utf8").digest("hex").slice(0, 20)}`;
}

function parentId(source: PeliasSource, field: string, value: string): string {
  return `${source}:${field}:${value.trim().toLowerCase()}`;
}

/**
 * Builds the Pelias `Document` for one provider candidate.
 *
 * `Document.setBoundingBox` expects `{ upperLeft, lowerRight }`
 * (`pelias/model/util/transform.js:toULLR`), so the contract's
 * `[west, south, east, north]` tuple is re-shaped here.
 */
export function buildPeliasDocument(candidate: ProviderCandidate): Document {
  const layer = candidateLayer(candidate);
  if (layer === undefined) {
    throw new Error(`Candidate ${candidate.source}:${candidate.place.name} has no usable layer`);
  }

  const document = new Document(candidate.source, layer, sourceIdFor(candidate));
  document.setName("default", candidate.place.name);

  const parents = parentsOf(candidate);
  const countryCode = candidate.place.countryCode;
  if (parents.country !== undefined) {
    document.addParent(
      "country",
      parents.country,
      parentId(candidate.source, "country", parents.country),
      countryCode,
    );
  }
  if (parents.region !== undefined) {
    document.addParent("region", parents.region, parentId(candidate.source, "region", parents.region));
  }
  if (parents.locality !== undefined) {
    document.addParent(
      "locality",
      parents.locality,
      parentId(candidate.source, "locality", parents.locality),
    );
  }
  if (parents.localadmin !== undefined) {
    document.addParent(
      "localadmin",
      parents.localadmin,
      parentId(candidate.source, "localadmin", parents.localadmin),
    );
  }
  if (parents.neighbourhood !== undefined) {
    document.addParent(
      "neighbourhood",
      parents.neighbourhood,
      parentId(candidate.source, "neighbourhood", parents.neighbourhood),
    );
  }

  const address = addressPartsOf(candidate);
  if (address.number !== undefined) {
    document.setAddress("number", address.number);
  }
  if (address.street !== undefined) {
    document.setAddress("street", address.street);
  }
  if (address.zip !== undefined) {
    document.setAddress("zip", address.zip);
  }

  document.setCentroid({ lat: candidate.place.lat, lon: candidate.place.lng });

  const bbox = candidate.place.bbox;
  if (bbox !== null) {
    document.setBoundingBox({
      upperLeft: { lat: bbox[3], lon: bbox[0] },
      lowerRight: { lat: bbox[1], lon: bbox[2] },
    });
  }

  if (candidate.source === "photon" && candidate.population !== undefined) {
    document.setPopulation(candidate.population);
  }
  // `rank.importance` (Geoapify) is used only as the `_score` proxy, never as
  // Pelias `popularity`/`population` (spec §5.4 hard rule).

  const category =
    candidate.source === "tencent"
      ? candidate.category
      : candidate.source === "photon"
        ? candidate.osmKey
        : candidate.resultType;
  if (category !== undefined && category.length > 0) {
    document.addCategory(category);
  }

  return document;
}

/**
 * Builds the sortable hit. `_score` is attached to the Document itself because
 * `pelias-sorting/index.js` reads `result._score` directly.
 */
export function buildPeliasHit(candidate: ProviderCandidate, score: number): PeliasHit {
  const layer = candidateLayer(candidate);
  if (layer === undefined) {
    throw new Error(`Candidate ${candidate.source}:${candidate.place.name} has no usable layer`);
  }
  const document = buildPeliasDocument(candidate);
  (document as Document & { _score: number })._score = score;
  return { document, place: candidate.place, candidate, layer, score };
}
