"use client";

import type { AiToolCall, AiToolResult } from "@roamlog/contracts";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { Badge, Button, Checkbox } from "@roamlog/ui";
import {
  AlertTriangle,
  ArrowUpRight,
  Backpack,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  ListChecks,
  Map as MapIcon,
  MapPin,
  NotebookPen,
  FileText,
  Receipt,
  Users,
  Wallet,
} from "lucide-react";
import { createContext, useContext, useEffect, useId, useMemo, useState } from "react";

import { createAiIdempotencyKey } from "@/lib/api/ai";

import { useOptionalAiArtifact } from "./artifacts/artifact-context";
import { cn } from "./cn";
import {
  describePlanWarning,
  describePlannedCall,
  planActionLabel,
  planFailureCopy,
  summarizeReadOnlyTrace,
  toolFailureCopy,
  toolLabel,
} from "./copy";
import {
  buildPlanReview,
  normalizeSelection,
  type PlanAction,
  type PlanBucket,
  type PlanRow as PlanReviewRow,
  type PlanSubjectMap,
} from "./plan-preview";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./tool-card-primitives";
import {
  EXECUTE_TOOL_NAME,
  PLAN_TOOL_NAME,
  executionOutcome,
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

const BUCKET_ICONS: Readonly<Record<PlanBucket, typeof MapPin>> = {
  trip: MapIcon,
  stops: MapPin,
  itinerary: CalendarDays,
  packing: Backpack,
  budget: Wallet,
  expenses: Receipt,
  entries: NotebookPen,
  participants: Users,
  documents: FileText,
  orphan: AlertTriangle,
};

function actionTone(action: PlanAction): "green" | "yellow" | "red" {
  if (action === "add") return "green";
  if (action === "remove") return "red";
  return "yellow";
}

/**
 * One field comparison, laid out after Payload CMS
 * `packages/ui/src/elements/FieldDiffContainer/index.tsx` L14–L63 (MIT):
 * two columns `{From}{To}` (L58–L59), `role="group"` + `aria-labelledby`
 * (L40–L44). The values are our rows, not Payload field records.
 */
function PlanFieldDiff({ row }: { row: PlanReviewRow }) {
  const labelId = useId();
  const from = row.from.join(" · ") || "—";
  const to = row.to.join(" · ") || "—";

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      data-testid="plan-field-diff"
      className="mt-2 overflow-hidden rounded-control border border-hairline"
    >
      <p id={labelId} className="sr-only">
        「{row.headline}」的旧值与新值
      </p>
      <div className="grid grid-cols-1 divide-y divide-hairline sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="min-w-0 px-3 py-2">
          <p className="type-meta">旧值</p>
          <p className="mt-0.5 break-words text-xs leading-5 text-muted">{from}</p>
        </div>
        <div className="min-w-0 px-3 py-2">
          <p className="type-meta">新值</p>
          <p className="mt-0.5 break-words text-xs leading-5 text-ink">{to}</p>
        </div>
      </div>
    </div>
  );
}

function PlanRowItem({
  row,
  checked,
  onToggle,
  disabled,
  dependencyCleared,
}: {
  row: PlanReviewRow;
  checked: boolean;
  onToggle: (index: number) => void;
  disabled: boolean;
  dependencyCleared: boolean;
}) {
  return (
    <li
      data-testid="plan-row"
      data-call-index={row.callIndex}
      data-action={row.action}
      data-mode={row.mode}
      className="flex items-start gap-3 px-4 py-3"
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={() => onToggle(row.callIndex)}
        aria-label={`选择「${row.label}」：${row.headline}`}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={actionTone(row.action)}>{planActionLabel(row.action)}</Badge>
          <p className="min-w-0 break-words text-sm leading-6 text-ink">{row.headline}</p>
        </div>
        <p className="mt-0.5 type-meta">{row.label}</p>
        {row.mode === "change" ? <PlanFieldDiff row={row} /> : null}
        {row.mode !== "change" && row.details.length > 0 ? (
          <p className="mt-1 break-words type-meta">{row.details.join(" · ")}</p>
        ) : null}
        {row.note ? (
          <p
            className={cn(
              "mt-1 text-xs leading-5",
              row.action === "remove" ? "text-accent-red" : "text-muted",
            )}
          >
            {row.note}
          </p>
        ) : null}
        {dependencyCleared ? (
          <p className="mt-1 text-xs leading-5 text-accent-amber">
            已随「创建旅行」一并取消，勾选它需要先勾选创建旅行。
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** `subjects` is additive on the plan event; the adapter type catches up with the contract. */
type PlanWithSubjects = PlanToolArgs["plan"] & { subjects?: PlanSubjectMap };

/**
 * The plan review card: one summary header, one foldable group per entity, and
 * one confirmation footer.
 *
 * Structure is a composition of ported surfaces (see `.audit/ai-plan-review-spec.md`
 * §4): Terraform/OpenTofu's "summary + per-item blocks + final plan line + no
 * undo" shape (behaviour only — BUSL/MPL code is not copied), GitHub's
 * "Files changed" grouping/folding, Payload's From/To column for a single edit,
 * and assistant-ui's receipt/expired states. Action words are Chinese; no
 * `+/~/-` symbols from OpenTofu are used.
 */
export function PlanConfirmationCard({
  args,
  result,
  addResult,
}: ToolCallMessagePartProps<PlanToolArgs, PlanToolResult>) {
  const { canWrite } = useWorkspaceChat();
  const plan = args?.plan as PlanWithSubjects | undefined;
  const calls = useMemo(() => plan?.plannedCalls ?? [], [plan]);
  const warnings = plan?.warnings ?? [];
  const review = useMemo(
    () => buildPlanReview(calls, plan?.subjects),
    [calls, plan?.subjects],
  );
  const [selected, setSelected] = useState<boolean[]>(() => calls.map(() => true));
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [armed, setArmed] = useState(false);
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
  const createIndex = calls.findIndex((call) => call.tool === "trips.create");
  const disabled = confirmed || expired || !canWrite;
  const expiresAt = plan?.expiresAt ? formatExpiry(plan.expiresAt) : null;

  const applySelection = (next: boolean[]) => {
    setSelected(normalizeSelection(calls, next));
    setArmed(false);
  };

  const toggle = (index: number) => {
    applySelection(
      calls.map((_, position) =>
        position === index ? !selected[position] : selected[position] === true,
      ),
    );
  };

  const toggleGroup = (group: (typeof review.groups)[number], next: boolean) => {
    const members = new Set(group.rows.map((row) => row.callIndex));
    applySelection(
      calls.map((_, index) => (members.has(index) ? next : selected[index] === true)),
    );
  };

  if (!plan) {
    return (
      <div className="rounded-card border border-hairline-strong bg-surface-1 px-4 py-3 text-sm text-muted">
        计划内容缺失，请重新发送这条需求。
      </div>
    );
  }

  const tripMeta = review.trip
    ? [
        review.trip.dateRange,
        review.trip.destinations,
        review.trip.days === undefined ? undefined : `${review.trip.days} 天`,
        review.trip.budget ? `预算 ${review.trip.budget}` : undefined,
      ].filter((part): part is string => Boolean(part))
    : [];

  return (
    <section
      aria-label="计划确认卡"
      className="mt-1 overflow-hidden rounded-card border border-hairline-strong bg-surface-1"
    >
      <header className="border-b border-hairline px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="type-meta flex items-center gap-1.5">
              <ListChecks aria-hidden="true" className="size-3.5 shrink-0" />
              方案预览
            </p>
            <h3
              data-testid="plan-summary-title"
              className="mt-1 font-serif text-lg leading-tight tracking-[-0.02em] text-ink"
            >
              {review.headerTitle}
            </h3>
            {tripMeta.length > 0 ? (
              <p
                data-testid="plan-summary-meta"
                className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-body"
              >
                {tripMeta.map((part, index) => (
                  <span key={`${part}-${index}`} className="flex items-center gap-2">
                    {index > 0 ? (
                      <span aria-hidden="true" className="text-stone">
                        ·
                      </span>
                    ) : null}
                    <span>{part}</span>
                  </span>
                ))}
              </p>
            ) : null}
          </div>
          {review.empty ? null : (
            <div className="shrink-0 text-right">
              <p className="type-meta">
                {confirmation
                  ? `${confirmation.calls.length} 项已确认`
                  : `已选 ${selectedCount} / ${calls.length}`}
              </p>
              <p
                data-testid="plan-summary-counts"
                className="mt-1 flex flex-wrap items-center justify-end gap-x-2 type-meta"
              >
                <span>共 {review.summary.total} 项</span>
                {review.summary.add > 0 ? (
                  <span className="text-accent-green">新增 {review.summary.add}</span>
                ) : null}
                {review.summary.change > 0 ? (
                  <span className="text-accent-yellow">修改 {review.summary.change}</span>
                ) : null}
                {review.summary.remove > 0 ? (
                  <span className="text-accent-red">移除 {review.summary.remove}</span>
                ) : null}
              </p>
            </div>
          )}
        </div>
      </header>

      {warnings.length > 0 ? <PlanWarnings warnings={warnings} /> : null}
      <TraceDetails trace={plan.readOnlyTrace ?? []} />

      {review.empty ? (
        <p data-testid="plan-empty" className="px-4 py-4 text-sm leading-6 text-muted">
          这次没有需要写入的操作。可以把需求写得更具体一些（目的地、时间、预算、同行人）再试一次。
        </p>
      ) : (
        <>
          <div aria-label="操作分组" className="divide-y divide-hairline">
            {review.groups.map((group) => {
              const Icon = BUCKET_ICONS[group.bucket];
              const states = group.rows.map((row) => selected[row.callIndex] === true);
              const all = states.length > 0 && states.every(Boolean);
              const some = states.some(Boolean);
              const open = openGroups[group.bucket] ?? group.defaultOpen;

              return (
                <section key={group.bucket} aria-label={`${group.title} ${group.rows.length} 项`} data-testid="plan-group" data-group-bucket={group.bucket} data-group-count={group.rows.length}>
                  <Collapsible
                    open={open}
                    onOpenChange={(next) =>
                      setOpenGroups((current) => ({ ...current, [group.bucket]: next }))
                    }
                    className="min-w-0"
                  >
                    {/* The header row owns the select-all box and the fold trigger, so
                        the box stays aligned with the title instead of centring on the
                        whole expanded group. */}
                    <div className="flex items-center gap-2 px-4 py-2">
                      <Checkbox
                        checked={all ? true : some ? "indeterminate" : false}
                        disabled={disabled}
                        onCheckedChange={() => toggleGroup(group, !all)}
                        aria-label={`选择「${group.title}」全部 ${group.rows.length} 项`}
                      />
                      <CollapsibleTrigger
                        data-testid="plan-group-trigger"
                        data-group-bucket={group.bucket}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-control py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
                      >
                        <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
                        <span className="min-w-0 truncate text-sm font-medium text-ink">
                          {group.title}
                        </span>
                        <span className="shrink-0 type-meta">{group.rows.length} 项</span>
                        <span className="ml-auto flex shrink-0 items-center gap-x-2 type-meta">
                          {group.counts.add > 0 ? (
                            <span className="text-accent-green">新增 {group.counts.add}</span>
                          ) : null}
                          {group.counts.change > 0 ? (
                            <span className="text-accent-yellow">修改 {group.counts.change}</span>
                          ) : null}
                          {group.counts.remove > 0 ? (
                            <span className="text-accent-red">移除 {group.counts.remove}</span>
                          ) : null}
                        </span>
                        <ChevronDown
                          aria-hidden="true"
                          className={cn(
                            "size-3.5 shrink-0 text-muted transition-transform",
                            open && "rotate-180",
                          )}
                        />
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent>
                      <ul
                        aria-label={`${group.title}操作`}
                        data-testid="plan-group-list"
                        className="divide-y divide-hairline border-t border-hairline"
                      >
                        {group.rows.map((row) => (
                          <PlanRowItem
                            key={row.key}
                            row={row}
                            checked={selected[row.callIndex] === true}
                            onToggle={toggle}
                            disabled={disabled}
                            dependencyCleared={
                              row.dependsOnCreate &&
                              createIndex >= 0 &&
                              selected[createIndex] !== true
                            }
                          />
                        ))}
                      </ul>
                    </CollapsibleContent>
                  </Collapsible>
                </section>
              );
            })}
          </div>

          <footer className="border-t border-hairline px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-1">
                {expired ? (
                  <p
                    role="status"
                    data-testid="plan-receipt"
                    className="text-xs leading-5 text-accent-amber"
                  >
                    计划已过期，未执行任何操作。请重新发送这条需求。
                  </p>
                ) : confirmed ? (
                  <p data-testid="plan-receipt" className="text-xs leading-5 text-muted">
                    已确认，正在执行选中的 {confirmation?.calls.length ?? selectedCount} 项操作。
                  </p>
                ) : !canWrite ? (
                  <p className="text-xs leading-5 text-muted">
                    {planFailureCopy("forbidden").description}
                  </p>
                ) : (
                  <>
                    <p className="text-xs leading-5 text-muted">
                      确认后写入 {selectedCount} 项，不会自动撤销。
                      {review.hasDestructive
                        ? `其中移除 ${review.summary.remove} 项，删除后无法恢复。`
                        : ""}
                      {review.orphanCount > 0
                        ? `其中 ${review.orphanCount} 项将无法执行。`
                        : ""}
                    </p>
                    {review.orphanCount > 0 ? (
                      <p className="text-xs leading-5 text-accent-amber">
                        「无法归属」里的操作会失败；建议取消勾选后再执行。
                      </p>
                    ) : null}
                    {armed ? (
                      <p className="text-xs leading-5 text-accent-red">
                        再次点击按钮会移除 {review.summary.remove} 项，且无法撤销。
                      </p>
                    ) : null}
                    {expiresAt ? (
                      <p className="type-meta">计划在 {expiresAt} 前有效。</p>
                    ) : null}
                    {selectedCount === 0 ? (
                      <p className="text-xs leading-5 text-accent-amber">
                        至少选择 1 项才能执行。
                      </p>
                    ) : null}
                  </>
                )}
              </div>
              {expired ? (
                <Badge tone="slate">已过期</Badge>
              ) : confirmed ? (
                <Badge tone="neutral">已确认</Badge>
              ) : (
                <Button
                  type="button"
                  data-testid="plan-confirm"
                  variant={review.hasDestructive ? "danger" : "primary"}
                  size="sm"
                  disabled={disabled || selectedCount === 0}
                  onClick={() => {
                    if (review.hasDestructive && !armed) {
                      setArmed(true);
                      return;
                    }
                    addResult({
                      status: "confirmed",
                      runId: plan.runId,
                      calls: selectedCalls,
                      idempotencyKey: createAiIdempotencyKey(),
                    });
                  }}
                >
                  {armed
                    ? `再次点击确认移除 ${review.summary.remove} 项`
                    : `执行选中的 ${selectedCount} 项`}
                </Button>
              )}
            </div>
          </footer>
        </>
      )}
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
  const artifacts = useOptionalAiArtifact();
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
  const outcome = executionOutcome(response);

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
        {outcome === "ok" ? (
          <Badge tone="neutral">全部完成</Badge>
        ) : outcome === "partial" ? (
          <Badge tone="yellow">部分失败</Badge>
        ) : (
          <Badge tone="red">全部失败</Badge>
        )}
      </header>

      {outcome === "all-failed" ? (
        <p className="border-b border-hairline bg-accent-red/5 px-4 py-2 text-xs leading-5 text-accent-red">
          没有写入任何数据，可以回到计划卡重新选择后再执行。
        </p>
      ) : null}

      <ul className="divide-y divide-hairline">
        {response.results.map((item, index) => {
          const call = result.calls[index];
          const copy = call ? describePlannedCall(call) : null;
          const tripHref =
            item.ok && item.entityId && call?.tool === "trips.create"
              ? `/w/${workspaceSlug}/trips/${item.entityId}`
              : null;
          const artifact = (
            item as AiToolResult & {
              artifact?: { id: string; title?: string; kind?: string };
            }
          ).artifact;

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
              {artifact && artifacts ? (
                <button
                  className="inline-flex shrink-0 items-center gap-1 text-xs text-ink underline decoration-hairline-strong underline-offset-2"
                  onClick={() => void artifacts.openArtifact(artifact)}
                  type="button"
                >
                  <FileText aria-hidden="true" className="size-3" />
                  打开文档
                </button>
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
