"use client";

import { Suspense, lazy, useEffect, useMemo, useState } from "react";

import { SchematicRouteMap } from "./map-fallback";
import type { MapPoint } from "./map-types";
import { PlacesAttribution } from "./places-attribution";

const MapCanvas = lazy(() => import("./map-canvas"));

export interface AtlasPoint extends MapPoint {
  tripId: string;
}

export function AtlasMap({
  points,
  selectedTripId,
  onSelectTrip,
  forceFallback = false,
}: {
  points: AtlasPoint[];
  selectedTripId?: string;
  onSelectTrip?: (tripId: string) => void;
  forceFallback?: boolean;
}) {
  const [mapFailed, setMapFailed] = useState(false);
  const [webglAvailable, setWebglAvailable] = useState(false);

  useEffect(() => {
    if (forceFallback) return;
    try {
      const canvas = document.createElement("canvas");
      setWebglAvailable(Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl")));
    } catch {
      setWebglAvailable(false);
    }
  }, [forceFallback]);

  const mapPoints = useMemo<MapPoint[]>(
    () =>
      points.map((point) => ({
        id: point.id,
        label: point.label,
        sublabel: point.sublabel,
        lat: point.lat,
        lng: point.lng,
      })),
    [points],
  );
  const selectedPointId = points.find((point) => point.tripId === selectedTripId)?.id;
  const tripIdByPointId = useMemo(
    () => new Map(points.map((point) => [point.id, point.tripId])),
    [points],
  );
  const selectPoint = (pointId: string) => {
    const tripId = tripIdByPointId.get(pointId);
    if (tripId) onSelectTrip?.(tripId);
  };

  if (forceFallback || mapFailed || !webglAvailable) {
    return (
      <div className="relative">
        <SchematicRouteMap
          points={mapPoints}
          selectedId={selectedPointId}
          onSelect={selectPoint}
          showRoute={false}
        />
        <div className="absolute left-3 top-3 rounded-pill border border-hairline-strong bg-black/65 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.1em] text-white/65">
          TILE FALLBACK / SCHEMATIC WORLD
        </div>
        <div className="absolute bottom-1 left-2 flex max-w-[calc(100%-0.5rem)] items-center rounded bg-black/85 px-2 py-0.5">
          {/* Atlas renders no live search, so only the OSM credit applies. */}
          <PlacesAttribution provider={null} tone="overlay" />
        </div>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div role="status" className="flex min-h-80 items-center justify-center bg-surface-deep">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
            LOADING MAP TILES…
          </p>
        </div>
      }
    >
      <MapCanvas
        points={mapPoints}
        selectedId={selectedPointId}
        onSelect={selectPoint}
        onError={() => setMapFailed(true)}
        placesProvider={null}
      />
    </Suspense>
  );
}