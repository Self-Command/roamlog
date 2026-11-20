"use client";

import type { Media, Stop, Trip } from "@roamlog/contracts";
import { Button, EmptyState, PageHeader } from "@roamlog/ui";
import { Crosshair, MapPin, Pencil, ImageOff } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";

import { routeCoordinates, stopToPoint, type MapPoint } from "@/components/map/map-types";
import { PhotoLayerToggle } from "@/components/map/photo-layer";
import { photosFromMedia } from "@/components/map/photo-points";
import type { PhotoLightboxItem } from "@/components/media/photo-lightbox";
import { useWorkspaceBySlug } from "@/lib/query";
import { formatDateRange } from "@/lib/trip-presentation";

import { mediaViewerUrl } from "@/components/trip-workspace/media-urls";

import { TripStopMap } from "./trip-stop-map";

/**
 * YARL is client-only (it portals into `document.body`) and 12 KB gzip, so the
 * viewer loads on demand even on the map page.
 */
const PhotoLightbox = dynamic(
  () => import("@/components/media/photo-lightbox").then((module) => module.PhotoLightbox),
  { ssr: false },
);

function coordinateLabel(stop: Stop): string | null {
  if (stop.lat === null || stop.lng === null) return null;
  return `${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}`;
}

export function TripMapPage({
  workspaceSlug,
  tripId,
  trip,
  stops,
  media = [],
}: {
  workspaceSlug: string;
  tripId: string;
  trip: Trip;
  stops: Stop[];
  /** Photos read for this trip (`Media.lat/lng` are the map coordinates). */
  media?: Media[];
}) {
  const { workspace } = useWorkspaceBySlug(workspaceSlug);
  const workspaceRoot = `/w/${workspaceSlug}`;
  const tripHref = `${workspaceRoot}/trips/${tripId}`;
  const editHref = `${tripHref}/edit`;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPhotos, setShowPhotos] = useState(true);
  const [focusPhotosToken, setFocusPhotosToken] = useState(0);
  const [viewerId, setViewerId] = useState<string | null>(null);

  // `stopToPoint` drops stops without coordinates, and `routeCoordinates`
  // keeps the stored `order`, so markers and the dashed polyline are the same
  // WGS-84 values the API returned — no client-side projection.
  const points = useMemo(
    () => stops.map(stopToPoint).filter((point): point is MapPoint => point !== null),
    [stops],
  );
  const route = useMemo(() => routeCoordinates(stops), [stops]);
  const unmappedCount = stops.length - points.length;
  const selectedStop = selectedId ? stops.find((stop) => stop.id === selectedId) : undefined;

  // Only rows with both coordinates become photo points; a photo without GPS is
  // simply not on the map, which is exactly "有位置才上图".
  const photoPoints = useMemo(() => photosFromMedia(media), [media]);
  const absentPhotos = media.length - photoPoints.length;

  const viewerItems = useMemo<PhotoLightboxItem[]>(() => {
    const items: PhotoLightboxItem[] = [];
    for (const item of media) {
      const src = mediaViewerUrl(item);
      if (!src) continue;
      items.push({
        id: item.id,
        src,
        alt: item.caption ?? "旅行照片",
        width: item.width,
        height: item.height,
      });
    }
    return items;
  }, [media]);
  const viewerIndex = viewerId ? viewerItems.findIndex((item) => item.id === viewerId) : -1;

  if (!stops.length) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-5" data-testid="trip-map-page">
        <Breadcrumbs
          workspaceName={workspace?.name ?? workspaceSlug}
          workspaceHref={workspaceRoot}
          tripTitle={trip.title}
          tripHref={tripHref}
        />
        <PageHeader
          eyebrow={`${trip.title} · ${formatDateRange(trip.startDate, trip.endDate)}`}
          title="行程地图"
          description="这趟旅行还没有可以连成路线的停靠点。添加之后，地图会按顺序标出每一站。"
          actions={
            <Button asChild variant="outline">
              <Link href={editHref}>
                <Pencil aria-hidden="true" />
                编辑旅行
              </Link>
            </Button>
          }
        />
        <section className="surface-card overflow-hidden" data-testid="trip-map-card">
          <EmptyState
            icon={MapPin}
            title="这趟旅行还没有停靠点"
            description="先按顺序添加停靠点，地图会把它们连成这趟旅行的路线。可以在旅行编辑页搜索城市，选中地点后经纬度会自动带上。"
            action={
              <Button asChild variant="primary">
                <Link href={editHref}>
                  <MapPin aria-hidden="true" />
                  添加停靠点
                </Link>
              </Button>
            }
          />
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5" data-testid="trip-map-page">
      <Breadcrumbs
        workspaceName={workspace?.name ?? workspaceSlug}
        workspaceHref={workspaceRoot}
        tripTitle={trip.title}
        tripHref={tripHref}
      />
      <PageHeader
        eyebrow={`${trip.title} · ${formatDateRange(trip.startDate, trip.endDate)}`}
        title="行程地图"
        description="停靠点按顺序连成路线。点击地图标记，或点击列表里的停靠点，查看这一站的日期与坐标。"
        actions={
          <Button asChild variant="outline">
            <Link href={editHref}>
              <Pencil aria-hidden="true" />
              编辑旅行
            </Link>
          </Button>
        }
      />

      <section
        className="surface-card overflow-hidden"
        aria-label="路线与停靠点"
        data-testid="trip-map-card"
      >
        <div className="flex flex-col gap-3 border-b border-hairline p-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="type-eyebrow">
              ROUTE / {points.length} MAPPED STOPS · {photoPoints.length} PHOTOS
            </p>
            <h2 className="mt-1 font-serif text-2xl tracking-[-0.025em] text-ink">
              路线与停靠点
            </h2>
            <p className="mt-1.5 text-[11px] text-muted">
              {unmappedCount > 0
                ? `地图只标注带坐标的停靠点；${unmappedCount} 个停靠点还没有坐标。`
                : "按停靠点顺序绘制路线；瓦片或 WebGL 不可用时自动切换为示意图。"}
            </p>
            {photoPoints.length > 0 ? (
              <p className="mt-1 text-[11px] text-muted">
                照片按拍摄位置显示；点击单个照片标记打开全屏查看，点击聚合数字会先放大散开。
              </p>
            ) : media.length > 0 ? (
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
                <ImageOff aria-hidden="true" className="size-3 text-stone" />
                {absentPhotos} 张照片没有拍摄位置，不会出现在地图上。
              </p>
            ) : null}
          </div>
          {photoPoints.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <PhotoLayerToggle
                enabled={showPhotos}
                photoCount={photoPoints.length}
                onToggle={() => setShowPhotos((current) => !current)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFocusPhotosToken((token) => token + 1)}
              >
                <Crosshair aria-hidden="true" />
                缩放到照片
              </Button>
            </div>
          ) : null}
        </div>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_340px] lg:divide-x lg:divide-hairline">
          <div className="relative overflow-hidden border-b border-hairline lg:border-b-0">
            {points.length ? (
              <TripStopMap
                points={points}
                route={route}
                selectedId={selectedId ?? undefined}
                onSelect={setSelectedId}
                photos={photoPoints}
                showPhotos={showPhotos && photoPoints.length > 0}
                focusPhotosToken={focusPhotosToken}
                onOpenPhoto={setViewerId}
              />
            ) : (
              <div className="p-4">
                <EmptyState
                  icon={MapPin}
                  title="停靠点还没有坐标"
                  description="地图只标注带经纬度的停靠点。在旅行编辑页用地点搜索重新选中这些地点，坐标会自动带上。"
                  action={
                    <Button asChild variant="outline">
                      <Link href={editHref}>
                        <Pencil aria-hidden="true" />
                        去编辑旅行补充坐标
                      </Link>
                    </Button>
                  }
                />
              </div>
            )}
          </div>

          <aside className="p-3" aria-label="停靠点列表" data-testid="trip-map-sidebar">
            {selectedStop ? (
              <div
                className="mb-3 rounded-control border border-hairline-strong bg-surface-2 p-3"
                data-testid="trip-map-selected-stop"
              >
                <p className="type-eyebrow">SELECTED STOP</p>
                <p className="mt-1.5 font-serif text-xl text-ink">{selectedStop.city}</p>
                <p className="mt-1 text-[10px] text-muted">
                  {selectedStop.country} · {formatDateRange(selectedStop.startDate, selectedStop.endDate)}
                </p>
                {coordinateLabel(selectedStop) ? (
                  <p className="mt-1 font-mono text-[8px] text-stone">{coordinateLabel(selectedStop)}</p>
                ) : (
                  <p className="mt-1 text-[10px] text-stone">这一站还没有坐标。</p>
                )}
                {selectedStop.notes ? (
                  <p className="mt-2 line-clamp-3 text-[10px] leading-5 text-muted">
                    {selectedStop.notes}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="mb-3 rounded-control border border-dashed border-hairline-strong px-3 py-6 text-center">
                <MapPin aria-hidden="true" className="mx-auto size-4 text-stone" />
                <p className="mt-2 text-[11px] text-muted">
                  {points.length > 0
                    ? "选择地图标记或列表中的停靠点。"
                    : "选择列表中的停靠点查看日期与备注。"}
                </p>
              </div>
            )}

            <div className="border-t border-hairline pt-3">
              <p className="type-eyebrow">STOP LIST / {stops.length}</p>
              <div className="mt-2 max-h-[24rem] space-y-1.5 overflow-y-auto">
                {stops.map((stop, index) => {
                  const selected = stop.id === selectedId;
                  const hasCoordinates = coordinateLabel(stop) !== null;
                  return (
                    <button
                      key={stop.id}
                      type="button"
                      onClick={() => setSelectedId(stop.id)}
                      aria-pressed={selected}
                      aria-label={`定位停靠点 ${stop.city}`}
                      data-testid={`trip-map-stop-${stop.id}`}
                      className={`flex w-full items-center gap-2 rounded-control border px-2 py-1.5 text-left text-[11px] ${
                        selected
                          ? "border-accent-orange/50 bg-surface-2 text-ink"
                          : "border-transparent text-muted hover:bg-white/[0.025] hover:text-ink"
                      }`}
                    >
                      <span className="font-mono text-[8px] text-stone">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          {stop.city} · {stop.country}
                        </span>
                        <span className="mt-0.5 block font-mono text-[8px] uppercase tracking-[0.08em] text-stone">
                          {formatDateRange(stop.startDate, stop.endDate)}
                          {hasCoordinates ? "" : " / 无坐标"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>
      </section>

      <PhotoLightbox
        open={viewerIndex >= 0}
        index={viewerIndex >= 0 ? viewerIndex : 0}
        items={viewerItems}
        onClose={() => setViewerId(null)}
      />
    </div>
  );
}

function Breadcrumbs({
  workspaceName,
  workspaceHref,
  tripTitle,
  tripHref,
}: {
  workspaceName: string;
  workspaceHref: string;
  tripTitle: string;
  tripHref: string;
}) {
  return (
    <nav aria-label="面包屑" className="flex min-w-0 items-center gap-2 text-[12px]">
      <Link href={workspaceHref} className="truncate text-muted hover:text-ink">
        {workspaceName}
      </Link>
      <span aria-hidden="true" className="text-stone">
        /
      </span>
      <Link href={tripHref} className="truncate text-muted hover:text-ink">
        {tripTitle}
      </Link>
      <span aria-hidden="true" className="text-stone">
        /
      </span>
      <span className="truncate text-ink" aria-current="page">
        地图
      </span>
    </nav>
  );
}