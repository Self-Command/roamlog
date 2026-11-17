import type { CitySearchResult } from "./map-types";

const DEFAULT_GEOCODER_URL = "https://photon.komoot.io/api/";
const CACHE_TTL_MS = 5 * 60_000;
const MAX_RESULTS = 6;

interface CacheEntry {
  expiresAt: number;
  results: CitySearchResult[];
}

const cache = new Map<string, CacheEntry>();

export interface SearchCitiesOptions {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  geocoderUrl?: string;
  limit?: number;
}

export function getGeocoderUrl(): string {
  return (
    process.env.NEXT_PUBLIC_GEOCODER_URL?.trim() ||
    DEFAULT_GEOCODER_URL
  );
}

export function clearGeocoderCache() {
  cache.clear();
}

export async function searchCities(
  query: string,
  options: SearchCitiesOptions = {},
): Promise<CitySearchResult[]> {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  if (normalized.length < 2) return [];

  const cached = cache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.results;
  }

  const baseUrl = options.geocoderUrl?.trim() || getGeocoderUrl();
  const url = buildSearchUrl(baseUrl, query.trim(), options.limit ?? MAX_RESULTS);
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(url, {
    signal: options.signal,
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Geocoder returned ${response.status}.`);
  }

  const payload: unknown = await response.json();
  const results = normalizeResults(payload).slice(0, options.limit ?? MAX_RESULTS);
  cache.set(normalized, { expiresAt: Date.now() + CACHE_TTL_MS, results });
  return results;
}

function buildSearchUrl(baseUrl: string, query: string, limit: number): string {
  const url = new URL(baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("lang", "zh");
  return url.toString();
}

export function normalizeResults(payload: unknown): CitySearchResult[] {
  if (!isRecord(payload) || !Array.isArray(payload.features)) {
    return normalizeNominatimResults(payload);
  }

  return payload.features.flatMap((feature) => {
    if (!isRecord(feature) || !isRecord(feature.properties)) return [];
    const properties = feature.properties;
    const geometry = isRecord(feature.geometry) ? feature.geometry : null;
    const coordinates = Array.isArray(geometry?.coordinates)
      ? geometry.coordinates
      : null;
    if (!coordinates || coordinates.length < 2) return [];
    const lng = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

    const name = text(properties.name) || text(properties.city);
    if (!name) return [];

    return [
      {
        id:
          text(properties.osm_id) ??
          `${lat.toFixed(4)}:${lng.toFixed(4)}:${name}`,
        name,
        region: text(properties.state) ?? text(properties.county),
        country: text(properties.country) ?? "未知国家",
        countryCode: (text(properties.countrycode) ?? "").toUpperCase(),
        lat,
        lng,
      },
    ];
  });
}

function normalizeNominatimResults(payload: unknown): CitySearchResult[] {
  if (!Array.isArray(payload)) return [];

  return payload.flatMap((item) => {
    if (!isRecord(item)) return [];
    const lat = Number(item.lat);
    const lng = Number(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const name =
      text(item.name) ??
      text(item.display_name)?.split(",")[0]?.trim() ??
      "";
    if (!name) return [];
    const address = isRecord(item.address) ? item.address : {};

    return [
      {
        id: text(item.place_id) ?? `${lat.toFixed(4)}:${lng.toFixed(4)}:${name}`,
        name,
        region: text(address.state) ?? text(address.county),
        country: text(address.country) ?? "未知国家",
        countryCode: (text(address.country_code) ?? "").toUpperCase(),
        lat,
        lng,
      },
    ];
  });
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
