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
import { ImageOff, Images, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
  MediaExifDetail,
  MediaExifSummary,
  formatCameraName,
  formatCaptureDate,
  formatExposureSummary,
  hasExactLocation,
} from "@/components/media";

import { deniedReason } from "./capabilities";
import { ReportMenu } from "@/components/moderation/report-menu";
import { ConfirmDialog } from "./dialogs";
import { MEDIA_STATUS_LABELS, shortDateLabel, shortTimestamp } from "./format";
import { mediaGroupKey, mediaPreviewUrl } from "./media-urls";
import { EmptyBlock, QueryPanel } from "./panel";
import { assertMutationOk, useTripMedia } from "./queries";
import { useTripWorkspace } from "./workspace-context";

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
  onDelete,
  onOpen,
}: {
  media: Media;
  workspaceId: string;
  canDelete: boolean;
  deleteTitle: string;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const url = mediaPreviewUrl(media);
  const label = media.caption ?? "旅行照片";
  const fallbackDate = media.date ? shortDateLabel(media.date) : shortTimestamp(media.createdAt);

  return (
    <li className="group relative overflow-hidden rounded-control border border-hairline bg-surface-2">
      <div className="relative aspect-[4/3] w-full">
        {url ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`查看照片详情：${label}`}
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
            <p className="text-[10px] leading-4 text-stone">暂无签名预览地址</p>
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
          <p className="text-[10px] leading-4 text-stone">当前角色不能修改行程设置。</p>
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
  const [deleteTarget, setDeleteTarget] = useState<Media | null>(null);
  const [detailTarget, setDetailTarget] = useState<Media | null>(null);

  const groups = useMemo(() => {
    if (media.state !== "ready") return [];
    const byDate = new Map<string, Media[]>();
    for (const item of media.data.items) {
      const key = mediaGroupKey(item);
      byDate.set(key, [...(byDate.get(key) ?? []), item]);
    }
    return [...byDate.entries()].sort((left, right) => right[0].localeCompare(left[0]));
  }, [media]);

  const deleteTitle = capabilities.deleteMedia ? undefined : deniedReason(role, "删除照片");
  // Absent means the default the product decided on: a shared trip shows the
  // exact point a photo was taken at. Display only — the switch is a trip
  // setting and lives in the edit form this tab links to.
  const showExactLocation = trip.showExactPhotoLocation !== false;

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
      forbidden: "当前角色不能删除照片。",
      failure: "照片没有删除。",
    });
    if (deleted) setDeleteTarget(null);
  }

  const detailUrl = detailTarget ? mediaPreviewUrl(detailTarget) : null;
  const detailLabel = detailTarget?.caption ?? "旅行照片";

  return (
    <>
      <div className="space-y-3">
        <ExactLocationNotice
          exact={showExactLocation}
          editHref={`/w/${workspaceSlug}/trips/${trip.id}/edit`}
          canEdit={capabilities.updateTrip}
        />

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
              description="照片列表来自真实媒体库。上传入口由媒体组件负责（presign → PUT → complete），本工作台不伪造占位图。"
            />
          }
        >
          {() => (
            <div className="space-y-5 px-4 py-4">
              {groups.map(([date, items]) => (
                <section key={date} className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink">
                      {shortDateLabel(date)}
                    </h3>
                    <span className="font-mono text-[9px] text-stone">{items.length} 张</span>
                  </div>
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                    {items.map((item) => (
                      <PhotoCard
                        key={item.id}
                        media={item}
                        workspaceId={workspace.id}
                        canDelete={capabilities.deleteMedia}
                        deleteTitle={deleteTitle ?? ""}
                        onDelete={() => setDeleteTarget(item)}
                        onOpen={() => setDetailTarget(item)}
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
        open={Boolean(detailTarget)}
        onOpenChange={(open) => {
          if (!open) setDetailTarget(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="truncate">{detailLabel}</DialogTitle>
            <DialogDescription>
              拍摄参数来自上传时读取的真实 EXIF；没有元数据的照片只显示图片本身。
            </DialogDescription>
          </DialogHeader>
          {detailTarget ? (
            <div className="space-y-4">
              {detailUrl ? (
                <img
                  src={detailUrl}
                  alt={detailLabel}
                  className="max-h-[55vh] w-full rounded-control object-contain"
                />
              ) : (
                <p className="text-xs text-muted">暂无签名预览地址。</p>
              )}
              {detailTarget.exif ? (
                <MediaExifDetail exif={detailTarget.exif} date={detailTarget.date} />
              ) : (
                <p className="text-xs text-muted">这张照片没有可读的 EXIF 拍摄参数。</p>
              )}
              {detailTarget.location ? (
                <p className="font-mono text-[11px] text-white/75">拍摄地：{detailTarget.location}</p>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除这张照片？"
        description="软删除后照片不再出现在旅行相册和分享页。存储对象由服务端清理。"
        pending={pending}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
