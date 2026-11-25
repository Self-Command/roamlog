"use client";

import { Activity, Clock3, GitCommitHorizontal, Layers, ServerCog } from "lucide-react";

import { Badge } from "@roamlog/ui";

import type { AdminConsoleRole } from "../../lib/admin-types";
import type { AdminSystemSnapshotDetail } from "../../lib/admin-data-source";
import { formatDateTime } from "../../lib/format";
import {
  ENVIRONMENT_LABELS,
  HEALTH_STATUS_LABELS,
  JOB_STATUS_LABELS,
  MIGRATION_STATUS_LABELS,
  QUEUE_STATE_LABELS,
  WORKER_STATUS_LABELS,
} from "../../lib/labels";
import {
  formatUptime,
  type AdminSystemSnapshot,
} from "../../lib/admin-ops-types";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { AdminMetricCard } from "../dashboard/admin-metric-card";

interface SystemViewProps {
  role: AdminConsoleRole;
  snapshot: AdminSystemSnapshot;
}

const checkTones = {
  up: "green",
  degraded: "yellow",
  down: "red",
} as const;

const workerTones = {
  up: "green",
  degraded: "yellow",
  down: "red",
} as const;

const signalSources = {
  "consumer-clients": "后台任务进程活跃连接与队列计数",
  "activity-derived": "最近一次任务完成/失败时间 + 队列运行数",
  unavailable: "无可用的推导信号",
} as const;

const UNCONFIGURED = "unconfigured";

const CHECK_LABELS: Readonly<Record<string, string>> = {
  database: "数据库",
  postgresql: "数据库",
  redis: "缓存服务",
  storage: "文件存储",
  s3: "文件存储",
  resend: "邮件服务",
  mail: "邮件服务",
  queue: "任务队列",
};

const QUEUE_LABELS: Readonly<Record<string, string>> = {
  "media-processing": "媒体处理",
  "email-delivery": "邮件发送",
  "archive-export": "档案导出",
  "trip-reminders": "行程提醒",
};

function friendlyCheckName(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized.includes("postgres") || normalized.includes("database")) {
    return CHECK_LABELS.database!;
  }
  if (normalized.includes("redis") || normalized.includes("cache")) {
    return CHECK_LABELS.redis!;
  }
  if (
    normalized.includes("s3") ||
    normalized.includes("minio") ||
    normalized.includes("storage")
  ) {
    return CHECK_LABELS.storage!;
  }
  if (normalized.includes("resend") || normalized.includes("mail")) {
    return CHECK_LABELS.mail!;
  }
  return CHECK_LABELS[normalized] ?? name;
}

function queueLabel(name: string): string {
  return QUEUE_LABELS[name.toLowerCase()] ?? name;
}

function checkAction(status: "up" | "degraded" | "down"): string {
  if (status === "up") return "服务正常";
  if (status === "degraded") return "服务响应变慢，请稍后重试";
  return "服务不可用，请检查服务连接";
}

/** `null`-able operational values render as an explicit "not wired" state. */
function notWired(value: string | null | undefined): boolean {
  return !value || value === UNCONFIGURED;
}

export function SystemView({
  role,
  snapshot,
}: SystemViewProps) {
  const readOnly = role === "analyst";
  const detail = snapshot as AdminSystemSnapshotDetail;
  const upChecks = snapshot.checks.filter((check) => check.status === "up").length;
  const workerSignal = detail.workerSignal ?? null;
  const queues = detail.queues ?? [];

  // The worker cannot be proven alive without a heartbeat; when neither the
  // blocked-consumer count nor recent job activity is available the console
  // says "not wired" instead of claiming DOWN.
  const signal = workerSignal?.signal ?? "unavailable";
  const workerObservable = signal !== "unavailable" && workerSignal !== null;
  const workerDerivation = workerSignal ? signalSources[workerSignal.signal] : "无可用的推导信号";

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="平台 / 系统"
        title="系统健康"
        description="只展示当前可观测的检查项。"
        readOnly={readOnly}
        actions={
          <div className="rounded-control border border-hairline bg-surface-1 px-3 py-2">
            <p className="type-eyebrow">环境</p>
            <p className="mt-1 font-mono text-[10px] text-body">
              {ENVIRONMENT_LABELS[snapshot.environment] ?? snapshot.environment}
            </p>
          </div>
        }
      />

      <section aria-label="版本与运行时间" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label="接口服务版本"
          value={notWired(snapshot.apiVersion) ? "未上报" : snapshot.apiVersion}
          detail={
            notWired(snapshot.apiVersion)
              ? "服务未上报版本号"
              : `任务进程版本 ${
                  notWired(snapshot.workerVersion) ? "未上报" : snapshot.workerVersion
                }`
          }
          tone="blue"
          icon={ServerCog}
        />
        <AdminMetricCard
          label="运行环境"
          value={snapshot.nodeVersion}
          detail="服务器运行时版本"
          tone="neutral"
          icon={GitCommitHorizontal}
        />
        <AdminMetricCard
          label="运行时间"
          value={formatUptime(snapshot.uptimeSeconds)}
          detail={`启动于 ${formatDateTime(snapshot.startedAt)}`}
          tone="green"
          icon={Clock3}
        />
        <AdminMetricCard
          label="最近构建"
          value={notWired(snapshot.buildTime) ? "未上报" : formatDateTime(snapshot.buildTime)}
          detail={
            notWired(snapshot.buildTime)
              ? "服务未上报构建时间"
              : "构建元数据"
          }
          tone="orange"
          icon={Activity}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section className="rounded-card border border-hairline-strong bg-surface-1">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
            <div>
              <h2 className="text-[13px] font-medium text-ink">依赖服务状态</h2>
              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                服务健康检查
              </p>
            </div>
            <Badge tone={upChecks === snapshot.checks.length ? "green" : "yellow"}>
              {snapshot.checks.length === 0
                ? "暂无检查项"
                : `${upChecks} / ${snapshot.checks.length} 正常`}
            </Badge>
          </div>
          <div className="grid gap-px bg-hairline sm:grid-cols-2">
            {snapshot.checks.map((check) => (
              <article key={check.name} className="bg-surface-1 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[12px] font-medium text-ink">
                    {friendlyCheckName(check.name)}
                  </h3>
                  <Badge tone={checkTones[check.status]}>{HEALTH_STATUS_LABELS[check.status]}</Badge>
                </div>
                <p className="mt-3 font-display text-2xl font-semibold leading-none tracking-[-0.02em] text-ink">
                  {check.latencyMs === null ? "—" : `${check.latencyMs} ms`}
                </p>
                <p className="mt-2 text-[10px] leading-4 text-muted">
                  {checkAction(check.status)}
                </p>
                {check.detail ? (
                  <details className="mt-2 font-mono text-[9px] leading-4 text-muted">
                    <summary className="cursor-pointer select-none">技术详情</summary>
                    <p className="mt-1 break-all">{check.detail}</p>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-card border border-hairline-strong bg-surface-1 p-4">
            <p className="type-eyebrow">后台任务状态</p>
            <h2 className="mt-2 font-display text-xl font-semibold text-ink">后台任务进程</h2>
            <dl className="mt-3 space-y-2 text-[11px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">版本</dt>
                <dd className="font-mono text-[10px] text-body">
                  {notWired(snapshot.workerVersion) ? "未上报" : `v${snapshot.workerVersion}`}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">活跃任务数</dt>
                <dd className="font-mono text-[10px] text-body">{snapshot.workerConsumers}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">状态</dt>
                <dd>
                  {!workerObservable ? (
                    <Badge tone="slate" title="缺少任务进程心跳，无法证明存活或不可用">
                      无法确认
                    </Badge>
                  ) : (
                    <Badge tone={workerTones[snapshot.workerStatus]}>
                      {WORKER_STATUS_LABELS[snapshot.workerStatus]}
                    </Badge>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">最近任务</dt>
                <dd className="font-mono text-[10px] text-body">
                  {workerSignal?.lastJobAt
                    ? formatDateTime(workerSignal.lastJobAt)
                    : "暂不可用"}
                </dd>
              </div>
            </dl>
            <p className="mt-3 border-t border-hairline pt-3 font-mono text-[9px] leading-4 text-muted">
              状态来源：{workerDerivation}
              {workerSignal?.lastJobStatus
                ? ` · 最近${JOB_STATUS_LABELS[workerSignal.lastJobStatus]} @ ${queueLabel(workerSignal.lastJobQueue ?? "?")}`
                : ""}
            </p>
            {!workerObservable ? (
              <p className="mt-2 text-[9px] leading-4 text-muted">
                当前没有足够的任务进程信号，无法确认它是否在线。请确认后台任务进程已启动。
              </p>
            ) : null}
          </section>

          <section className="rounded-card border border-hairline-strong bg-surface-1 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="type-eyebrow">任务队列</p>
                <h2 className="mt-2 font-display text-xl font-semibold text-ink">任务队列</h2>
              </div>
              <Layers aria-hidden="true" className="size-4 text-accent-blue" />
            </div>
            <div className="mt-3 space-y-2 text-[11px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">已登记队列</span>
                <span className="font-mono text-[10px] text-body">
                  {`${queues.length} 个`}
                </span>
              </div>
              {queues.length === 0 ? (
                <p className="text-[10px] leading-4 text-muted">
                  "没有发现队列。请确认后台任务进程已经启动；如果持续为空，请联系平台管理员。"
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {queues.map((queue) => (
                    <li key={queue.name} className="flex items-center justify-between gap-2">
                      <span
                        className="truncate text-[10px] text-body"
                        title={`技术标识：${queue.name}`}
                      >
                        {queueLabel(queue.name)}
                      </span>
                      <span className="flex items-center gap-2 font-mono text-[9px] text-muted">
                        <span>等待 {queue.waiting}</span>
                        <span>运行 {queue.active}</span>
                        {queue.paused ? (
                          <Badge tone="yellow">{QUEUE_STATE_LABELS.paused}</Badge>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="mt-3 border-t border-hairline pt-3 font-mono text-[9px] leading-4 text-muted">
              来源：扫描后台任务队列状态。
            </p>
          </section>
        </aside>
      </div>

      <section className="overflow-hidden rounded-card border border-hairline-strong bg-surface-1">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
          <div>
            <h2 className="text-[13px] font-medium text-ink">数据库迁移</h2>
            <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              数据库升级状态
            </p>
          </div>
          <Badge tone={snapshot.migrations.length > 0 ? "green" : "yellow"}>
            {snapshot.migrations.length > 0
              ? "最新已应用"
              : "暂不可用"}
          </Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-left text-[12px]">
            <caption className="sr-only">数据库迁移版本</caption>
            <thead>
              <tr className="border-b border-hairline font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                <th scope="col" className="px-3 py-2.5 font-normal">
                  版本
                </th>
                <th scope="col" className="px-3 py-2.5 font-normal">
                  名称
                </th>
                <th scope="col" className="px-3 py-2.5 font-normal">
                  应用时间
                </th>
                <th scope="col" className="px-3 py-2.5 font-normal">
                  状态
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {snapshot.migrations.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-[11px] text-muted">
                    当前读不到迁移版本；请确认数据库可用后刷新。
                  </td>
                </tr>
              ) : (
                snapshot.migrations.map((migration) => (
                  <tr key={migration.version} className="h-11">
                    <td className="px-3 py-2 font-mono text-[10px] text-body">
                      {migration.version}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-muted">{migration.name}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-muted">
                      {formatDateTime(migration.appliedAt)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={migration.status === "applied" ? "green" : "yellow"}>
                        {MIGRATION_STATUS_LABELS[migration.status]}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
