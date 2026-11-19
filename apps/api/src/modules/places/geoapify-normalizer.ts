import {
  IanaTimeZoneSchema,
  PlaceSchema,
  type Place,
  type PlaceBbox,
  type PlaceType,
} from "@roamlog/contracts";

/**
 * Normalizes a Geoapify `v1/geocode/autocomplete` FeatureCollection into the
 * strict `Place` contract.
 *
 * Rules (verified against the live API on 2026-11-19):
 * - `place_id`, a valid point and a display name/country are required. An entry
 *   missing any of them is dropped instead of being filled with placeholders.
 * - `country_code` is lowercase upstream (`jp`) and uppercased here.
 * - `properties.timezone.name` is copied as-is after IANA validation; Geoapify
 *   really returns `Asia/Tokyo`.
 * - Geoapify's **feature-level `bbox` is `[west, south, east, north]`**
 *   (verified: `[135.6081441, 34.8515754, 135.9281441, 35.1715754]` for Kyoto).
 *   `properties.bbox` uses the equivalent `{lon1, lat1, lon2, lat2}` object.
 *   Both are normalized to the contract order `[west, south, east, north]`.
 * - `rank.importance` is optional upstream (present for cities, absent for
 *   counties); it stays `null` when absent.
 * - `result_type` is mapped with an explicit allowlist; unknown values become
 *   `"other"` rather than being guessed.
 */

export class GeoapifyPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeoapifyPayloadError";
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

function coordinate(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

function importance(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function timeZone(value: unknown): string | null {
  const name = asRecord(value)?.name;
  if (typeof name !== "string") {
    return null;
  }
  return IanaTimeZoneSchema.safeParse(name).success ? name : null;
}

/**
 * Validates a raw four-number box in `[west, south, east, north]` order.
 * Returns `null` for anything inconsistent so a bad upstream box never reaches
 * the contract.
 */
function bboxFrom(values: readonly unknown[]): PlaceBbox | null {
  if (values.length !== 4) {
    return null;
  }
  const west = coordinate(values[0], -180, 180);
  const south = coordinate(values[1], -90, 90);
  const east = coordinate(values[2], -180, 180);
  const north = coordinate(values[3], -90, 90);
  if (west === undefined || south === undefined || east === undefined || north === undefined) {
    return null;
  }
  return west <= east && south <= north ? [west, south, east, north] : null;
}

function placeBbox(feature: Record<string, unknown>, properties: Record<string, unknown>) {
  if (Array.isArray(feature.bbox)) {
    const fromFeature = bboxFrom(feature.bbox);
    if (fromFeature) {
      return fromFeature;
    }
  }

  const propertyBbox = asRecord(properties.bbox);
  if (propertyBbox) {
    return bboxFrom([
      propertyBbox.lon1,
      propertyBbox.lat1,
      propertyBbox.lon2,
      propertyBbox.lat2,
    ]);
  }
  return null;
}

function formattedAddress(properties: Record<string, unknown>): string | null {
  const formatted = boundedText(properties.formatted, MAX_ADDRESS_LENGTH);
  if (formatted) {
    return formatted;
  }
  const line1 = boundedText(properties.address_line1, MAX_ADDRESS_LENGTH);
  const line2 = boundedText(properties.address_line2, MAX_ADDRESS_LENGTH);
  const joined = [line1, line2].filter((part): part is string => Boolean(part)).join(", ");
  return joined.length > 0 && joined.length <= MAX_ADDRESS_LENGTH ? joined : null;
}

/**
 * `result_type` allowlist. `street` intentionally maps to `poi`: the contract
 * has no `street` type yet, and a street-level hit is still a searchable place
 * rather than a "city" or a bare "other".
 */
function placeType(resultType: string | undefined): PlaceType {
  switch (resultType) {
    case "country":
      return "country";
    case "state":
    case "county":
      return "region";
    case "city":
    case "suburb":
    case "district":
      return "city";
    case "amenity":
    case "shop":
    case "tourism":
    case "building":
    case "street":
      return "poi";
    default:
      return "other";
  }
}

/**
 * Normalizes a single Geoapify feature. Returns `null` when the feature cannot
 * be expressed as a contract-valid `Place` without inventing data.
 */
export function normalizeGeoapifyFeature(feature: unknown): Place | null {
  const featureRecord = asRecord(feature);
  const properties = asRecord(featureRecord?.properties);
  const geometry = asRecord(featureRecord?.geometry);
  if (!featureRecord || !properties) {
    return null;
  }

  const providerPlaceId = boundedText(properties.place_id, MAX_PROVIDER_PLACE_ID_LENGTH);
  if (!providerPlaceId) {
    return null;
  }

  const geometryCoordinates = Array.isArray(geometry?.coordinates)
    ? geometry.coordinates
    : undefined;
  const lng =
    coordinate(geometryCoordinates?.[0], -180, 180) ?? coordinate(properties.lon, -180, 180);
  const lat =
    coordinate(geometryCoordinates?.[1], -90, 90) ?? coordinate(properties.lat, -90, 90);
  if (lat === undefined || lng === undefined) {
    return null;
  }

  const name = boundedText(properties.name, MAX_NAME_LENGTH);
  const country = boundedText(properties.country, MAX_COUNTRY_LENGTH);
  const code = countryCode(properties.country_code);
  if (!name || !country || !code) {
    return null;
  }

  const parsed = PlaceSchema.safeParse({
    provider: "geoapify",
    providerPlaceId,
    name,
    address: formattedAddress(properties),
    country,
    countryCode: code,
    lat,
    lng,
    timeZone: timeZone(properties.timezone),
    bbox: placeBbox(featureRecord, properties),
    importance: importance(asRecord(properties.rank)?.importance),
    type: placeType(boundedText(properties.result_type, 40)?.toLowerCase()),
  });

  return parsed.success ? parsed.data : null;
}

/**
 * Normalizes a Geoapify FeatureCollection payload. Throws `GeoapifyPayloadError`
 * when the payload is not a FeatureCollection; individual invalid features are
 * dropped.
 */
export function normalizeGeoapifyPayload(payload: unknown): Place[] {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.features)) {
    throw new GeoapifyPayloadError("Geoapify response is not a FeatureCollection");
  }

  const places: Place[] = [];
  for (const feature of record.features) {
    const place = normalizeGeoapifyFeature(feature);
    if (place) {
      places.push(place);
    }
  }
  return places;
}