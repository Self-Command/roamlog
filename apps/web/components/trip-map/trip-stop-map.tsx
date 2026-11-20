"use client";

import { Suspense, lazy, useEffect, useState } from "react";

import { SchematicRouteMap } from "@/components/map/map-fallback";
import type { MapPoint } from "@/components/map/map-types";
import type { PhotoPoint } from "@/components/map/photo-points";
import { PlacesAttribution } from "@/components/map/places-attribution";

const MapCanvas = lazy(() => import("@/components/map/map-canvas"));

/**
 * The map surface for one trip.
 *
 * The frame height is a prop of this component rather than of its content:
 * MapCanvas sizes itself with `height: 100%`, which resolves to 0 under an
 * auto-height parent (the atlas regression guarded by map-flat.spec.ts), so the
 * wrapper uses the same `h-[320px] sm:h-[440px]` frame as atlas-map.tsx.
 *
 * Photos travel through unchanged: this component owns no filtering of its own,
 * so the GPS pairs the trip page derived from `Media.lat/lng` are exactly what
 * the cluster layer plots. Clicking a single photo asks the page for the viewer;
 * the cluster layer still only expands on click.
 */
export function TripStopMap({
  points,
  route,
  selectedId,
  onSelect,
  photos,
  showPhotos = false,
  focusPhotosToken = 0,
  onOpenPhoto,
}: {
  points: MapPoint[];
  route: Array<[number, number]>;
  selectedId?: string;
  onSelect: (id: string) => void;
  photos?: PhotoPoint[];
  showPhotos?: boolean;
  focusPhotosToken?: number;
  onOpenPhoto?: (photoId: string) => void;
}) {
  const [mapFailed, setMapFailed] = useState(false);
  const [webglAvailable, setWebglAvailable] = useState(false);

  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      setWebglAvailable(Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl")));
    } catch {
      setWebglAvailable(false);
    }
  }, []);

  if (mapFailed || !webglAvailable) {
    return (
      <div className="relative h-[320px] w-full sm:h-[440px]">
        <SchematicRouteMap
          points={points}
          selectedId={selectedId}
          onSelect={onSelect}
          showRoute
        />
        <div className="pointer-events-none absolute left-3 top-3 rounded-pill border border-hairline-strong bg-black/65 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.1em] text-white/65">
          TILE FALLBACK / SCHEMATIC WORLD
        </div>
        <div className="pointer-events-none absolute bottom-1 left-2 flex max-w-[calc(100%-0.5rem)] items-center rounded bg-black/85 px-2 py-0.5">
          {/* The trip page renders no live place search, so only the OSM credit applies. */}
          <PlacesAttribution provider={null} tone="overlay" />
        </div>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div
          role="status"
          className="flex h-[320px] w-full items-center justify-center bg-surface-deep sm:h-[440px]"
        >
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
            LOADING MAP TILES…
          </p>
        </div>
      }
    >
      <div className="relative h-[320px] w-full sm:h-[440px]">
        <MapCanvas
          points={points}
          route={route}
          selectedId={selectedId}
          onSelect={onSelect}
          photos={photos}
          showPhotos={showPhotos}
          focusPhotosToken={focusPhotosToken}
          onOpenPhoto={onOpenPhoto}
          onError={() => setMapFailed(true)}
          placesProvider={null}
        />
      </div>
    </Suspense>
  );
}