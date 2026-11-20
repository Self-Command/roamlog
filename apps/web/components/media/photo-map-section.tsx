"use client";

import { Button } from "@roamlog/ui";
import { Crosshair, ImageOff, MapPin } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import type { PhotoPoint } from "@/components/map/photo-points";

/**
 * Small map inside the photos tab: every photo that carries a GPS pair is a
 * pin, and activating a pin opens the same YARL viewer the grid uses.
 *
 * The clustering stack lives in `MapCanvas` (ported from MapLibre's official
 * cluster example); this surface turns on `photosAsMarkers` instead, because a
 * 300px map inside a tab has no sidebar to be the keyboard equivalent of
 * canvas-only markers. The atlas and the trip map keep clusters.
 */
const MapCanvas = dynamic(() => import("@/components/map/map-canvas"), {
  ssr: false,
  loading: () => (
    <div
      role="status"
      className="flex h-[300px] w-full items-center justify-center bg-surface-deep"
    >
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
        正在加载照片地图…
      </p>
    </div>
  ),
});

export function PhotoMapSection({
  photos,
  onOpenPhoto,
}: {
  photos: readonly PhotoPoint[];
  onOpenPhoto: (photoId: string) => void;
}) {
  const [mapFailed, setMapFailed] = useState(false);
  const [focusToken, setFocusToken] = useState(0);

  return (
    <section
      className="surface-card overflow-hidden"
      aria-label="照片地图"
      data-testid="photo-map-section"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
        <div className="flex items-center gap-2">
          <MapPin aria-hidden="true" className="size-3.5 text-accent-blue" />
          <p className="type-eyebrow">
            PHOTO MAP / {photos.length} 张有位置
          </p>
        </div>
        {photos.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setFocusToken((token) => token + 1)}
          >
            <Crosshair aria-hidden="true" />
            缩放到照片
          </Button>
        ) : null}
      </div>

      {photos.length === 0 ? (
        <div className="flex h-[180px] flex-col items-center justify-center gap-1.5 px-4 text-center">
          <ImageOff aria-hidden="true" className="size-4 text-stone" />
          <p className="text-[11px] leading-5 text-muted">
            这些照片没有拍摄位置。带 GPS 信息的照片上传后会自动出现在这里。
          </p>
        </div>
      ) : mapFailed ? (
        <div className="space-y-2 px-4 py-4">
          <p className="text-[11px] leading-5 text-muted">
            地图暂时无法加载，仍可以从下面的列表打开这些照片查看。
          </p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {photos.map((photo) => (
              <li key={photo.id}>
                <button
                  type="button"
                  onClick={() => onOpenPhoto(photo.id)}
                  className="flex w-full items-center gap-2 rounded-control border border-hairline bg-surface-2 px-2 py-1.5 text-left text-[11px] text-muted hover:text-ink"
                >
                  <MapPin aria-hidden="true" className="size-3 shrink-0 text-accent-blue" />
                  <span className="truncate">{photo.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="relative h-[300px] w-full" data-testid="photo-map-canvas">
          <MapCanvas
            points={[]}
            photos={[...photos]}
            photosAsMarkers
            showPhotos
            focusPhotosToken={focusToken}
            onOpenPhoto={onOpenPhoto}
            onError={() => setMapFailed(true)}
            placesProvider={null}
          />
        </div>
      )}
    </section>
  );
}