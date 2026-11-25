"use client";

import { useDeleteMedia } from "@roamlog/api-client";
import type { Media } from "@roamlog/contracts";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@roamlog/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ImageOff, Images, Info, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import {
  MediaExifDetail,
  MediaExifSummary,
  formatCameraName,
  formatCaptureDate,
  formatExposureSummary,
  hasExactLocation,
} from "@/components/media";
import { photosFromMedia } from "@/components/map/photo-points";

import { deniedReason } from "./capabilities";
import { ReportMenu } from "@/components/moderation/report-menu";
import { ConfirmDialog } from "./dialogs";
import { MEDIA_STATUS_LABELS, shortDateLabel, shortTimestamp } from "./format";
import { mediaGroupKey, mediaPreviewUrl, mediaViewerUrl } from "./media-urls";
import { EmptyBlock, QueryPanel } from "./panel";
import { assertMutationOk, tripWorkspaceKeys, useTripMedia } from "./queries";
import { useTripWorkspace } from "./workspace-context";
import { PhotoUploader } from "@/components/media/photo-uploader";
import { PhotoMapSection } from "@/components/media/photo-map-section";
import type { PhotoLightboxItem } from "@/components/media/photo-lightbox";

/**
 * YARL touches `document.body` (its Portal) and is 12 KB gzip, so the viewer is
 * a client-only chunk that only loads once a photo is actually opened.
 */
const PhotoLightbox = dynamic(
  () => import("@/components/media/photo-lightbox").then((module) => module.PhotoLightbox),
  {
    ssr: false,
    loading: () => (
      <div role="status" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/70">
          正在打开照片查看…
        </p>
      </div>
    ),
  },
);

/**
 * Mirrors the rule `MediaExifSummary` applies internally.
 *
 * The card needs to know *before* rendering whether that component will produce
 * anything, because the plain date line is the fallback it must not shadow: a
 * photo whose only readable tag is, say, `Orientation` has an `exif` object but
 * nothing worth showing, and the row date must still appear.
 */
function hasDisplayableExif(media: Media): boolean {
  if (!media.exif) return false;
  return (
    formatCameraName(media.exif) !== null ||
    formatExposureSummary(media.exif) !== null ||
    formatCaptureDate(media.date ?? null, media.exif) !== null ||
    hasExactLocation(media.exif)
  );
}

function PhotoCard({
  media,
  workspaceId,
  canDelete,
  deleteTitle,
  isNew,
  onDelete,
  onOpenViewer,
  onOpenDetail,
}: {
  media: Media;
  workspaceId: string;
  canDelete: boolean;
  deleteTitle: string;
  isNew: boolean;
  onDelete: () => void;
  onOpenViewer: () => void;
  onOpenDetail: () => void;
}) {
  const url = mediaPreviewUrl(media);
  const label = media.caption ?? "旅行照片";
  const fallbackDate = media.date ? shortDateLabel(media.date) : shortTimestamp(media.createdAt);

  return (
    <li
      data-media-id={media.id}
      data-testid={`photo-card-${media.id}`}
      className={`group relative overflow-hidden rounded-control border bg-surface-2 ${
        isNew ? "border-accent-orange/55 ring-1 ring-accent-orange/30" : "border-hairline"
      }`}
    >
      <div className="relative aspect-[4/3] w-full">
        {url ? (
          <button
            type="button"
            onClick={onOpenViewer}
            aria-label={`打开照片查看：${label}`}
            data-testid={`photo-open-${media.id}`}
            className="block size-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink"
          >
            {/* Signed URLs are per-request and short lived; next/image would need remote-pattern config. */}
            <img src={url} alt={label} loading="lazy" className="size-full object-cover" />
          </button>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 px-3 text-center">
            <ImageOff aria-hidden="true" className="size-4 text-stone" />
            <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
              {MEDIA_STATUS_LABELS[media.status]}
            </p>
            <p className="text-[10px] leading-4 text-stone">图片还在处理中</p>
          </div>
        )}
      </div>

      <div className="space-y-1 border-t border-hairline px-2.5 py-2">
        <p className="truncate text-[11px] leading-4 text-ink">{label}</p>
        {hasDisplayableExif(media) ? (
          <MediaExifSummary exif={media.exif} date={media.date} />
        ) : (
          <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
            {fallbackDate}
          </p>
        )}
        {media.width && media.height ? (
          <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
            {media.width}×{media.height}
          </p>
        ) : null}
        {media.status === "ready" ? null : (
          <Badge tone={media.status === "failed" ? "red" : "yellow"}>
            {MEDIA_STATUS_LABELS[media.status]}
          </Badge>
        )}
      </div>

      <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-control bg-black/60 backdrop-blur-sm">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onOpenDetail}
          aria-label={`查看照片详情：${label}`}
          data-testid={`photo-detail-${media.id}`}
          title={`查看照片详情 ${label}`}
        >
          <Info aria-hidden="true" />
        </Button>
        <ReportMenu
          workspaceId={workspaceId}
          target={{ type: "media", id: media.id, label }}
          label={`更多操作：${label}`}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={!canDelete}
          title={canDelete ? `删除照片 ${label}` : deleteTitle}
          aria-label={`删除照片 ${label}`}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

/**
 * Read-only notice for the trip-level `showExactPhotoLocation` switch.
 *
 * The control itself belongs to the trip settings — the form the header's
 * "编辑旅行" button opens — because it governs the trip, not this tab. Rendering
 * it here made a trip-wide privacy decision look like a per-tab display
 * preference, so this tab only reports the current state and links to where it
 * can be changed.
 *
 * The copy stays inside what the server actually enforces: the flag is read by
 * the public share page only, so it must not claim anything about the in-app map
 * or photo detail. `Trip.showExactPhotoLocation` is optional in the contract, and
 * absent means the product default (`true`).
 */
function ExactLocationNotice({
  exact,
  editHref,
  canEdit,
}: {
  exact: boolean;
  editHref: string;
  canEdit: boolean;
}) {
  return (
    <section className="surface-card flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-[13px] text-ink">公开页显示精确位置：{exact ? "开启" : "关闭"}</p>
        <p className="text-[11px] leading-4 text-muted">
          {exact
            ? "公开分享页会显示照片拍摄的精确位置。"
            : "公开分享页只显示城市，不显示照片拍摄的精确位置。"}
          这是行程设置，不在照片页修改。
        </p>
        {canEdit ? null : (
          <p className="text-[10px] leading-4 text-stone">你没有修改行程设置的权限。</p>
        )}
      </div>
      {canEdit ? (
        <Button asChild variant="ghost" size="sm">
          <Link href={editHref}>编辑旅行</Link>
        </Button>
      ) : null}
    </section>
  );
}

export function PhotosTab({ tripId }: { tripId: string }) {
  const { capabilities, mutate, pending, role, trip, workspace, workspaceSlug } =
    useTripWorkspace();
  const media = useTripMedia(tripId);
  const deleteMedia = useDeleteMedia();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<Media | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [recentIds, setRecentIds] = useState<readonly string[]>([]);
  const [pendingScrollIds, setPendingScrollIds] = useState<readonly string[]>([]);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const groups = useMemo(() => {
    if (media.state !== "ready") return [];
    const byDate = new Map<string, Media[]>();
    for (const item of media.data.items) {
      const key = mediaGroupKey(item);
      byDate.set(key, [...(byDate.get(key) ?? []), item]);
    }
    return [...byDate.entries()].sort((left, right) => right[0].localeCompare(left[0]));
  }, [media]);

  const orderedMedia = useMemo(() => groups.flatMap(([, items]) => items), [groups]);

  /**
   * Viewer order follows the grid's order (date groups, newest first), and the
   * index is always resolved from the photo id — never from a cluster/group
   * index — so a place with several photos cannot open the wrong one (spec §E.2
   * S2). Signed `thumb/display` URLs expire after 900 s; a refetch hands back
   * new references and YARL updates its slides in place.
   */
  const viewerItems = useMemo<PhotoLightboxItem[]>(() => {
    const items: PhotoLightboxItem[] = [];
    for (const item of orderedMedia) {
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
  }, [orderedMedia]);

  const viewerIndex = viewerId
    ? viewerItems.findIndex((item) => item.id === viewerId)
    : -1;

  const detailMedia = detailId
    ? (media.state === "ready"
        ? media.data.items.find((item) => item.id === detailId)
        : undefined) ?? null
    : null;

  const photoPoints = useMemo(
    () => (media.state === "ready" ? photosFromMedia(media.data.items) : []),
    [media],
  );

  const deleteTitle = capabilities.deleteMedia ? undefined : deniedReason(role, "删除照片");
  // Absent means the default the product decided on: a shared trip shows the
  // exact point a photo was taken at. Display only — the switch is a trip
  // setting and lives in the edit form this tab links to.
  const showExactLocation = trip.showExactPhotoLocation !== false;

  const refreshMedia = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: tripWorkspaceKeys.media(tripId) });
  }, [queryClient, tripId]);

  const openViewer = useCallback(
    (mediaId: string) => {
      // A photo still processing has no signed URL yet; its detail panel is the
      // honest surface (the real status, never a fake image).
      if (viewerItems.some((item) => item.id === mediaId)) {
        setViewerId(mediaId);
        return;
      }
      setDetailId(mediaId);
    },
    [viewerItems],
  );

  const handleUploaded = useCallback((mediaIds: readonly string[]) => {
    setRecentIds(mediaIds);
    setPendingScrollIds(mediaIds);
  }, []);

  // Scroll to the first photo of the batch once the refetched grid actually has it.
  useEffect(() => {
    if (pendingScrollIds.length === 0 || media.state !== "ready") return;
    const container = gridRef.current;
    if (!container) return;
    const first = pendingScrollIds[0];
    if (!first) return;
    const target = container.querySelector<HTMLElement>(`[data-media-id="${first}"]`);
    if (!target) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    setPendingScrollIds([]);
  }, [media, pendingScrollIds]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const deleted = await mutate({
      label: "这张照片",
      execute: async () => {
        const response = await deleteMedia.mutateAsync({ mediaId: target.id });
        assertMutationOk(response, `/v1/media/${target.id}`);
        return response;
      },
      forbidden: "你没有删除照片的权限。请联系工作区所有者或管理员。",
      failure: "照片没有删除，请重试。",
    });
    if (deleted) setDeleteTarget(null);
  }

  const detailUrl = detailMedia ? mediaPreviewUrl(detailMedia) : null;
  const detailLabel = detailMedia?.caption ?? "旅行照片";

  return (
    <>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="type-eyebrow">照片库</p>
          <PhotoUploader
            workspaceId={workspace.id}
            tripId={tripId}
            canUpload={capabilities.presignMedia}
            role={role}
            onUploaded={handleUploaded}
          />
        </div>

        <ExactLocationNotice
          exact={showExactLocation}
          editHref={`/w/${workspaceSlug}/trips/${trip.id}/edit`}
          canEdit={capabilities.updateTrip}
        />

        {media.state === "ready" && media.data.items.length > 0 ? (
          <PhotoMapSection photos={photoPoints} onOpenPhoto={openViewer} />
        ) : null}

        <QueryPanel
          title="照片"
          meta={
            media.state === "ready"
              ? `${media.data.items.length} 张${media.data.hasMore ? " · 仅显示最近 100 张" : ""}`
              : "读取中"
          }
          result={media}
          errorTitle="照片读取失败"
          skeletonRows={2}
          isEmpty={(data) => data.items.length === 0}
          empty={
            <EmptyBlock
              icon={Images}
              title="这趟旅行还没有照片"
              description="上传照片后，这里会按旅行与日期归档。"
            />
          }
        >
          {() => (
            <div ref={gridRef} className="space-y-5 px-4 py-4">
              {groups.map(([date, items]) => (
                <section key={date} className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-xs font-medium text-ink">
                      {shortDateLabel(date)}
                    </h3>
                    <span className="text-[11px] text-stone">{items.length} 张</span>
                  </div>
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                    {items.map((item) => (
                      <PhotoCard
                        key={item.id}
                        media={item}
                        workspaceId={workspace.id}
                        canDelete={capabilities.deleteMedia}
                        deleteTitle={deleteTitle ?? ""}
                        isNew={recentIds.includes(item.id)}
                        onDelete={() => setDeleteTarget(item)}
                        onOpenViewer={() => openViewer(item.id)}
                        onOpenDetail={() => setDetailId(item.id)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </QueryPanel>
      </div>

      <Dialog
        open={Boolean(detailMedia)}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      >
        <DialogContent
          className="max-w-2xl"
          onEscapeKeyDown={(event) => {
            // YARL already stops Escape propagation; this is the second lock so a
            // viewer closing can never take the detail dialog with it.
            if (viewerId) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle className="truncate">{detailLabel}</DialogTitle>
            <DialogDescription>
              没有拍摄参数的照片只显示图片本身。
            </DialogDescription>
          </DialogHeader>
          {detailMedia ? (
            <div className="space-y-4">
              {detailUrl ? (
                <div className="space-y-2">
                  <img
                    src={detailUrl}
                    alt={detailLabel}
                    className="max-h-[55vh] w-full rounded-control object-contain"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setViewerId(detailMedia.id)}
                  >
                    全屏查看
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted">图片还在处理中。</p>
              )}
              {detailMedia.exif ? (
                <MediaExifDetail exif={detailMedia.exif} date={detailMedia.date} />
              ) : (
                <p className="text-xs text-muted">这张照片没有可读取的拍摄参数。</p>
              )}
              {detailMedia.location ? (
                <p className="font-mono text-[11px] text-white/75">
                  拍摄地：{detailMedia.location}
                </p>
              ) : null}
              {detailMedia.lat !== null && detailMedia.lat !== undefined &&
              detailMedia.lng !== null && detailMedia.lng !== undefined ? (
                <p className="font-mono text-[10px] text-stone" data-testid="photo-detail-coordinates">
                  {detailMedia.lat.toFixed(6)}, {detailMedia.lng.toFixed(6)}
                </p>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <PhotoLightbox
        open={viewerIndex >= 0}
        index={viewerIndex >= 0 ? viewerIndex : 0}
        items={viewerItems}
        onClose={() => setViewerId(null)}
        onImageError={refreshMedia}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除这张照片？"
        description="删除后照片不再出现在旅行相册和分享页；存储清理会自动完成。"
        pending={pending}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
