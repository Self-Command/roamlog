"use client";

import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Every camera move on a Roamlog map goes through here.
 *
 * Moves are always user-initiated (a point click, a list row, a "缩放到照片"
 * press), so the non-reduced branch uses MapLibre's `flyTo({ ..., essential:
 * true })` — "this motion was requested, not decorative" — and the
 * `prefers-reduced-motion` branch skips the flight entirely and places the
 * camera instead, which is the `duration: 0` behaviour the globe research
 * requires. Ported from the official fly-to-a-location example
 * (test/examples/fly-to-a-location.html); originally written in globe-view.tsx
 * and moved here so the flat map and the globe share one contract.
 */
export function moveCamera(
  map: MapLibreMap | null | undefined,
  center: [number, number],
  zoom: number,
  reducedMotion: boolean,
) {
  if (!map) return;
  if (reducedMotion) {
    map.jumpTo({ center, zoom });
    return;
  }
  map.flyTo({ center, zoom, essential: true });
}
