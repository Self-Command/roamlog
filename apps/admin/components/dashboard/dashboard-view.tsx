import {
  AlertTriangle,
  Building2,
  HardDrive,
  NotebookPen,
  Plane,
  RefreshCw,
  Users,
} from "lucide-react";

import { Badge, Button, Progress } from "@roamlog/ui";

import type {
  AdminDashboardSourceState,
  AdminDashboardSources,
} from "../../lib/admin-data-source";
import type { AdminConsoleRole } from "../../lib/admin-types";
import type { AdminDashboardData } from "../../lib/admin-types";
import { formatBytes, formatCount, formatDateTime } from "../../lib/format";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { AdminMetricCard } from "./admin-metric-card";
import { TrendChart } from "./trend-chart";

const READY_SOURCE: AdminDashboardSourceState = {
  status: "ready",
  error: null,
  refetch: () => undefined,
};

interface DashboardViewProps {
  role: AdminConsoleRole;
  data: AdminDashboardData & { sources?: AdminDashboardSources };
}

function DashboardSourceNotice({
  state,
  subject,
}: {
  state: AdminDashboardSourceState;
  subject: string;
}) {
  if (state.status === "ready") {
    return null;
  }

  if (state.status === "loading") {
    return (
      <div role="status" className="flex items-center gap-2 py-4 text-[11px] text-muted">
        <span aria-hidden="true" className="size-1.5 animate-pulse rounded-pill bg-accent-yellow" />
        正在加载{subject}…
      </div>
    );
  }

  return (
    <div role="alert" className="rounded-control border border-accent-red/25 bg-accent-red/5 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-red" />
        <div className="min-w-0 space-y-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-accent-red">
            DATA SOURCE ERROR{state.error?.code ? ` · ${state.error.code}` : ""}
          </p>
          <p className="text-[11px] leading-5 text-body">
            {state.error?.detail ?? `${subject}加载失败，请重试。`}
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={state.refetch}>
            <RefreshCw aria-hidden="true" />
            重试
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DashboardView({ role, data }: DashboardViewProps) {
  const metricsSource = data.sources?.metrics ?? READY_SOURCE;
  const emailsSource = data.sources?.emails ?? READY_SOURCE;
  const auditSource = data.sources?.audit ?? READY_SOURCE;
  const metricsReady = metricsSource.status === "ready";
  const emailsReady = emailsSource.status === "ready";
  const auditReady = auditSource.status === "ready";
  const failedJobs = data.metrics.queues.reduce((total, queue) => total + queue.failed, 0);
  const delivered = data.emailHealth.delivered;
  const deliveryTotal =
    delivered +
    data.emailHealth.bounced +
    data.emailHealth.complained +
    data.emailHealth.failed +
    data.emailHealth.queued;
  const deliveryRate = deliveryTotal > 0 ? (delivered / deliveryTotal) * 100 : 0;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="PLATFORM / OVERVIEW"
        title="平台总览"
        description={
          "运营指标、后台队列与邮件健康。数字来自真实 Admin API；仅有当前快照时趋势显示单点。"}
        readOnly={role === "analyst"}
        actions={
          <div className="text-right">
            <p className="type-eyebrow">数据生成时间</p>
            <p className="mt-1 font-mono text-[10px] text-muted">
              {metricsReady ? formatDateTime(data.generatedAt) : "—"}
            </p>
          </div>
        }
      />

      <section
        aria-label="核心指标"
        className={
          metricsReady
            ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-6"
            : "rounded-card border border-hairline-strong bg-surface-1 p-5"
        }
      >
        {metricsReady ? (
          <>
            <AdminMetricCard
              label="用户总数"
              value={formatCount(data.metrics.users.total)}
              detail={`${formatCount(data.metrics.users.active)} 活跃账户`}
              change={`+${data.metrics.users.new24h}/24h`}
              tone="blue"
              icon={Users}
            />
            <AdminMetricCard
              label="工作区"
              value={formatCount(data.metrics.workspaces.total)}
              detail={`${formatCount(data.metrics.workspaces.active)} 正常运营`}
              change={`+${data.metrics.workspaces.new24h}/24h`}
              tone="green"
              icon={Building2}
            />
            <AdminMetricCard
              label="旅行"
              value={formatCount(data.metrics.trips)}
              detail="跨全部 Workspace"
              tone="neutral"
              icon={Plane}
            />
            <AdminMetricCard
              label="日志"
              value={formatCount(data.metrics.entries)}
              detail={`${formatCount(data.metrics.comments)} 条评论`}
              tone="neutral"
              icon={NotebookPen}
            />
            <AdminMetricCard
              label="媒体对象"
              value={formatCount(data.metrics.media.count)}
              detail={`${formatBytes(data.metrics.media.bytes)} 已存储`}
              tone="orange"
              icon={HardDrive}
            />
            <AdminMetricCard
              label="失败任务"
              value={String(failedJobs)}
              detail="media / email / export"
              change={failedJobs > 0 ? "需处理" : "清空"}
              tone={failedJobs > 0 ? "red" : "green"}
              icon={AlertTriangle}
            />
          </>
        ) : (
          <DashboardSourceNotice state={metricsSource} subject="核心指标" />
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-5">
        <section
          aria-label="用户与工作区趋势"
          className="rounded-card border border-hairline-strong bg-surface-1 p-5 xl:col-span-3"
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="type-eyebrow">GROWTH / 12 DAYS</p>
              <h2 className="mt-2 font-serif text-2xl tracking-[-0.025em] text-ink">
                用户与工作区趋势
              </h2>
            </div>
            
          </div>
          {metricsReady ? (
            <TrendChart data={data.trend} />
          ) : (
            <DashboardSourceNotice state={metricsSource} subject="趋势数据" />
          )}
        </section>

        <section
          aria-label="最近审计事件"
          className="rounded-card border border-hairline-strong bg-surface-1 p-5 xl:col-span-2"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="type-eyebrow">AUDIT / LATEST</p>
              <h2 className="mt-2 font-serif text-2xl tracking-[-0.025em] text-ink">
                最近审计事件
              </h2>
            </div>
            <a
              href="/admin/audit"
              className="rounded-control text-[11px] text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ink"
            >
              查看全部
            </a>
          </div>
          {auditReady ? (
            data.recentAudit.length > 0 ? (
              <ol className="mt-5 divide-y divide-hairline border-y border-hairline">
                {data.recentAudit.map((entry) => (
                  <li key={entry.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[10px] text-body">{entry.action}</p>
                      <p className="mt-1 truncate text-[11px] text-muted">
                        {entry.targetType} / {entry.targetId.slice(-8)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-[9px] text-stone">
                        {formatDateTime(entry.createdAt)}
                      </p>
                      <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.08em] text-muted">
                        {entry.actorType}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-5 rounded-control border border-hairline bg-canvas/40 px-4 py-6 text-center text-[11px] text-muted">
                暂无审计事件。
              </p>
            )
          ) : (
            <div className="mt-4">
              <DashboardSourceNotice state={auditSource} subject="最近审计事件" />
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          aria-label="队列健康"
          className="rounded-card border border-hairline-strong bg-surface-1 p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="type-eyebrow">BULLMQ / HEALTH</p>
              <h2 className="mt-2 font-serif text-2xl tracking-[-0.025em] text-ink">队列健康</h2>
            </div>
            {metricsReady ? (
              <Badge tone={failedJobs > 0 ? "red" : "green"}>{failedJobs} failed</Badge>
            ) : (
              <Badge tone={metricsSource.status === "error" ? "red" : "neutral"}>
                {metricsSource.status}
              </Badge>
            )}
          </div>
          {metricsReady ? (
            data.metrics.queues.length > 0 ? (
              <div className="mt-5 space-y-4">
                {data.metrics.queues.map((queue) => {
                  const depth = queue.waiting + queue.active + queue.failed;
                  const health = Math.max(0, 100 - Math.min(100, depth * 3 + queue.failed * 12));
                  return (
                    <div key={queue.name}>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="font-mono text-[10px] text-body">{queue.name}</span>
                        <span className="font-mono text-[9px] text-muted">
                          {queue.waiting} wait · {queue.active} active · {queue.failed} failed
                        </span>
                      </div>
                      <Progress
                        value={health}
                        aria-label={`${queue.name} 健康度 ${Math.round(health)}%`}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-5 rounded-control border border-hairline bg-canvas/40 px-4 py-6 text-center text-[11px] text-muted">
                暂无队列数据。
              </p>
            )
          ) : (
            <div className="mt-4">
              <DashboardSourceNotice state={metricsSource} subject="队列数据" />
            </div>
          )}
        </section>

        <section
          aria-label="邮件健康"
          className="rounded-card border border-hairline-strong bg-surface-1 p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="type-eyebrow">RESEND / DELIVERY</p>
              <h2 className="mt-2 font-serif text-2xl tracking-[-0.025em] text-ink">邮件健康</h2>
            </div>
            {emailsReady ? (
              <Badge tone={deliveryRate > 99 ? "green" : "yellow"}>
                {deliveryRate.toFixed(2)}% delivered
              </Badge>
            ) : (
              <Badge tone={emailsSource.status === "error" ? "red" : "neutral"}>
                {emailsSource.status}
              </Badge>
            )}
          </div>
          {emailsReady ? (
            <>
              <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-control border border-hairline bg-hairline sm:grid-cols-5">
                {[
                  ["Delivered", delivered],
                  ["Queued", data.emailHealth.queued],
                  ["Bounced", data.emailHealth.bounced],
                  ["Complained", data.emailHealth.complained],
                  ["Failed", data.emailHealth.failed],
                ].map(([label, value]) => (
                  <div key={label} className="bg-surface-1 px-3 py-4">
                    <dt className="type-eyebrow">{label}</dt>
                    <dd className="mt-2 font-serif text-xl text-ink">
                      {typeof value === "number" && label === "Delivered"
                        ? new Intl.NumberFormat("en-US").format(value)
                        : value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-[11px] leading-5 text-muted">
                退信与投诉保留在邮件日志中；邮件页可重发失败邮件，队列页可检查投递任务的失败详情。
              </p>
            </>
          ) : (
            <div className="mt-4">
              <DashboardSourceNotice state={emailsSource} subject="邮件健康" />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
