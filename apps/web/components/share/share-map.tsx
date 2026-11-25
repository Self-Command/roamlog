"use client";

import { useMemo } from "react";

import type { PublicMedia, PublicStop } from "@roamlog/contracts";

import { routeCoordinates, stopToPoint, type MapPoint } from "@/components/map/map-types";
import type { PhotoPoint } from "@/components/map/photo-points";
import { TripStopMap } from "@/components/trip-map/trip-stop-map";

function hasFiniteCoordinates(stop: PublicStop): boolean {
  return (
    typeof stop.lat === "number" &&
    typeof stop.lng === "number" &&
    Number.isFinite(stop.lat) &&
    Number.isFinite(stop.lng)
  );
}

/**
 * Public shares only expose `PublicMedia`, while the shared photo-point builder
 * consumes the internal `Media` row. This adapter keeps the exact filtering and
 * fallback rules of `photosFromMedia` without inventing the private fields the
 * public payload deliberately omits (bucket, key, variants, EXIF snapshot).
 */
export function photosFromPublicMedia(items: readonly PublicMedia[]): PhotoPoint[] {
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
      sublabel: item.caption?.trim() || item.date || "",
      thumbUrl: item.thumbUrl ?? item.url,
      date: item.date,
      tripId: null,
    });
  }
  return points;
}

/**
 * Read-only route map for the public share page.
 *
 * It reuses the same map shell, route coordinates and stop projection as the
 * trip map page, but never mounts editing affordances: selection is disabled
 * and photos only appear when the public payload actually carries coordinates.
 */
export function ShareMap({
  stops,
  media,
}: {
  stops: readonly PublicStop[];
  media: readonly PublicMedia[];
}) {
  const mappableStops = useMemo(() => stops.filter(hasFiniteCoordinates), [stops]);
  const points = useMemo(
    () => mappableStops.map(stopToPoint).filter((point): point is MapPoint => point !== null),
    [mappableStops],
  );
  const route = useMemo(() => routeCoordinates(mappableStops), [mappableStops]);
  const photoPoints = useMemo(() => photosFromPublicMedia(media), [media]);

  if (points.length === 0) return null;

  return (
    <figure
      aria-label="路线地图"
      data-testid="share-map"
      data-mapped-stops={points.length}
      data-photo-points={photoPoints.length}
      className="mt-5 overflow-hidden rounded-card border border-hairline bg-surface-1"
    >
      <div className="relative h-[320px] w-full sm:h-[440px]">
        <TripStopMap
          points={points}
          route={route}
          selectedId={undefined}
          onSelect={() => {}}
          photos={photoPoints}
          showPhotos={photoPoints.length > 0}
        />
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-3 py-2 font-mono text-[8px] uppercase tracking-[0.1em] text-stone">
        <span>路线地图 / {points.length} 个已定位停靠点</span>
        <span>
          {photoPoints.length > 0
            ? `${photoPoints.length} 张带定位照片`
            : "没有照片精确位置"}
        </span>
      </figcaption>
    </figure>
  );
}
