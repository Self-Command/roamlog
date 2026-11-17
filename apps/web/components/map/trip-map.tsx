"use client";

import { Button } from "@roamlog/ui";
import { List, Map as MapIcon, MapPin } from "lucide-react";
import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { MapFallback } from "./map-fallback";
import {
  routeCoordinates,
  stopToPoint,
  type CitySearchResult,
  type MapPoint,
  type MapStop,
} from "./map-types";
import { CitySearch } from "./city-search";

const MapCanvas = lazy(() => import("./map-canvas"));

export interface TripMapProps {
  stops: MapStop[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  forceFallback?: boolean;
  allowSearch?: boolean;
  className?: string;
}

export function TripMap({
  stops,
  selectedId,
  onSelect,
  forceFallback = false,
  allowSearch = true,
  className,
}: TripMapProps) {
  const [mode, setMode] = useState<"map" | "list">("map");
  const [mapFailed, setMapFailed] = useState(false);
  const [webglAvailable, setWebglAvailable] = useState(false);
  const [previewPoints, setPreviewPoints] = useState<MapPoint[]>([]);
  const [activeId, setActiveId] = useState(selectedId);

  useEffect(() => setActiveId(selectedId), [selectedId]);

  useEffect(() => {
    if (forceFallback) return;
    try {
      const canvas = document.createElement("canvas");
      const available = Boolean(
        canvas.getContext("webgl2") || canvas.getContext("webgl"),
      );
      setWebglAvailable(available);
    } catch {
      setWebglAvailable(false);
    }
  }, [forceFallback]);

  const points = useMemo(() => {
    const stopPoints = stops
      .map(stopToPoint)
      .filter((point): point is MapPoint => point !== null);
    const known = new Set(stopPoints.map((point) => point.id));
    return [...stopPoints, ...previewPoints.filter((point) => !known.has(point.id))];
  }, [stops, previewPoints]);
  const route = useMemo(() => routeCoordinates(stops), [stops]);
  const selectedStop =
    stops.find((stop) => stop.id === activeId) ??
    stops.find((stop) => stop.id === selectedId);

  function selectPoint(id: string) {
    setActiveId(id);
    onSelect?.(id);
  }

  function addCity(result: CitySearchResult) {
    const point: MapPoint = {
      id: `search:${result.id}`,
      label: result.name,
      sublabel: result.country,
      lat: result.lat,
      lng: result.lng,
    };
    setPreviewPoints((current) => [...current.filter((item) => item.id !== point.id), point]);
    setActiveId(point.id);
  }

  const fallback = mode === "list" || forceFallback || mapFailed || !webglAvailable;

  return (
    <section className={`surface-card overflow-hidden ${className ?? ""}`}>
      <div className="flex flex-col gap-3 border-b border-hairline p-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="type-eyebrow">ROUTE / {stops.length} STOPS</p>
          <h2 className="mt-1 font-serif text-2xl tracking-[-0.025em] text-ink">路线与停靠点</h2>
          <p className="mt-1.5 text-[11px] text-muted">
            MapLibre 交互地图。瓦片或 WebGL 不可用时自动切换为可访问列表。
          </p>
        </div>
        <div className="flex items-center gap-1 self-start rounded-control border border-hairline-strong bg-surface-2 p-1 sm:self-auto">
          <Button
            type="button"
            variant={mode === "map" ? "subtle" : "ghost"}
            size="sm"
            className="border-0"
            aria-pressed={mode === "map"}
            onClick={() => setMode("map")}
          >
            <MapIcon aria-hidden="true" />
            地图
          </Button>
          <Button
            type="button"
            variant={mode === "list" ? "subtle" : "ghost"}
            size="sm"
            className="border-0"
            aria-pressed={mode === "list"}
            onClick={() => setMode("list")}
          >
            <List aria-hidden="true" />
            列表
          </Button>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px] lg:divide-x lg:divide-hairline">
        <div className="relative min-h-72 overflow-hidden border-b border-hairline lg:border-b-0">
          {fallback ? (
            <MapFallback
              stops={stops}
              points={points}
              selectedId={activeId}
              onSelect={selectPoint}
              reason={mode === "list" ? "manual" : "unavailable"}
            />
          ) : (
            <MapErrorBoundary onError={() => setMapFailed(true)}>
              <Suspense
                fallback={
                  <div
                    role="status"
                    className="flex min-h-72 items-center justify-center bg-surface-deep"
                  >
                    <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
                      LOADING MAP TILES…
                    </p>
                  </div>
                }
              >
                <MapCanvas
                  points={points}
                  route={route}
                  selectedId={activeId}
                  onSelect={selectPoint}
                  onError={() => setMapFailed(true)}
                />
              </Suspense>
            </MapErrorBoundary>
          )}
        </div>

        <aside className="max-h-[31rem] overflow-y-auto p-3">
          {selectedStop ? (
            <div className="mb-3 rounded-control border border-hairline-strong bg-surface-2 p-3">
              <p className="type-eyebrow">SELECTED STOP</p>
              <p className="mt-1.5 font-serif text-xl text-ink">{selectedStop.city}</p>
              <p className="mt-1 text-[10px] text-muted">
                {selectedStop.country} · {selectedStop.startDate} → {selectedStop.endDate}
              </p>
              {selectedStop.lat !== null && selectedStop.lng !== null ? (
                <p className="mt-1 font-mono text-[8px] text-stone">
                  {selectedStop.lat.toFixed(4)}, {selectedStop.lng.toFixed(4)}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mb-3 rounded-control border border-dashed border-hairline-strong px-3 py-6 text-center">
              <MapPin aria-hidden="true" className="mx-auto size-4 text-stone" />
              <p className="mt-2 text-[11px] text-muted">选择地图标记查看停靠点。</p>
            </div>
          )}

          {allowSearch ? (
            <div className="space-y-2 border-t border-hairline pt-3">
              <p className="type-eyebrow">CITY SEARCH / 300MS</p>
              <CitySearch onSelect={addCity} />
              <p className="text-[9px] leading-4 text-stone">
                搜索结果仅用于地图预览；保存停靠点仍由旅行编辑流程负责。
              </p>
            </div>
          ) : null}

          <div className="mt-3 border-t border-hairline pt-3">
            <p className="type-eyebrow">STOP LIST</p>
            <div className="mt-2 space-y-1.5">
              {stops.map((stop, index) => {
                const selected = stop.id === activeId;
                return (
                  <button
                    key={stop.id}
                    type="button"
                    onClick={() => selectPoint(stop.id)}
                    aria-pressed={selected}
                    className={`flex w-full items-center gap-2 rounded-control border px-2 py-1.5 text-left text-[11px] ${
                      selected
                        ? "border-accent-orange/50 bg-surface-2 text-ink"
                        : "border-transparent text-muted hover:bg-white/[0.025] hover:text-ink"
                    }`}
                  >
                    <span className="font-mono text-[8px] text-stone">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="truncate">
                      {stop.city} · {stop.country}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

class MapErrorBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch() {
    this.props.onError();
  }

  override render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="flex min-h-72 items-center justify-center bg-surface-deep px-6">
          <p className="text-xs text-muted">地图加载失败，已切换到停靠点列表。</p>
        </div>
      );
    }
    return this.props.children;
  }
}
