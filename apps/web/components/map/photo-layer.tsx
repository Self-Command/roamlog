"use client";

import { Button } from "@roamlog/ui";
import { Crosshair, ImageOff, MapPin } from "lucide-react";

import type { PhotoGroup, PhotoPoint } from "./photo-points";

/**
 * The photo-location panel that sits under the map canvas.
 *
 * It is the keyboard- and screen-reader-equivalent entry point for the photo
 * markers (canvas markers cannot be tabbed to, exactly like the globe's
 * LOCATION LIST) and it renders the thumbnails of whichever place was opened,
 * either by clicking a marker on the map or by activating a row here.
 */
export function PhotoLocationsPanel({
  groups,
  photoCount,
  activeKey,
  onSelect,
  onZoomToPhotos,
}: {
  groups: PhotoGroup[];
  photoCount: number;
  activeKey: string | null;
  onSelect: (key: string | null) => void;
  onZoomToPhotos: () => void;
}) {
  const active = groups.find((group) => group.key === activeKey) ?? null;

  return (
    <div
      className="border-t border-hairline bg-surface-1 px-3 py-3"
      data-testid="photo-locations-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="size-1.5 rounded-pill bg-accent-blue" />
        <p className="type-eyebrow text-body">PHOTO LOCATIONS / {photoCount}</p>
        <span className="font-mono text-[8px] uppercase tracking-[0.08em] text-stone">
          {groups.length} PLACES · GPS
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={onZoomToPhotos}
        >
          <Crosshair aria-hidden="true" />
          缩放到照片
        </Button>
      </div>

      <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
        {groups.map((group) => {
          const isActive = group.key === activeKey;
          return (
            <li key={group.key}>
              <button
                type="button"
                onClick={() => onSelect(isActive ? null : group.key)}
                aria-pressed={isActive}
                className={`flex w-full items-center justify-between gap-3 rounded-control border px-2 py-1.5 text-left text-[11px] ${
                  isActive
                    ? "border-accent-blue/50 bg-surface-2 text-ink"
                    : "border-transparent text-muted hover:bg-white/[0.025] hover:text-ink"
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <MapPin aria-hidden="true" className="size-3 shrink-0 text-accent-blue" />
                  <span className="truncate">
                    {group.photos.length > 1
                      ? `${group.photos[0]?.label ?? "照片位置"} · ${group.photos.length} 张`
                      : (group.photos[0]?.label ?? "照片位置")}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[8px] uppercase tracking-[0.08em] text-stone">
                  {group.lat.toFixed(4)}, {group.lng.toFixed(4)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {active ? (
        <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="该位置的缩略图">
          {active.photos.map((photo) => (
            <li
              key={photo.id}
              className="overflow-hidden rounded-control border border-hairline bg-surface-2"
            >
              <div className="relative h-20 bg-surface-deep">
                {photo.thumbUrl ? (
                  <img
                    src={photo.thumbUrl}
                    alt={photo.sublabel}
                    className="size-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="flex size-full items-center justify-center">
                    <ImageOff aria-hidden="true" className="size-3.5 text-stone" />
                  </span>
                )}
              </div>
              <p className="truncate px-1.5 py-1 font-mono text-[8px] uppercase tracking-[0.06em] text-stone">
                {photo.date ?? "—"}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[10px] leading-4 text-stone">
          点开地图上的蓝色照片标记，或选择上面的位置，查看该处照片缩略图。
        </p>
      )}
    </div>
  );
}

/** The toolbar switch. A native button, so it is tab- and Enter-reachable. */
export function PhotoLayerToggle({
  enabled,
  photoCount,
  onToggle,
}: {
  enabled: boolean;
  photoCount: number;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant={enabled ? "subtle" : "ghost"}
      size="sm"
      className="border-0"
      aria-pressed={enabled}
      onClick={onToggle}
    >
      <MapPin aria-hidden="true" />
      照片图层
      <span className="ml-1 font-mono text-[8px] text-stone">{photoCount}</span>
    </Button>
  );
}

export type { PhotoGroup, PhotoPoint };
