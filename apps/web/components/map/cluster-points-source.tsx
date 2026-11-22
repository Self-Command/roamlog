"use client";

import { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { Layer, Source } from "react-map-gl/maplibre";

import { useThemeColor } from "./use-theme-color";

/**
 * One cluster source + cluster/cluster-count/unclustered-point layer stack,
 * shared by every map surface in this folder.
 *
 * The stack itself is ported from the official MapLibre "Create and style
 * clusters" example (test/examples/create-and-style-clusters.html, repo
 * github.com/maplibre/maplibre-gl-js @ b8a71bd487e97c811da1acc5f4eff707df2da5f8);
 * this module only parameterizes it so the footprint layer (globe-view.tsx) and
 * the photo layer cannot drift into two different clustering behaviours.
 */

export interface ClusterPoint {
  id: string;
  label: string;
  sublabel?: string;
  lat: number;
  lng: number;
  /** Existing atlas trip id; carried through for the flat/globe hand-off. */
  tripId?: string;
}

export interface ClusterSpec {
  sourceId: string;
  clusterLayerId: string;
  countLayerId: string;
  pointLayerId: string;
  /** Semantic token whose resolved value is used for the marker fill. */
  colorToken: `--${string}`;
  /** Named-color fallback before the document theme resolves. */
  fallbackColor: string;
  clusterMaxZoom: number;
  clusterRadius: number;
}

/** Footprint stops — identical ids/paint to the pre-photo globe layer. */
export const GLOBE_CLUSTER_SPEC: ClusterSpec = {
  sourceId: "globe-points",
  clusterLayerId: "globe-clusters",
  countLayerId: "globe-cluster-count",
  pointLayerId: "globe-point",
  colorToken: "--map-marker",
  fallbackColor: "orange",
  clusterMaxZoom: 14,
  clusterRadius: 50,
};

/** Photos carrying GPS. Same stack, different source/layer ids and colour. */
export const PHOTO_CLUSTER_SPEC: ClusterSpec = {
  sourceId: "photo-points",
  clusterLayerId: "photo-clusters",
  countLayerId: "photo-cluster-count",
  pointLayerId: "photo-point",
  colorToken: "--map-route",
  fallbackColor: "blue",
  clusterMaxZoom: 16,
  clusterRadius: 46,
};

/** Layers a map must put in `interactiveLayerIds` for this stack to be clicked. */
export function clusterInteractiveLayerIds(spec: ClusterSpec): string[] {
  return [spec.clusterLayerId, spec.pointLayerId];
}

/** GeoJSON for the cluster source; only points carrying coordinates exist upstream. */
export function pointsToGeoJson(points: ClusterPoint[]) {
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

export function ClusterPointsSource({
  spec,
  data,
}: {
  spec: ClusterSpec;
  data: ReturnType<typeof pointsToGeoJson>;
}) {
  const markerColor = useThemeColor(spec.colorToken, spec.fallbackColor);
  const countColor = useThemeColor("--accent-contrast", "black");
  const strokeColor = useThemeColor("--canvas", "black");

  return (
    <Source
      id={spec.sourceId}
      type="geojson"
      data={data}
      cluster
      clusterMaxZoom={spec.clusterMaxZoom}
      clusterRadius={spec.clusterRadius}
    >
      <Layer
        id={spec.clusterLayerId}
        type="circle"
        filter={["has", "point_count"] as never}
        paint={{
          "circle-color": markerColor,
          "circle-opacity": 0.92,
          "circle-radius": ["step", ["get", "point_count"], 20, 10, 25, 30, 30] as never,
          "circle-stroke-width": 1,
          "circle-stroke-color": strokeColor,
        }}
      />
      <Layer
        id={spec.countLayerId}
        type="symbol"
        filter={["has", "point_count"] as never}
        layout={{
          "text-field": "{point_count_abbreviated}",
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
        }}
        paint={{ "text-color": countColor }}
      />
      <Layer
        id={spec.pointLayerId}
        type="circle"
        filter={["!", ["has", "point_count"]] as never}
        paint={{
          "circle-color": markerColor,
          "circle-radius": 4,
          "circle-stroke-width": 1,
          "circle-stroke-color": strokeColor,
        }}
      />
    </Source>
  );
}

/**
 * Zoom a clicked cluster one step in, the way the official example does.
 *
 * Returns `true` when the click was a cluster (handled here), so the caller can
 * skip its own single-point handling. A cluster whose source is not mounted yet
 * still counts as handled, which is the old `if (!source) return;` behaviour.
 */
export async function expandClusterIfAny(
  map: MapLibreMap,
  spec: ClusterSpec,
  properties: Record<string, unknown>,
  coordinates: [number, number],
): Promise<boolean> {
  if (properties.cluster_id === undefined) return false;
  const source = map.getSource(spec.sourceId) as GeoJSONSource | undefined;
  if (!source) return true;
  const zoom = await source.getClusterExpansionZoom(Number(properties.cluster_id));
  map.easeTo({ center: coordinates, zoom });
  return true;
}
