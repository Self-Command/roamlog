"use client";

import type { Trip } from "@roamlog/contracts";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";

import { SchematicRouteMap } from "./map-fallback";
import type { MapPoint } from "./map-types";

const MapCanvas = lazy(() => import("./map-canvas"));

const COUNTRY_CENTERS: Record<string, [number, number]> = {
  KR: [36.5, 127.8],
  JP: [36.2, 138.2],
  IS: [64.9, -18.6],
  PT: [39.4, -8.2],
  IT: [42.7, 12.5],
  CL: [-33.4, -70.6],
  AR: [-38.4, -63.6],
  GR: [39.0, 22.0],
  MA: [31.8, -7.1],
};

export function AtlasMap({
  trips,
  selectedTripId,
  onSelect,
  forceFallback = false,
}: {
  trips: Trip[];
  selectedTripId?: string;
  onSelect?: (tripId: string) => void;
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

  const points = useMemo<MapPoint[]>(
    () =>
      trips.flatMap((trip, index) => {
        const code = trip.countryCodes[0] ?? "";
        const center = COUNTRY_CENTERS[code];
        if (!center) return [];
        return [
          {
            id: trip.id,
            label: trip.title,
            sublabel: trip.destinations.join(" · "),
            lat: center[0] + (index % 3) * 0.25,
            lng: center[1] - (index % 2) * 0.3,
          },
        ];
      }),
    [trips],
  );

  if (forceFallback || mapFailed || !webglAvailable) {
    return (
      <div className="relative">
        <SchematicRouteMap points={points} selectedId={selectedTripId} onSelect={onSelect} />
        <div className="absolute left-3 top-3 rounded-pill border border-hairline-strong bg-black/65 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.1em] text-white/65">
          TILE FALLBACK / SCHEMATIC WORLD
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
        points={points}
        selectedId={selectedTripId}
        onSelect={onSelect}
        onError={() => setMapFailed(true)}
      />
    </Suspense>
  );
}
