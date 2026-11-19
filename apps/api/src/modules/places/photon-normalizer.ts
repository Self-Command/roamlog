import { PlaceSchema, type Place, type PlaceBbox, type PlaceType } from "@roamlog/contracts";

/**
 * Photon returns GeoJSON FeatureCollections. This module converts the subset we
 * accept into the strict `Place` contract.
 *
 * Rules:
 * - Only `name`, `country`, `countrycode` and point coordinates are required.
 *   An entry missing any of them is dropped instead of being filled with
 *   placeholders.
 * - `provider` is always `"photon"`; manual (`"local"`) places are created by
 *   the client when it submits a Stop, never by search.
 * - Photon carries no time zone, so `timeZone` is `null` ("unknown"), not a
 *   guess derived from coordinates.
 * - Photon **does** carry `street`, `housenumber` and `postcode`; they are
 *   composed into `address` instead of being discarded.
 * - Photon's `extent` is `[west, north, east, south]` (not GeoJSON order), so it
 *   is re-ordered to the contract's `[west, south, east, north]`.
 */

export class PhotonPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotonPayloadError";
  }
}

const MAX_NAME_LENGTH = 200;
const MAX_COUNTRY_LENGTH = 120;
const MAX_ADDRESS_LENGTH = 500;
const MAX_PROVIDER_PLACE_ID_LENGTH = 200;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
}

function countryCode(value: unknown): string | undefined {
  const normalized = boundedText(value, 8)?.toUpperCase();
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
}

function pointCoordinate(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

function osmIdentifier(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^\d{1,20}$/.test(trimmed) ? trimmed : undefined;
  }
  return undefined;
}

function providerPlaceId(osmType: unknown, osmId: unknown): string | null {
  const type = boundedText(osmType, 4)?.toUpperCase();
  const id = osmIdentifier(osmId);
  if (!type || !/^[A-Z]{1,4}$/.test(type) || !id) {
    return null;
  }
  const value = `${type}:${id}`;
  return value.length <= MAX_PROVIDER_PLACE_ID_LENGTH ? value : null;
}

/**
 * Composes the address Photon already sends. Returns `null` when no street,
 * house number, postcode or city is present: a country/state alone is not an
 * address, so nothing is invented.
 */
function formattedAddress(properties: Record<string, unknown>): string | null {
  const housenumber = boundedText(properties.housenumber, 40);
  const street = boundedText(properties.street, 160);
  const postcode = boundedText(properties.postcode, 20);
  const city = boundedText(properties.city, 120);
  const state = boundedText(properties.state, 120);
  const country = boundedText(properties.country, MAX_COUNTRY_LENGTH);

  const line1 = [housenumber, street].filter((part): part is string => Boolean(part)).join(" ");
  const line2 = [postcode, city].filter((part): part is string => Boolean(part)).join(" ");
  if (!line1 && !line2) {
    return null;
  }

  const joined = [line1, line2, state, country]
    .filter((part): part is string => Boolean(part))
    .join(", ");
  return joined.length <= MAX_ADDRESS_LENGTH ? joined : null;
}

/**
 * Photon documents `extent` as `[minLon, maxLat, maxLon, minLat]`
 * (`[west, north, east, south]`). Re-order it to the contract's
 * `[west, south, east, north]` and reject inconsistent boxes.
 */
function bboxFromExtent(value: unknown): PlaceBbox | null {
  if (!Array.isArray(value) || value.length !== 4) {
    return null;
  }
  const west = pointCoordinate(value[0], -180, 180);
  const north = pointCoordinate(value[1], -90, 90);
  const east = pointCoordinate(value[2], -180, 180);
  const south = pointCoordinate(value[3], -90, 90);
  if (west === undefined || south === undefined || east === undefined || north === undefined) {
    return null;
  }
  return west <= east && south <= north ? [west, south, east, north] : null;
}

function importance(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function placeType(candidate: string | undefined, osmKey: string | undefined): PlaceType {
  switch (candidate) {
    case "country":
      return "country";
    case "state":
    case "region":
    case "county":
    case "state_district":
      return "region";
    case "city":
    case "town":
    case "village":
    case "locality":
    case "district":
    case "borough":
    case "suburb":
    case "hamlet":
    case "municipality":
      return "city";
    case "house":
    case "street":
    case "poi":
      return "poi";
    default:
      break;
  }

  if (candidate === undefined || candidate === "other") {
    return osmKey && osmKey !== "place" ? "poi" : "other";
  }
  return "other";
}

/**
 * Normalizes a single Photon feature. Returns `null` when the feature cannot be
 * expressed as a contract-valid `Place` without inventing data.
 */
export function normalizePhotonFeature(feature: unknown): Place | null {
  const featureRecord = asRecord(feature);
  const properties = asRecord(featureRecord?.properties);
  const geometry = asRecord(featureRecord?.geometry);
  if (!properties || !geometry) {
    return null;
  }

  const name = boundedText(properties.name, MAX_NAME_LENGTH);
  const country = boundedText(properties.country, MAX_COUNTRY_LENGTH);
  const code = countryCode(properties.countrycode);
  const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : undefined;
  const lng = pointCoordinate(coordinates?.[0], -180, 180);
  const lat = pointCoordinate(coordinates?.[1], -90, 90);
  if (!name || !country || !code || lat === undefined || lng === undefined) {
    return null;
  }

  const upstreamType = boundedText(properties.type, 40)?.toLowerCase();
  const osmValue = boundedText(properties.osm_value, 40)?.toLowerCase();
  const osmKey = boundedText(properties.osm_key, 40)?.toLowerCase();

  const parsed = PlaceSchema.safeParse({
    provider: "photon",
    providerPlaceId: providerPlaceId(properties.osm_type, properties.osm_id),
    name,
    address: formattedAddress(properties),
    country,
    countryCode: code,
    lat,
    lng,
    timeZone: null,
    bbox: bboxFromExtent(properties.extent),
    importance: importance(properties.importance),
    type: placeType(upstreamType ?? osmValue, osmKey),
  });

  return parsed.success ? parsed.data : null;
}

/**
 * Normalizes a Photon FeatureCollection payload. Throws `PhotonPayloadError`
 * when the payload is not a FeatureCollection; individual invalid features are
 * dropped.
 */
export function normalizePhotonPayload(payload: unknown): Place[] {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.features)) {
    throw new PhotonPayloadError("Photon response is not a FeatureCollection");
  }

  const places: Place[] = [];
  for (const feature of record.features) {
    const place = normalizePhotonFeature(feature);
    if (place) {
      places.push(place);
    }
  }
  return places;
}
