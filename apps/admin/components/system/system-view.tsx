"use client";

import { Activity, Clock3, GitCommitHorizontal, ServerCog } from "lucide-react";

import { Badge } from "@roamlog/ui";

import type { AdminConsoleRole } from "../../lib/fixtures";
import { formatDateTime } from "../../lib/format";
import {
  MOCK_ADMIN_SYSTEM,
  formatUptime,
  type AdminSystemSnapshot,
} from "../../lib/ops-fixtures";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { AdminMetricCard } from "../dashboard/admin-metric-card";

interface SystemViewProps {
  role: AdminConsoleRole;
  snapshot?: AdminSystemSnapshot;
}

const checkTones = {
  up: "green",
  degraded: "yellow",
  down: "red",
} as const;

const checkLabels = {
  up: "Operational",
  degraded: "Degraded",
  down: "Down",
} as const;

export function SystemView({ role, snapshot = MOCK_ADMIN_SYSTEM }: SystemViewProps) {
  const readOnly = role === "analyst";

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="PLATFORM / SYSTEM"
        title="系统健康"
        description="检查 API、Worker、数据库、Redis、对象存储与迁移版本。当前读数为本地 fixture 快照。"
        readOnly={readOnly}
        actions={
          <div className="rounded-control border border-hairline bg-surface-1 px-3 py-2">
            <p className="type-eyebrow">环境</p>
            <p className="mt-1 font-mono text-[10px] uppercase text-body">
              {snapshot.environment}
            </p>
          </div>
        }
      />

      <section aria-label="版本与运行时间" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label="API 版本"
          value={snapshot.apiVersion}
          detail={`Worker 版本 ${snapshot.workerVersion}`}
          tone="blue"
          icon={ServerCog}
        />
        <AdminMetricCard
          label="Node.js"
          value={snapshot.nodeVersion}
          detail="server runtime"
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
          value={formatDateTime(snapshot.buildTime)}
          detail="fixture build metadata"
          tone="orange"
          icon={Activity}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section className="rounded-card border border-hairline-strong bg-surface-1">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
            <div>
              <h2 className="text-[13px] font-medium text-ink">依赖健康检查</h2>
              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
                readiness / fixture probes
              </p>
            </div>
            <Badge tone="green">3 / 4 up</Badge>
          </div>
          <div className="grid gap-px bg-hairline sm:grid-cols-2">
            {snapshot.checks.map((check) => (
              <article key={check.name} className="bg-surface-1 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[12px] font-medium text-ink">{check.name}</h3>
                  <Badge tone={checkTones[check.status]}>{checkLabels[check.status]}</Badge>
                </div>
                <p className="mt-3 font-serif text-2xl leading-none text-ink">
                  {check.latencyMs === null ? "—" : `${check.latencyMs} ms`}
                </p>
                <p className="mt-2 font-mono text-[9px] leading-4 text-muted">{check.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-card border border-hairline-strong bg-surface-1 p-4">
            <p className="type-eyebrow">WORKER / HEARTBEAT</p>
            <h2 className="mt-2 font-serif text-xl tracking-[-0.025em] text-ink">后台 Worker</h2>
            <dl className="mt-3 space-y-2 text-[11px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">版本</dt>
                <dd className="font-mono text-[10px] text-body">v{snapshot.workerVersion}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">最后心跳</dt>
                <dd className="font-mono text-[10px] text-body">
                  {formatDateTime(snapshot.lastWorkerHeartbeat)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">状态</dt>
                <dd>
                  <Badge tone="green">Healthy</Badge>
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-card border border-hairline-strong bg-surface-1 p-4">
            <p className="type-eyebrow">QUEUE / REDIS</p>
            <h2 className="mt-2 font-serif text-xl tracking-[-0.025em] text-ink">队列与 Redis</h2>
            <div className="mt-3 space-y-2 text-[11px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">连接</span>
                <Badge tone="green">Up · 2 ms</Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Key prefix</span>
                <span className="font-mono text-[10px] text-body">roamlog</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">maxRetriesPerRequest</span>
                <span className="font-mono text-[10px] text-body">null</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Worker consumers</span>
                <span className="font-mono text-[10px] text-body">4 queues</span>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <section className="overflow-hidden rounded-card border border-hairline-strong bg-surface-1">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
          <div>
            <h2 className="text-[13px] font-medium text-ink">数据库迁移</h2>
            <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              prisma migrate status · fixture
            </p>
          </div>
          <Badge tone="green">Up to date</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-left text-[12px]">
            <caption className="sr-only">数据库迁移版本</caption>
            <thead>
              <tr className="border-b border-hairline font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                <th scope="col" className="px-3 py-2.5 font-normal">
                  Version
                </th>
                <th scope="col" className="px-3 py-2.5 font-normal">
                  Name
                </th>
                <th scope="col" className="px-3 py-2.5 font-normal">
                  Applied at
                </th>
                <th scope="col" className="px-3 py-2.5 font-normal">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {snapshot.migrations.map((migration) => (
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
                      {migration.status === "applied" ? "Applied" : "Pending"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
