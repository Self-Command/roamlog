"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Gauge, Pause, Play, RotateCcw, ShieldAlert } from "lucide-react";

import { canPlatform } from "@roamlog/contracts";
import {
  Badge,
  Button,
  EmptyState,
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
  MOCK_ADMIN_FAILED_JOBS,
  MOCK_ADMIN_QUEUES,
  type AdminFailedJob,
  type AdminQueueSummary,
} from "../../lib/ops-fixtures";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { AdminMetricCard } from "../dashboard/admin-metric-card";
import { DestructiveActionDialog } from "../admin-ui/destructive-action-dialog";

type QueueAction =
  | { kind: "retry"; job: AdminFailedJob }
  | { kind: "pause"; queue: AdminQueueSummary }
  | { kind: "resume"; queue: AdminQueueSummary }
  | { kind: "clear"; queue: AdminQueueSummary };

interface QueuesViewProps {
  role: AdminConsoleRole;
  queues?: readonly AdminQueueSummary[];
  failedJobs?: readonly AdminFailedJob[];
  mode?: AdminDataMode;
  mutations?: AdminMutationPort;
}

export function QueuesView({
  role,
  queues = MOCK_ADMIN_QUEUES,
  failedJobs = MOCK_ADMIN_FAILED_JOBS,
  mode = "fixture",
  mutations,
}: QueuesViewProps) {
  const [queueRecords, setQueueRecords] = useState<readonly AdminQueueSummary[]>(queues);
  const [jobRecords, setJobRecords] = useState<readonly AdminFailedJob[]>(failedJobs);
  const [pendingAction, setPendingAction] = useState<QueueAction | null>(null);
  const [detailJob, setDetailJob] = useState<AdminFailedJob | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const canRetry = canPlatform(role, "admin:jobs:retry");
  const canManageQueue = mode === "fixture" && canPlatform(role, "admin:jobs:manage");
  const readOnly = role === "analyst";
  const totalFailed = queueRecords.reduce((total, queue) => total + queue.failed, 0);
  const totalWaiting = queueRecords.reduce((total, queue) => total + queue.waiting, 0);
  const throughput = queueRecords.reduce((total, queue) => total + queue.throughputPerMinute, 0);
  const pausedQueues = queueRecords.filter((queue) => queue.paused).length;

  const queueByJob = useMemo(
    () => new Map(queueRecords.map((queue) => [queue.name, queue])),
    [queueRecords],
  );

  function actionTarget(action: QueueAction): string {
    if (action.kind === "retry") {
      return action.job.id;
    }
    return action.queue.name;
  }

  const actionCopy =
    pendingAction?.kind === "retry"
      ? {
          title: "重试任务",
          description: "任务将重新进入等待队列，并保留原有 job id 用于幂等检查。",
          confirmLabel: "确认重试",
          label: "输入任务 ID 确认",
        }
      : pendingAction?.kind === "pause"
        ? {
            title: "暂停队列",
            description: "暂停后 Worker 不再消费该队列的新任务，已在执行的任务会完成。",
            confirmLabel: "确认暂停",
            label: "输入队列名称确认",
          }
        : pendingAction?.kind === "resume"
          ? {
              title: "恢复队列",
              description: "队列恢复后 Worker 将重新消费等待中的任务。",
              confirmLabel: "确认恢复",
              label: "输入队列名称确认",
            }
          : {
              title: "清空队列",
              description: "该队列的失败任务将被永久移除，等待与活跃任务保持不变。",
              confirmLabel: "确认清空",
              label: "输入队列名称确认",
            };

  async function confirmAction() {
    if (!pendingAction) {
      return;
    }
    if (pendingAction.kind === "retry") {
      const job = pendingAction.job;
      if (mode === "api" && mutations) {
        try {
          await mutations.retryJob(job.queue, job.id);
        } catch (error) {
          setStatusMessage(
            error instanceof AdminMutationError
              ? `重试失败：${error.failure.code} · ${error.failure.detail}`
              : "重试失败，请检查 API 与权限后重试。",
          );
          setPendingAction(null);
          return;
        }
      }
      setJobRecords((current) => current.filter((item) => item.id !== job.id));
      setQueueRecords((current) =>
        current.map((queue) =>
          queue.name === job.queue ? { ...queue, failed: Math.max(0, queue.failed - 1) } : queue,
        ),
      );
      if (mode === "fixture") {
        recordMockAuditEvent({
          action: "admin.jobs.retry",
          targetType: "job",
          targetId: job.id,
          targetName: job.name,
          metadata: { mock: true, queue: job.queue, attempts: job.attempts },
        });
      }
      setStatusMessage(`已重新入队：${job.id}`);
    } else if (pendingAction.kind === "clear") {
      const queue = pendingAction.queue;
      setJobRecords((current) => current.filter((job) => job.queue !== queue.name));
      setQueueRecords((current) =>
        current.map((item) => (item.name === queue.name ? { ...item, failed: 0 } : item)),
      );
      recordMockAuditEvent({
        action: "admin.jobs.clear",
        targetType: "queue",
        targetId: queue.name,
        targetName: queue.label,
        metadata: { mock: true, queue: queue.name, previousFailed: queue.failed },
      });
      setStatusMessage(`已清空失败任务：${queue.name}`);
    } else {
      const { queue, kind } = pendingAction;
      setQueueRecords((current) =>
        current.map((item) =>
          item.name === queue.name ? { ...item, paused: kind === "pause" } : item,
        ),
      );
      recordMockAuditEvent({
        action: kind === "pause" ? "admin.jobs.pause" : "admin.jobs.resume",
        targetType: "queue",
        targetId: queue.name,
        targetName: queue.label,
        metadata: { mock: true, queue: queue.name },
      });
      setStatusMessage(`${kind === "pause" ? "已暂停" : "已恢复"}队列：${queue.name}`);
    }
    setPendingAction(null);
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="DELIVERY / BULLMQ"
        title="队列"
        description="检查各队列等待、活跃与失败任务，查看失败原因。Admin API 当前提供失败任务读取与重试；队列暂停/清空仍待后端契约补齐。"
        readOnly={readOnly}
        actions={
          <div className="flex items-center gap-2 rounded-control border border-hairline bg-surface-1 px-3 py-2">
            <Gauge aria-hidden="true" className="size-4 text-accent-blue" />
            <div>
              <p className="type-eyebrow">总吞吐</p>
              <p className="mt-0.5 font-mono text-[10px] text-body">
                {throughput.toFixed(1)} jobs/min
              </p>
            </div>
          </div>
        }
      />

      <section aria-label="队列指标" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label="等待任务"
          value={String(totalWaiting)}
          detail="跨四个队列"
          tone="blue"
          icon={RotateCcw}
        />
        <AdminMetricCard
          label="失败任务"
          value={String(totalFailed)}
          detail="需要运营复核"
          tone={totalFailed > 0 ? "red" : "green"}
          icon={AlertTriangle}
        />
        <AdminMetricCard
          label="已暂停"
          value={String(pausedQueues)}
          detail="Worker 不消费已暂停队列"
          tone={pausedQueues > 0 ? "orange" : "neutral"}
          icon={Pause}
        />
        <AdminMetricCard
          label="吞吐"
          value={throughput.toFixed(1)}
          detail="jobs / minute"
          tone="green"
          icon={Gauge}
        />
      </section>

      {!canManageQueue ? (
        <div
          role="note"
          className="flex items-center gap-2 rounded-control border border-accent-slate/25 bg-accent-slate/5 px-3 py-2 text-[12px] text-accent-slate"
        >
          <ShieldAlert aria-hidden="true" className="size-4" />
          {mode === "api"
            ? "API 模式：失败任务重试已接入真实 mutation；队列暂停、恢复与清空在 Admin API 契约补齐前保持禁用。"
            : !canRetry
              ? "Support / Analyst 可读取队列指标与失败原因；重试、暂停与清空操作保持可见但禁用。"
              : "Admin 可重试失败任务；暂停、恢复与清空队列属于 super_admin 专属操作。"}
        </div>
      ) : null}

      <section aria-label="队列卡片" className="grid gap-3 sm:grid-cols-2">
        {queueRecords.map((queue) => (
          <article
            key={queue.name}
            aria-label={`队列 ${queue.name}`}
            className="rounded-card border border-hairline-strong bg-surface-1 p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[10px] text-body">{queue.name}</p>
                <h2 className="mt-1 font-serif text-xl tracking-[-0.025em] text-ink">
                  {queue.label}
                </h2>
              </div>
              <Badge tone={queue.paused ? "yellow" : queue.failed > 0 ? "red" : "green"}>
                {queue.paused ? "Paused" : queue.failed > 0 ? "Needs review" : "Healthy"}
              </Badge>
            </div>

            <dl className="mt-4 grid grid-cols-4 gap-px overflow-hidden rounded-control border border-hairline bg-hairline">
              {[
                ["Wait", queue.waiting],
                ["Active", queue.active],
                ["Failed", queue.failed],
                ["Done", queue.completed],
              ].map(([label, value]) => (
                <div key={label} className="bg-surface-1 px-2 py-2.5">
                  <dt className="type-eyebrow text-[8px]">{label}</dt>
                  <dd className="mt-1 font-mono text-[12px] text-body">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
              <span className="font-mono text-[9px] text-muted">
                {queue.throughputPerMinute.toFixed(1)} jobs/min throughput
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  variant="danger"
                  size="sm"
                  aria-label={`清空队列 ${queue.name}`}
                  disabled={!canManageQueue || queue.failed === 0}
                  title={canManageQueue ? "清空该队列的失败任务" : "仅 super_admin 可清空队列"}
                  onClick={() => setPendingAction({ kind: "clear", queue })}
                >
                  清空
                </Button>
                <Button
                  variant={queue.paused ? "outline" : "ghost"}
                  size="sm"
                  aria-label={`${queue.paused ? "恢复" : "暂停"}队列 ${queue.name}`}
                  disabled={!canManageQueue}
                  title={
                    canManageQueue
                      ? queue.paused
                        ? "恢复队列"
                        : "暂停队列"
                      : "仅 super_admin 可暂停或恢复队列"
                  }
                  onClick={() =>
                    setPendingAction({
                      kind: queue.paused ? "resume" : "pause",
                      queue,
                    })
                  }
                >
                  {queue.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                  {queue.paused ? "恢复" : "暂停"}
                </Button>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-card border border-hairline-strong bg-surface-1">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
          <div>
            <h2 className="text-[13px] font-medium text-ink">失败任务</h2>
            <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              failed / dead-letter review · {mode}
            </p>
          </div>
          <Badge tone={jobRecords.length > 0 ? "red" : "green"}>{jobRecords.length} jobs</Badge>
        </div>

        {jobRecords.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title="没有失败任务"
            description={`当前 ${mode} 数据中没有待处理失败任务。`}
            className="m-4"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-[12px]">
              <caption className="sr-only">失败任务列表</caption>
              <thead>
                <tr className="border-b border-hairline font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    Job
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    Queue
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    Attempts
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    失败原因
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    时间
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-normal">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {jobRecords.map((job) => (
                  <tr
                    key={job.id}
                    aria-label={`失败任务 ${job.id}`}
                    className="h-12 transition-colors hover:bg-surface-2/60"
                  >
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setDetailJob(job)}
                        className="rounded-control text-left outline-none focus-visible:ring-2 focus-visible:ring-ink"
                      >
                        <span className="block font-mono text-[10px] text-body">{job.id}</span>
                        <span className="block text-[10px] text-muted">{job.name}</span>
                      </button>
                    </td>
                    <td className="px-3 py-2 font-mono text-[9px] text-muted">{job.queue}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-muted">{job.attempts}</td>
                    <td className="max-w-[380px] px-3 py-2">
                      <span className="block truncate text-[10px] text-muted">
                        {job.failedReason}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[9px] text-muted">
                      {formatDateTime(job.processedAt ?? job.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="查看失败详情"
                          onClick={() => setDetailJob(job)}
                        >
                          详情
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label="重试任务"
                          disabled={!canRetry}
                          title={canRetry ? "重试任务" : "当前角色不可重试队列任务"}
                          onClick={() => setPendingAction({ kind: "retry", job })}
                        >
                          <RotateCcw aria-hidden="true" />
                          重试
                        </Button>
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

      <Sheet open={detailJob !== null} onOpenChange={(open) => !open && setDetailJob(null)}>
        <SheetContent>
          {detailJob ? (
            <>
              <SheetHeader>
                <p className="type-eyebrow">FAILED JOB / {detailJob.queue}</p>
                <SheetTitle>{detailJob.id}</SheetTitle>
                <SheetDescription>{detailJob.name}</SheetDescription>
              </SheetHeader>
              <div className="flex flex-wrap gap-2">
                <Badge tone="red">Failed</Badge>
                <Badge tone="neutral">{detailJob.attempts} attempts</Badge>
                <Badge tone="slate">
                  {queueByJob.get(detailJob.queue)?.label ?? detailJob.queue}
                </Badge>
              </div>
              <div className="mt-6 space-y-4">
                <div className="rounded-control border border-accent-red/25 bg-accent-red/5 p-3">
                  <p className="type-eyebrow text-accent-red">失败原因</p>
                  <p className="mt-2 text-[12px] leading-5 text-body">{detailJob.failedReason}</p>
                </div>
                <div className="rounded-control border border-hairline bg-surface-1 p-3">
                  <p className="type-eyebrow">Payload summary</p>
                  <p className="mt-2 break-words font-mono text-[10px] text-body">
                    {detailJob.payloadSummary}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-control border border-hairline bg-hairline">
                  <div className="bg-surface-1 p-3">
                    <dt className="type-eyebrow">创建</dt>
                    <dd className="mt-1.5 font-mono text-[10px] text-body">
                      {formatDateTime(detailJob.createdAt)}
                    </dd>
                  </div>
                  <div className="bg-surface-1 p-3">
                    <dt className="type-eyebrow">最近处理</dt>
                    <dd className="mt-1.5 font-mono text-[10px] text-body">
                      {formatDateTime(detailJob.processedAt)}
                    </dd>
                  </div>
                </dl>
              </div>
              <Button
                className="mt-6"
                variant="outline"
                disabled={!canRetry}
                onClick={() => {
                  setDetailJob(null);
                  setPendingAction({ kind: "retry", job: detailJob });
                }}
              >
                <RotateCcw aria-hidden="true" />
                重试任务
              </Button>
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
        confirmationLabel={actionCopy.label}
        confirmActionLabel={actionCopy.confirmLabel}
        onConfirm={confirmAction}
      />
    </div>
  );
}
