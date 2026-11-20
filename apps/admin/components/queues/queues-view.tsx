"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Gauge, Pause, Play, RotateCcw, ShieldAlert, Waypoints } from "lucide-react";

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

import type { AdminConsoleRole } from "../../lib/admin-types";
import { AdminMutationError } from "../../lib/admin-api-error";
import {
  UNKNOWN_THROUGHPUT,
  formatThroughput,
  useAdminSystemResource,
  type AdminMutationPort,
} from "../../lib/admin-data-source";
import { formatDateTime } from "../../lib/format";
import {
  JOB_STATUS_LABELS,
  QUEUE_STATE_LABELS,
  WORKER_STATUS_LABELS,
} from "../../lib/labels";
import {
  type AdminFailedJob,
  type AdminQueueSummary,
} from "../../lib/admin-ops-types";
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
  queues: readonly AdminQueueSummary[];
  failedJobs: readonly AdminFailedJob[];
  mutations?: AdminMutationPort;
}

export function QueuesView({
  role,
  queues,
  failedJobs,
  mutations,
}: QueuesViewProps) {
  const [queueRecords, setQueueRecords] = useState<readonly AdminQueueSummary[]>(queues);
  const [jobRecords, setJobRecords] = useState<readonly AdminFailedJob[]>(failedJobs);
  const [pendingAction, setPendingAction] = useState<QueueAction | null>(null);
  const [detailJob, setDetailJob] = useState<AdminFailedJob | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const canRetry = canPlatform(role, "admin:jobs:retry");
  const canManageQueue = canPlatform(role, "admin:jobs:manage");
  const readOnly = role === "analyst";
  const totalFailed = queueRecords.reduce((total, queue) => total + queue.failed, 0);
  const totalWaiting = queueRecords.reduce((total, queue) => total + queue.waiting, 0);
  const pausedQueues = queueRecords.filter((queue) => queue.paused).length;
  // Throughput is a measured window per queue; if Redis could not provide the
  // window the console shows "暂不可用" instead of a fabricated 0.
  const throughputKnown =
    queueRecords.length > 0 &&
    queueRecords.every((queue) => Number.isFinite(queue.throughputPerMinute));
  const throughput = throughputKnown
    ? queueRecords.reduce((total, queue) => total + queue.throughputPerMinute, 0)
    : UNKNOWN_THROUGHPUT;
  const throughputLabel = formatThroughput(throughput);

  const queueByJob = useMemo(
    () => new Map(queueRecords.map((queue) => [queue.name, queue])),
    [queueRecords],
  );

  useEffect(() => {
    setQueueRecords(queues);
    setJobRecords(failedJobs);
  }, [queues, failedJobs]);

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
          description: "任务将重新进入等待队列，并保留原有任务 ID 用于幂等检查。",
          confirmLabel: "确认重试",
          label: "输入任务 ID 确认",
        }
      : pendingAction?.kind === "pause"
        ? {
            title: "暂停队列",
            description: "暂停后任务进程不再消费该队列的新任务，已在执行的任务会完成。",
            confirmLabel: "确认暂停",
            label: "输入队列名称确认",
          }
        : pendingAction?.kind === "resume"
          ? {
              title: "恢复队列",
              description: "队列恢复后任务进程将重新消费等待中的任务。",
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
      if (mutations) {
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
      setStatusMessage(`已重新入队：${job.id}`);
    } else if (pendingAction.kind === "clear") {
      const queue = pendingAction.queue;
      if (mutations) {
        try {
          await mutations.clearQueue(queue.name);
        } catch (error) {
          setStatusMessage(
            error instanceof AdminMutationError
              ? `清空失败：${error.failure.code} · ${error.failure.detail}`
              : "清空失败，请检查 API 与权限后重试。",
          );
          setPendingAction(null);
          return;
        }
      }
      setJobRecords((current) => current.filter((job) => job.queue !== queue.name));
      setQueueRecords((current) =>
        current.map((item) => (item.name === queue.name ? { ...item, failed: 0 } : item)),
      );
      setStatusMessage(`已清空失败任务：${queue.name}`);
    } else {
      const { queue, kind } = pendingAction;
      if (mutations) {
        try {
          if (kind === "pause") {
            await mutations.pauseQueue(queue.name);
          } else {
            await mutations.resumeQueue(queue.name);
          }
        } catch (error) {
          setStatusMessage(
            error instanceof AdminMutationError
              ? `${kind === "pause" ? "暂停" : "恢复"}失败：${error.failure.code} · ${error.failure.detail}`
              : `${kind === "pause" ? "暂停" : "恢复"}失败，请检查 API 与权限后重试。`,
          );
          setPendingAction(null);
          return;
        }
      }
      setQueueRecords((current) =>
        current.map((item) =>
          item.name === queue.name ? { ...item, paused: kind === "pause" } : item,
        ),
      );
      setStatusMessage(`${kind === "pause" ? "已暂停" : "已恢复"}队列：${queue.name}`);
    }
    setPendingAction(null);
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="投递 / BullMQ"
        title="队列"
        description="检查各队列等待、运行与失败任务，查看失败原因；暂停、恢复与清空仅超级管理员可执行。"
        readOnly={readOnly}
        actions={
          <div className="flex items-center gap-2 rounded-control border border-hairline bg-surface-1 px-3 py-2">
            <Gauge aria-hidden="true" className="size-4 text-accent-blue" />
            <div>
              <p className="type-eyebrow">总吞吐</p>
              <p className="mt-0.5 font-mono text-[10px] text-body">{throughputLabel}</p>
            </div>
          </div>
        }
      />

      <section aria-label="队列指标" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetricCard
          label="等待任务"
          value={String(totalWaiting)}
          detail={
            queueRecords.length === 0
              ? "Redis 中未发现已注册队列"
              : `跨 ${queueRecords.length} 个队列（Redis 发现）`
          }
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
          detail="任务进程不消费已暂停队列"
          tone={pausedQueues > 0 ? "orange" : "neutral"}
          icon={Pause}
        />
        <AdminMetricCard
          label="吞吐"
          value={Number.isFinite(throughput) ? throughput.toFixed(1) : "暂不可用"}
          detail={
            Number.isFinite(throughput)
              ? "5 分钟窗口内 BullMQ 完成时间戳推算 · 任务/分钟"
              : "Redis 无法提供完成窗口"
          }
          tone="green"
          icon={Gauge}
        />
      </section>

      {<QueueWorkerPanel />}

      {!canManageQueue ? (
        <div
          role="note"
          className="flex items-center gap-2 rounded-control border border-accent-slate/25 bg-accent-slate/5 px-3 py-2 text-[12px] text-accent-slate"
        >
          <ShieldAlert aria-hidden="true" className="size-4" />
          失败任务读取与重试按角色权限开放；暂停、恢复与清空队列仅超级管理员可执行。
        </div>
      ) : null}

      <section aria-label="队列卡片" className="grid gap-3 sm:grid-cols-2">
        {queueRecords.length === 0 ? (
          <EmptyState
            icon={RotateCcw}
            title="未发现队列"
            description="Redis 中没有可识别的队列状态键。队列列表来自 Redis 扫描；任务进程尚未注册队列时这里保持为空。"
            className="sm:col-span-2"
          />
        ) : null}
        {queueRecords.map((queue) => {
          // The badge reports the queue state that is actually observable; a
          // queue is never labelled "healthy" from counters alone.
          const queueState = queue.paused
            ? { label: QUEUE_STATE_LABELS.paused, tone: "yellow" as const }
            : queue.failed > 0
              ? { label: QUEUE_STATE_LABELS.needs_review, tone: "red" as const }
              : queue.active > 0
                ? { label: QUEUE_STATE_LABELS.processing, tone: "blue" as const }
                : queue.waiting > 0
                  ? { label: QUEUE_STATE_LABELS.backlog, tone: "orange" as const }
                  : { label: QUEUE_STATE_LABELS.idle, tone: "neutral" as const };

          return (
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
              <Badge tone={queueState.tone}>{queueState.label}</Badge>
            </div>

            <dl className="mt-4 grid grid-cols-4 gap-px overflow-hidden rounded-control border border-hairline bg-hairline">
              {[
                ["等待", queue.waiting],
                ["运行", queue.active],
                ["失败", queue.failed],
                ["完成", queue.completed],
              ].map(([label, value]) => (
                <div key={label} className="bg-surface-1 px-2 py-2.5">
                  <dt className="type-eyebrow text-[8px]">{label}</dt>
                  <dd className="mt-1 font-mono text-[12px] text-body">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
              <span className="font-mono text-[9px] text-muted">
                {formatThroughput(queue.throughputPerMinute)} · 5 分钟窗口
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  variant="danger"
                  size="sm"
                  aria-label={`清空队列 ${queue.name}`}
                  disabled={!canManageQueue || queue.failed === 0}
                  title={canManageQueue ? "清空该队列的失败任务" : "仅超级管理员可清空队列"}
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
                      : "仅超级管理员可暂停或恢复队列"
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
          );
        })}
      </section>

      <section className="overflow-hidden rounded-card border border-hairline-strong bg-surface-1">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
          <div>
            <h2 className="text-[13px] font-medium text-ink">失败任务</h2>
            <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              失败 / 死信复核
            </p>
          </div>
          <Badge tone={jobRecords.length > 0 ? "red" : "green"}>{jobRecords.length} 个任务</Badge>
        </div>

        {jobRecords.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title="没有失败任务"
            description="当前数据中没有待处理失败任务。"
            className="m-4"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-[12px]">
              <caption className="sr-only">失败任务列表</caption>
              <thead>
                <tr className="border-b border-hairline font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    任务
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    队列
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-normal">
                    尝试次数
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
                <p className="type-eyebrow">失败任务 / {detailJob.queue}</p>
                <SheetTitle>{detailJob.id}</SheetTitle>
                <SheetDescription>{detailJob.name}</SheetDescription>
              </SheetHeader>
              <div className="flex flex-wrap gap-2">
                <Badge tone="red">{JOB_STATUS_LABELS.failed}</Badge>
                <Badge tone="neutral">{detailJob.attempts} 次尝试</Badge>
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
                  <p className="type-eyebrow">负载摘要</p>
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

const workerTones = {
  up: "green",
  degraded: "yellow",
  down: "red",
} as const;

const signalSources = {
  "consumer-clients": "Redis CLIENT LIST 中阻塞在 BullMQ BZPOPMIN 的消费者 + 队列计数",
  "activity-derived": "最近一次任务完成/失败时间 + 队列运行数",
  unavailable: "无可用的推导信号",
} as const;

/**
 * Worker health cannot be derived from queue counters alone. This panel calls
 * `/v1/admin/system` so the queue page shows the same observed worker signal,
 * and says "无法确认" when the API could not prove liveness either way.
 */
function QueueWorkerPanel() {
  const resource = useAdminSystemResource();
  const snapshot = resource.data;

  if (resource.isLoading && !snapshot) {
    return (
      <section
        aria-label="任务进程消费端"
        className="rounded-card border border-hairline bg-surface-1 p-4 font-mono text-[10px] text-muted"
      >
        读取任务进程观测信号…
      </section>
    );
  }

  if (!snapshot) {
    return (
      <section
        aria-label="任务进程消费端"
        className="flex items-start gap-3 rounded-card border border-hairline bg-surface-1 p-4"
      >
        <Waypoints aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-slate" />
        <div>
          <h2 className="text-[12px] font-medium text-ink">任务进程消费端</h2>
          <p className="mt-1 text-[10px] leading-5 text-muted">
            暂时读不到任务进程信号，无法判断消费者是否存活。
          </p>
        </div>
      </section>
    );
  }

  const signal = snapshot.workerSignal ?? null;
  const observable = signal !== null && signal.signal !== "unavailable";

  return (
    <section
      aria-label="任务进程消费端"
      className="rounded-card border border-hairline-strong bg-surface-1 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="type-eyebrow">任务进程 / 观测信号</p>
          <h2 className="mt-1 font-serif text-lg tracking-[-0.02em] text-ink">任务进程消费端</h2>
        </div>
        {observable ? (
          <Badge tone={workerTones[snapshot.workerStatus]}>
            {WORKER_STATUS_LABELS[snapshot.workerStatus]}
          </Badge>
        ) : (
          <Badge tone="slate" title="缺少任务进程心跳，无法证明存活或不可用">
            无法确认
          </Badge>
        )}
      </div>

      <dl className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">阻塞消费者</dt>
          <dd className="font-mono text-[10px] text-body">{snapshot.workerConsumers}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">最近任务</dt>
          <dd className="font-mono text-[10px] text-body">
            {signal?.lastJobAt ? formatDateTime(signal.lastJobAt) : "暂不可用"}
          </dd>
        </div>
      </dl>

      <p className="mt-3 border-t border-hairline pt-3 font-mono text-[9px] leading-4 text-muted">
        推导口径：{signal ? signalSources[signal.signal] : "无可用的推导信号"}
        {signal?.lastJobStatus
          ? ` · 最近${JOB_STATUS_LABELS[signal.lastJobStatus]} @ ${signal.lastJobQueue ?? "?"}`
          : ""}
      </p>
      {!observable ? (
        <p className="mt-2 text-[9px] leading-4 text-muted">
          队列健康不由计数推导：需要任务进程写入心跳，或由任务进程侧暴露自身连接信息
          （当前版本的任务进程不标记连接名，按连接名匹配会永久误报不可用）。
        </p>
      ) : null}
    </section>
  );
}
