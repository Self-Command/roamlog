"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { setWorkerUrl, type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import Map, {
  Layer,
  NavigationControl,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";

import { Button } from "@roamlog/ui";

import { useReducedMotion } from "../charts/use-reduced-motion";
import { PlacesAttribution } from "./places-attribution";

/**
 * Globe projection, cluster layer and flyTo usage are ported from the official
 * MapLibre examples, not designed here:
 * - projection: test/examples/display-a-globe-with-a-vector-map.html
 * - clusters + cluster-count + unclustered-point layers: test/examples/create-and-style-clusters.html
 * - flyTo({center, zoom, essential}) : test/examples/fly-to-a-location.html
 * Repo: github.com/maplibre/maplibre-gl-js @ b8a71bd487e97c811da1acc5f4eff707df2da5f8
 * The only project-specific glue is the data adapter, the accessible list and
 * the "进入地图" hand-off to the existing 2D atlas view.
 */

// Same OpenFreeMap Liberty style as components/map/map-canvas.tsx:31.
const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// Same worker wiring as map-canvas.tsx; the globe chunk can load first.
if (typeof window !== "undefined") {
  setWorkerUrl(
    "https://cdn.jsdelivr.net/npm/maplibre-gl@6.18.0/dist/maplibre-gl-worker.mjs",
  );
}

export const GLOBE_ZOOM = 2.2;
export const CITY_ZOOM = 11;

export interface GlobePoint {
  id: string;
  label: string;
  sublabel?: string;
  lat: number;
  lng: number;
  /** Existing atlas trip id; used to hand the selection back to the 2D view. */
  tripId?: string;
}

export interface GlobeViewProps {
  points: GlobePoint[];
  /** Switches the atlas page to its existing 2D view, keeping the selection. */
  onEnterMap?: (point: GlobePoint) => void;
  /** Lets the parent fall back to the flat map when the globe cannot render. */
  onError?: () => void;
  className?: string;
}

/** GeoJSON for the cluster source; only points carrying coordinates exist upstream. */
export function pointsToGeoJson(points: GlobePoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: points.map((point) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [point.lng, point.lat] as [number, number],
      },
      properties: {
        id: point.id,
        label: point.label,
        sublabel: point.sublabel ?? "",
        tripId: point.tripId ?? "",
      },
    })),
  };
}

function initialView(points: GlobePoint[]) {
  if (!points.length) {
    return { longitude: 0, latitude: 20, zoom: GLOBE_ZOOM };
  }
  const latitude = points.reduce((total, point) => total + point.lat, 0) / points.length;
  const longitude = points.reduce((total, point) => total + point.lng, 0) / points.length;
  return { longitude, latitude, zoom: GLOBE_ZOOM };
}

/**
 * 3D globe over the existing OpenFreeMap Liberty vector style. There is no
 * entrance flight: the camera is placed statically, which keeps
 * `prefers-reduced-motion` users out of unrequested motion. Reduced motion also
 * turns the ambient auto-rotation off and shortens requested camera moves to an
 * immediate placement.
 */
export default function GlobeView({
  points,
  onEnterMap,
  onError,
  className,
}: GlobeViewProps) {
  const mapRef = useRef<MapRef | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const reducedMotion = useReducedMotion();

  const styleUrl = process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim() || DEFAULT_STYLE_URL;
  const geojson = useMemo(() => pointsToGeoJson(points), [points]);
  const viewState = useMemo(() => initialView(points), [points]);
  const selected = points.find((point) => point.id === selectedId) ?? null;

  // Rotating is opt-in and is never started for a user who asked for reduced
  // motion: the globe research requires the rotation switch to be off under
  // `prefers-reduced-motion`, and ambient rotation is exactly the kind of
  // unrequested motion that setting exists to suppress.
  useEffect(() => {
    if (!autoRotate || reducedMotion) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const map = mapRef.current?.getMap();
      if (map) {
        const delta = ((now - previous) / 1000) * 6;
        map.setBearing((map.getBearing() + delta) % 360);
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [autoRotate, reducedMotion]);

  // Phones get MapLibre's cooperative gestures so a one-finger drag scrolls the
  // page instead of spinning the globe; the same flag keeps pinch-zoom working.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 639px)");
    setNarrow(query.matches);
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  /**
   * Camera moves here are always user-initiated. `essential: true` is
   * MapLibre's marker for "the motion is requested, not decorative" (the
   * official fly-to-a-location example uses it for the same reason). When the
   * user asked for reduced motion the flight is skipped entirely and the camera
   * is placed instead, which is the `duration: 0` behaviour the globe research
   * requires.
   */
  function moveCamera(map: MapLibreMap | null | undefined, center: [number, number], zoom: number) {
    if (!map) return;
    if (reducedMotion) {
      map.jumpTo({ center, zoom });
      return;
    }
    map.flyTo({ center, zoom, essential: true });
  }

  function focusPoint(point: GlobePoint) {
    setSelectedId(point.id);
    moveCamera(mapRef.current?.getMap(), [point.lng, point.lat], CITY_ZOOM);
  }

  async function handleClick(event: MapLayerMouseEvent) {
    const feature = event.features?.[0];
    if (!feature) return;
    const properties = (feature.properties ?? {}) as Record<string, unknown>;
    const geometry = feature.geometry as { coordinates?: [number, number] };
    if (!geometry.coordinates) return;

    if (properties.cluster_id !== undefined) {
      setSelectedId(null);
      const source = event.target.getSource("globe-points") as GeoJSONSource | undefined;
      if (!source) return;
      const zoom = await source.getClusterExpansionZoom(Number(properties.cluster_id));
      event.target.easeTo({ center: geometry.coordinates, zoom });
      return;
    }

    const id = typeof properties.id === "string" ? properties.id : null;
    const point = points.find((item) => item.id === id);
    if (!point) return;
    setSelectedId(point.id);
    moveCamera(event.target, geometry.coordinates, CITY_ZOOM);
  }

  return (
    <section
      className={`relative bg-black ${className ?? ""}`}
      aria-label="3D 地球视图"
      data-testid="globe-view"
    >
      <p className="sr-only">3D 地球视图，显示 {points.length} 个地点</p>

      <div className="relative h-[320px] w-full sm:h-[440px]">
        <Map
          ref={mapRef}
          projection="globe"
          initialViewState={viewState}
          mapStyle={styleUrl}
          attributionControl={{ compact: true }}
          renderWorldCopies={false}
          cooperativeGestures={narrow}
          interactiveLayerIds={["globe-clusters", "globe-point"]}
          onClick={(event) => {
            void handleClick(event);
          }}
          onLoad={(event) => {
            // The Liberty style paints its space with #f8f4f0; the product
            // canvas must be true black, so only the background paint changes.
            try {
              if (event.target.getLayer("background")) {
                event.target.setPaintProperty("background", "background-color", "#000000");
              }
            } catch {
              // A style without a background layer keeps its own colour.
            }
          }}
          onError={() => onError?.()}
          style={{ width: "100%", height: "100%" }}
        >
          <NavigationControl position="top-right" showCompass={false} />

          {/* Ported from the official "Create and style clusters" example. */}
          <Source
            id="globe-points"
            type="geojson"
            data={geojson}
            cluster
            clusterMaxZoom={14}
            clusterRadius={50}
          >
            <Layer
              id="globe-clusters"
              type="circle"
              filter={["has", "point_count"] as never}
              paint={{
                "circle-color": "#ff801f",
                "circle-opacity": 0.92,
                "circle-radius": [
                  "step",
                  ["get", "point_count"],
                  20,
                  10,
                  25,
                  30,
                  30,
                ] as never,
                "circle-stroke-width": 1,
                "circle-stroke-color": "rgba(0, 0, 0, 0.85)",
              }}
            />
            <Layer
              id="globe-cluster-count"
              type="symbol"
              filter={["has", "point_count"] as never}
              layout={{
                "text-field": "{point_count_abbreviated}",
                "text-font": ["Noto Sans Regular"],
                "text-size": 12,
              }}
              paint={{ "text-color": "#ffffff" }}
            />
            <Layer
              id="globe-point"
              type="circle"
              filter={["!", ["has", "point_count"]] as never}
              paint={{
                "circle-color": "#ff801f",
                "circle-radius": 4,
                "circle-stroke-width": 1,
                "circle-stroke-color": "#ffffff",
              }}
            />
          </Source>
        </Map>

        {reducedMotion ? null : (
          <div className="absolute left-3 top-3 z-10">
            <Button
              type="button"
              size="sm"
              variant={autoRotate ? "subtle" : "ghost"}
              className="border border-hairline-strong bg-black/75"
              aria-pressed={autoRotate}
              onClick={() => setAutoRotate((current) => !current)}
            >
              自动旋转
            </Button>
          </div>
        )}

        {/* Same OSM/OpenFreeMap credit plate as the flat map. */}
        <div className="pointer-events-none absolute bottom-1 left-2 z-10 flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded bg-black/85 px-2 py-0.5">
          <PlacesAttribution provider={null} tone="overlay" />
          <span className="font-mono text-[8px] leading-4 text-white/60">· OpenFreeMap</span>
        </div>
      </div>

      {selected ? (
        <div className="flex items-center justify-between gap-3 border-t border-hairline bg-surface-1 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate font-serif text-base text-ink">{selected.label}</p>
            <p className="mt-0.5 truncate font-mono text-[8px] uppercase tracking-[0.08em] text-stone">
              {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onEnterMap?.(selected)}
          >
            进入地图
          </Button>
        </div>
      ) : null}

      {/* Keyboard-equivalent entry point: canvas markers cannot be tabbed to. */}
      <div className="border-t border-hairline bg-surface-1 px-3 py-2">
        <p className="type-eyebrow">LOCATION LIST / {points.length}</p>
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
          {points.map((point) => {
            const active = point.id === selectedId;
            return (
              <li key={point.id}>
                <button
                  type="button"
                  onClick={() => focusPoint(point)}
                  aria-pressed={active}
                  className={`flex w-full items-center justify-between gap-3 rounded-control border px-2 py-1.5 text-left text-[11px] ${
                    active
                      ? "border-accent-orange/50 bg-surface-2 text-ink"
                      : "border-transparent text-muted hover:bg-white/[0.025] hover:text-ink"
                  }`}
                >
                  <span className="truncate">{point.label}</span>
                  <span className="shrink-0 font-mono text-[8px] uppercase tracking-[0.08em] text-stone">
                    {point.sublabel ?? ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}