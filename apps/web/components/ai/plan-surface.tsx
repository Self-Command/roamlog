"use client";

/**
 * Plan card surface, composed from the AI Elements Plan primitives ported in
 * `elements/plan.tsx` (vercel/ai-elements @ ca8be600, Apache-2.0).
 *
 * Adaptation layer:
 * - Roamlog already owns the plan review state in `plan-card.tsx`; this file
 *   only lays out the header, expandable body and footer.
 * - The upstream plan primitives are used unchanged: Plan, PlanHeader,
 *   PlanTitle, PlanDescription, PlanAction, PlanTrigger, PlanContent and
 *   PlanFooter.
 * - The body is rendered with the repository's full Markdown renderer so the
 *   model's headings, tables, lists and links are not flattened.
 */

import { ListChecks } from "lucide-react";
import type { ReactNode } from "react";
import type {
  AiPlanDetailDay as ContractPlanDetailDay,
  AiPlanDetailItem as ContractPlanDetailItem,
  AiPlanDetails as ContractPlanDetails,
  AiPlanDetailsBudget as ContractPlanDetailBudget,
} from "@roamlog/contracts";

import { formatCurrencyMinor } from "@/lib/money";

import { cn } from "./cn";
import {
  Plan,
  PlanAction,
  PlanContent,
  PlanDescription,
  PlanFooter,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from "./elements/plan";
import { Markdown } from "./markdown";

export type PlanDetailItem = ContractPlanDetailItem;
export type PlanDetailDay = ContractPlanDetailDay;
export type PlanDetailBudget = ContractPlanDetailBudget;

/**
 * Optional, additive display payload defined by the API contract.
 *
 * `plannedCalls` remains the executable source of truth. These fields are the
 * readable brief the user can judge before confirming anything.
 */
export type PlanDetails = ContractPlanDetails;

export interface PlanSurfaceProps {
  readonly title: string;
  readonly meta?: readonly string[];
  readonly message: string;
  readonly details?: PlanDetails | null;
  /** Editable review draft; execution still reads only plannedCalls. */
  readonly detailsEditor?: ReactNode;
  readonly status?: ReactNode;
  readonly warnings?: ReactNode;
  readonly trace?: ReactNode;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  readonly empty?: boolean;
  readonly emptyMessage?: string;
  readonly className?: string;
  readonly defaultOpen?: boolean;
  /** Enables the upstream Plan title/description shimmer while the plan streams. */
  readonly isStreaming?: boolean;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function list(value: unknown): string[] {
    return Array.isArray(value)
    ? value
        .map((entry) => text(entry))
        .filter((entry): entry is string => entry !== null)
        .slice(0, 40)
    : [];
}

function safeDays(value: unknown): readonly PlanDetailDay[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const date = text(record.date);
    if (!date) return [];
    const items = Array.isArray(record.items)
      ? record.items.flatMap((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return [];
          const row = item as Record<string, unknown>;
          const title = text(row.title);
          if (!title) return [];
          const rawType = text(row.type);
          const type: PlanDetailItem["type"] =
            rawType === "transit" ||
            rawType === "food" ||
            rawType === "activity" ||
            rawType === "stay" ||
            rawType === "note"
              ? rawType
              : undefined;
          return [
            {
              title,
              ...(text(row.time) ? { time: text(row.time)! } : {}),
              ...(text(row.location) ? { location: text(row.location)! } : {}),
              ...(text(row.transport) ? { transport: text(row.transport)! } : {}),
              ...(text(row.notes) ? { notes: text(row.notes)! } : {}),
              ...(type ? { type } : {}),
            },
          ];
        })
      : [];
    return [{ date, ...(text(record.title) ? { title: text(record.title)! } : {}), items }];
  });
}

function safeBudget(value: unknown): PlanDetailBudget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.amountMinor !== "number" ||
    !Number.isSafeInteger(record.amountMinor) ||
    record.amountMinor < 0
  ) {
    return null;
  }
  const currency = text(record.currency);
  if (!currency) return null;
  const breakdown = list(record.breakdown);
  return {
    amountMinor: record.amountMinor,
    currency,
    ...(breakdown.length > 0 ? { breakdown } : {}),
  };
}

function formatDay(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(parsed);
}

const PLAN_ITEM_TYPE_LABELS = {
  transit: "交通",
  food: "餐饮",
  activity: "活动",
  stay: "住宿",
  note: "备注",
} as const satisfies Record<NonNullable<PlanDetailItem["type"]>, string>;

function DetailList({
  title,
  items,
  testId,
}: {
  title: string;
  items: readonly string[];
  testId: string;
}) {
  if (items.length === 0) return null;
  return (
    <section data-testid={testId}>
      <h4 className="type-eyebrow">{title}</h4>
      <ul className="mt-2 space-y-1.5 text-xs leading-5 text-body">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex gap-2">
            <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-stone" />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PlanDetailsView({ details }: { details: PlanDetails }) {
  const constraints = list(details.constraints);
  const assumptions = list(details.assumptions);
  const openQuestions = list(details.openQuestions);
  const days = safeDays(details.days);
  const logistics = list(details.logistics);
  const risks = list(details.risks);
  const alternatives = list(details.alternatives);
  const budget = safeBudget(details.budget);
  const objective = text(details.objective);
  const hasContent =
    Boolean(objective) ||
    constraints.length > 0 ||
    assumptions.length > 0 ||
    openQuestions.length > 0 ||
    days.length > 0 ||
    Boolean(budget) ||
    logistics.length > 0 ||
    risks.length > 0 ||
    alternatives.length > 0;

  if (!hasContent) return null;

  return (
    <section
      aria-label="计划详情"
      className="border-b border-hairline px-4 py-4"
      data-testid="plan-details"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {objective ? (
          <section className="sm:col-span-2" data-testid="plan-objective">
            <h4 className="type-eyebrow">目标</h4>
            <p className="mt-2 text-sm leading-6 text-ink">{objective}</p>
          </section>
        ) : null}
        <DetailList title="明确约束" items={constraints} testId="plan-constraints" />
        <DetailList title="假设" items={assumptions} testId="plan-assumptions" />
        <DetailList title="待确认问题" items={openQuestions} testId="plan-open-questions" />
        <DetailList title="交通与后勤" items={logistics} testId="plan-logistics" />
        <DetailList title="风险" items={risks} testId="plan-risks" />
        <DetailList title="备选方案" items={alternatives} testId="plan-alternatives" />
      </div>

      {days.length > 0 ? (
        <section className="mt-5" data-testid="plan-days">
          <h4 className="type-eyebrow">逐日安排</h4>
          <ol className="mt-2 space-y-2">
            {days.map((day) => (
              <li
                key={`${day.date}-${day.title ?? ""}`}
                className="rounded-control border border-hairline bg-surface-0/50 px-3 py-2.5"
                data-testid="plan-detail-day"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="type-meta">{formatDay(day.date)}</span>
                  {day.title ? <span className="text-sm text-ink">{day.title}</span> : null}
                </div>
                {day.items.length > 0 ? (
                  <ul className="mt-2 space-y-2">
                    {day.items.map((item, index) => {
                      const typeLabel = item.type ? PLAN_ITEM_TYPE_LABELS[item.type] : null;
                      const itemDetails = [item.transport, item.notes].filter(
                        (part): part is string => Boolean(part),
                      );
                      return (
                        <li key={`${item.title}-${index}`} className="text-xs leading-5">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            {item.time ? (
                              <span className="font-mono text-[10px] text-stone">{item.time}</span>
                            ) : null}
                            <span className="text-ink">{item.title}</span>
                            {item.location ? (
                              <span className="text-muted">· {item.location}</span>
                            ) : null}
                          </div>
                          {typeLabel || itemDetails.length > 0 ? (
                            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted">
                              {typeLabel ? (
                                <span
                                  className="rounded-pill border border-hairline bg-surface-2 px-1.5 py-0.5 text-[10px] leading-4"
                                  data-testid="plan-item-type"
                                >
                                  {typeLabel}
                                </span>
                              ) : null}
                              {itemDetails.length > 0 ? (
                                <p className="min-w-0">{itemDetails.join(" · ")}</p>
                              ) : null}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {budget ? (
        <section className="mt-5" data-testid="plan-budget">
          <h4 className="type-eyebrow">预算</h4>
          <p className="mt-2 text-sm text-ink">
            {formatCurrencyMinor(budget.amountMinor, budget.currency)}
          </p>
          {budget.breakdown ? (
            <ul className="mt-1.5 space-y-1 text-xs leading-5 text-muted">
              {budget.breakdown.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

export function PlanSurface({
  title,
  meta,
  message,
  details,
  detailsEditor,
  status,
  warnings,
  trace,
  children,
  footer,
  empty = false,
  emptyMessage,
  className,
  defaultOpen = true,
  isStreaming = false,
}: PlanSurfaceProps) {
  const description = meta?.filter((part) => part.trim().length > 0).join(" · ") ?? "";
  const hasMessage = message.trim().length > 0;

  return (
    <Plan
      aria-label="计划确认卡"
      className={cn("mt-1 overflow-hidden", className)}
      data-testid="plan-surface"
      defaultOpen={defaultOpen}
      isStreaming={isStreaming}
    >
      <PlanHeader className="border-b border-hairline">
        <div className="flex w-full items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="type-meta flex items-center gap-1.5">
              <ListChecks aria-hidden="true" className="size-3.5 shrink-0" />
              方案预览
            </p>
            <PlanTitle data-testid="plan-summary-title" className="mt-1">
              {title}
            </PlanTitle>
            {description.length > 0 ? (
              <PlanDescription data-testid="plan-summary-meta" className="mt-1">
                {description}
              </PlanDescription>
            ) : null}
          </div>
          <div className="flex shrink-0 items-start gap-2">
            {status}
            <PlanAction>
              <PlanTrigger />
            </PlanAction>
          </div>
        </div>
      </PlanHeader>

      {warnings}
      {trace}

      <PlanContent>
        {hasMessage ? (
          <div
            data-testid="plan-message"
            className="-mx-4 border-b border-hairline bg-surface-0/40 px-4 py-4"
          >
            <Markdown text={message} />
          </div>
        ) : null}

        {details ? <PlanDetailsView details={details} /> : null}

        {detailsEditor}

        {children ? <div className="-mx-4 -mb-4">{children}</div> : null}

        {empty && !children ? (
          <p
            data-testid="plan-empty"
            className="-mx-4 -mb-4 border-t border-hairline px-4 py-4 text-sm leading-6 text-muted"
          >
            {emptyMessage ?? "这次没有需要写入的操作。"}
          </p>
        ) : null}
      </PlanContent>

      {footer ? (
        <PlanFooter className="border-t border-hairline p-0">
          <div className="w-full px-4 py-3">{footer}</div>
        </PlanFooter>
      ) : null}
    </Plan>
  );
}
