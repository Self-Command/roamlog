import { AlertTriangle, Building2, HardDrive, NotebookPen, Plane, Users } from "lucide-react";

import { Badge, Progress } from "@roamlog/ui";

import type { AdminConsoleRole } from "../../lib/fixtures";
import type { AdminDashboardData } from "../../lib/fixtures";
import { formatBytes, formatCount, formatDateTime } from "../../lib/format";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { AdminMetricCard } from "./admin-metric-card";
import { TrendChart } from "./trend-chart";

interface DashboardViewProps {
  role: AdminConsoleRole;
  data: AdminDashboardData;
}

export function DashboardView({ role, data }: DashboardViewProps) {
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
        description="运营指标、后台队列与邮件健康。数字来自本地 fixture，用于验证后台布局与数据密度。"
        readOnly={role === "analyst"}
        actions={
          <div className="text-right">
            <p className="type-eyebrow">数据生成时间</p>
            <p className="mt-1 font-mono text-[10px] text-muted">
              {formatDateTime(data.generatedAt)}
            </p>
          </div>
        }
      />

      <section aria-label="核心指标" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
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
      </section>

      <div className="grid gap-4 xl:grid-cols-5">
        <section className="rounded-card border border-hairline-strong bg-surface-1 p-5 xl:col-span-3">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="type-eyebrow">GROWTH / 12 DAYS</p>
              <h2 className="mt-2 font-serif text-2xl tracking-[-0.025em] text-ink">
                用户与工作区趋势
              </h2>
            </div>
            <Badge tone="neutral">fixture</Badge>
          </div>
          <TrendChart data={data.trend} />
        </section>

        <section className="rounded-card border border-hairline-strong bg-surface-1 p-5 xl:col-span-2">
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
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-card border border-hairline-strong bg-surface-1 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="type-eyebrow">BULLMQ / HEALTH</p>
              <h2 className="mt-2 font-serif text-2xl tracking-[-0.025em] text-ink">队列健康</h2>
            </div>
            <Badge tone={failedJobs > 0 ? "red" : "green"}>{failedJobs} failed</Badge>
          </div>
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
        </section>

        <section className="rounded-card border border-hairline-strong bg-surface-1 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="type-eyebrow">RESEND / DELIVERY</p>
              <h2 className="mt-2 font-serif text-2xl tracking-[-0.025em] text-ink">邮件健康</h2>
            </div>
            <Badge tone={deliveryRate > 99 ? "green" : "yellow"}>
              {deliveryRate.toFixed(2)}% delivered
            </Badge>
          </div>
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
        </section>
      </div>
    </div>
  );
}
