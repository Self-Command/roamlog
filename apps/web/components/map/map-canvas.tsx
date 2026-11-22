"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { setWorkerUrl } from "maplibre-gl";
import { ImageOff } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import Map, {
  Layer,
  Marker,
  NavigationControl,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";

import type { PlacesProvider } from "@/lib/places-attribution";

import { useReducedMotion } from "../charts/use-reduced-motion";
import {
  ClusterPointsSource,
  clusterInteractiveLayerIds,
  expandClusterIfAny,
  PHOTO_CLUSTER_SPEC,
} from "./cluster-points-source";
import { moveCamera } from "./map-camera";
import type { MapPoint } from "./map-types";
import { photoFocus, photoGroupKey, photosToGeoJson, type PhotoPoint } from "./photo-points";
import { PlacesAttribution } from "./places-attribution";
import { useThemeColor } from "./use-theme-color";

export interface MapCanvasProps {
  points: MapPoint[];
  route?: Array<[number, number]>;
  selectedId?: string;
  onSelect?: (id: string) => void;
  onError?: () => void;
  onReady?: () => void;
  /** Photos that carry GPS; plotted as a cluster stack on the flat map too. */
  photos?: PhotoPoint[];
  /**
   * Render one DOM marker per photo instead of the cluster stack.
   *
   * Used by the photos-tab mini map, where there is no sidebar to act as the
   * keyboard equivalent: canvas cluster markers are not tabbable, a DOM
   * `<Marker>` is. The atlas and the trip map keep the clustered layer.
   */
  photosAsMarkers?: boolean;
  /** The photo-layer switch lives in the atlas toolbar, not on the canvas. */
  showPhotos?: boolean;
  /** Incremented by "缩放到照片"; each change re-frames the photo extent. */
  focusPhotosToken?: number;
  /** Opens the thumbnail panel for one photo place (`null` clears it). */
  onSelectPhotoGroup?: (key: string | null) => void;
  /**
   * Opens the full-screen viewer for one photo. When absent, a single photo
   * click keeps the pre-existing `onSelectPhotoGroup` behaviour (atlas side
   * panel); when present, a cluster still only zooms in.
   */
  onOpenPhoto?: (photoId: string) => void;
  /** Source of the city search shown alongside the map, when known. */
  placesProvider?: PlacesProvider;
}

const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

if (typeof window !== "undefined") {
  setWorkerUrl("https://cdn.jsdelivr.net/npm/maplibre-gl@6.18.0/dist/maplibre-gl-worker.mjs");
}

export default function MapCanvas({
  points,
  route = [],
  selectedId,
  onSelect,
  onError,
  onReady,
  photos = [],
  photosAsMarkers = false,
  showPhotos = false,
  focusPhotosToken = 0,
  onSelectPhotoGroup,
  onOpenPhoto,
  placesProvider = null,
}: MapCanvasProps) {
  const mapRef = useRef<MapRef | null>(null);
  const styleUrl = process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim() || DEFAULT_STYLE_URL;
  const reducedMotion = useReducedMotion();
  const routeColor = useThemeColor("--map-route", "orange");
  const initialViewState = useMemo(
    () => initialView(points, showPhotos ? photos : []),
    [points, photos, showPhotos],
  );
  const clusterPhotos = showPhotos && !photosAsMarkers;
  const photoGeoJson = useMemo(
    () => photosToGeoJson(clusterPhotos ? photos : []),
    [photos, clusterPhotos],
  );

  // Mirrors globe-view.tsx: the token marks a user request, so the camera re-frames
  // once per click and not on every photo-list refresh.
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

  async function handleClick(event: MapLayerMouseEvent) {
    const feature = event.features?.[0];
    if (!feature) return;
    const properties = (feature.properties ?? {}) as Record<string, unknown>;
    const geometry = feature.geometry as { coordinates?: [number, number] };
    if (!geometry.coordinates) return;

    const layerId = (feature.layer as { id?: string } | undefined)?.id;
    if (
      !clusterPhotos ||
      layerId === undefined ||
      !clusterInteractiveLayerIds(PHOTO_CLUSTER_SPEC).includes(layerId)
    ) {
      return;
    }

    if (
      await expandClusterIfAny(event.target, PHOTO_CLUSTER_SPEC, properties, geometry.coordinates)
    ) {
      onSelectPhotoGroup?.(null);
      return;
    }
    const photo = photos.find((item) => item.id === properties.id);
    if (!photo) return;
    // A cluster only expands; a single point either opens the viewer or, for
    // the atlas sidebar, selects its place. Never both — S2 of the spec.
    if (onOpenPhoto) {
      onOpenPhoto(photo.id);
      return;
    }
    onSelectPhotoGroup?.(photoGroupKey(photo));
  }
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
        interactiveLayerIds={clusterPhotos ? clusterInteractiveLayerIds(PHOTO_CLUSTER_SPEC) : []}
        onClick={(event) => {
          void handleClick(event);
        }}
        onLoad={() => {
          onReady?.();
          const map = mapRef.current;
          if (!map) return;
          const coordinates = route.length
            ? route
            : points.length
              ? points.map((point) => [point.lng, point.lat] as [number, number])
              : showPhotos
                ? photos.map((photo) => [photo.lng, photo.lat] as [number, number])
                : [];
          if (coordinates.length > 1) {
            try {
              map.fitBounds(
                [
                  [
                    Math.min(...coordinates.map(([lng]) => lng)),
                    Math.min(...coordinates.map(([, lat]) => lat)),
                  ],
                  [
                    Math.max(...coordinates.map(([lng]) => lng)),
                    Math.max(...coordinates.map(([, lat]) => lat)),
                  ],
                ],
                { padding: 64, maxZoom: 12, duration: 0 },
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
                "line-color": routeColor,
                "line-width": 2,
                "line-opacity": 0.72,
                "line-dasharray": [1.5, 1.5],
              }}
            />
          </Source>
        ) : null}

        {clusterPhotos ? (
          <ClusterPointsSource spec={PHOTO_CLUSTER_SPEC} data={photoGeoJson} />
        ) : null}

        {showPhotos && photosAsMarkers
          ? photos.map((photo) => (
              <Marker
                key={photo.id}
                longitude={photo.lng}
                latitude={photo.lat}
                anchor="center"
                onClick={(event: { originalEvent: Event }) => {
                  event.originalEvent.stopPropagation();
                  onOpenPhoto?.(photo.id);
                }}
              >
                <button
                  type="button"
                  data-testid={`photo-marker-${photo.id}`}
                  data-photo-id={photo.id}
                  aria-label={`打开照片查看：${photo.label}`}
                  title={photo.label}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenPhoto?.(photo.id);
                  }}
                  className="group flex size-10 cursor-zoom-in items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  <span className="flex size-8 items-center justify-center overflow-hidden rounded-full border-2 border-ink/85 bg-surface-deep shadow-lg transition-transform group-hover:scale-110">
                    {photo.thumbUrl ? (
                      // Signed, short-lived S3 URL; next/image has no remote pattern for it.
                      <img
                        src={photo.thumbUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <ImageOff aria-hidden="true" className="size-3.5 text-stone" />
                    )}
                  </span>
                </button>
              </Marker>
            ))
          : null}

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
                className={`group relative flex flex-col items-center outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
                  selected ? "z-10" : ""
                }`}
              >
                <span
                  className={`whitespace-nowrap rounded-pill border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] shadow-lg ${
                    selected
                      ? "border-accent-orange/70 bg-surface-deep/90 text-ink"
                      : "border-hairline-strong bg-surface-deep/80 text-ink/75 group-hover:text-ink"
                  }`}
                >
                  {point.label}
                </span>
                <span
                  className={`mt-1 size-2.5 rounded-full border ${
                    selected ? "border-canvas bg-accent-orange" : "border-canvas/80 bg-ink/85"
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
      <div className="pointer-events-none absolute bottom-1 left-2 z-10 flex max-w-[calc(100%-0.5rem)] items-center gap-1 rounded bg-surface-deep/90 px-2 py-0.5">
        <PlacesAttribution provider={placesProvider} tone="overlay" />
        <span className="font-mono text-[8px] leading-4 text-ink/60">· OpenFreeMap</span>
      </div>
    </div>
  );
}

function initialView(points: MapPoint[], photos: PhotoPoint[] = []) {
  if (!points.length) {
    if (photos.length) {
      return {
        longitude: average(photos.map((photo) => photo.lng)),
        latitude: average(photos.map((photo) => photo.lat)),
        zoom: photos.length > 1 ? 8 : 12,
      };
    }
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
