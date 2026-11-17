"use client";

import { useMemo, useState } from "react";
import { ExternalLink, FileWarning, ShieldAlert, Trash2, Undo2 } from "lucide-react";

import { canPlatform } from "@roamlog/contracts";
import type { TripVisibility } from "@roamlog/contracts";
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Input,
  Select,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@roamlog/ui";

import type { AdminConsoleRole } from "../../lib/fixtures";
import type { AdminDataMode } from "../../lib/admin-data-mode";
import { AdminMutationError } from "../../lib/admin-api-error";
import type { AdminMutationPort } from "../../lib/admin-data-source";
import { formatDateTime } from "../../lib/format";
import { recordMockAuditEvent } from "../../lib/mock-audit";
import {
  CONTENT_KIND_LABELS,
  CONTENT_STATUS_LABELS,
  MOCK_ADMIN_CONTENT,
  type AdminContentItem,
  type ContentKind,
  type ContentModerationStatus,
} from "../../lib/ops-fixtures";
import { AdminFilterBar } from "../admin-ui/admin-filter-bar";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { BulkSelectionBar } from "../admin-ui/bulk-selection-bar";
import { DestructiveActionDialog } from "../admin-ui/destructive-action-dialog";

type ModerationAction =
  { kind: "delete"; items: AdminContentItem[] } | { kind: "restore"; items: AdminContentItem[] };

interface ContentViewProps {
  role: AdminConsoleRole;
  items?: readonly AdminContentItem[];
  mode?: AdminDataMode;
  mutations?: AdminMutationPort;
}

const visibilityLabels: Record<TripVisibility, string> = {
  workspace: "Workspace",
  private: "Private",
  public_link: "Public link",
};

const statusTones: Record<ContentModerationStatus, "green" | "yellow" | "red"> = {
  published: "green",
  flagged: "yellow",
  deleted: "red",
};

export function ContentView({
  role,
  items = MOCK_ADMIN_CONTENT,
  mode = "fixture",
  mutations,
}: ContentViewProps) {
  const [records, setRecords] = useState<readonly AdminContentItem[]>(items);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | ContentKind>("all");
  const [status, setStatus] = useState<"all" | ContentModerationStatus>("all");
  const [visibility, setVisibility] = useState<"all" | TripVisibility>("all");
  const [workspace, setWorkspace] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<ModerationAction | null>(null);
  const [detailItem, setDetailItem] = useState<AdminContentItem | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const readOnly = role === "analyst";
  const canDelete = canPlatform(role, "admin:content:delete");
  const canRestore = canPlatform(role, "admin:content:restore");

  const workspaceOptions = useMemo(() => {
    const map = new Map<string, string>();
    records.forEach((item) => map.set(item.workspaceId, item.workspaceName));
    return [...map.entries()];
  }, [records]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return records.filter((item) => {
      const matchesQuery =
        !normalizedQuery ||
        `${item.title} ${item.excerpt} ${item.authorName}`
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedQuery);
      return (
        matchesQuery &&
        (kind === "all" || item.kind === kind) &&
        (status === "all" || item.status === status) &&
        (visibility === "all" || item.visibility === visibility) &&
        (workspace === "all" || item.workspaceId === workspace)
      );
    });
  }, [kind, query, records, status, visibility, workspace]);

  const selectedItems = records.filter((item) => selectedIds.has(item.id));
  const allSelected =
    filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.id));

  function setSelected(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function actionTarget(action: ModerationAction): string {
    const first = action.items[0];
    return action.items.length === 1 && first ? first.title : `${action.items.length} 条内容`;
  }

  async function confirmAction() {
    if (!pendingAction) {
      return;
    }

    const actionRecord = pendingAction;
    if (mode === "api" && mutations) {
      try {
        await Promise.all(
          actionRecord.items.map((item) =>
            actionRecord.kind === "delete"
              ? mutations.deleteContent(item.kind, item.id)
              : mutations.restoreContent(item.kind, item.id),
          ),
        );
      } catch (error) {
        setStatusMessage(
          error instanceof AdminMutationError
            ? `操作失败：${error.failure.code} · ${error.failure.detail}`
            : "操作失败，请检查 API 与权限后重试。",
        );
        setPendingAction(null);
        return;
      }
    }

    const ids = new Set(actionRecord.items.map((item) => item.id));
    const nextStatus: ContentModerationStatus =
      actionRecord.kind === "delete" ? "deleted" : "published";
    const action =
      actionRecord.kind === "delete" ? "admin.content.delete" : "admin.content.restore";

    setRecords((current) =>
      current.map((item) =>
        ids.has(item.id)
          ? { ...item, status: nextStatus, updatedAt: new Date().toISOString() }
          : item,
      ),
    );
    setSelectedIds(new Set());
    const firstItem = actionRecord.items[0];
    if (mode === "fixture") {
      recordMockAuditEvent({
        action,
        targetType: "content",
        targetId: actionRecord.items.length === 1 && firstItem ? firstItem.id : "batch",
        targetName: actionTarget(actionRecord),
        metadata: {
          mock: true,
          count: actionRecord.items.length,
          previousRole: role,
          nextStatus,
        },
      });
    }
    setStatusMessage(
      `${action} · ${actionRecord.kind === "delete" ? "已软删除" : "已恢复"}：${actionTarget(
        actionRecord,
      )}${mode === "api" ? "（后端审计已写入）" : ""}`,
    );
    setPendingAction(null);
  }

  const actionCopy =
    pendingAction?.kind === "delete"
      ? {
          title: "删除内容",
          description: "内容进入软删除状态，仍可在后台恢复。删除后公开分享链接将立即失效。",
          confirmLabel: "确认删除",
        }
      : {
          title: "恢复内容",
          description: "恢复后将重新对原可见范围开放，操作由后端执行并写入审计。",
          confirmLabel: "确认恢复",
        };

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="TRUST & SAFETY / CONTENT"
        title="内容审核"
        description="按 Workspace、作者、状态与可见性检查旅行、日志和评论，执行带二次确认的软删除与恢复。"
        readOnly={readOnly}
        actions={
          <div className="rounded-control border border-hairline bg-surface-1 px-3 py-2">
            <p className="type-eyebrow">待审核举报</p>
            <p className="mt-1 font-mono text-[11px] text-body">
              {records.reduce((total, item) => total + item.reportCount, 0)} reports
            </p>
          </div>
        }
      />

      <AdminFilterBar>
        <label className="min-w-0 flex-1">
          <span className="type-eyebrow">搜索标题 / 作者</span>
          <Input
            className="mt-1.5 h-9"
            type="search"
            value={query}
            placeholder="例如 直岛、陈墨"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label className="w-full md:w-32">
          <span className="type-eyebrow">内容类型</span>
          <Select
            className="mt-1.5 h-9"
            value={kind}
            onChange={(event) => setKind(event.currentTarget.value as "all" | ContentKind)}
          >
            <option value="all">全部</option>
            <option value="trip">旅行</option>
            <option value="entry">日志</option>
            <option value="comment">评论</option>
          </Select>
        </label>
        <label className="w-full md:w-40">
          <span className="type-eyebrow">内容状态</span>
          <Select
            className="mt-1.5 h-9"
            value={status}
            onChange={(event) =>
              setStatus(event.currentTarget.value as "all" | ContentModerationStatus)
            }
          >
            <option value="all">全部状态</option>
            <option value="published">已发布</option>
            <option value="flagged">待审核</option>
            <option value="deleted">已删除</option>
          </Select>
        </label>
        <label className="w-full md:w-36">
          <span className="type-eyebrow">可见性</span>
          <Select
            className="mt-1.5 h-9"
            value={visibility}
            onChange={(event) => setVisibility(event.currentTarget.value as "all" | TripVisibility)}
          >
            <option value="all">全部</option>
            <option value="workspace">Workspace</option>
            <option value="private">Private</option>
            <option value="public_link">Public link</option>
          </Select>
        </label>
        <label className="w-full md:w-44">
          <span className="type-eyebrow">Workspace</span>
          <Select
            className="mt-1.5 h-9"
            value={workspace}
            onChange={(event) => setWorkspace(event.currentTarget.value)}
          >
            <option value="all">全部 Workspace</option>
            {workspaceOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </label>
      </AdminFilterBar>

      {readOnly ? (
        <div
          role="note"
          className="flex items-center gap-2 rounded-control border border-accent-slate/25 bg-accent-slate/5 px-3 py-2 text-[12px] text-accent-slate"
        >
          <ShieldAlert aria-hidden="true" className="size-4" />
          Analyst 仅可查看内容与审计信号；软删除和恢复保持可见但禁用。
        </div>
      ) : null}

      <BulkSelectionBar
        count={selectedIds.size}
        noun="条内容"
        onClear={() => setSelectedIds(new Set())}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canRestore || !selectedItems.some((item) => item.status === "deleted")}
              onClick={() => setPendingAction({ kind: "restore", items: selectedItems })}
            >
              批量恢复
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!canDelete}
              onClick={() => setPendingAction({ kind: "delete", items: selectedItems })}
            >
              批量软删除
            </Button>
          </>
        }
      />

      <section className="overflow-hidden rounded-card border border-hairline-strong bg-surface-1">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
          <div>
            <h2 className="text-[13px] font-medium text-ink">内容列表</h2>
            <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              trips / entries / comments · {mode}
            </p>
          </div>
          <Badge tone="neutral">{filteredItems.length} rows</Badge>
        </div>

        {filteredItems.length === 0 ? (
          <EmptyState
            icon={FileWarning}
            title="没有匹配内容"
            description="调整搜索、状态、可见性或 Workspace 筛选后再试。"
            className="m-4"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] border-collapse text-left text-[12px]">
              <caption className="sr-only">内容审核列表</caption>
              <thead>
                <tr className="border-b border-hairline font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                  <th scope="col" className="w-10 px-3 py-2.5">
                    <Checkbox
                      aria-label="全选当前内容"
                      checked={allSelected}
                      onCheckedChange={(checked) =>
                        setSelectedIds(
                          checked === true
                            ? new Set(filteredItems.map((item) => item.id))
                            : new Set(),
                        )
                      }
                    />
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    内容
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    Workspace / 作者
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    可见性
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    状态
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    举报
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    更新
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-normal">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {filteredItems.map((item) => (
                  <tr
                    key={item.id}
                    aria-label={`内容 ${item.title}`}
                    className="h-12 transition-colors hover:bg-surface-2/60"
                  >
                    <td className="px-3 py-1.5">
                      <Checkbox
                        aria-label={`选择 ${item.title}`}
                        checked={selectedIds.has(item.id)}
                        onCheckedChange={(checked) => setSelected(item.id, checked === true)}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => setDetailItem(item)}
                        className="group min-w-0 max-w-[340px] rounded-control text-left outline-none focus-visible:ring-2 focus-visible:ring-ink"
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-[8px] uppercase tracking-[0.08em] text-muted">
                            {CONTENT_KIND_LABELS[item.kind]}
                          </span>
                          <span className="truncate text-[12px] font-medium text-ink group-hover:underline group-hover:underline-offset-4">
                            {item.title}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted">
                          {item.excerpt}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="block max-w-[170px] truncate text-[11px] text-body">
                        {item.workspaceName}
                      </span>
                      <span className="block font-mono text-[9px] text-muted">
                        {item.authorName}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge tone={item.visibility === "public_link" ? "orange" : "slate"}>
                        {visibilityLabels[item.visibility]}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge tone={statusTones[item.status]}>
                        {CONTENT_STATUS_LABELS[item.status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-muted">
                      {item.reportCount}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-muted">
                      {formatDateTime(item.updatedAt)}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="查看内容详情"
                          onClick={() => setDetailItem(item)}
                        >
                          <ExternalLink aria-hidden="true" />
                        </Button>
                        {item.status === "deleted" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label="恢复内容"
                            disabled={!canRestore}
                            title={canRestore ? "恢复内容" : "当前角色不可恢复内容"}
                            onClick={() => setPendingAction({ kind: "restore", items: [item] })}
                          >
                            <Undo2 aria-hidden="true" />
                            恢复
                          </Button>
                        ) : (
                          <Button
                            variant="danger"
                            size="sm"
                            aria-label="删除内容"
                            disabled={!canDelete}
                            title={canDelete ? "软删除内容" : "当前角色不可删除内容"}
                            onClick={() => setPendingAction({ kind: "delete", items: [item] })}
                          >
                            <Trash2 aria-hidden="true" />
                            删除
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div role="status" aria-live="polite" className="min-h-4 font-mono text-[10px] text-muted">
        {statusMessage}
      </div>

      <Sheet open={detailItem !== null} onOpenChange={(open) => !open && setDetailItem(null)}>
        <SheetContent>
          {detailItem ? (
            <>
              <SheetHeader>
                <p className="type-eyebrow">CONTENT DETAIL / {detailItem.kind.toUpperCase()}</p>
                <SheetTitle>{detailItem.title}</SheetTitle>
                <SheetDescription>{detailItem.excerpt}</SheetDescription>
              </SheetHeader>
              <div className="flex flex-wrap gap-2">
                <Badge tone={statusTones[detailItem.status]}>
                  {CONTENT_STATUS_LABELS[detailItem.status]}
                </Badge>
                <Badge tone="slate">{visibilityLabels[detailItem.visibility]}</Badge>
                <Badge tone="neutral">{detailItem.workspaceName}</Badge>
              </div>
              <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline bg-hairline">
                {[
                  ["作者", detailItem.authorName],
                  ["举报", String(detailItem.reportCount)],
                  ["创建", formatDateTime(detailItem.createdAt)],
                  ["更新", formatDateTime(detailItem.updatedAt)],
                ].map(([label, value]) => (
                  <div key={label} className="bg-surface-1 p-3">
                    <dt className="type-eyebrow">{label}</dt>
                    <dd className="mt-1.5 truncate text-[12px] text-body">{value}</dd>
                  </div>
                ))}
              </dl>
              {detailItem.shareToken ? (
                <div className="mt-6 rounded-control border border-hairline bg-surface-1 p-3">
                  <p className="type-eyebrow">公开分享</p>
                  <a
                    className="mt-2 inline-flex items-center gap-2 font-mono text-[10px] text-accent-blue underline-offset-4 hover:underline"
                    href={`http://localhost:3000/share/${detailItem.shareToken}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    /share/{detailItem.shareToken}
                    <ExternalLink aria-hidden="true" className="size-3" />
                  </a>
                </div>
              ) : null}
              <p className="mt-6 text-[11px] leading-5 text-muted">
                {mode === "api"
                  ? "内容详情来自 Admin API；删除与恢复 mutation 由后端权限与审计规则约束。"
                  : "内容详情与分享链接均来自 fixture；当前不读取真实数据库，也不会修改生产内容。"}
              </p>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <DestructiveActionDialog
        open={pendingAction !== null}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title={actionCopy.title}
        description={actionCopy.description}
        targetName={pendingAction ? actionTarget(pendingAction) : ""}
        confirmationLabel={
          pendingAction?.items.length === 1 ? "输入内容标题确认" : "输入选中数量确认"
        }
        confirmActionLabel={actionCopy.confirmLabel}
        onConfirm={confirmAction}
      />
    </div>
  );
}
