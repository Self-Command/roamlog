"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { setWorkerUrl } from "maplibre-gl";
import { useMemo, useRef } from "react";
import Map, {
  Layer,
  Marker,
  NavigationControl,
  Source,
  type MapRef,
} from "react-map-gl/maplibre";

import type { PlacesProvider } from "@/lib/places-attribution";

import type { MapPoint } from "./map-types";
import { PlacesAttribution } from "./places-attribution";

export interface MapCanvasProps {
  points: MapPoint[];
  route?: Array<[number, number]>;
  selectedId?: string;
  onSelect?: (id: string) => void;
  onError?: () => void;
  onReady?: () => void;
  /** Source of the city search shown alongside the map, when known. */
  placesProvider?: PlacesProvider;
}

const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

if (typeof window !== "undefined") {
  setWorkerUrl(
    "https://cdn.jsdelivr.net/npm/maplibre-gl@6.18.0/dist/maplibre-gl-worker.mjs",
  );
}

export default function MapCanvas({
  points,
  route = [],
  selectedId,
  onSelect,
  onError,
  onReady,
  placesProvider = null,
}: MapCanvasProps) {
  const mapRef = useRef<MapRef | null>(null);
  const styleUrl = process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim() || DEFAULT_STYLE_URL;
  const initialViewState = useMemo(() => initialView(points), [points]);
  const routeGeoJson = useMemo<{
    type: "Feature";
    properties: Record<string, never>;
    geometry: { type: "LineString"; coordinates: Array<[number, number]> };
  }>(
    () => ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: route },
    }),
    [route],
  );

  return (
    <div className="relative h-full min-h-72 w-full" data-testid="maplibre-canvas">
      <Map
        ref={mapRef}
        initialViewState={initialViewState}
        mapStyle={styleUrl}
        attributionControl={{ compact: false }}
        reuseMaps
        onLoad={() => {
          onReady?.();
          const map = mapRef.current;
          if (!map) return;
          const coordinates = route.length
            ? route
            : points.map((point) => [point.lng, point.lat] as [number, number]);
          if (coordinates.length > 1) {
            try {
              map.fitBounds(
                [
                  [Math.min(...coordinates.map(([lng]) => lng)), Math.min(...coordinates.map(([, lat]) => lat))],
                  [Math.max(...coordinates.map(([lng]) => lng)), Math.max(...coordinates.map(([, lat]) => lat))],
                ],
                { padding: 64, maxZoom: 10, duration: 0 },
              );
            } catch {
              // A single point or degenerate bounds should keep the initial view.
            }
          }
        }}
        onError={() => onError?.()}
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="top-right" showCompass={false} />
        {route.length > 1 ? (
          <Source id="trip-route" type="geojson" data={routeGeoJson}>
            <Layer
              id="trip-route-line"
              type="line"
              paint={{
                "line-color": "#ff801f",
                "line-width": 2,
                "line-opacity": 0.72,
                "line-dasharray": [1.5, 1.5],
              }}
            />
          </Source>
        ) : null}

        {points.map((point) => {
          const selected = point.id === selectedId;
          return (
            <Marker
              key={point.id}
              longitude={point.lng}
              latitude={point.lat}
              anchor="bottom"
              onClick={(event: { originalEvent: Event }) => {
                event.originalEvent.stopPropagation();
                onSelect?.(point.id);
              }}
            >
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect?.(point.id);
                }}
                aria-pressed={selected}
                aria-label={`选择停靠点 ${point.label}`}
                className={`group relative flex flex-col items-center outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
                  selected ? "z-10" : ""
                }`}
              >
                <span
                  className={`whitespace-nowrap rounded-pill border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] shadow-lg ${
                    selected
                      ? "border-accent-orange/70 bg-black/85 text-ink"
                      : "border-white/20 bg-black/70 text-white/75 group-hover:text-ink"
                  }`}
                >
                  {point.label}
                </span>
                <span
                  className={`mt-1 size-2.5 rounded-full border ${
                    selected
                      ? "border-white bg-accent-orange"
                      : "border-black/80 bg-white/85"
                  }`}
                />
              </button>
            </Marker>
          );
        })}
      </Map>

      {/*
        Tiles come from OpenFreeMap (OSM-derived), so the OSM credit is always
        shown; when the page's city search has a known provider it is added on
        the same line. The plate is nearly opaque so the 10px credit keeps
        >=4.5:1 contrast even over a white tile.
      */}
      <div className="pointer-events-none absolute bottom-1 left-2 z-10 flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded bg-black/85 px-2 py-0.5">
        <PlacesAttribution provider={placesProvider} tone="overlay" />
        <span className="font-mono text-[8px] leading-4 text-white/60">· OpenFreeMap</span>
      </div>
    </div>
  );
}

function initialView(points: MapPoint[]) {
  if (!points.length) {
    return { longitude: 105, latitude: 30, zoom: 1.7 };
  }
  const latitude = average(points.map((point) => point.lat));
  const longitude = average(points.map((point) => point.lng));
  return {
    longitude,
    latitude,
    zoom: points.length > 1 ? 3 : 6,
  };
}

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}
