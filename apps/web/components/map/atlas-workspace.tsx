"use client";

import type { Trip } from "@roamlog/contracts";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "@roamlog/ui";
import {
  ArrowUpRight,
  Compass,
  Globe2,
  List,
  Map as MapIcon,
  MapPin,
  Search,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  formatDateRange,
  getTripStatusLabel,
  getTripStatusTone,
} from "@/lib/trip-presentation";

import { useAtlasData } from "./atlas-data";
import { AtlasMap, type AtlasPoint } from "./atlas-map";
import type { GlobePoint } from "./globe-view";
import { PhotoLayerToggle, PhotoLocationsPanel } from "./photo-layer";
import { groupPhotos } from "./photo-points";

/**
 * The globe is map code plus MapLibre's globe projection, so it is only
 * downloaded when the view is actually used and never prerendered on the
 * server (WebGL has no server implementation).
 */
const GlobeView = dynamic(() => import("./globe-view"), {
  ssr: false,
  loading: () => (
    <div role="status" className="flex min-h-80 items-center justify-center bg-black">
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
        LOADING GLOBE…
      </p>
    </div>
  ),
});

function countryLabel(code: string | undefined): string {
  if (!code) return "—";
  try {
    return new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function AtlasLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-12 w-56" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-[480px] rounded-card" />
        <Skeleton className="h-[480px] rounded-card" />
      </div>
    </div>
  );
}

export function AtlasWorkspace({ workspaceSlug }: { workspaceSlug: string }) {
  const {
    workspace,
    workspacesQuery,
    tripsQuery,
    trips,
    tripsTruncated,
    stopsByTrip,
    photos,
    isLoading,
    error,
    retry,
  } = useAtlasData(workspaceSlug);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [year, setYear] = useState("all");
  const [view, setView] = useState<"map" | "list">("map");
  const [mapProjection, setMapProjection] = useState<"flat" | "globe">("flat");
  const [weakDevice, setWeakDevice] = useState(false);
  const [globeFailed, setGlobeFailed] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  // The photo layer is on by default — the user asked for the photos to be on
  // the map — and the switch itself only exists when a photo carries GPS.
  const [photoLayer, setPhotoLayer] = useState(true);
  const [activePhotoKey, setActivePhotoKey] = useState<string | null>(null);
  const [focusPhotosToken, setFocusPhotosToken] = useState(0);

  const hasPhotoLocations = photos.length > 0;
  const showPhotos = photoLayer && hasPhotoLocations;
  const photoGroups = useMemo(() => groupPhotos(photos), [photos]);

  // The globe is offered as the overview only when the device can carry it.
  // Weak devices stay on the existing 2D map (see the hint above the map).
  useEffect(() => {
    const reduced =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const lowMemory = typeof deviceMemory === "number" && deviceMemory < 4;
    setWeakDevice(reduced || lowMemory);
    if (reduced || lowMemory) return;
    try {
      const canvas = document.createElement("canvas");
      if (canvas.getContext("webgl2")) setMapProjection("globe");
    } catch {
      // Keep the flat view; the toggle still lets the user try the globe.
    }
  }, []);

  const years = useMemo(
    () =>
      [...new Set(trips.map((trip) => trip.startDate.slice(0, 4)))].sort((left, right) =>
        right.localeCompare(left),
      ),
    [trips],
  );
  const filteredTrips = useMemo(
    () =>
      trips.filter((trip) => {
        const text = `${trip.title} ${trip.destinations.join(" ")} ${trip.tags.join(" ")} ${trip.countryCodes
          .map((code) => countryLabel(code))
          .join(" ")}`.toLocaleLowerCase("zh-CN");
        return (
          (!query.trim() || text.includes(query.trim().toLocaleLowerCase("zh-CN"))) &&
          (status === "all" || trip.status === status) &&
          (year === "all" || trip.startDate.startsWith(year))
        );
      }),
    [query, status, trips, year],
  );
  const selected = filteredTrips.find((trip) => trip.id === selectedId) ?? filteredTrips[0];
  const groups = useMemo(() => {
    const map = new Map<string, Trip[]>();
    filteredTrips.forEach((trip) =>
      map.set(trip.startDate.slice(0, 4), [
        ...(map.get(trip.startDate.slice(0, 4)) ?? []),
        trip,
      ]),
    );
    return [...map.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [filteredTrips]);

  const points = useMemo<AtlasPoint[]>(
    () =>
      filteredTrips.flatMap((trip) =>
        (stopsByTrip.get(trip.id) ?? []).flatMap((stop) => {
          if (stop.lat === null || stop.lng === null) return [];
          return [
            {
              id: `${trip.id}:${stop.id}`,
              tripId: trip.id,
              label: stop.city,
              sublabel: `${trip.title} · ${stop.country}`,
              lat: stop.lat,
              lng: stop.lng,
            },
          ];
        }),
      ),
    [filteredTrips, stopsByTrip],
  );
  const visibleStopCount = filteredTrips.reduce(
    (total, trip) => total + (stopsByTrip.get(trip.id)?.length ?? 0),
    0,
  );
  const mappedStops = filteredTrips.flatMap((trip) =>
    (stopsByTrip.get(trip.id) ?? []).filter(
      (stop): stop is typeof stop & { lat: number; lng: number } =>
        stop.lat !== null && stop.lng !== null,
    ),
  );
  const countries = new Set(mappedStops.map((stop) => stop.countryCode));
  const cities = new Set(mappedStops.map((stop) => stop.city));
  const totalDays = filteredTrips.reduce((sum, trip) => sum + trip.durationDays, 0);
  const unmappedCount = visibleStopCount - mappedStops.length;
  const coverUrl = selected?.cover?.thumbUrl ?? selected?.cover?.url ?? null;

  // Hand-off from the globe: keep the trip selected, then reuse the existing
  // 2D atlas map on the same route.
  function enterFlatMap(point: GlobePoint) {
    if (point.tripId) setSelectedId(point.tripId);
    setMapProjection("flat");
  }

  if (isLoading) {
    return <AtlasLoading />;
  }

  if (error || !workspace || tripsQuery.isError || !tripsQuery.data) {
    return (
      <ErrorState
        title="旅行地图暂时不可用"
        description="工作区、旅行或停靠点没有返回。请稍后重试。"
        retryAction={
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              void workspacesQuery.refetch();
              retry();
            }}
          >
            重新加载
          </Button>
        }
      />
    );
  }

  const header = (
    <>
      <PageHeader
        eyebrow={`ATLAS / ${filteredTrips.length} TRIPS · ${countries.size} COUNTRIES`}
        title="世界足迹"
        description="没有经纬度的停靠点不会出现在地图上。"
        actions={
          <div className="flex items-center rounded-control border border-hairline-strong bg-surface-1 p-1">
            <Button
              type="button"
              variant={view === "map" ? "subtle" : "ghost"}
              size="sm"
              className="border-0"
              aria-pressed={view === "map"}
              onClick={() => setView("map")}
            >
              <MapIcon aria-hidden="true" />
              地图
            </Button>
            <Button
              type="button"
              variant={view === "list" ? "subtle" : "ghost"}
              size="sm"
              className="border-0"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              <List aria-hidden="true" />
              列表
            </Button>
          </div>
        }
      />
    </>
  );

  if (trips.length === 0) {
    return (
      <div>
        {header}
        <EmptyState
          className="mt-6"
          icon={Globe2}
          title="还没有旅行足迹"
          description="创建旅行并添加带经纬度的停靠点后，这里会显示地图标记。"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="surface-card overflow-hidden">
          <div className="flex min-h-14 flex-wrap items-center gap-3 border-b border-hairline px-4 py-2">
            <span className="size-1.5 rounded-pill bg-accent-orange" />
            <p className="type-eyebrow text-body">WORLD / FOOTPRINT</p>
            <span className="hidden font-mono text-[8px] uppercase tracking-[0.08em] text-stone sm:inline">
              {points.length} STOPS · REAL COORDINATES
            </span>
            <div
              role="group"
              aria-label="地图视图切换"
              className="ml-auto flex items-center gap-1 rounded-control border border-hairline-strong bg-surface-1 p-1"
            >
              <Button
                type="button"
                variant={mapProjection === "flat" ? "subtle" : "ghost"}
                size="sm"
                className="border-0"
                aria-pressed={mapProjection === "flat"}
                onClick={() => setMapProjection("flat")}
              >
                <MapIcon aria-hidden="true" />
                平面
              </Button>
              <Button
                type="button"
                variant={mapProjection === "globe" ? "subtle" : "ghost"}
                size="sm"
                className="border-0"
                aria-pressed={mapProjection === "globe"}
                onClick={() => setMapProjection("globe")}
              >
                <Globe2 aria-hidden="true" />
                地球
              </Button>
            </div>

            {/* Only rendered when the workspace really has a photo with GPS, so
                the switch never advertises an empty layer. */}
            {hasPhotoLocations ? (
              <div
                role="group"
                aria-label="地图图层"
                className="flex items-center gap-1 rounded-control border border-hairline-strong bg-surface-1 p-1"
              >
                <PhotoLayerToggle
                  enabled={photoLayer}
                  photoCount={photos.length}
                  onToggle={() => setPhotoLayer((current) => !current)}
                />
              </div>
            ) : null}
          </div>

          {view === "map" ? (
            <div className="relative">
              {weakDevice && mapProjection === "flat" ? (
                <p
                  role="status"
                  className="border-b border-hairline bg-surface-2 px-4 py-2 text-[10px] leading-5 text-muted"
                >
                  已按低内存或减少动效设置默认使用平面视图；可切换到地球。
                </p>
              ) : null}
              {globeFailed ? (
                <p
                  role="status"
                  className="border-b border-hairline bg-surface-2 px-4 py-2 text-[10px] leading-5 text-muted"
                >
                  地球视图加载失败，已回到平面地图。
                </p>
              ) : null}
              {points.length > 0 ? (
                mapProjection === "globe" ? (
                  <GlobeView
                    points={points}
                    photos={photos}
                    showPhotos={showPhotos}
                    focusPhotosToken={focusPhotosToken}
                    onSelectPhotoGroup={setActivePhotoKey}
                    onEnterMap={enterFlatMap}
                    onError={() => {
                      setGlobeFailed(true);
                      setMapProjection("flat");
                    }}
                  />
                ) : (
                  <AtlasMap
                    points={points}
                    selectedTripId={selected?.id}
                    onSelectTrip={setSelectedId}
                    photos={photos}
                    showPhotos={showPhotos}
                    focusPhotosToken={focusPhotosToken}
                    onSelectPhotoGroup={setActivePhotoKey}
                  />
                )
              ) : (
                <div className="flex min-h-80 items-center justify-center p-6">
                  <EmptyState
                    className="w-full max-w-md px-4 py-10"
                    icon={Globe2}
                    title="还没有可显示的地图坐标"
                    description="停靠点补齐经纬度后，这里会出现标记。"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="min-h-80 p-4">
              <div className="mb-3 flex items-center gap-1.5 rounded-control border border-accent-blue/20 bg-accent-blue/10 px-3 py-2 text-[11px] text-accent-blue">
                <List aria-hidden="true" className="size-3.5" />
                低带宽列表视图：地图不可用或不需要瓦片时，所有旅行仍可访问。
              </div>
              {filteredTrips.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {filteredTrips.map((trip) => (
                    <button
                      key={trip.id}
                      type="button"
                      onClick={() => setSelectedId(trip.id)}
                      className={`rounded-card border p-3 text-left ${
                        selected?.id === trip.id
                          ? "border-hairline-strong bg-surface-2"
                          : "border-hairline bg-surface-1 hover:bg-surface-2"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate font-serif text-lg text-ink">{trip.title}</p>
                        <Badge tone={getTripStatusTone(trip.status)}>
                          {getTripStatusLabel(trip.status)}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-muted">
                        {trip.destinations.join(" · ")}
                      </p>
                      <p className="mt-2 font-mono text-[8px] uppercase tracking-[0.08em] text-stone">
                        {trip.countryCodes.map((code) => countryLabel(code)).join(" · ")}
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState
                  className="mt-3 px-4 py-10"
                  title="没有匹配的旅行"
                  description="换一个关键词或清除筛选，查看全部旅行。"
                />
              )}
            </div>
          )}

          {view === "map" && showPhotos && photoGroups.length > 0 ? (
            <PhotoLocationsPanel
              groups={photoGroups}
              photoCount={photos.length}
              activeKey={activePhotoKey}
              onSelect={setActivePhotoKey}
              onZoomToPhotos={() => setFocusPhotosToken((current) => current + 1)}
            />
          ) : null}

          <div className="flex h-10 items-center justify-between gap-3 border-t border-hairline px-4">
            <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-muted">
              VISIBLE {filteredTrips.length} / {trips.length} · {countries.size} COUNTRIES
              {tripsTruncated ? " · 前 100 趟" : ""}
            </p>
            <p className="truncate font-mono text-[8px] uppercase tracking-[0.1em] text-stone">
              {selected ? `SELECTED / ${selected.title}` : "NO SELECTION"}
            </p>
          </div>
        </section>

        <aside className="surface-card flex flex-col gap-3 p-3 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)]">
          {selected ? (
            <div className="overflow-hidden rounded-card border border-hairline-strong bg-surface-2">
              <div className="relative h-28 bg-surface-deep">
                {coverUrl ? (
                  <img src={coverUrl} alt="" className="size-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <MapPin aria-hidden="true" className="size-5 text-stone" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
                <div className="absolute inset-x-3 bottom-3">
                  <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-white/55">
                    {selected.countryCodes.length > 0
                      ? `${selected.countryCodes.map((code) => countryLabel(code)).join(" · ")} / `
                      : ""}
                    {getTripStatusLabel(selected.status)}
                  </p>
                  <h2 className="mt-1 truncate font-serif text-[23px] leading-none text-white">
                    {selected.title}
                  </h2>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[8px] uppercase text-muted">
                    {formatDateRange(selected.startDate, selected.endDate)}
                  </p>
                  <p className="mt-1 truncate text-[10px] text-muted">
                    {selected.destinations.join(" · ")}
                  </p>
                </div>
                <Link
                  href={`/w/${workspaceSlug}/trips/${selected.id}`}
                  className="inline-flex shrink-0 items-center gap-1 text-[10px] text-ink hover:text-accent-orange"
                >
                  打开旅行
                  <ArrowUpRight aria-hidden="true" className="size-3" />
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex min-h-36 flex-col items-center justify-center rounded-card border border-dashed border-hairline-strong text-center">
              <Compass aria-hidden="true" className="size-5 text-stone" />
              <p className="mt-2 font-serif text-lg text-body">选择一个目的地</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-control border border-hairline-strong bg-hairline">
            {[
              ["国家 / 地区", countries.size],
              ["城市", cities.size],
              ["旅行天数", totalDays],
              ["旅行", filteredTrips.length],
            ].map(([label, value]) => (
              <div key={label} className="bg-surface-1 px-3 py-2.5">
                <p className="type-eyebrow">{label}</p>
                <p className="mt-1 font-serif text-xl text-ink">{value}</p>
              </div>
            ))}
          </div>

          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-stone"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索旅行、目的地或标签"
              aria-label="搜索旅行足迹"
              className="h-10 pl-8 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              aria-label="按状态筛选"
              className="h-10 text-[11px]"
            >
              <option value="all">全部状态</option>
              <option value="completed">已归来</option>
              <option value="active">在途</option>
              <option value="upcoming">即将出发</option>
              <option value="planning">计划中</option>
              <option value="wishlist">愿望</option>
            </Select>
            <Select
              value={year}
              onChange={(event) => setYear(event.target.value)}
              aria-label="按年份筛选"
              className="h-10 text-[11px]"
            >
              <option value="all">全部年份</option>
              {years.map((item) => (
                <option key={item} value={item}>
                  {item} 年
                </option>
              ))}
            </Select>
          </div>

          <div className="min-h-52 flex-1 overflow-y-auto pr-1">
            {groups.map(([groupYear, groupTrips]) => (
              <div key={groupYear}>
                <div className="sticky top-0 z-10 flex items-center gap-2 bg-surface-1 py-2">
                  <span className="font-mono text-[10px] text-ink">{groupYear}</span>
                  <span className="h-px flex-1 bg-hairline" />
                  <span className="font-mono text-[8px] text-stone">{groupTrips.length}</span>
                </div>
                {groupTrips.map((trip) => (
                  <button
                    key={trip.id}
                    type="button"
                    onClick={() => setSelectedId(trip.id)}
                    aria-pressed={trip.id === selected?.id}
                    className={`flex w-full items-start gap-2.5 rounded-control p-2 text-left ${
                      trip.id === selected?.id ? "bg-surface-2" : "hover:bg-white/[0.025]"
                    }`}
                  >
                    <span className="relative size-10 shrink-0 overflow-hidden rounded-control border border-hairline bg-surface-2">
                      {trip.cover?.thumbUrl || trip.cover?.url ? (
                        <img
                          src={trip.cover.thumbUrl ?? trip.cover.url ?? ""}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <MapPin className="absolute inset-0 m-auto size-3.5 text-stone" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-body">{trip.title}</span>
                      <span className="mt-0.5 block truncate text-[9px] text-muted">
                        {trip.destinations.join(" · ")}
                      </span>
                      <span className="mt-1 flex items-center justify-between font-mono text-[8px] uppercase text-stone">
                        <span>{trip.startDate}</span>
                        <span>{getTripStatusLabel(trip.status)}</span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          {unmappedCount > 0 ? (
            <p className="border-t border-hairline pt-2 text-[10px] leading-4 text-stone">
              另有 {unmappedCount} 个停靠点缺少经纬度，未显示在地图上。
            </p>
          ) : null}
          {selected && selected.guestNames.length > 0 ? (
            <p className="truncate border-t border-hairline pt-2 text-[10px] text-muted">
              同行：{selected.guestNames.join(" · ")}
            </p>
          ) : null}
        </aside>
      </div>
      <p className="text-[10px] leading-5 text-stone">
        缺少坐标的停靠点不会显示在地图上。
      </p>
    </div>
  );
}