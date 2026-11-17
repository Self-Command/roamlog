"use client";

import type { WorkspaceRole } from "@roamlog/contracts";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@roamlog/ui";
import { Images, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { canEdit, useDemoStore } from "@/lib/demo-store";
import { gradientFor, shortDate } from "@/lib/demo-format";

export function PhotosTab({ tripId, role }: { tripId: string; role: WorkspaceRole }) {
  const { state, addMedia } = useDemoStore();
  const photos = useMemo(
    () =>
      state.media
        .filter((media) => media.tripId === tripId)
        .sort((left, right) => (right.date ?? "").localeCompare(left.date ?? "")),
    [state.media, tripId],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const selected = photos.find((photo) => photo.id === selectedId);
  const editable = canEdit(role);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!caption.trim()) return;
    addMedia(tripId, caption.trim(), role);
    setCaption("");
    setUploadOpen(false);
  }

  return (
    <section className="surface-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-hairline p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="type-eyebrow">PHOTOS / {photos.length} FRAMES</p>
          <h2 className="mt-1.5 font-serif text-2xl tracking-[-0.025em] text-ink">旅行相册</h2>
          <p className="mt-2 text-xs text-muted">
            本地渐变帧是明确的无网络占位；真实媒体上传和签名 URL 尚未接入。
          </p>
        </div>
        {editable ? (
          <Button type="button" variant="outline" onClick={() => setUploadOpen(true)}>
            <Plus aria-hidden="true" />
            添加照片
          </Button>
        ) : (
          <Badge tone="slate">VIEWER · 只读</Badge>
        )}
      </div>

      {photos.length ? (
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 sm:gap-3 sm:p-4">
          {photos.map((photo, index) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => setSelectedId(photo.id)}
              aria-label={`查看照片：${photo.caption ?? "旅行现场"}`}
              className={`group relative overflow-hidden rounded-card border border-hairline-strong bg-gradient-to-br ${gradientFor(photo.id)} text-left ${
                index % 5 === 0 ? "row-span-2 min-h-72 sm:min-h-96" : "min-h-36 sm:min-h-44"
              }`}
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(255,255,255,0.18),transparent_42%),linear-gradient(0deg,rgba(0,0,0,0.78),transparent_60%)]" />
              <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
                <span className="rounded-pill border border-white/10 bg-black/45 px-2 py-1 font-mono text-[8px] uppercase tracking-[0.08em] text-white/65 backdrop-blur">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="font-mono text-[8px] uppercase tracking-[0.08em] text-white/45">
                  {photo.date ? shortDate(photo.date) : "LOCAL"}
                </span>
              </div>
              <div className="absolute inset-x-3 bottom-3">
                <p className="line-clamp-2 text-[12px] leading-5 text-white/80">
                  {photo.caption ?? photo.location}
                </p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-6 py-14 text-center">
          <Images aria-hidden="true" className="mx-auto size-5 text-stone" />
          <h3 className="mt-3 font-serif text-2xl text-ink">相册还是空的</h3>
          <p className="mt-2 text-sm text-muted">上传第一张照片，或从日志里关联媒体。</p>
        </div>
      )}

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="sm:max-w-3xl">
          {selected ? (
            <>
              <SheetHeader>
                <Badge tone="neutral">LOCAL MEDIA FIXTURE</Badge>
                <SheetTitle className="mt-2">{selected.caption ?? "旅行现场"}</SheetTitle>
                <SheetDescription>
                  {selected.location ?? "未知地点"} ·{" "}
                  {selected.date ? shortDate(selected.date) : "无日期"}
                </SheetDescription>
              </SheetHeader>
              <div
                className={`relative min-h-[50vh] overflow-hidden rounded-card border border-hairline-strong bg-gradient-to-br ${gradientFor(selected.id)}`}
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_32%_18%,rgba(255,255,255,0.2),transparent_42%)]" />
                <span className="absolute bottom-4 left-4 font-mono text-[9px] uppercase tracking-[0.12em] text-white/45">
                  NO SIGNED URL · GRADIENT PLACEHOLDER
                </span>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <p className="type-eyebrow">LOCAL MEDIA</p>
            <DialogTitle>添加照片</DialogTitle>
            <DialogDescription>
              当前不调用 S3；仅向本地相册追加一张可解释的渐变占位帧。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <FormField label="照片说明" required>
              <Input
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                placeholder="例如：鸭川边的清晨"
              />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setUploadOpen(false)}>
                取消
              </Button>
              <Button type="submit" variant="outline">
                加入相册
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
