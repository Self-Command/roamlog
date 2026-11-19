"use client";

import {
  Badge,
  Button,
  Checkbox,
  Skeleton,
} from "@roamlog/ui";
import type {
  AiChatResponse,
  AiPlanWarning,
  AiRunExecuteResponse,
  AiToolCall,
  AiToolResult,
} from "@roamlog/contracts";
import { ArrowUpRight, Check, ChevronRight, CircleAlert, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { AiRequestError } from "@/lib/api/ai";

import {
  describePlanWarning,
  describePlannedCall,
  executionFailureCopy,
  toolFailureCopy,
  toolLabel,
} from "./copy";

/**
 * The right-hand plan panel: every action the model wants to take, one
 * checkbox each, plus the confirmed results.
 *
 * Nothing in this panel has happened yet until the user confirms. That is why
 * the footer is the *only* primary action once a plan exists, and why the
 * result list is the only place that says 「已保存」.
 */

export interface PlanPanelProps {
  plan: AiChatResponse | null;
  selected: boolean[];
  onToggle: (index: number) => void;
  onRequestExecute: () => void;
  onDiscard: () => void;
  onRestart: () => void;
  /** Puts the previous request back in the composer. Never auto-sends it. */
  onRevise: () => void;
  executing: boolean;
  planning: boolean;
  result: AiRunExecuteResponse | null;
  submittedCalls: AiToolCall[];
  runFailure: AiRequestError | null;
  workspaceSlug: string;
}

function formatExpiry(expiresAt: string): string | null {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function PanelHeader({
  eyebrow,
  title,
  counter,
}: {
  eyebrow: string;
  title: string;
  counter: string;
}) {
  return (
    <header className="flex shrink-0 items-end justify-between gap-3 border-b border-hairline px-4 py-4">
      <div>
        <p className="type-eyebrow">{eyebrow}</p>
        <h2 className="mt-1 font-serif text-xl leading-tight tracking-[-0.02em] text-ink">
          {title}
        </h2>
      </div>
      <p className="type-meta shrink-0 pb-0.5">{counter}</p>
    </header>
  );
}

/**
 * Non-fatal notes: the server dropped a call instead of queueing it. This is a
 * partial omission, not a failure, so the block is neutral (never red) and
 * still explains every dropped action in the server's own words.
 */
function PlanWarnings({ warnings }: { warnings: AiPlanWarning[] }) {
  const [open, setOpen] = useState(true);

  return (
    <section
      aria-label="被忽略的操作提示"
      className="border-b border-hairline bg-surface-2/40 px-4 py-3"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
      >
        <ChevronRight
          aria-hidden="true"
          className={
            open
              ? "size-3 shrink-0 rotate-90 text-stone transition-transform"
              : "size-3 shrink-0 text-stone transition-transform"
          }
        />
        <span className="text-sm text-stone">{warnings.length} 条提示</span>
        <span className="type-meta ml-auto shrink-0">部分操作已忽略</span>
      </button>

      {open ? (
        <ul className="mt-3 space-y-2">
          {warnings.map((warning, index) => {
            const copy = describePlanWarning(warning);
            return (
              <li
                key={`${warning.code}-${index}`}
                className="rounded-control border border-hairline bg-black/20 px-3 py-2.5"
              >
                {copy.action ? (
                  <p className="text-xs leading-5 text-stone">{copy.action}</p>
                ) : null}
                <p className="mt-0.5 break-words text-sm leading-6 text-body">{copy.message}</p>
                {copy.explanation ? (
                  <p className="mt-1 text-xs leading-5 text-stone">{copy.explanation}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function PanelEmpty({
  planning,
  warningCount,
  onRevise,
}: {
  planning: boolean;
  warningCount: number;
  onRevise: () => void;
}) {
  if (planning) {
    return (
      <div className="space-y-4 px-4 py-5" aria-hidden="true">
        {[0, 1, 2].map((item) => (
          <div key={item} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
        <p className="pt-2 text-xs leading-5 text-muted">正在整理计划，尚未写入任何内容。</p>
      </div>
    );
  }

  // A plan exists and every proposed call was rejected by validation. Saying
  // only 「没有可执行的计划」 would hide the reason the user needs to fix.
  if (warningCount > 0) {
    return (
      <div className="px-5 py-8">
        <span className="flex size-10 items-center justify-center rounded-pill border border-hairline-strong bg-surface-2 text-stone">
          <TriangleAlert aria-hidden="true" className="size-4" />
        </span>
        <p className="mt-4 font-serif text-xl leading-tight tracking-[-0.02em] text-ink">
          已生成建议，但全部被校验拦下
        </p>
        <p className="mt-2 text-xs leading-5 text-stone">
          助手给出了操作建议，但没有一条通过校验，具体原因见上方「{warningCount} 条提示」。工作区没有被写入任何内容。
        </p>
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRevise}>
          修改需求重新规划
        </Button>
      </div>
    );
  }

  return (
    <div className="px-5 py-10 text-center">
      <span className="mx-auto flex size-10 items-center justify-center rounded-pill border border-hairline-strong bg-surface-2 text-muted">
        <Sparkles aria-hidden="true" className="size-4" />
      </span>
      <p className="mt-4 font-serif text-xl leading-tight tracking-[-0.02em] text-ink">
        还没有计划
      </p>
      <p className="mt-2 text-xs leading-5 text-muted">
        发送一句话后，这里会逐条列出助手准备执行的操作。你确认之前，不会写入任何内容。
      </p>
    </div>
  );
}

function ResultBanner({ result }: { result: AiRunExecuteResponse }) {
  const succeeded = result.results.filter((item) => item.ok).length;
  const failed = result.results.length - succeeded;

  if (result.partialFailure) {
    return (
      <div className="border-b border-accent-yellow/20 bg-accent-yellow/5 px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-medium text-accent-yellow">
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
          部分成功，请检查
        </p>
        <p className="mt-1 text-xs leading-5 text-muted">
          {succeeded} 项已保存，{failed} 项失败。已成功的内容不会回滚，请重新规划失败的部分。
        </p>
      </div>
    );
  }

  if (succeeded === 0) {
    return (
      <div className="border-b border-accent-red/20 bg-accent-red/5 px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-medium text-accent-red">
          <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
          执行未完成
        </p>
        <p className="mt-1 text-xs leading-5 text-muted">
          所有操作都没有保存成功，工作区没有被写入新内容。
        </p>
      </div>
    );
  }

  return (
    <div className="border-b border-accent-green/20 bg-accent-green/5 px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-medium text-accent-green">
        <Check aria-hidden="true" className="size-4 shrink-0" />
        执行完成
      </p>
      <p className="mt-1 text-xs leading-5 text-muted">
        {succeeded} 项操作已保存到工作区。
      </p>
    </div>
  );
}

function ResultRow({
  call,
  result,
  workspaceSlug,
}: {
  call: AiToolCall;
  result: AiToolResult;
  workspaceSlug: string;
}) {
  const copy = describePlannedCall(call);

  return (
    <div className="flex items-start gap-3 px-4 py-4">
      <span
        aria-hidden="true"
        className={
          result.ok
            ? "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-pill border border-accent-green/30 bg-accent-green/10 text-accent-green"
            : "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-pill border border-accent-red/30 bg-accent-red/10 text-accent-red"
        }
      >
        {result.ok ? <Check className="size-3" strokeWidth={3} /> : <CircleAlert className="size-3" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink">{copy.label}</span>
          <Badge tone={result.ok ? "green" : "red"}>{result.ok ? "已保存" : "未保存"}</Badge>
        </div>
        <p className="mt-1 break-words text-sm leading-6 text-body">{copy.headline}</p>
        {copy.details.length > 0 ? (
          <p className="mt-1 break-words type-meta">{copy.details.join(" · ")}</p>
        ) : null}
        {!result.ok ? (
          <p className="mt-1 text-xs leading-5 text-accent-red">
            {toolFailureCopy(result.error?.code ?? "")}
          </p>
        ) : null}
        {result.ok && result.entityId && call.tool === "trips.create" ? (
          <Link
            href={`/w/${workspaceSlug}/trips/${result.entityId}`}
            className="mt-2 inline-flex items-center gap-1 text-xs text-accent-blue underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
          >
            打开新建的旅行
            <ArrowUpRight aria-hidden="true" className="size-3" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function PlannedRow({
  call,
  index,
  checked,
  onToggle,
  disabled,
}: {
  call: AiToolCall;
  index: number;
  checked: boolean;
  onToggle: (index: number) => void;
  disabled: boolean;
}) {
  const copy = describePlannedCall(call);

  return (
    <div className="flex items-start gap-3 px-4 py-4">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={() => onToggle(index)}
        aria-label={`选择「${copy.label}」：${copy.headline}`}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink">{copy.label}</span>
          {copy.write ? (
            <Badge tone="neutral">将写入数据</Badge>
          ) : (
            <Badge tone="slate">只读</Badge>
          )}
        </div>
        <p className="mt-1 break-words text-sm leading-6 text-body">{copy.headline}</p>
        {copy.details.length > 0 ? (
          <p className="mt-1 break-words type-meta">{copy.details.join(" · ")}</p>
        ) : null}
      </div>
    </div>
  );
}

export function PlanPanel({
  plan,
  selected,
  onToggle,
  onRequestExecute,
  onDiscard,
  onRestart,
  onRevise,
  executing,
  planning,
  result,
  submittedCalls,
  runFailure,
  workspaceSlug,
}: PlanPanelProps) {
  const calls = plan?.plannedCalls ?? [];
  const warnings = plan?.warnings ?? [];
  const selectedCount = selected.filter(Boolean).length;
  const expiresAt = plan ? formatExpiry(plan.expiresAt) : null;
  const terminalFailure = runFailure ? !runFailure.retryable : false;
  const runFailureCopy = runFailure ? executionFailureCopy(runFailure.kind) : null;

  const header = result
    ? { eyebrow: "RESULT / 已执行", title: "执行结果", counter: `${result.results.length} 项` }
    : {
        eyebrow: plan ? "PLAN / 待确认" : "PLAN",
        title: "计划面板",
        counter: `${selectedCount} / ${calls.length}`,
      };

  return (
    <aside
      aria-label="计划面板"
      className="flex min-w-0 flex-col overflow-hidden rounded-card border border-hairline-strong bg-surface-1 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-8rem)]"
    >
      <PanelHeader eyebrow={header.eyebrow} title={header.title} counter={header.counter} />

      <div className="min-h-0 flex-1 lg:overflow-y-auto">
        {result ? <ResultBanner result={result} /> : null}

        {runFailure && runFailureCopy ? (
          <div role="alert" className="border-b border-hairline bg-accent-red/5 px-4 py-3">
            <p className="text-sm font-medium text-ink">{runFailureCopy.title}</p>
            <p className="mt-1 text-xs leading-5 text-muted">{runFailureCopy.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onRestart}>
                重新规划
              </Button>
            </div>
          </div>
        ) : null}

        {warnings.length > 0 ? <PlanWarnings warnings={warnings} /> : null}

        {calls.length === 0 ? (
          <PanelEmpty
            planning={planning}
            warningCount={warnings.length}
            onRevise={onRevise}
          />
        ) : null}

        {calls.length > 0 && !result ? (
          <ul aria-label="待确认的操作">
            {calls.map((call, index) => (
              <li key={`${call.tool}-${index}`} className="border-b border-hairline last:border-b-0">
                <PlannedRow
                  call={call}
                  index={index}
                  checked={selected[index] === true}
                  onToggle={onToggle}
                  disabled={executing || submittedCalls.length > 0}
                />
              </li>
            ))}
          </ul>
        ) : null}

        {submittedCalls.length > 0 && !result ? (
          <p className="px-4 py-3">
            <span className="type-meta">
              这次提交的清单已锁定；重试会按同一份操作执行，不会重复创建内容。
            </span>
          </p>
        ) : null}

        {result ? (
          <ul aria-label="执行结果">
            {submittedCalls.map((call, index) => {
              const item = result.results[index];
              if (!item) return null;
              return (
                <li key={`${call.tool}-${index}`} className="border-b border-hairline last:border-b-0">
                  <ResultRow call={call} result={item} workspaceSlug={workspaceSlug} />
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {plan && !result && calls.length > 0 ? (
        <footer className="shrink-0 border-t border-hairline p-4">
          <Button
            type="button"
            variant="primary"
            className="w-full"
            disabled={selectedCount === 0 || executing || terminalFailure}
            onClick={onRequestExecute}
          >
            {executing ? "正在执行…" : `执行选中的 ${selectedCount} 项操作`}
          </Button>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="type-meta">
              {expiresAt ? `计划有效至 ${expiresAt}` : "计划 15 分钟内有效"}
            </p>
            <button
              type="button"
              onClick={onDiscard}
              disabled={executing}
              className="rounded-sm text-xs text-muted underline-offset-4 outline-none hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 disabled:opacity-40"
            >
              放弃计划，不执行
            </button>
          </div>
        </footer>
      ) : null}

      {plan && !result && calls.length === 0 ? (
        <footer className="shrink-0 border-t border-hairline p-4">
          <p className="text-xs leading-5 text-stone">
            {warnings.length > 0
              ? "修改需求后重新发送，就能生成新的计划；现在没有写入任何内容。"
              : "这次没有需要写入的操作。可以继续描述新的计划。"}
          </p>
          <button
            type="button"
            onClick={onDiscard}
            className="mt-2 rounded-sm text-xs text-muted underline-offset-4 outline-none hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
          >
            清除这份计划
          </button>
        </footer>
      ) : null}

      {result ? (
        <footer className="shrink-0 border-t border-hairline p-4">
          <Button type="button" variant="outline" className="w-full" onClick={onRestart}>
            开始新的计划
          </Button>
        </footer>
      ) : null}
    </aside>
  );
}

/**
 * Exported for the console: the confirmation dialog reuses the exact same
 * summaries as the panel, so what the user confirmed is what the server gets.
 */
export function ConfirmationList({ calls }: { calls: AiToolCall[] }) {
  return (
    <ul className="max-h-64 space-y-2 overflow-y-auto rounded-control border border-hairline bg-black/30 p-3">
      {calls.map((call, index) => {
        const copy = describePlannedCall(call);
        return (
          <li key={`${call.tool}-${index}`} className="flex gap-2 text-xs leading-5">
            <span className="mt-0.5 size-1.5 shrink-0 rounded-pill bg-ink" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-ink">
                {toolLabel(call.tool)} · {copy.headline}
              </p>
              <p className="type-meta">
                {copy.details.length > 0 ? copy.details.join(" · ") : "将在此工作区执行"}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}