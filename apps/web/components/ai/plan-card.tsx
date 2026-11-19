"use client";

import type { AiToolCall, AiToolResult } from "@roamlog/contracts";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { Badge, Button, Checkbox } from "@roamlog/ui";
import { AlertTriangle, ArrowUpRight, ChevronRight, CircleCheck } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { createAiIdempotencyKey } from "@/lib/api/ai";

import {
  describePlanWarning,
  describePlannedCall,
  executionFailureCopy,
  planFailureCopy,
  summarizeReadOnlyTrace,
  toolFailureCopy,
  toolLabel,
} from "./copy";
import {
  EXECUTE_TOOL_NAME,
  PLAN_TOOL_NAME,
  type ConfirmedPlanResult,
  type ExecuteToolResult,
  type PlanToolArgs,
  type PlanToolResult,
} from "./chat-model-adapter";

/**
 * The plan confirmation card, rendered *inside* the assistant message as the
 * `roamlog.plan` tool part (assistant-ui "Tool UI" slot:
 * `MessagePrimitive.Parts components.tools.by_name`).
 *
 * Two-phase safety is preserved exactly as the previous two-column console
 * enforced it: this card can only ever call `addResult`, which hands the
 * selected calls back to the `ChatModelAdapter`; the adapter is the only place
 * that reaches `executeAiRun`.
 */

interface WorkspaceChatContextValue {
  workspaceSlug: string;
  canWrite: boolean;
}

const WorkspaceChatContext = createContext<WorkspaceChatContextValue>({
  workspaceSlug: "",
  canWrite: true,
});

export const WorkspaceChatProvider = WorkspaceChatContext.Provider;

export function useWorkspaceChat(): WorkspaceChatContextValue {
  return useContext(WorkspaceChatContext);
}

function formatExpiry(expiresAt: string): string | null {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function PlanWarnings({ warnings }: { warnings: NonNullable<PlanToolArgs["plan"]["warnings"]> }) {
  if (warnings.length === 0) return null;

  return (
    <ul className="space-y-2 border-b border-hairline bg-accent-amber/5 px-4 py-3">
      {warnings.map((warning, index) => {
        const copy = describePlanWarning(warning);
        return (
          <li key={`${warning.code}-${index}`} className="flex gap-2 text-xs leading-5">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent-amber" />
            <div className="min-w-0">
              <p className="text-body">
                {copy.action ? `${copy.action}：` : ""}
                {copy.message}
              </p>
              {copy.explanation ? <p className="mt-0.5 text-muted">{copy.explanation}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function TraceDetails({ trace }: { trace: AiToolCall[] }) {
  const summary = summarizeReadOnlyTrace(trace);
  if (!summary) return null;

  return (
    <details className="group border-b border-hairline">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2 text-xs text-muted outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-3 shrink-0 transition-transform group-open:rotate-90"
        />
        <span className="min-w-0 truncate">{summary}</span>
      </summary>
      <ul className="space-y-1 border-t border-hairline px-4 py-2">
        {trace.map((call, index) => (
          <li key={`${call.tool}-${index}`} className="flex gap-2">
            <span className="type-meta shrink-0 text-stone">{toolLabel(call.tool)}</span>
            <span className="type-meta min-w-0 truncate">{describePlannedCall(call).headline}</span>
          </li>
        ))}
      </ul>
    </details>
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
    <li className="flex items-start gap-3 px-4 py-3">
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
          {copy.write ? <Badge tone="neutral">将写入数据</Badge> : <Badge tone="slate">只读</Badge>}
        </div>
        <p className="mt-1 break-words text-sm leading-6 text-body">{copy.headline}</p>
        {copy.details.length > 0 ? (
          <p className="mt-1 break-words type-meta">{copy.details.join(" · ")}</p>
        ) : null}
      </div>
    </li>
  );
}

export function PlanConfirmationCard({
  args,
  result,
  addResult,
}: ToolCallMessagePartProps<PlanToolArgs, PlanToolResult>) {
  const { canWrite } = useWorkspaceChat();
  const plan = args?.plan;
  const calls = useMemo(() => plan?.plannedCalls ?? [], [plan]);
  const warnings = plan?.warnings ?? [];
  const [selected, setSelected] = useState<boolean[]>(() => calls.map(() => true));
  const [expired, setExpired] = useState(() =>
    plan?.expiresAt ? Date.parse(plan.expiresAt) <= Date.now() : false,
  );

  useEffect(() => {
    setSelected((current) =>
      calls.length === current.length ? current : calls.map(() => true),
    );
  }, [calls.length]);

  useEffect(() => {
    if (!plan?.expiresAt) return;
    const remaining = Date.parse(plan.expiresAt) - Date.now();
    if (remaining <= 0) {
      setExpired(true);
      return;
    }
    const timer = setTimeout(() => setExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [plan?.expiresAt]);

  const confirmation: ConfirmedPlanResult | null =
    result?.status === "confirmed" ? result : null;
  const confirmed = confirmation !== null;
  const selectedCalls = useMemo(
    () => calls.filter((_, index) => selected[index]),
    [calls, selected],
  );
  const selectedCount = selectedCalls.length;
  const disabled = confirmed || expired || !canWrite;
  const expiresAt = plan?.expiresAt ? formatExpiry(plan.expiresAt) : null;

  const toggle = (index: number) => {
    setSelected((current) => current.map((value, position) => (position === index ? !value : value)));
  };

  if (!plan) {
    return (
      <div className="rounded-card border border-hairline-strong bg-surface-1 px-4 py-3 text-sm text-muted">
        计划内容缺失，请重新发送这条需求。
      </div>
    );
  }

  return (
    <section
      aria-label="计划确认卡"
      className="mt-1 overflow-hidden rounded-card border border-hairline-strong bg-surface-1"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h3 className="font-serif text-base leading-tight tracking-[-0.02em] text-ink">
            待确认的操作
          </h3>
          <p className="type-meta">{calls.length} 项待执行</p>
        </div>
        <p className="type-meta">
          {confirmation
            ? `${confirmation.calls.length} 项已确认`
            : `已选 ${selectedCount} / ${calls.length}`}
        </p>
      </header>

      {warnings.length > 0 ? <PlanWarnings warnings={warnings} /> : null}
      <TraceDetails trace={plan.readOnlyTrace ?? []} />

      {calls.length === 0 ? (
        <p className="px-4 py-4 text-sm leading-6 text-muted">
          这次没有需要写入的操作。可以把需求写得更具体一些（目的地、时间、预算、同行人）再试一次。
        </p>
      ) : (
        <ul aria-label="待确认的操作" className="divide-y divide-hairline">
          {calls.map((call, index) => (
            <PlannedRow
              key={`${call.tool}-${index}`}
              call={call}
              index={index}
              checked={selected[index] ?? false}
              onToggle={toggle}
              disabled={disabled}
            />
          ))}
        </ul>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-4 py-3">
        <p className="min-w-0 text-xs leading-5 text-muted">
          {!canWrite
            ? planFailureCopy("forbidden").description
            : expired
              ? executionFailureCopy("run_not_found").description
              : confirmed
                ? "已确认，正在执行选中的操作。"
                : `确认后会立即写入工作区，不会自动撤销。${
                    expiresAt ? `计划在 ${expiresAt} 前有效。` : ""
                  }`}
        </p>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={disabled || selectedCount === 0}
          onClick={() =>
            addResult({
              status: "confirmed",
              runId: plan.runId,
              calls: selectedCalls,
              idempotencyKey: createAiIdempotencyKey(),
            })
          }
        >
          {confirmed ? "已确认执行" : `执行选中的 ${selectedCount} 项`}
        </Button>
      </footer>
    </section>
  );
}

function resultLine(result: AiToolResult): string {
  if (result.ok) return "已保存";
  const code = result.error?.code;
  return code ? toolFailureCopy(code) : "这一步没有保存成功，请稍后重试。";
}

export function ExecutionResultCard({
  result,
}: ToolCallMessagePartProps<Record<string, unknown>, ExecuteToolResult>) {
  const { workspaceSlug } = useWorkspaceChat();
  if (!result) return null;

  if (result.status === "failed") {
    return (
      <section
        role="alert"
        className="mt-1 rounded-card border border-accent-red/25 bg-accent-red/5 px-4 py-3"
      >
        <p className="text-sm font-medium text-ink">{result.title}</p>
        <p className="mt-1 text-xs leading-5 text-muted">{result.description}</p>
        <ul className="mt-3 space-y-1">
          {result.calls.map((call, index) => (
            <li key={`${call.tool}-${index}`} className="type-meta">
              {toolLabel(call.tool)} · {describePlannedCall(call).headline}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const { response } = result;

  return (
    <section
      aria-label="执行结果"
      className="mt-1 overflow-hidden rounded-card border border-hairline-strong bg-surface-1"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h3 className="font-serif text-base leading-tight tracking-[-0.02em] text-ink">
            执行结果
          </h3>
          <p className="type-meta">{response.results.length} 项</p>
        </div>
        {response.partialFailure ? (
          <Badge tone="yellow">部分失败</Badge>
        ) : (
          <Badge tone="neutral">全部完成</Badge>
        )}
      </header>

      <ul className="divide-y divide-hairline">
        {response.results.map((item, index) => {
          const call = result.calls[index];
          const copy = call ? describePlannedCall(call) : null;
          const tripHref =
            item.ok && item.entityId && call?.tool === "trips.create"
              ? `/w/${workspaceSlug}/trips/${item.entityId}`
              : null;

          return (
            <li key={`${item.tool}-${index}`} className="flex items-start gap-3 px-4 py-3">
              {item.ok ? (
                <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-green" />
              ) : (
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-red" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-ink">{toolLabel(item.tool)}</span>
                  {copy ? <span className="type-meta">{copy.headline}</span> : null}
                </div>
                <p className="mt-1 break-words text-xs leading-5 text-muted">{resultLine(item)}</p>
              </div>
              {tripHref ? (
                <a
                  href={tripHref}
                  className="inline-flex shrink-0 items-center gap-1 text-xs text-ink underline decoration-hairline-strong underline-offset-2"
                >
                  查看
                  <ArrowUpRight aria-hidden="true" className="size-3" />
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>

      <footer className="border-t border-hairline px-4 py-3">
        <p className="type-meta">{response.summary}</p>
      </footer>
    </section>
  );
}

export const AI_TOOL_COMPONENTS = {
  [PLAN_TOOL_NAME]: PlanConfirmationCard,
  [EXECUTE_TOOL_NAME]: ExecutionResultCard,
} as const;
