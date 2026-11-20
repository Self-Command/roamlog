"use client";

import { useMemo, useState } from "react";
import { Download, FileSearch, ShieldCheck } from "lucide-react";

import type { ExportAdminAuditCsvParams } from "@roamlog/api-client";
import { canPlatform } from "@roamlog/contracts";
import type { AuditLog } from "@roamlog/contracts";
import { Badge, Button, EmptyState, Input, Select } from "@roamlog/ui";

import { AdminMutationError } from "../../lib/admin-api-error";
import type { AdminConsoleRole } from "../../lib/admin-types";
import { formatDateTime } from "../../lib/format";
import { AUDIT_ACTOR_TYPE_LABELS, auditTargetTypeLabel } from "../../lib/labels";
import { AdminFilterBar } from "../admin-ui/admin-filter-bar";
import { AdminPageHeader } from "../admin-ui/admin-page-header";

interface AuditViewProps {
  role: AdminConsoleRole;
  entries: readonly AuditLog[];
  exportCsv?: (params: ExportAdminAuditCsvParams) => Promise<string>;
}

interface AuditActorOption {
  value: string;
  label: string;
}

function actorName(actorId: string | null, actorType: AuditLog["actorType"]): string {
  if (actorType === "system") {
    return "系统任务进程";
  }
  return actorId ? `操作者 ${actorId.slice(-8)}` : "未知操作者";
}

function escapeCsvValue(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

const AUDIT_CSV_COLUMNS = [
  "id",
  "createdAt",
  "actorType",
  "actorId",
  "action",
  "targetType",
  "targetId",
  "workspaceId",
  "ip",
  "userAgent",
  "metadata",
] as const;

function downloadCsv(csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "roamlog-admin-audit.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function AuditView({ role, entries, exportCsv }: AuditViewProps) {
  const sourceEntries = entries;
  const [query, setQuery] = useState("");
  const [actorType, setActorType] = useState<"all" | AuditLog["actorType"]>("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [targetTypeFilter, setTargetTypeFilter] = useState("all");
  const [ipQuery, setIpQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const canExport = canPlatform(role, "admin:audit:export");
  const targetTypeOptions = useMemo(
    () => [...new Set(sourceEntries.map((entry) => entry.targetType))].sort(),
    [sourceEntries],
  );
  const actorOptions = useMemo<readonly AuditActorOption[]>(() => {

    // The audit log carries real actor ids but no display names, so the filter
    // offers exactly the actors present on the loaded page. Labels come from
    // actorName(), matching the `actor <id8>` text used by the timeline.
    const labelsByActorId = new Map<string, string>();
    for (const entry of sourceEntries) {
      if (entry.actorType === "system" || !entry.actorId) {
        continue;
      }
      if (!labelsByActorId.has(entry.actorId)) {
        labelsByActorId.set(entry.actorId, actorName(entry.actorId, entry.actorType));
      }
    }

    const options: AuditActorOption[] = [...labelsByActorId].map(([value, label]) => ({
      value,
      label,
    }));
    if (
      actorFilter !== "all" &&
      actorFilter !== "system" &&
      !options.some((option) => option.value === actorFilter)
    ) {
      // Keep an active filter selectable after the loaded page no longer contains
      // that actor, so the control never falls back to a blank selection.
      options.push({ value: actorFilter, label: actorName(actorFilter, "admin") });
    }

    return options.sort(
      (left, right) =>
        left.label.localeCompare(right.label, "zh-CN") || left.value.localeCompare(right.value),
    );
  }, [actorFilter, sourceEntries]);
  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    const normalizedIp = ipQuery.trim().toLocaleLowerCase("zh-CN");
    return sourceEntries.filter((entry) => {
      const matchesQuery =
        !normalizedQuery ||
        `${entry.action} ${entry.targetType} ${entry.actorId ?? ""} ${actorName(
          entry.actorId,
          entry.actorType,
)}`
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedQuery);
      const matchesActor = actorType === "all" || entry.actorType === actorType;
      const matchesActorId =
        actorFilter === "all" ||
        (actorFilter === "system" ? entry.actorType === "system" : entry.actorId === actorFilter);
      const matchesTarget = targetTypeFilter === "all" || entry.targetType === targetTypeFilter;
      const matchesIp =
        !normalizedIp || (entry.ip ?? "").toLocaleLowerCase("zh-CN").includes(normalizedIp);
      const entryDate = entry.createdAt.slice(0, 10);
      const matchesFrom = !fromDate || entryDate >= fromDate;
      const matchesTo = !toDate || entryDate <= toDate;
      return (
        matchesQuery &&
        matchesActor &&
        matchesActorId &&
        matchesTarget &&
        matchesIp &&
        matchesFrom &&
        matchesTo
      );
    });
  }, [
    actorFilter,
    actorType,
    fromDate,
    ipQuery,
    query,
    sourceEntries,
targetTypeFilter,
    toDate,
  ]);

  async function exportAuditCsv() {
    if (!canExport || isExporting) {
      return;
    }

    if (exportCsv) {
      setIsExporting(true);
      try {
        const params: ExportAdminAuditCsvParams = {
          ...(query.trim() ? { q: query.trim() } : {}),
          ...(actorType !== "all" ? { actorType } : {}),
          ...(actorFilter === "system"
            ? { actorType: "system" as const }
            : actorFilter !== "all"
              ? { actorId: actorFilter }
              : {}),
          ...(targetTypeFilter !== "all" ? { targetType: targetTypeFilter } : {}),
          ...(ipQuery.trim() ? { ip: ipQuery.trim() } : {}),
          ...(fromDate ? { from: fromDate } : {}),
          ...(toDate ? { to: toDate } : {}),
          sort: "createdAt:desc",
        };
        const csv = await exportCsv(params);
        downloadCsv(csv);
        setStatusMessage(`已导出审计 CSV。`);
      } catch (error) {
        setStatusMessage(
          error instanceof AdminMutationError
            ? `导出失败：${error.failure.code} · ${error.failure.detail}`
            : "导出失败，请检查 API 与权限后重试。",
        );
      } finally {
        setIsExporting(false);
      }
      return;
    }

    const rows = filteredEntries.map((entry) =>
      AUDIT_CSV_COLUMNS.map((column) =>
        escapeCsvValue(
          column === "metadata" ? JSON.stringify(entry.metadata) : String(entry[column] ?? ""),
        ),
      ).join(","),
    );
    downloadCsv(`\uFEFF${[AUDIT_CSV_COLUMNS.join(","), ...rows].join("\r\n")}\r\n`);
    setStatusMessage(`已导出 ${filteredEntries.length} 条审计事件。`);
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="信任与安全 / 审计"
        title="审计日志"
        description={
          "只追加的管理后台操作记录。"}
        readOnly={role === "analyst"}
        actions={
          <div className="flex flex-col items-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={!canExport || isExporting}
              title={
                canExport
                  ? "导出当前筛选结果为 CSV": "仅分析员及以上角色可导出"
              }
              onClick={exportAuditCsv}
            >
              <Download aria-hidden="true" />
              {isExporting ? "导出中…" : "导出 CSV"}
            </Button>
            {!canExport ? (
              <p className="font-mono text-[9px] text-muted">
                仅分析员及以上角色可导出审计 CSV。
              </p>
            ) : null}
          </div>
        }
      />

      <AdminFilterBar>
        <label className="min-w-0 flex-1">
          <span className="type-eyebrow">搜索动作 / 目标</span>
          <Input
            className="mt-1.5 h-9"
            type="search"
            placeholder="例如 admin.user.suspend"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label className="w-full md:w-36">
          <span className="type-eyebrow">操作者类型</span>
          <Select
            className="mt-1.5 h-9"
            value={actorType}
            onChange={(event) =>
              setActorType(event.currentTarget.value as "all" | AuditLog["actorType"])
            }
          >
            <option value="all">全部类型</option>
            <option value="user">{AUDIT_ACTOR_TYPE_LABELS.user}</option>
            <option value="admin">{AUDIT_ACTOR_TYPE_LABELS.admin}</option>
            <option value="system">{AUDIT_ACTOR_TYPE_LABELS.system}</option>
          </Select>
        </label>
        <label className="w-full md:w-40">
          <span className="type-eyebrow">操作者</span>
          <Select
            className="mt-1.5 h-9"
            value={actorFilter}
            onChange={(event) => setActorFilter(event.currentTarget.value)}
          >
            <option value="all">全部操作者</option>
            <option value="system">系统任务进程</option>
            {actorOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="w-full md:w-36">
          <span className="type-eyebrow">目标类型</span>
          <Select
            className="mt-1.5 h-9"
            value={targetTypeFilter}
            onChange={(event) => setTargetTypeFilter(event.currentTarget.value)}
          >
            <option value="all">全部目标</option>
            {targetTypeOptions.map((targetType) => (
              <option key={targetType} value={targetType}>
                {auditTargetTypeLabel(targetType)}
              </option>
            ))}
          </Select>
        </label>
        <label className="w-full md:w-32">
          <span className="type-eyebrow">IP</span>
          <Input
            className="mt-1.5 h-9"
            type="search"
            placeholder="10.10.2"
            value={ipQuery}
            onChange={(event) => setIpQuery(event.currentTarget.value)}
          />
        </label>
        <label className="w-full md:w-36">
          <span className="type-eyebrow">开始日期</span>
          <Input
            className="mt-1.5 h-9"
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.currentTarget.value)}
          />
        </label>
        <label className="w-full md:w-36">
          <span className="type-eyebrow">结束日期</span>
          <Input
            className="mt-1.5 h-9"
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.currentTarget.value)}
          />
        </label>
        <span className="flex h-9 items-center border-l border-hairline pl-3 font-mono text-[10px] text-muted max-md:hidden">
          {filteredEntries.length} 条事件
        </span>
      </AdminFilterBar>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <section className="rounded-card border border-hairline-strong bg-surface-1">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <div>
              <h2 className="text-[13px] font-medium text-ink">审计时间线</h2>
              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                不可篡改 / 最新在前
              </p>
            </div>
          </div>

          {filteredEntries.length === 0 ? (
            <EmptyState
              icon={FileSearch}
              title="没有匹配审计事件"
              description="调整关键词、操作者类型或日期范围后再试。"
              className="m-4"
            />
          ) : (
            <ol aria-label="审计日志时间线" className="divide-y divide-hairline">
              {filteredEntries.map((entry) => (
                <li key={entry.id} className="px-4 py-4">
                  <div className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-pill border border-hairline-strong bg-surface-2 text-muted"
                    >
                      <ShieldCheck className="size-3" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="font-mono text-[10px] text-body">{entry.action}</h3>
                        <time
                          dateTime={entry.createdAt}
                          className="font-mono text-[9px] text-stone"
                        >
                          {formatDateTime(entry.createdAt)}
                        </time>
                      </div>
                      <p className="mt-1.5 text-[11px] text-muted">
                        <span className="text-body">
                          {actorName(entry.actorId, entry.actorType)}
                        </span>{" "}
                        对 {auditTargetTypeLabel(entry.targetType)} / {entry.targetId.slice(-8)}{" "}
                        执行了操作
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge tone={entry.actorType === "system" ? "slate" : "blue"}>
                          {AUDIT_ACTOR_TYPE_LABELS[entry.actorType]}
                        </Badge>
                        {entry.workspaceId ? (
                          <span className="font-mono text-[8px] text-muted">
                            工作区 {entry.workspaceId.slice(-8)}
                          </span>
                        ) : null}
                        {entry.ip ? (
                          <span className="font-mono text-[8px] text-muted">IP {entry.ip}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="space-y-4">
          {null}
          <section className="rounded-card border border-hairline-strong bg-surface-1 p-4">
            <p className="type-eyebrow">不可篡改性</p>
            <h2 className="mt-2 font-serif text-xl tracking-[-0.025em] text-ink">只追加审计</h2>
            <p className="mt-2 text-[11px] leading-5 text-muted">
              管理器不可编辑或删除审计事件。当前页面不提供任何修改入口，只提供筛选与 CSV 导出。
            </p>
          </section>
          <section className="rounded-card border border-hairline-strong bg-surface-1 p-4">
            <p className="type-eyebrow">事件覆盖</p>
            <dl className="mt-3 space-y-2 text-[11px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">管理员操作</dt>
                <dd className="font-mono text-body">
                  {sourceEntries.filter((entry) => entry.actorType === "admin").length}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">系统操作</dt>
                <dd className="font-mono text-body">
                  {sourceEntries.filter((entry) => entry.actorType === "system").length}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">用户操作</dt>
                <dd className="font-mono text-body">
                  {sourceEntries.filter((entry) => entry.actorType === "user").length}
                </dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>

      <div role="status" aria-live="polite" className="min-h-4 font-mono text-[10px] text-muted">
        {statusMessage}
      </div>
    </div>
  );
}
