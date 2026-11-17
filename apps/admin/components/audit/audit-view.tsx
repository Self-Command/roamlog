"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileSearch, ShieldCheck } from "lucide-react";

import type { ExportAdminAuditCsvParams } from "@roamlog/api-client";
import { canPlatform } from "@roamlog/contracts";
import type { AuditLog } from "@roamlog/contracts";
import { Badge, Button, EmptyState, Input, Select } from "@roamlog/ui";

import { AdminMutationError } from "../../lib/admin-api-error";
import { getAdminDataSource } from "../../lib/admin-data-source";
import { MOCK_ADMIN_USERS, type AdminConsoleRole } from "../../lib/fixtures";
import type { AdminDataMode } from "../../lib/admin-data-mode";
import { formatDateTime } from "../../lib/format";
import { readMockAuditEvents } from "../../lib/mock-audit-reader";
import type { MockAuditEvent } from "../../lib/mock-audit";
import { AdminFilterBar } from "../admin-ui/admin-filter-bar";
import { AdminPageHeader } from "../admin-ui/admin-page-header";

interface AuditViewProps {
  role: AdminConsoleRole;
  entries?: readonly AuditLog[];
  mode?: AdminDataMode;
  exportCsv?: (params: ExportAdminAuditCsvParams) => Promise<string>;
}

const actorTypeLabels: Record<AuditLog["actorType"], string> = {
  user: "User",
  admin: "Admin",
  system: "System",
};

function actorName(
  actorId: string | null,
  actorType: AuditLog["actorType"],
  mode: AdminDataMode,
): string {
  if (actorType === "system") {
    return "System worker";
  }
  if (mode === "api") {
    return actorId ? `actor ${actorId.slice(-8)}` : "未知操作者";
  }
  return MOCK_ADMIN_USERS.find((user) => user.id === actorId)?.name ?? "未知管理员";
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

function downloadCsv(csv: string, mode: AdminDataMode): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `roamlog-admin-audit-${mode}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function AuditView({ role, entries, mode = "fixture", exportCsv }: AuditViewProps) {
  const sourceEntries = entries ?? getAdminDataSource().listAuditLogs();
  const [query, setQuery] = useState("");
  const [actorType, setActorType] = useState<"all" | AuditLog["actorType"]>("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [targetTypeFilter, setTargetTypeFilter] = useState("all");
  const [ipQuery, setIpQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [mockEvents, setMockEvents] = useState<MockAuditEvent[]>([]);

  useEffect(() => {
    setMockEvents(readMockAuditEvents().reverse());
  }, []);

  const canExport = canPlatform(role, "admin:audit:export");
  const targetTypeOptions = useMemo(
    () => [...new Set(sourceEntries.map((entry) => entry.targetType))].sort(),
    [sourceEntries],
  );
  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    const normalizedIp = ipQuery.trim().toLocaleLowerCase("zh-CN");
    return sourceEntries.filter((entry) => {
      const matchesQuery =
        !normalizedQuery ||
        `${entry.action} ${entry.targetType} ${entry.actorId ?? ""} ${actorName(
          entry.actorId,
          entry.actorType,
          mode,
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
    mode,
    targetTypeFilter,
    toDate,
  ]);

  async function exportAuditCsv() {
    if (!canExport || isExporting) {
      return;
    }

    if (mode === "api" && exportCsv) {
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
        downloadCsv(csv, "api");
        setStatusMessage(`已从 Admin API 导出审计 CSV。`);
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
    downloadCsv(`\uFEFF${[AUDIT_CSV_COLUMNS.join(","), ...rows].join("\r\n")}\r\n`, mode);
    setStatusMessage(`已导出 ${filteredEntries.length} 条 ${mode} 审计事件。`);
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="TRUST & SAFETY / AUDIT"
        title="审计日志"
        description={
          mode === "api"
            ? "只追加的管理后台操作记录，读取真实 Admin API。"
            : "只追加的管理后台操作记录。当前页面读取本地 fixture；真实日志接入 API 后保持同一展示与筛选结构。"
        }
        readOnly={role === "analyst"}
        actions={
          <div className="flex flex-col items-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={!canExport || isExporting}
              title={
                canExport
                  ? mode === "api"
                    ? "从 Admin API 导出当前筛选结果为 CSV"
                    : "导出当前 fixture 筛选结果为 CSV"
                  : "仅 Analyst 及以上角色可导出"
              }
              onClick={exportAuditCsv}
            >
              <Download aria-hidden="true" />
              {isExporting ? "导出中…" : "导出 CSV"}
            </Button>
            {!canExport ? (
              <p className="font-mono text-[9px] text-muted">
                仅 Analyst 及以上角色可导出审计 CSV。
              </p>
            ) : null}
          </div>
        }
      />

      <AdminFilterBar>
        <label className="min-w-0 flex-1">
          <span className="type-eyebrow">搜索 action / target</span>
          <Input
            className="mt-1.5 h-9"
            type="search"
            placeholder="例如 admin.user.suspend"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label className="w-full md:w-36">
          <span className="type-eyebrow">Actor type</span>
          <Select
            className="mt-1.5 h-9"
            value={actorType}
            onChange={(event) =>
              setActorType(event.currentTarget.value as "all" | AuditLog["actorType"])
            }
          >
            <option value="all">全部类型</option>
            <option value="user">User</option>
            <option value="admin">Admin</option>
            <option value="system">System</option>
          </Select>
        </label>
        <label className="w-full md:w-40">
          <span className="type-eyebrow">Actor</span>
          <Select
            className="mt-1.5 h-9"
            value={actorFilter}
            onChange={(event) => setActorFilter(event.currentTarget.value)}
          >
            <option value="all">全部操作者</option>
            <option value="system">System worker</option>
            {MOCK_ADMIN_USERS.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="w-full md:w-36">
          <span className="type-eyebrow">Target type</span>
          <Select
            className="mt-1.5 h-9"
            value={targetTypeFilter}
            onChange={(event) => setTargetTypeFilter(event.currentTarget.value)}
          >
            <option value="all">全部目标</option>
            {targetTypeOptions.map((targetType) => (
              <option key={targetType} value={targetType}>
                {targetType}
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
          {filteredEntries.length} events
        </span>
      </AdminFilterBar>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <section className="rounded-card border border-hairline-strong bg-surface-1">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <div>
              <h2 className="text-[13px] font-medium text-ink">Audit timeline</h2>
              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                immutable / newest first
              </p>
            </div>
            <Badge tone={mode === "api" ? "green" : "neutral"}>{mode}</Badge>
          </div>

          {filteredEntries.length === 0 ? (
            <EmptyState
              icon={FileSearch}
              title="没有匹配审计事件"
              description="调整关键词、actor 类型或日期范围后再试。"
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
                          {actorName(entry.actorId, entry.actorType, mode)}
                        </span>{" "}
                        对 {entry.targetType} / {entry.targetId.slice(-8)} 执行了操作
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge tone={entry.actorType === "system" ? "slate" : "blue"}>
                          {actorTypeLabels[entry.actorType]}
                        </Badge>
                        {entry.workspaceId ? (
                          <span className="font-mono text-[8px] text-muted">
                            workspace {entry.workspaceId.slice(-8)}
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
          {mode === "fixture" ? (
            <section className="rounded-card border border-hairline-strong bg-surface-1 p-4">
              <p className="type-eyebrow">LOCAL SESSION</p>
              <h2 className="mt-2 font-serif text-xl tracking-[-0.025em] text-ink">
                最近本地模拟操作
              </h2>
              {mockEvents.length === 0 ? (
                <p className="mt-2 text-[11px] leading-5 text-muted">
                  在用户或工作区页面执行带确认的操作后，事件会显示在这里。
                </p>
              ) : (
                <ol className="mt-3 divide-y divide-hairline border-y border-hairline">
                  {mockEvents.slice(0, 5).map((event) => (
                    <li key={event.id} className="py-2.5">
                      <p className="font-mono text-[9px] text-body">{event.action}</p>
                      <p className="mt-1 truncate text-[10px] text-muted">
                        {event.targetName} · {formatDateTime(event.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ) : null}
          <section className="rounded-card border border-hairline-strong bg-surface-1 p-4">
            <p className="type-eyebrow">Immutability</p>
            <h2 className="mt-2 font-serif text-xl tracking-[-0.025em] text-ink">只追加审计</h2>
            <p className="mt-2 text-[11px] leading-5 text-muted">
              管理器不可编辑或删除审计事件。当前页面不提供任何修改入口，只提供筛选与 CSV 导出。
            </p>
          </section>
          <section className="rounded-card border border-hairline-strong bg-surface-1 p-4">
            <p className="type-eyebrow">Event coverage</p>
            <dl className="mt-3 space-y-2 text-[11px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Admin actions</dt>
                <dd className="font-mono text-body">
                  {sourceEntries.filter((entry) => entry.actorType === "admin").length}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">System actions</dt>
                <dd className="font-mono text-body">
                  {sourceEntries.filter((entry) => entry.actorType === "system").length}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">User actions</dt>
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
