"use client";

import type { Media } from "@roamlog/contracts";

import { mediaPreviewUrl } from "../trip-workspace/media-urls";
import { pointsToGeoJson, type ClusterPoint } from "./cluster-points-source";

/**
 * A photo that carries a WGS-84 position.
 *
 * The coordinates come from `Media.lat` / `Media.lng`, the denormalized pair the
 * media contract already exposes (written from EXIF at upload time). Nothing
 * here reads `exif.latitude` and nothing here invents a position: a media row
 * without the pair is simply not a photo location.
 */
export interface PhotoPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  sublabel: string;
  /** Signed thumbnail resolved by the existing media URL helper; `null` while
   * the asset is still processing (shown as its real state, never a fake image). */
  thumbUrl: string | null;
  /** Album day: the photo's own date, else its upload date. */
  date: string | null;
  tripId: string | null;
}

/**
 * Grouping precision for the panel and the thumbnail strip, ~110 m at the
 * equator. The map itself clusters with MapLibre's own radius (see
 * cluster-points-source.tsx); this grid only decides which photos the panel
 * lists together, so a panel row and a rendered cluster cover the same place.
 */
export const PHOTO_GROUP_PRECISION = 3;

export interface PhotoGroup {
  key: string;
  lat: number;
  lng: number;
  photos: PhotoPoint[];
}

export function photosFromMedia(items: readonly Media[]): PhotoPoint[] {
  const points: PhotoPoint[] = [];
  for (const item of items) {
    const lat = item.lat;
    const lng = item.lng;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    points.push({
      id: item.id,
      lat,
      lng,
      label: item.location?.trim() || item.caption?.trim() || "带定位的照片",
      sublabel: item.caption?.trim() || item.date || item.createdAt.slice(0, 10),
      thumbUrl: mediaPreviewUrl(item),
      date: item.date ?? item.createdAt.slice(0, 10),
      tripId: item.tripId ?? null,
    });
  }
  return points;
}

export function photoGroupKey(point: Pick<PhotoPoint, "lat" | "lng">): string {
  return `${point.lat.toFixed(PHOTO_GROUP_PRECISION)},${point.lng.toFixed(PHOTO_GROUP_PRECISION)}`;
}

export function groupPhotos(points: readonly PhotoPoint[]): PhotoGroup[] {
  const groups = new Map<string, PhotoGroup>();
  for (const point of points) {
    const key = photoGroupKey(point);
    const existing = groups.get(key);
    if (existing) {
      existing.photos.push(point);
      continue;
    }
    groups.set(key, { key, lat: point.lat, lng: point.lng, photos: [point] });
  }
  return [...groups.values()];
}

export function photosToClusterPoints(points: readonly PhotoPoint[]): ClusterPoint[] {
  return points.map((point) => ({
    id: point.id,
    label: point.label,
    sublabel: point.sublabel,
    lat: point.lat,
    lng: point.lng,
    tripId: point.tripId ?? undefined,
  }));
}

/** Reuses the footprint layer's GeoJSON adapter — one GeoJSON shape per map. */
export function photosToGeoJson(points: readonly PhotoPoint[]) {
  return pointsToGeoJson(photosToClusterPoints(points));
}

/**
 * Bounding box for "zoom to the photos". Returns `null` (and the button then
 * does nothing) when no photo carries a position.
 */
export function photoBounds(
  points: readonly PhotoPoint[],
): [[number, number], [number, number]] | null {
  if (!points.length) return null;
  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

/**
 * Camera target for "缩放到照片": the centre of the photo extent plus a zoom
 * that keeps the whole extent in view.
 *
 * This is a centre + zoom pair rather than a `fitBounds()` call on purpose. The
 * brief for this layer requires the camera move to follow the existing
 * `moveCamera()` contract (immediate `jumpTo` under `prefers-reduced-motion`,
 * `flyTo` otherwise), and `fitBounds` is not expressible as that pair — it also
 * crashed the page when it ran on a live react-map-gl map (MapLibre's
 * `resize` event reached the React camera handler with an unset transform).
 * The zoom steps below are the standard Web-Mercator span ladder.
 */
export function photoFocus(
  points: readonly PhotoPoint[],
): { center: [number, number]; zoom: number } | null {
  const bounds = photoBounds(points);
  if (!bounds) return null;
  const [[minLng, minLat], [maxLng, maxLat]] = bounds;
  const span = Math.max(maxLng - minLng, maxLat - minLat);
  const zoom = span > 60 ? 1.7 : span > 20 ? 3 : span > 5 ? 5 : span > 1 ? 7 : 11;
  return { center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2], zoom };
}

