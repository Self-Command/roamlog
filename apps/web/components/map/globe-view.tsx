"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import Map, {
  NavigationControl,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";

import { Button } from "@roamlog/ui";

import { useReducedMotion } from "../charts/use-reduced-motion";
import {
  ClusterPointsSource,
  clusterInteractiveLayerIds,
  expandClusterIfAny,
  GLOBE_CLUSTER_SPEC,
  PHOTO_CLUSTER_SPEC,
  pointsToGeoJson,
} from "./cluster-points-source";
import { moveCamera } from "./map-camera";
import { installMapLibreWorker } from "./maplibre-worker";
import { photoFocus, photoGroupKey, photosToGeoJson, type PhotoPoint } from "./photo-points";
import { PlacesAttribution } from "./places-attribution";
import { useThemeColor } from "./use-theme-color";

/**
 * The cluster stack (source + cluster/cluster-count/unclustered-point layers)
 * now lives in ./cluster-points-source.tsx so the photo layer plots through the
 * exact same implementation instead of a second one. Projection and flyTo usage
 * stay here:
 * - projection: test/examples/display-a-globe-with-a-vector-map.html
 * - flyTo({center, zoom, essential}) : test/examples/fly-to-a-location.html
 * Repo: github.com/maplibre/maplibre-gl-js @ b8a71bd487e97c811da1acc5f4eff707df2da5f8
 * The only project-specific glue is the data adapter, the accessible list and
 * the "进入地图" hand-off to the existing 2D atlas view.
 */

// Re-exported so existing importers keep one entry point for the GeoJSON shape.
export { pointsToGeoJson } from "./cluster-points-source";

// Same OpenFreeMap Liberty style as components/map/map-canvas.tsx:31.
const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// Same worker wiring as map-canvas.tsx; the globe chunk can load first.
installMapLibreWorker();

export const GLOBE_ZOOM = 2.2;
export const CITY_ZOOM = 11;

// Liberty uses its `background` layer as the land base once its z7
// `natural_earth` hillshade raster drops out; painting that layer black for the
// black space around the globe therefore turns every high-zoom map black. Keep
// the space black and paint the globe surface with a world-covering fill in the
// style's own background colour instead.
const GLOBE_BASE_SOURCE_ID = "globe-land-base";
const GLOBE_BASE_LAYER_ID = "globe-land-base";
const GLOBE_BASE_FALLBACK_COLOR = "white";
const WORLD_BASE_POLYGON = {
  type: "Feature" as const,
  properties: {},
  geometry: {
    type: "Polygon" as const,
    coordinates: [
      [
        [-179.9, -89.9],
        [179.9, -89.9],
        [179.9, 89.9],
        [-179.9, 89.9],
        [-179.9, -89.9],
      ],
    ],
  },
};

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
  /** Photos that carry GPS; plotted as a second cluster stack when enabled. */
  photos?: PhotoPoint[];
  /** The photo-layer switch lives in the atlas toolbar, not on the canvas. */
  showPhotos?: boolean;
  /** Incremented by "缩放到照片"; each change re-frames the photo extent. */
  focusPhotosToken?: number;
  /** Opens/closes the thumbnail panel for one photo place (`null` clears it). */
  onSelectPhotoGroup?: (key: string | null) => void;
  /** Switches the atlas page to its existing 2D view, keeping the selection. */
  onEnterMap?: (point: GlobePoint) => void;
  /** Lets the parent fall back to the flat map when the globe cannot render. */
  onError?: () => void;
  className?: string;
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
 * Paints the globe's space black while giving its surface the same land base
 * as the Liberty style. The world polygon is inserted directly above the
 * style's `background` layer, so all style layers (water, landcover, roads…)
 * keep their normal order on top of it.
 */
function prepareGlobeBase(map: MapLibreMap, spaceColor: string) {
  try {
    const style = map.getStyle();
    const background = style?.layers?.find((layer) => layer.id === "background");
    const backgroundPaint = background?.paint as Record<string, unknown> | undefined;
    const configured = backgroundPaint?.["background-color"];
    const baseColor = typeof configured === "string" ? configured : GLOBE_BASE_FALLBACK_COLOR;

    if (background) {
      map.setPaintProperty("background", "background-color", spaceColor);
    }
    if (map.getLayer(GLOBE_BASE_LAYER_ID)) return;
    if (!map.getSource(GLOBE_BASE_SOURCE_ID)) {
      map.addSource(GLOBE_BASE_SOURCE_ID, {
        type: "geojson",
        data: WORLD_BASE_POLYGON,
      });
    }
    const layers = map.getStyle().layers;
    const backgroundIndex = layers.findIndex((layer) => layer.id === "background");
    map.addLayer(
      {
        id: GLOBE_BASE_LAYER_ID,
        type: "fill",
        source: GLOBE_BASE_SOURCE_ID,
        paint: { "fill-color": baseColor },
      },
      backgroundIndex >= 0 ? layers[backgroundIndex + 1]?.id : undefined,
    );
  } catch {
    // A style without a background layer keeps its own colour.
  }
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
  photos = [],
  showPhotos = false,
  focusPhotosToken = 0,
  onSelectPhotoGroup,
  onEnterMap,
  onError,
  className,
}: GlobeViewProps) {
  const mapRef = useRef<MapRef | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  // react-map-gl only reads `cooperativeGestures` while constructing the Map
  // (it is not one of the props it updates later), so the narrow-screen flag
  // must be correct on the very first render — a post-mount effect is too late.
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(max-width: 639px)").matches;
  });
  const reducedMotion = useReducedMotion();
  const spaceColor = useThemeColor("--canvas", "black");

  const styleUrl = process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim() || DEFAULT_STYLE_URL;
  const geojson = useMemo(() => pointsToGeoJson(points), [points]);
  const photoGeoJson = useMemo(
    () => photosToGeoJson(showPhotos ? photos : []),
    [photos, showPhotos],
  );
  const viewState = useMemo(() => initialView(points), [points]);
  const selected = points.find((point) => point.id === selectedId) ?? null;

  // "缩放到照片" is keyed by a token so the effect fires once per request and
  // never re-frames the camera just because the photo list refreshed.
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    if (!focusPhotosToken) return;
    const focus = photoFocus(photosRef.current);
    if (!focus) return;
    moveCamera(mapRef.current?.getMap(), focus.center, focus.zoom, reducedMotion);
  }, [focusPhotosToken, reducedMotion]);

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
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    try {
      if (map.getLayer("background")) {
        map.setPaintProperty("background", "background-color", spaceColor);
      }
    } catch {
      // A style without a background layer keeps its own color.
    }
  }, [spaceColor]);

  /**
   * Moves go through ./map-camera.ts's single `moveCamera()` contract: user
   * requests fly, `prefers-reduced-motion` places the camera instead. The
   * function is user-initiated, so `essential: true` is MapLibre's marker for
   * "requested, not decorative" (the official fly-to-a-location example uses it
   * for the same reason).
   */
  function focusPoint(point: GlobePoint) {
    setSelectedId(point.id);
    moveCamera(mapRef.current?.getMap(), [point.lng, point.lat], CITY_ZOOM, reducedMotion);
  }

  async function handleClick(event: MapLayerMouseEvent) {
    const feature = event.features?.[0];
    if (!feature) return;
    const properties = (feature.properties ?? {}) as Record<string, unknown>;
    const geometry = feature.geometry as { coordinates?: [number, number] };
    if (!geometry.coordinates) return;

    const layerId = (feature.layer as { id?: string } | undefined)?.id;
    const photoLayers = clusterInteractiveLayerIds(PHOTO_CLUSTER_SPEC);
    const isPhotoHit = showPhotos && layerId !== undefined && photoLayers.includes(layerId);

    if (isPhotoHit) {
      setSelectedId(null);
      if (
        await expandClusterIfAny(event.target, PHOTO_CLUSTER_SPEC, properties, geometry.coordinates)
      ) {
        onSelectPhotoGroup?.(null);
        return;
      }
      const photo = photos.find((item) => item.id === properties.id);
      if (!photo) return;
      onSelectPhotoGroup?.(photoGroupKey(photo));
      moveCamera(event.target, geometry.coordinates, CITY_ZOOM, reducedMotion);
      return;
    }

    if (
      await expandClusterIfAny(event.target, GLOBE_CLUSTER_SPEC, properties, geometry.coordinates)
    ) {
      setSelectedId(null);
      return;
    }

    const id = typeof properties.id === "string" ? properties.id : null;
    const point = points.find((item) => item.id === id);
    if (!point) return;
    setSelectedId(point.id);
    moveCamera(event.target, geometry.coordinates, CITY_ZOOM, reducedMotion);
  }

  return (
    <section
      className={`relative bg-canvas ${className ?? ""}`}
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
          interactiveLayerIds={[
            ...clusterInteractiveLayerIds(GLOBE_CLUSTER_SPEC),
            ...(showPhotos ? clusterInteractiveLayerIds(PHOTO_CLUSTER_SPEC) : []),
          ]}
          onClick={(event) => {
            void handleClick(event);
          }}
          onLoad={(event) => {
            prepareGlobeBase(event.target, spaceColor);
          }}
          onError={() => onError?.()}
          style={{ width: "100%", height: "100%" }}
        >
          <NavigationControl position="top-right" showCompass={false} />

          {/* Ported from the official "Create and style clusters" example. */}
          <ClusterPointsSource spec={GLOBE_CLUSTER_SPEC} data={geojson} />
          {showPhotos ? (
            <ClusterPointsSource spec={PHOTO_CLUSTER_SPEC} data={photoGeoJson} />
          ) : null}
        </Map>

        {reducedMotion ? null : (
          <div className="absolute left-3 top-3 z-10">
            <Button
              type="button"
              size="sm"
              variant={autoRotate ? "subtle" : "ghost"}
              className="border border-hairline-strong bg-surface-deep/85"
              aria-pressed={autoRotate}
              onClick={() => setAutoRotate((current) => !current)}
            >
              自动旋转
            </Button>
          </div>
        )}

        {/* Same OSM/OpenFreeMap credit plate as the flat map. */}
        <div className="pointer-events-none absolute bottom-1 left-2 z-10 flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded bg-surface-deep/90 px-2 py-0.5">
          <PlacesAttribution provider={null} tone="overlay" />
          <span className="font-mono text-[8px] leading-4 text-ink/60">· OpenFreeMap</span>
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
          <Button type="button" size="sm" variant="outline" onClick={() => onEnterMap?.(selected)}>
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
                      : "border-transparent text-muted hover:bg-ink/[0.025] hover:text-ink"
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
