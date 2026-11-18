"use client";

import { useDeleteMedia } from "@roamlog/api-client";
import type { Media } from "@roamlog/contracts";
import { Badge, Button } from "@roamlog/ui";
import { ImageOff, Images, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { deniedReason } from "./capabilities";
import { ConfirmDialog } from "./dialogs";
import { MEDIA_STATUS_LABELS, shortDateLabel, shortTimestamp } from "./format";
import { mediaGroupKey, mediaPreviewUrl } from "./media-urls";
import { EmptyBlock, QueryPanel } from "./panel";
import { assertMutationOk, useTripMedia } from "./queries";
import { useTripWorkspace } from "./workspace-context";

function PhotoCard({
  media,
  canDelete,
  deleteTitle,
  onDelete,
}: {
  media: Media;
  canDelete: boolean;
  deleteTitle: string;
  onDelete: () => void;
}) {
  const url = mediaPreviewUrl(media);
  const label = media.caption ?? "旅行照片";

  return (
    <li className="group relative overflow-hidden rounded-control border border-hairline bg-surface-2">
      <div className="relative aspect-[4/3] w-full">
        {url ? (
          // Signed URLs are per-request and short lived; next/image would need remote-pattern config.
          <img
            src={url}
            alt={label}
            loading="lazy"
            className="size-full object-cover"
          />
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
        <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
          {media.date ? shortDateLabel(media.date) : shortTimestamp(media.createdAt)}
          {media.width && media.height ? ` · ${media.width}×${media.height}` : ""}
        </p>
        {media.status === "ready" ? null : (
          <Badge tone={media.status === "failed" ? "red" : "yellow"}>
            {MEDIA_STATUS_LABELS[media.status]}
          </Badge>
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onDelete}
        disabled={!canDelete}
        title={canDelete ? `删除照片 ${label}` : deleteTitle}
        aria-label={`删除照片 ${label}`}
        className="absolute right-1.5 top-1.5 bg-black/60 backdrop-blur-sm"
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </li>
  );
}

export function PhotosTab({ tripId }: { tripId: string }) {
  const { capabilities, mutate, pending, role } = useTripWorkspace();
  const media = useTripMedia(tripId);
  const deleteMedia = useDeleteMedia();
  const [deleteTarget, setDeleteTarget] = useState<Media | null>(null);

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

  return (
    <>
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
                      canDelete={capabilities.deleteMedia}
                      deleteTitle={deleteTitle ?? ""}
                      onDelete={() => setDeleteTarget(item)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </QueryPanel>

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