"use client";

import { useDeferredValue, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Flag,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";

import { canPlatform } from "@roamlog/contracts";
import type {
  AdminReportItem,
  ModerationActionKind,
  ReportReason,
  ReportStatus,
  ReportTargetType,
} from "@roamlog/contracts";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Sheet,
  SheetContent,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@roamlog/ui";

import type { AdminConsoleRole } from "../../lib/admin-types";
import { formatDateTime, formatRelativeTime } from "../../lib/format";
import {
  MODERATION_ACTION_LABELS,
  REPORT_REASON_LABELS,
  REPORT_STATUS_LABELS,
  REPORT_TARGET_TYPE_LABELS,
} from "../../lib/labels";
import { AdminFilterBar } from "../admin-ui/admin-filter-bar";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import {
  reportFailure,
  useAdminReportDetail,
  useAdminReports,
  useResolveReport,
  type AdminReportsParams,
} from "./reports-data";

const statusTones: Record<ReportStatus, "orange" | "blue" | "green" | "slate"> = {
  open: "orange",
  in_review: "blue",
  resolved: "green",
  dismissed: "slate",
};

type StatusFilter = "all" | ReportStatus;
type TypeFilter = "all" | ReportTargetType;
type ReasonFilter = "all" | ReportReason;

const TAB_ORDER: StatusFilter[] = ["all", "open", "in_review", "resolved", "dismissed"];

function ReporterLine({ report }: { report: AdminReportItem }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <p className="text-[12px] text-ink">{REPORT_REASON_LABELS[report.reason]}</p>
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-stone">
        举报人 {report.reporterId.slice(-8)}
      </span>
      <span className="font-mono text-[10px] text-stone">{formatDateTime(report.createdAt)}</span>
    </div>
  );
}

export function ContentView({ role }: { role: AdminConsoleRole }) {
  const [status, setStatus] = useState<StatusFilter>("open");
  const [targetType, setTargetType] = useState<TypeFilter>("all");
  const [reason, setReason] = useState<ReasonFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const canResolve = canPlatform(role, "admin:content:delete");
  const canRestore = canPlatform(role, "admin:content:restore");
  const readOnly = !canResolve;

  const params = useMemo<AdminReportsParams>(
    () => ({
      ...(status !== "all" ? { status } : {}),
      ...(targetType !== "all" ? { targetType } : {}),
      ...(reason !== "all" ? { reason } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(deferredQuery ? { q: deferredQuery } : {}),
      limit: 20,
      ...(cursor ? { cursor } : {}),
    }),
    [cursor, deferredQuery, from, reason, status, targetType, to],
  );

  const page = useAdminReports(params);
  const rows = page.data?.items ?? [];
  const detail = useAdminReportDetail(selectedId);
  const resolve = useResolveReport(() => {
    setSelectedId(null);
    setBanner("裁决已记录，队列已重新拉取。");
    void page.refetch();
  });

  function resetPaging() {
    setCursors([]);
  }

  function changeStatus(next: StatusFilter) {
    setStatus(next);
    resetPaging();
  }

  const failure = page.error ? reportFailure(page.error) : null;
  const detailFailure = detail.error ? reportFailure(detail.error) : null;
  const resolveFailure = resolve.error ? reportFailure(resolve.error) : null;
  const selected = detail.data?.report ?? null;

  const emptyTitle = status === "open" ? "暂无待处理举报" : "当前筛选下没有举报";
  const emptyDescription =
    status === "open"
      ? "用户提交举报后会实时出现在这里；当前队列确实是空的。"
      : "调整状态、类型、原因或时间范围后再试。";

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="信任与安全 / 内容"
        title="内容审核"
        description="真实举报队列：用户提交的举报在这里按状态、内容类型与原因筛选，裁决会写审计并重新拉取列表。"
        readOnly={readOnly}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void page.refetch();
            }}
          >
            <RefreshCw aria-hidden="true" />
            刷新队列
          </Button>
        }
      />

      {readOnly ? (
        <div
          role="note"
          className="flex items-center gap-2 rounded-control border border-accent-slate/25 bg-accent-slate/5 px-3 py-2 text-[12px] text-accent-slate"
        >
          <ShieldAlert aria-hidden="true" className="size-4" />
          分析员可查看举报队列与内容快照；裁决操作保持可见但不可用。
        </div>
      ) : null}

      {banner ? (
        <p role="status" className="rounded-control border border-accent-green/25 bg-accent-green/5 px-3 py-2 text-[12px] text-accent-green">
          {banner}
        </p>
      ) : null}

      <Tabs value={status} onValueChange={(value) => changeStatus(value as StatusFilter)}>
        <TabsList aria-label="举报状态">
          {TAB_ORDER.map((value) => (
            <TabsTrigger key={value} value={value}>
              {value === "all" ? "全部" : REPORT_STATUS_LABELS[value]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <AdminFilterBar>
        <label className="min-w-0 flex-1 md:min-w-56">
          <span className="type-eyebrow">搜索内容 / 工作区</span>
          <div className="mt-1.5 flex h-9 items-center gap-2 rounded-control border border-hairline-strong bg-surface-1 px-2.5">
            <Search aria-hidden="true" className="size-3.5 text-muted" />
            <Input
              className="h-full border-0 bg-transparent px-0"
              type="search"
              value={query}
              aria-label="搜索举报"
              placeholder="标题、评论正文、工作区或举报说明"
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                resetPaging();
              }}
            />
          </div>
        </label>
        <label className="w-full md:w-36">
          <span className="type-eyebrow">内容类型</span>
          <Select
            className="mt-1.5 h-9"
            value={targetType}
            onChange={(event) => {
              setTargetType(event.currentTarget.value as TypeFilter);
              resetPaging();
            }}
          >
            <option value="all">全部类型</option>
            {Object.entries(REPORT_TARGET_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label className="w-full md:w-44">
          <span className="type-eyebrow">举报原因</span>
          <Select
            className="mt-1.5 h-9"
            value={reason}
            onChange={(event) => {
              setReason(event.currentTarget.value as ReasonFilter);
              resetPaging();
            }}
          >
            <option value="all">全部原因</option>
            {Object.entries(REPORT_REASON_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <label className="w-full md:w-36">
          <span className="type-eyebrow">开始日期</span>
          <Input
            className="mt-1.5 h-9"
            type="date"
            value={from}
            aria-label="举报起始日期"
            onChange={(event) => {
              setFrom(event.currentTarget.value);
              resetPaging();
            }}
          />
        </label>
        <label className="w-full md:w-36">
          <span className="type-eyebrow">结束日期</span>
          <Input
            className="mt-1.5 h-9"
            type="date"
            value={to}
            aria-label="举报结束日期"
            onChange={(event) => {
              setTo(event.currentTarget.value);
              resetPaging();
            }}
          />
        </label>
      </AdminFilterBar>

      {failure ? (
        <ErrorState
          title="举报队列没有加载"
          description={`${failure.code} · ${failure.detail}`}
          retryAction={
            <Button type="button" variant="outline" onClick={() => void page.refetch()}>
              重试
            </Button>
          }
        />
      ) : page.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-card" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Flag}
          title={emptyTitle}
          description={emptyDescription}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void page.refetch()}>
              重新检查
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-card border border-hairline bg-surface-1">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-hairline bg-surface-2/60 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
                <th scope="col" className="px-4 py-2.5">目标内容</th>
                <th scope="col" className="px-4 py-2.5">举报数</th>
                <th scope="col" className="px-4 py-2.5">最新举报</th>
                <th scope="col" className="px-4 py-2.5">状态</th>
                <th scope="col" className="px-4 py-2.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((report) => (
                <tr key={report.id} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <Badge tone="neutral">{REPORT_TARGET_TYPE_LABELS[report.targetType]}</Badge>
                      <div className="min-w-0">
                        <p className="max-w-md truncate text-[13px] text-ink">{report.target.title}</p>
                        <p className="mt-1 font-mono text-[10px] text-muted">
                          {report.target.authorName} · {report.target.workspaceName} ·{" "}
                          {REPORT_REASON_LABELS[report.reason]}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[12px] text-ink">{report.reportCount}</span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-[12px] text-body">{formatRelativeTime(report.lastReportedAt)}</p>
                    <p className="font-mono text-[10px] text-stone">{formatDateTime(report.lastReportedAt)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTones[report.status]}>{REPORT_STATUS_LABELS[report.status]}</Badge>
                    {report.target.moderatedAt ? (
                      <p className="mt-1 font-mono text-[10px] text-accent-orange">已下架</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setExpanded(false);
                        setSelectedId(report.id);
                      }}
                    >
                      查看详情
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
          {page.data ? `${rows.length} 条 · ${page.data.hasMore ? "还有更多" : "已到末尾"}` : "—"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={cursors.length === 0 || page.isFetching}
            onClick={() => setCursors((current) => current.slice(0, -1))}
          >
            <ChevronLeft aria-hidden="true" />
            上一页
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!page.data?.hasMore || !page.data.nextCursor || page.isFetching}
            onClick={() => {
              const next = page.data?.nextCursor;
              if (next) {
                setCursors((current) => [...current, next]);
              }
            }}
          >
            下一页
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>

      <Sheet
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
          }
        }}
      >
        <SheetContent className="max-w-2xl">
          {selectedId === null ? null : detail.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : detailFailure || !selected ? (
            <ErrorState
              title="举报详情没有加载"
              description={detailFailure ? `${detailFailure.code} · ${detailFailure.detail}` : "举报不存在。"}
              retryAction={
                <Button type="button" variant="outline" onClick={() => void detail.refetch()}>
                  重试
                </Button>
              }
            />
          ) : (
            <div className="space-y-6">
              <div>
                <p className="type-eyebrow">
                  {REPORT_TARGET_TYPE_LABELS[selected.targetType]} · 举报 {selected.id.slice(-8)}
                </p>
                <h2 className="mt-2 font-serif text-2xl leading-tight tracking-[-0.02em] text-ink">
                  {selected.target.title}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone={statusTones[selected.status]}>{REPORT_STATUS_LABELS[selected.status]}</Badge>
                  <span className="font-mono text-[10px] text-muted">
                    {selected.target.authorName} · {selected.target.workspaceName}
                  </span>
                </div>
              </div>

              <section aria-label="内容快照" className="rounded-card border border-hairline bg-surface-2/50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="type-eyebrow">内容快照 / 只读</p>
                  <Badge tone={selected.target.moderatedAt ? "orange" : "neutral"}>
                    {selected.target.moderatedAt
                      ? "管理员已下架"
                      : selected.target.deletedAt
                        ? "作者已删除"
                        : "正常可见"}
                  </Badge>
                </div>
                <p
                  className={`mt-3 whitespace-pre-wrap text-[12px] leading-6 text-body ${
                    expanded ? "" : "line-clamp-4"
                  }`}
                >
                  {selected.target.title}
                </p>
                {selected.target.title.length > 120 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => setExpanded((current) => !current)}
                  >
                    {expanded ? "收起长文本" : "展开长文本"}
                  </Button>
                ) : null}
                <dl className="mt-3 grid gap-1 font-mono text-[10px] text-muted sm:grid-cols-2">
                  <div>目标 ID：{selected.target.id}</div>
                  <div>作者 ID：{selected.target.authorId}</div>
                  <div>作者删除：{formatDateTime(selected.target.deletedAt)}</div>
                  <div>管理员下架：{formatDateTime(selected.target.moderatedAt)}</div>
                </dl>
              </section>

              <section aria-label="全部举报">
                <div className="flex items-center justify-between">
                  <h3 className="font-serif text-lg text-ink">全部举报</h3>
                  <Badge tone="neutral">{detail.data!.reports.length}</Badge>
                </div>
                <ul className="mt-3 space-y-2">
                  {detail.data!.reports.map((report) => (
                    <li key={report.id} className="rounded-card border border-hairline p-3">
                      <ReporterLine report={report} />
                      {report.detail ? (
                        <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-5 text-body">
                          {report.detail}
                        </p>
                      ) : null}
                      <div className="mt-1.5 flex items-center gap-2">
                        <Badge tone={statusTones[report.status]}>{REPORT_STATUS_LABELS[report.status]}</Badge>
                        {report.id === selected.id ? (
                          <span className="font-mono text-[10px] text-stone">当前举报</span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-label="动作历史">
                <h3 className="font-serif text-lg text-ink">动作历史</h3>
                {detail.data!.actions.length === 0 ? (
                  <p className="mt-2 rounded-card border border-dashed border-hairline-strong px-3 py-4 text-center text-[12px] text-muted">
                    还没有裁决动作。
                  </p>
                ) : (
                  <ol className="mt-3 space-y-2">
                    {detail.data!.actions.map((action) => (
                      <li key={action.id} className="flex flex-wrap items-baseline gap-x-2 rounded-card border border-hairline px-3 py-2">
                        <Badge tone="slate">{MODERATION_ACTION_LABELS[action.action]}</Badge>
                        <span className="text-[12px] text-body">{action.note ?? "（无备注）"}</span>
                        <span className="ml-auto font-mono text-[10px] text-stone">
                          {formatDateTime(action.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              {selected.status === "resolved" || selected.status === "dismissed" ? (
                <p className="rounded-control border border-hairline bg-surface-2/50 px-3 py-3 text-[12px] text-muted">
                  该举报已裁决，不能重复裁决。新的举报会以独立记录进入队列。
                </p>
              ) : (
                <ResolveForm
                  disabled={!canResolve || resolve.isPending}
                  canRestore={canRestore}
                  pending={resolve.isPending}
                  failure={resolveFailure}
                  onSubmit={(action, note) => {
                    setBanner(null);
                    resolve.mutate({ id: selected.id, action, note });
                  }}
                />
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ResolveForm({
  disabled,
  canRestore,
  pending,
  failure,
  onSubmit,
}: {
  disabled: boolean;
  canRestore: boolean;
  pending: boolean;
  failure: { code: string; detail: string } | null;
  onSubmit: (action: ModerationActionKind, note?: string) => void;
}) {
  const [action, setAction] = useState<ModerationActionKind>("remove");
  const [note, setNote] = useState("");

  return (
    <form
      aria-label="裁决举报"
      className="space-y-3 rounded-card border border-hairline bg-surface-2/40 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(action, note);
      }}
    >
      <h3 className="font-serif text-lg text-ink">裁决</h3>
      <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
        <label>
          <span className="type-eyebrow">动作</span>
          <Select
            className="mt-1.5 h-9"
            value={action}
            disabled={disabled}
            onChange={(event) => setAction(event.currentTarget.value as ModerationActionKind)}
          >
            <option value="remove">{MODERATION_ACTION_LABELS.remove}</option>
            <option value="restore" disabled={!canRestore}>
              {MODERATION_ACTION_LABELS.restore}
            </option>
            <option value="warn">{MODERATION_ACTION_LABELS.warn}</option>
            <option value="dismiss">{MODERATION_ACTION_LABELS.dismiss}</option>
          </Select>
        </label>
        <label>
          <span className="type-eyebrow">备注（写入动作历史）</span>
          <Textarea
            className="mt-1.5 min-h-9"
            rows={2}
            maxLength={1000}
            value={note}
            disabled={disabled}
            placeholder="可选：说明裁决依据，不写入内容正文"
            onChange={(event) => setNote(event.currentTarget.value)}
          />
        </label>
      </div>
      {failure ? (
        <p role="alert" className="text-[12px] text-accent-red">
          裁决失败：{failure.code} · {failure.detail}
        </p>
      ) : null}
      {disabled && !pending ? (
        <p className="text-[12px] text-muted">当前角色没有裁决权限。</p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" disabled={disabled}>
          {pending ? "正在提交…" : "提交裁决"}
        </Button>
      </div>
    </form>
  );
}