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
import {
  AUDIT_ACTOR_TYPE_LABELS,
  DATA_SOURCE_STATUS_LABELS,
  EMAIL_STATUS_LABELS,
  auditTargetTypeLabel,
} from "../../lib/labels";
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
            数据源错误{state.error?.code ? ` · ${state.error.code}` : ""}
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
        eyebrow="平台 / 总览"
        title="平台总览"
        description={
          "运营指标、后台队列与邮件健康。仅有当前快照时趋势显示单点。"}
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
              change={`+${data.metrics.users.new24h}/24 小时`}
              tone="blue"
              icon={Users}
            />
            <AdminMetricCard
              label="工作区"
              value={formatCount(data.metrics.workspaces.total)}
              detail={`${formatCount(data.metrics.workspaces.active)} 正常运营`}
              change={`+${data.metrics.workspaces.new24h}/24 小时`}
              tone="green"
              icon={Building2}
            />
            <AdminMetricCard
              label="旅行"
              value={formatCount(data.metrics.trips)}
              detail="跨全部工作区"
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
              detail="媒体 / 邮件 / 导出"
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
              <p className="type-eyebrow">增长 / 12 天</p>
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
              <p className="type-eyebrow">审计 / 最新</p>
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
                        {auditTargetTypeLabel(entry.targetType)} / {entry.targetId.slice(-8)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-[9px] text-stone">
                        {formatDateTime(entry.createdAt)}
                      </p>
                      <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.08em] text-muted">
                        {AUDIT_ACTOR_TYPE_LABELS[entry.actorType]}
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
              <p className="type-eyebrow">BullMQ / 健康度</p>
              <h2 className="mt-2 font-serif text-2xl tracking-[-0.025em] text-ink">队列健康</h2>
            </div>
            {metricsReady ? (
              <Badge tone={failedJobs > 0 ? "red" : "green"}>{failedJobs} 个失败</Badge>
            ) : (
              <Badge tone={metricsSource.status === "error" ? "red" : "neutral"}>
                {DATA_SOURCE_STATUS_LABELS[metricsSource.status]}
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
                          {queue.waiting} 等待 · {queue.active} 运行 · {queue.failed} 失败
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
              <p className="type-eyebrow">Resend / 投递</p>
              <h2 className="mt-2 font-serif text-2xl tracking-[-0.025em] text-ink">邮件健康</h2>
            </div>
            {emailsReady ? (
              <Badge tone={deliveryRate > 99 ? "green" : "yellow"}>
                {deliveryRate.toFixed(2)}% 已送达
              </Badge>
            ) : (
              <Badge tone={emailsSource.status === "error" ? "red" : "neutral"}>
                {DATA_SOURCE_STATUS_LABELS[emailsSource.status]}
              </Badge>
            )}
          </div>
          {emailsReady ? (
            <>
              <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-control border border-hairline bg-hairline sm:grid-cols-5">
                {(
                  ["delivered", "queued", "bounced", "complained", "failed"] as const
                ).map((key) => {
                  const value = data.emailHealth[key];
                  return (
                    <div key={key} className="bg-surface-1 px-3 py-4">
                      <dt className="type-eyebrow">{EMAIL_STATUS_LABELS[key]}</dt>
                      <dd className="mt-2 font-serif text-xl text-ink">
                        {key === "delivered"
                          ? new Intl.NumberFormat("zh-CN").format(value)
                          : value}
                      </dd>
                    </div>
                  );
                })}
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
