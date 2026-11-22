"use client";

import { useMemo, useState } from "react";
import { HardDrive, ImageIcon, ShieldAlert, Trash2 } from "lucide-react";

import { canPlatform } from "@roamlog/contracts";
import type { MediaStatus } from "@roamlog/contracts";
import { Badge, Button, EmptyState, Input, Select, Switch } from "@roamlog/ui";

import type { AdminConsoleRole } from "../../lib/admin-types";
import { AdminMutationError } from "../../lib/admin-api-error";
import type { AdminMutationPort } from "../../lib/admin-data-source";
import { formatBytes, formatDateTime } from "../../lib/format";
import { MEDIA_STATUS_LABELS } from "../../lib/labels";
import type { AdminMediaItem } from "../../lib/admin-ops-types";
import { AdminFilterBar } from "../admin-ui/admin-filter-bar";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { AdminMetricCard } from "../dashboard/admin-metric-card";
import { DestructiveActionDialog } from "../admin-ui/destructive-action-dialog";

interface MediaViewProps {
  role: AdminConsoleRole;
  media: readonly AdminMediaItem[];
  mutations?: AdminMutationPort;
}

const mediaStatusTones: Record<MediaStatus, "neutral" | "blue" | "green" | "red"> = {
  pending: "neutral",
  processing: "blue",
  ready: "green",
  failed: "red",
};

const previewGradients = [
  "from-surface-2 via-surface-deep to-canvas",
  "from-accent-orange/15 via-surface-2 to-surface-deep",
  "from-accent-blue/15 via-surface-2 to-surface-deep",
  "from-accent-slate/15 via-surface-2 to-surface-deep",
];

function MediaThumbnail({ item, index }: { item: AdminMediaItem; index: number }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(item.thumbnailUrl) && !failed;

  return (
    <div
      className={`relative flex h-36 items-end bg-gradient-to-br ${
        previewGradients[index % previewGradients.length]
      } p-3`}
    >
      {showImage ? (
        <img
          data-testid={`media-thumbnail-${item.id}`}
          src={item.thumbnailUrl ?? undefined}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-canvas/70 via-transparent to-transparent"
      />
      <span className="relative font-mono text-[8px] uppercase tracking-[0.12em] text-ink/70">
        {item.mimeType}
      </span>
    </div>
  );
}

export function MediaView({ role, media, mutations }: MediaViewProps) {
  const [records, setRecords] = useState<readonly AdminMediaItem[]>(media);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | MediaStatus>("all");
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AdminMediaItem | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const canDelete = canPlatform(role, "admin:media:delete");
  const readOnly = role === "analyst";
  const orphanCount = records.filter((item) => item.usage === "orphan").length;
  const totalBytes = records.reduce((total, item) => total + item.sizeBytes, 0);
  const linkedBytes = records
    .filter((item) => item.usage === "linked")
    .reduce((total, item) => total + item.sizeBytes, 0);

  const filteredMedia = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return records.filter((item) => {
      const matchesQuery =
        !normalizedQuery ||
        `${item.fileName} ${item.workspaceName} ${item.caption ?? ""}`
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedQuery);
      return (
        matchesQuery &&
        (status === "all" || item.status === status) &&
        (!orphansOnly || item.usage === "orphan")
      );
    });
  }, [orphansOnly, query, records, status]);

  async function confirmDelete() {
    if (!pendingDelete) {
      return;
    }
    const target = pendingDelete;
    if (mutations) {
      try {
        await mutations.deleteMedia(target.id);
      } catch (error) {
        setStatusMessage(
          error instanceof AdminMutationError
            ? `删除失败：${error.failure.code} · ${error.failure.detail}`
            : "删除失败，请检查 API 与权限后重试。",
        );
        setPendingDelete(null);
        return;
      }
    }
    setRecords((current) => current.filter((item) => item.id !== target.id));
    setStatusMessage(`已删除媒体：${target.fileName}`);
    setPendingDelete(null);
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="内容与资产 / 媒体"
        title="媒体库"
        description={"检查存储用量、处理状态与孤儿对象。"}
        readOnly={readOnly}
        actions={
          <div className="rounded-control border border-hairline bg-surface-1 px-3 py-2">
            <p className="type-eyebrow">存储桶</p>
            <p className="mt-1 font-mono text-[10px] text-body">roamlog-local</p>
          </div>
        }
      />

      <section aria-label="媒体指标" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label="对象总量"
          value={String(records.length)}
          detail={`存储用量 ${formatBytes(totalBytes)}`}
          tone="blue"
          icon={HardDrive}
        />
        <AdminMetricCard
          label="已关联"
          value={String(records.length - orphanCount)}
          detail={`${formatBytes(linkedBytes)} 被日志或封面引用`}
          tone="green"
          icon={ImageIcon}
        />
        <AdminMetricCard
          label="孤儿对象"
          value={String(orphanCount)}
          detail="可安全清理的未引用文件"
          tone={orphanCount > 0 ? "orange" : "neutral"}
          icon={ShieldAlert}
        />
        <AdminMetricCard
          label="处理中 / 失败"
          value={`${records.filter((item) => item.status === "processing").length} / ${records.filter((item) => item.status === "failed").length}`}
          detail="media-processing 队列"
          tone="neutral"
          icon={HardDrive}
        />
      </section>

      <AdminFilterBar>
        <label className="min-w-0 flex-1">
          <span className="type-eyebrow">搜索文件 / 工作区</span>
          <Input
            className="mt-1.5 h-9"
            type="search"
            value={query}
            placeholder="文件名或工作区"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label className="w-full md:w-40">
          <span className="type-eyebrow">处理状态</span>
          <Select
            className="mt-1.5 h-9"
            value={status}
            onChange={(event) => setStatus(event.currentTarget.value as "all" | MediaStatus)}
          >
            <option value="all">全部状态</option>
            <option value="pending">{MEDIA_STATUS_LABELS.pending}</option>
            <option value="ready">{MEDIA_STATUS_LABELS.ready}</option>
            <option value="processing">{MEDIA_STATUS_LABELS.processing}</option>
            <option value="failed">{MEDIA_STATUS_LABELS.failed}</option>
          </Select>
        </label>
        <div className="flex items-center gap-3 rounded-control border border-hairline px-3 py-2">
          <Switch
            aria-label="仅显示孤儿对象"
            checked={orphansOnly}
            onCheckedChange={setOrphansOnly}
          />
          <span className="text-[11px] text-muted">仅看孤儿</span>
        </div>
        <span className="flex h-9 items-center border-l border-hairline pl-3 font-mono text-[10px] text-muted max-md:hidden">
          {filteredMedia.length} / {records.length}
        </span>
      </AdminFilterBar>

      {readOnly ? (
        <div
          role="note"
          className="flex items-center gap-2 rounded-control border border-accent-slate/25 bg-accent-slate/5 px-3 py-2 text-[12px] text-accent-slate"
        >
          <ShieldAlert aria-hidden="true" className="size-4" />
          分析员可查看媒体用量与孤儿检测结果；删除操作保持可见但不可用。
        </div>
      ) : null}

      {filteredMedia.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="没有匹配媒体"
          description="调整关键词、处理状态或孤儿筛选后再试。"
          className="rounded-card border border-hairline-strong bg-surface-1"
        />
      ) : (
        <section aria-label="媒体网格" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredMedia.map((item, index) => (
            <article
              key={item.id}
              aria-label={`媒体 ${item.fileName}`}
              className="overflow-hidden rounded-card border border-hairline-strong bg-surface-1"
            >
              <MediaThumbnail item={item} index={index} />
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-[12px] font-medium text-ink">{item.fileName}</h2>
                    <p className="mt-0.5 truncate font-mono text-[9px] text-muted">
                      {item.workspaceName} · {formatBytes(item.sizeBytes)}
                    </p>
                  </div>
                  <Badge tone={mediaStatusTones[item.status]}>
                    {MEDIA_STATUS_LABELS[item.status]}
                  </Badge>
                </div>
                <p className="mt-2 min-h-8 text-[10px] leading-4 text-muted">
                  {item.caption ?? "未添加说明"}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
                  <Badge tone={item.usage === "orphan" ? "yellow" : "slate"}>
                    {item.usage === "orphan" ? "孤儿" : "已关联"}
                  </Badge>
                  <span className="font-mono text-[8px] text-muted">
                    {formatDateTime(item.createdAt)}
                  </span>
                  <Button
                    variant="danger"
                    size="sm"
                    className="ml-auto"
                    aria-label={`删除媒体 ${item.fileName}`}
                    disabled={!canDelete}
                    title={canDelete ? "删除媒体对象" : "当前角色不可删除媒体"}
                    onClick={() => setPendingDelete(item)}
                  >
                    <Trash2 aria-hidden="true" />
                    删除
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      <div role="status" aria-live="polite" className="min-h-4 font-mono text-[10px] text-muted">
        {statusMessage}
      </div>

      <DestructiveActionDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="删除媒体"
        description="媒体对象进入软删除状态；后续清理任务会处理派生版本。"
        targetName={pendingDelete?.fileName ?? ""}
        confirmationLabel="输入文件名确认"
        confirmActionLabel="确认删除"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
