import { PlaceSchema, type Place, type PlaceType } from "@roamlog/contracts";
import gcoord from "gcoord";

/**
 * Normalizes Tencent Map WebService payloads into the strict `Place` contract.
 *
 * Ported from the official documentation (no invented fields):
 * - 关键词输入提示 `place/v1/suggestion`
 *   https://lbs.qq.com/service/webService/webServiceGuide/webServiceSuggestion
 * - 地址解析 `geocoder/v1?address=` and 逆地址解析 `geocoder/v1?location=`
 *   https://lbs.qq.com/service/webService/webServiceGuide/webServiceGeocoder
 *
 * Rules:
 * - Field names follow the documentation verbatim: `title` → `name`,
 *   `address` → `address`, `location.{lat,lng}` → `lat`/`lng`.
 * - **Tencent returns GCJ-02** ("解析到的坐标（GCJ02坐标系）"), while Roamlog
 *   stores WGS-84. Every coordinate therefore goes through
 *   `gcoord.transform(..., GCJ02, WGS84)`; no offset math is written here.
 * - `ad_info` is the documented container for `adcode`/`province`/`city`/`district`
 *   on `suggestion`; some responses carry the same keys flat on the item, so both
 *   shapes are accepted. The reverse geocoder documents `address_component`.
 * - Tencent is a mainland-China source, so `country`/`countryCode` are fixed to
 *   `中国`/`CN` (the response never carries a country field).
 * - `timeZone`, `bbox` and `importance` have no counterpart in these responses and
 *   stay `null` instead of being guessed.
 */

export class TencentPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TencentPayloadError";
  }
}

const MAX_NAME_LENGTH = 200;
const MAX_ADDRESS_LENGTH = 500;
const MAX_PROVIDER_PLACE_ID_LENGTH = 200;

const CHINA_COUNTRY = "中国";
const CHINA_COUNTRY_CODE = "CN";

/**
 * Tencent POI types (`suggestion`, documented values):
 * 0 普通POI / 1 公交车站 / 2 地铁站 / 3 公交线路 / 4 行政区划.
 * Only the administrative-division type has a distinct contract type today.
 */
const ADMINISTRATIVE_DIVISION_TYPE = 4;

/**
 * 地址解析精度级别 (`geocoder/v1`, documented 1–11):
 * 1 城市, 2 区县, 3 乡镇街道, 4 村社区, 5 开发区, 6 热点区域/商圈,
 * 7 道路, 8 道路附属点, 9 门址, 10 小区/大厦, 11 POI点.
 */
const LEVEL_PLACE_TYPE: Readonly<Record<number, PlaceType>> = Object.freeze({
  1: "city",
  2: "region",
  3: "region",
  4: "region",
  5: "region",
  6: "region",
  7: "other",
  8: "other",
  9: "poi",
  10: "poi",
  11: "poi",
});

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

function coordinate(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

/**
 * GCJ-02 → WGS-84 through `gcoord` (the one offset implementation we allow).
 * Returns `undefined` when the upstream point is missing or not a number.
 */
export function gcj02ToWgs84(
  location: unknown,
): { readonly lat: number; readonly lng: number } | undefined {
  const record = asRecord(location);
  const lat = coordinate(record?.lat, -90, 90);
  const lng = coordinate(record?.lng, -180, 180);
  if (lat === undefined || lng === undefined) {
    return undefined;
  }

  const converted = gcoord.transform([lng, lat], gcoord.GCJ02, gcoord.WGS84);
  const wgsLng = converted[0];
  const wgsLat = converted[1];
  if (
    typeof wgsLng !== "number" ||
    typeof wgsLat !== "number" ||
    !Number.isFinite(wgsLng) ||
    !Number.isFinite(wgsLat)
  ) {
    return undefined;
  }
  return { lat: wgsLat, lng: wgsLng };
}

function providerPlaceId(value: unknown): string | null {
  const text =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : boundedText(value, MAX_PROVIDER_PLACE_ID_LENGTH);
  return text ?? null;
}

/**
 * Tencent splits the administrative parts across `ad_info` (suggestion) and
 * `address_component` / `address_components` (geocoder); both also appear flat on
 * some responses. The first record that answers wins.
 */
function administrative(
  item: Record<string, unknown>,
  ...containers: readonly (Record<string, unknown> | undefined)[]
): Record<string, unknown> {
  for (const container of containers) {
    if (container === undefined) {
      continue;
    }
    if (
      container.province !== undefined ||
      container.city !== undefined ||
      container.district !== undefined ||
      container.adcode !== undefined
    ) {
      return container;
    }
  }
  return item;
}

function suggestionType(value: unknown): PlaceType {
  return value === ADMINISTRATIVE_DIVISION_TYPE ? "region" : "poi";
}

function geocodeType(value: unknown): PlaceType {
  return typeof value === "number" ? (LEVEL_PLACE_TYPE[value] ?? "other") : "other";
}

/** The reverse geocoder describes a coordinate, not a typed place. */
const REVERSE_PLACE_TYPE: PlaceType = "other";

/**
 * Joins the documented address parts, skipping empty ones and a part that merely
 * repeats the previous one — Tencent returns `province = city = 北京市` for the
 * municipalities, which would otherwise render as `北京市北京市朝阳区`.
 */
function composeAddress(...parts: readonly (string | undefined)[]): string | null {
  const kept: string[] = [];
  for (const part of parts) {
    if (part !== undefined && part !== kept[kept.length - 1]) {
      kept.push(part);
    }
  }
  return boundedText(kept.join(""), MAX_ADDRESS_LENGTH) ?? null;
}

/**
 * One `suggestion` entry. Returns `undefined` when the entry cannot satisfy the
 * strict contract (no usable name or no usable coordinate); one bad row must not
 * degrade a whole search.
 */
function suggestionItem(value: unknown): Place | undefined {
  const item = asRecord(value);
  if (item === undefined) {
    return undefined;
  }

  const point = gcj02ToWgs84(item.location);
  if (point === undefined) {
    return undefined;
  }

  const name = boundedText(item.title, MAX_NAME_LENGTH);
  if (name === undefined) {
    return undefined;
  }

  const ad = administrative(item, asRecord(item.ad_info));
  const province = boundedText(ad.province, MAX_NAME_LENGTH);
  const district = boundedText(ad.district, MAX_NAME_LENGTH);
  const city = boundedText(ad.city, MAX_NAME_LENGTH);
  const street = boundedText(item.address, MAX_ADDRESS_LENGTH);

  return PlaceSchema.parse({
    provider: "tencent",
    providerPlaceId: providerPlaceId(item.id),
    name,
    // The suggestion `address` is documented as 地址, and Tencent returns it
    // either as a bare street part (`建国路87号`) or already fully formatted
    // (`广东省深圳市南山区深南大道10000号`). Prepend the documented
    // province/city/district only when the upstream address does not already
    // carry them, so the stored address is never doubled.
    address:
      street !== undefined && district !== undefined && street.includes(district)
        ? street
        : composeAddress(province, city, district, street),
    country: CHINA_COUNTRY,
    countryCode: CHINA_COUNTRY_CODE,
    lat: point.lat,
    lng: point.lng,
    timeZone: null,
    bbox: null,
    importance: null,
    type: suggestionType(item.type),
  });
}

/** `place/v1/suggestion` response body → `Place[]`. */
export function normalizeTencentSuggestionPayload(payload: unknown): Place[] {
  const root = asRecord(payload);
  if (root === undefined) {
    throw new TencentPayloadError("Tencent suggestion payload is not an object");
  }
  if (!Array.isArray(root.data)) {
    throw new TencentPayloadError("Tencent suggestion payload has no data array");
  }

  const places: Place[] = [];
  for (const entry of root.data) {
    const place = suggestionItem(entry);
    if (place !== undefined) {
      places.push(place);
    }
  }
  return places;
}

/** `geocoder/v1?address=` response body → `Place`. */
export function normalizeTencentGeocodePayload(payload: unknown): Place {
  const root = asRecord(payload);
  const result = root === undefined ? undefined : asRecord(root.result);
  if (result === undefined) {
    throw new TencentPayloadError("Tencent geocoder payload has no result object");
  }

  const point = gcj02ToWgs84(result.location);
  if (point === undefined) {
    throw new TencentPayloadError("Tencent geocoder result has no usable location");
  }

  const components = asRecord(result.address_components);
  const province = boundedText(components?.province, MAX_NAME_LENGTH);
  const city = boundedText(components?.city, MAX_NAME_LENGTH);
  const district = boundedText(components?.district, MAX_NAME_LENGTH);
  const street = boundedText(components?.street, MAX_NAME_LENGTH);
  const streetNumber = boundedText(components?.street_number, MAX_NAME_LENGTH);
  const address = composeAddress(province, city, district, street, streetNumber);

  // `title` is documented as deprecated but stays the only display name the
  // forward geocoder returns; the composed address is the documented fallback.
  const name = boundedText(result.title, MAX_NAME_LENGTH) ?? address;
  if (name === undefined) {
    throw new TencentPayloadError("Tencent geocoder result has no usable name");
  }

  return PlaceSchema.parse({
    provider: "tencent",
    providerPlaceId: null,
    name,
    address,
    country: CHINA_COUNTRY,
    countryCode: CHINA_COUNTRY_CODE,
    lat: point.lat,
    lng: point.lng,
    timeZone: null,
    bbox: null,
    importance: null,
    type: geocodeType(result.level),
  });
}

/**
 * `geocoder/v1?location=` response body → `Place`.
 *
 * `fallback` is the coordinate we asked about (already WGS-84). The reverse
 * geocoder echoes it as GCJ-02 in `result.location`, but if that field is absent
 * the answered coordinate must still be returned.
 */
export function normalizeTencentReversePayload(
  payload: unknown,
  fallback?: { readonly lat: number; readonly lng: number },
): Place {
  const root = asRecord(payload);
  const result = root === undefined ? undefined : asRecord(root.result);
  if (result === undefined) {
    throw new TencentPayloadError("Tencent reverse geocoder payload has no result object");
  }

  const point = gcj02ToWgs84(result.location) ?? fallback;
  if (point === undefined) {
    throw new TencentPayloadError("Tencent reverse geocoder result has no usable location");
  }

  const components = asRecord(result.address_component);
  const address = boundedText(result.address, MAX_ADDRESS_LENGTH);
  const formatted = asRecord(result.formatted_addresses);
  const name =
    boundedText(formatted?.recommend, MAX_NAME_LENGTH) ??
    address ??
    boundedText(components?.street, MAX_NAME_LENGTH);

  if (name === undefined) {
    throw new TencentPayloadError("Tencent reverse geocoder result has no usable name");
  }

  return PlaceSchema.parse({
    provider: "tencent",
    providerPlaceId: null,
    name,
    address,
    country: CHINA_COUNTRY,
    countryCode: CHINA_COUNTRY_CODE,
    lat: point.lat,
    lng: point.lng,
    timeZone: null,
    bbox: null,
    importance: null,
    type: REVERSE_PLACE_TYPE,
  });
}
