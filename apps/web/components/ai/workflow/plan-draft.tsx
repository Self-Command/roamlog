"use client";

/**
 * Persistent, editable plan review draft.
 *
 * Sources:
 * - assistant-ui `examples/with-agent-document-editor` (MIT,
 *   `4a0d2a5b9f04c8fb7ff9cd224827a958096b52dc`) for the localStorage
 *   persistence, user/AI co-editing and version/restore pattern.
 * - assistant-ui `examples/with-interactables/app/page.tsx:34-118,171-243`
 *   for immutable collection `setState(prev => ...)` edits.
 * - vercel/ai-elements Plan remains the display layer.
 *
 * Adaptation: Roamlog does not port Lexical. A plan is structured
 * `AiPlanDetails`, and edited prose/details are review-only. The executable
 * source remains the existing `plannedCalls` array.
 */

import {
  unstable_useInteractable,
  unstable_useInteractableVersions,
} from "@assistant-ui/react";
import { Badge, Button, Input, Label, Select, Textarea } from "@roamlog/ui";
import { ChevronDown, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useCallback, useId, useMemo, type ReactNode } from "react";

import {
  currencyFractionDigits,
  majorToMinor,
  minorToMajor,
} from "@/lib/money";

import { cn } from "../cn";
import {
  PLAN_DRAFT_NAME,
  planDraftIdFor,
  useDraftScope,
} from "./draft-persistence";
import {
  PLAN_DRAFT_STATE_SCHEMA,
  initialPlanDraft,
  readPlanDraftState,
  type PlanDraftBudget,
  type PlanDraftDay,
  type PlanDraftDetails,
  type PlanDraftItem,
  type PlanDraftItemType,
  type PlanDraftSeed,
  type PlanDraftState,
} from "./plan-draft-state";

const PLAN_DRAFT_DESCRIPTION =
  "Internal Roamlog plan review draft. The user edits the preview; the model must never call the generated update tool. Executable operations remain plannedCalls.";

export interface PlanDraftController {
  readonly id: string;
  readonly draft: PlanDraftState;
  readonly isPending: boolean;
  readonly error: unknown;
  setMessage: (message: string) => void;
  patchDetails: (patch: Partial<PlanDraftDetails>) => void;
  setSelected: (selected: readonly boolean[]) => void;
  setOpenGroups: (
    updater:
      | Readonly<Record<string, boolean>>
      | ((
          current: Readonly<Record<string, boolean>>,
        ) => Readonly<Record<string, boolean>>),
  ) => void;
  restoreOriginal: () => void;
  restoreState: (state: PlanDraftState) => void;
  discard: () => Promise<void>;
  flush: () => Promise<void>;
}

export function usePlanDraft({
  seed,
  toolCallId,
}: {
  readonly seed: PlanDraftSeed;
  readonly toolCallId: string;
}): PlanDraftController {
  const conversationScope = useDraftScope();
  const fallback = useMemo(
    () => initialPlanDraft(seed),
    [seed.plannedCalls, seed.details, seed.message, seed.runId],
  );
  const [rawState, methods] = unstable_useInteractable(PLAN_DRAFT_NAME, {
    id: planDraftIdFor(conversationScope, toolCallId, seed.runId),
    description: PLAN_DRAFT_DESCRIPTION,
    stateSchema: PLAN_DRAFT_STATE_SCHEMA,
    initialState: fallback,
  });
  const draft = useMemo(
    () => readPlanDraftState(rawState, fallback),
    [fallback, rawState],
  );
  const setState = methods.setState;
  const update = useCallback(
    (updater: (current: PlanDraftState) => PlanDraftState) => {
      setState((previous: unknown) => {
        const current = readPlanDraftState(previous, fallback);
        return {
          ...updater(current),
          dirty: true,
          updatedAt: new Date().toISOString(),
        };
      });
    },
    [fallback, setState],
  );

  const setMessage = useCallback(
    (message: string) => update((current) => ({ ...current, message })),
    [update],
  );
  const patchDetails = useCallback(
    (patch: Partial<PlanDraftDetails>) =>
      update((current) => ({
        ...current,
        details: { ...current.details, ...patch },
      })),
    [update],
  );
  const setSelected = useCallback(
    (selected: readonly boolean[]) =>
      update((current) => ({
        ...current,
        selected: [...selected],
      })),
    [update],
  );
  const setOpenGroups = useCallback(
    (
      updater:
        | Readonly<Record<string, boolean>>
        | ((
            current: Readonly<Record<string, boolean>>,
          ) => Readonly<Record<string, boolean>>),
    ) =>
      update((current) => ({
        ...current,
        openGroups:
          typeof updater === "function" ? updater(current.openGroups) : updater,
      })),
    [update],
  );
  const restoreOriginal = useCallback(
    () => update(() => fallback),
    [fallback, update],
  );
  const restoreState = useCallback(
    (state: PlanDraftState) =>
      update(() => readPlanDraftState(state, fallback)),
    [fallback, update],
  );
  const discard = useCallback(async () => {
    methods.setState(fallback);
    await methods.flush();
  }, [fallback, methods]);
  const flush = useCallback(async () => {
    await methods.flush();
  }, [methods]);

  return {
    id: methods.id,
    draft,
    isPending: methods.isPending,
    error: methods.error,
    setMessage,
    patchDetails,
    setSelected,
    setOpenGroups,
    restoreOriginal,
    restoreState,
    discard,
    flush,
  };
}

function LabeledField({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="mt-1 text-[11px] leading-4 text-muted">{hint}</p> : null}
    </div>
  );
}

function StringListEditor({
  id,
  label,
  items,
  disabled,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  items: readonly string[];
  disabled: boolean;
  placeholder: string;
  onChange: (items: string[]) => void;
}) {
  return (
    <section data-testid={`plan-draft-list-${id}`} className="min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="mb-0">{label}</Label>
        <Button
          aria-label={`添加${label}`}
          disabled={disabled || items.length >= 30}
          onClick={() => onChange([...items, ""])}
          size="sm"
          variant="ghost"
        >
          <Plus aria-hidden="true" />
          添加
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs leading-5 text-muted">暂无</p>
      ) : (
        <ol className="space-y-2">
          {items.map((item, index) => (
            <li key={`${id}-${index}`} className="flex min-w-0 items-start gap-2">
              <Input
                aria-label={`${label} ${index + 1}`}
                disabled={disabled}
                onChange={(event) =>
                  onChange(
                    items.map((entry, position) =>
                      position === index ? event.currentTarget.value : entry,
                    ),
                  )
                }
                placeholder={placeholder}
                value={item}
              />
              <Button
                aria-label={`删除${label} ${index + 1}`}
                disabled={disabled}
                onClick={() =>
                  onChange(items.filter((_, position) => position !== index))
                }
                size="sm"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function BudgetEditor({
  budget,
  disabled,
  onChange,
}: {
  budget: PlanDraftBudget | null;
  disabled: boolean;
  onChange: (budget: PlanDraftBudget | null) => void;
}) {
  if (!budget) {
    return (
      <section data-testid="plan-draft-budget" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="mb-0">预算</Label>
          <Button
            disabled={disabled}
            onClick={() =>
              onChange({ amountMinor: 0, currency: "CNY", breakdown: [] })
            }
            size="sm"
            variant="ghost"
          >
            <Plus aria-hidden="true" />
            添加预算
          </Button>
        </div>
        <p className="text-xs leading-5 text-muted">未设置预算</p>
      </section>
    );
  }

  const fractionDigits = currencyFractionDigits(budget.currency);
  const setCurrency = (currency: string) => {
    const currentMajor = minorToMajor(budget.amountMinor, budget.currency);
    onChange({
      ...budget,
      currency,
      amountMinor: majorToMinor(currentMajor, currency),
    });
  };

  return (
    <section data-testid="plan-draft-budget" className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="mb-0">预算</Label>
        <Button
          disabled={disabled}
          onClick={() => onChange(null)}
          size="sm"
          variant="ghost"
        >
          <Trash2 aria-hidden="true" />
          移除预算
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <LabeledField label="金额">
          <Input
            disabled={disabled}
            min={0}
            onChange={(event) => {
              const amount = Number(event.currentTarget.value);
              if (!Number.isFinite(amount)) return;
              onChange({
                ...budget,
                amountMinor: Math.max(0, majorToMinor(amount, budget.currency)),
              });
            }}
            aria-label="计划草稿预算金额"
            step={fractionDigits === 0 ? "1" : "0.01"}
            type="number"
            value={minorToMajor(budget.amountMinor, budget.currency)}
          />
        </LabeledField>
        <LabeledField label="币种">
          <Select
            aria-label="计划草稿预算币种"
            disabled={disabled}
            onChange={(event) => setCurrency(event.currentTarget.value)}
            value={budget.currency}
          >
            {["CNY", "USD", "EUR", "JPY", "GBP"].map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </Select>
        </LabeledField>
      </div>
      <StringListEditor
        disabled={disabled}
        id="budget-breakdown"
        items={budget.breakdown}
        label="预算明细"
        onChange={(breakdown) => onChange({ ...budget, breakdown })}
        placeholder="例如：住宿 2400 元"
      />
    </section>
  );
}

const ITEM_TYPE_OPTIONS: ReadonlyArray<{
  value: PlanDraftItemType;
  label: string;
}> = [
  { value: "activity", label: "活动" },
  { value: "food", label: "餐饮" },
  { value: "transit", label: "交通" },
  { value: "stay", label: "住宿" },
  { value: "note", label: "备注" },
];

function patchItem(
  item: PlanDraftItem,
  patch: Partial<PlanDraftItem>,
): PlanDraftItem {
  return { ...item, ...patch };
}

function ItemEditor({
  item,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  item: PlanDraftItem;
  index: number;
  disabled: boolean;
  onChange: (item: PlanDraftItem) => void;
  onRemove: () => void;
}) {
  return (
    <li
      className="min-w-0 rounded-control border border-hairline bg-surface-1 p-3"
      data-testid="plan-draft-item"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-body">安排 {index + 1}</p>
        <Button
          aria-label={`删除安排 ${index + 1}`}
          disabled={disabled}
          onClick={onRemove}
          size="sm"
          variant="ghost"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <LabeledField label="时间">
          <Input
            aria-label={`安排 ${index + 1} 时间`}
            disabled={disabled}
            onChange={(event) =>
              onChange(patchItem(item, { time: event.currentTarget.value }))
            }
            type="time"
            value={item.time ?? ""}
          />
        </LabeledField>
        <LabeledField label="类型">
          <Select
            aria-label={`安排 ${index + 1} 类型`}
            disabled={disabled}
            onChange={(event) => {
              const next = event.currentTarget.value;
              onChange(
                patchItem(item, {
                  type: ITEM_TYPE_OPTIONS.some((option) => option.value === next)
                    ? (next as PlanDraftItemType)
                    : undefined,
                }),
              );
            }}
            value={item.type ?? "activity"}
          >
            {ITEM_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </LabeledField>
      </div>
      <div className="mt-3 space-y-3">
        <LabeledField label="标题">
          <Input
            aria-label={`安排 ${index + 1} 标题`}
            disabled={disabled}
            onChange={(event) =>
              onChange(patchItem(item, { title: event.currentTarget.value }))
            }
            placeholder="例如：清水寺"
            value={item.title}
          />
        </LabeledField>
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledField label="地点">
            <Input
              aria-label={`安排 ${index + 1} 地点`}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  patchItem(item, { location: event.currentTarget.value }),
                )
              }
              value={item.location ?? ""}
            />
          </LabeledField>
          <LabeledField label="交通">
            <Input
              aria-label={`安排 ${index + 1} 交通`}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  patchItem(item, { transport: event.currentTarget.value }),
                )
              }
              value={item.transport ?? ""}
            />
          </LabeledField>
        </div>
        <LabeledField label="备注">
          <Textarea
            aria-label={`安排 ${index + 1} 备注`}
            className="min-h-20"
            disabled={disabled}
            onChange={(event) =>
              onChange(patchItem(item, { notes: event.currentTarget.value }))
            }
            value={item.notes ?? ""}
          />
        </LabeledField>
      </div>
    </li>
  );
}

function DaysEditor({
  days,
  disabled,
  onChange,
}: {
  days: readonly PlanDraftDay[];
  disabled: boolean;
  onChange: (days: PlanDraftDay[]) => void;
}) {
  const updateDay = (index: number, next: PlanDraftDay) => {
    onChange(days.map((day, position) => (position === index ? next : day)));
  };

  return (
    <section className="min-w-0 space-y-3" data-testid="plan-draft-days">
      <div className="flex items-center justify-between gap-2">
        <Label className="mb-0">逐日安排</Label>
        <Button
          disabled={disabled || days.length >= 30}
          onClick={() =>
            onChange([
              ...days,
              { date: "", title: "", items: [{ title: "" }] },
            ])
          }
          size="sm"
          variant="ghost"
          data-testid="plan-draft-day-add"
        >
          <Plus aria-hidden="true" />
          添加一天
        </Button>
      </div>
      {days.length === 0 ? (
        <p className="text-xs leading-5 text-muted">暂无逐日安排</p>
      ) : (
        <ol className="space-y-3">
          {days.map((day, dayIndex) => (
            <li
              className="min-w-0 rounded-control border border-hairline bg-surface-0/40 p-3"
              data-testid="plan-draft-day"
              key={`${day.date}-${dayIndex}`}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-body">第 {dayIndex + 1} 天</p>
                <Button
                  aria-label={`删除第 ${dayIndex + 1} 天`}
                  disabled={disabled}
                  onClick={() =>
                    onChange(days.filter((_, position) => position !== dayIndex))
                  }
                  size="sm"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <LabeledField label="日期">
                  <Input
                    aria-label={`第 ${dayIndex + 1} 天日期`}
                    disabled={disabled}
                    onChange={(event) =>
                      updateDay(dayIndex, {
                        ...day,
                        date: event.currentTarget.value,
                      })
                    }
                    type="date"
                    value={day.date}
                  />
                </LabeledField>
                <LabeledField label="当天主题">
                  <Input
                    aria-label={`第 ${dayIndex + 1} 天主题`}
                    disabled={disabled}
                    onChange={(event) =>
                      updateDay(dayIndex, {
                        ...day,
                        title: event.currentTarget.value,
                      })
                    }
                    value={day.title ?? ""}
                  />
                </LabeledField>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <Label className="mb-0">安排</Label>
                <Button
                  disabled={disabled || day.items.length >= 8}
                  onClick={() =>
                    updateDay(dayIndex, {
                      ...day,
                      items: [...day.items, { title: "" }],
                    })
                  }
                  size="sm"
                  variant="ghost"
                  data-testid="plan-draft-item-add"
                >
                  <Plus aria-hidden="true" />
                  添加安排
                </Button>
              </div>
              {day.items.length === 0 ? (
                <p className="mt-2 text-xs leading-5 text-muted">暂无安排</p>
              ) : (
                <ol className="mt-2 space-y-2">
                  {day.items.map((item, itemIndex) => (
                    <ItemEditor
                      disabled={disabled}
                      index={itemIndex}
                      item={item}
                      key={`${item.title}-${itemIndex}`}
                      onChange={(next) =>
                        updateDay(dayIndex, {
                          ...day,
                          items: day.items.map((entry, position) =>
                            position === itemIndex ? next : entry,
                          ),
                        })
                      }
                      onRemove={() =>
                        updateDay(dayIndex, {
                          ...day,
                          items: day.items.filter(
                            (_, position) => position !== itemIndex,
                          ),
                        })
                      }
                    />
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function VersionHistory({
  id,
  draft,
  disabled,
  onRestore,
}: {
  id: string;
  draft: PlanDraftState;
  disabled: boolean;
  onRestore: (state: PlanDraftState) => void;
}) {
  const versions = unstable_useInteractableVersions<PlanDraftState>(
    id,
    PLAN_DRAFT_NAME,
  );
  const usable = useMemo(
    () =>
      versions
        .map((version) => ({
          ...version,
          state: readPlanDraftState(version.state, draft),
        }))
        .filter((version) => version.state.runId === draft.runId),
    [draft, versions],
  );

  if (usable.length < 2) return null;

  return (
    <details className="rounded-control border border-hairline bg-surface-1">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-muted outline-none focus-visible:ring-2 focus-visible:ring-focus-ring [&::-webkit-details-marker]:hidden">
        版本历史（{usable.length}）
      </summary>
      <ul className="divide-y divide-hairline border-t border-hairline">
        {usable.map((version, index) => (
          <li
            className="flex min-w-0 items-center justify-between gap-3 px-3 py-2"
            key={`${version.origin}-${index}`}
          >
            <span className="min-w-0 text-xs text-muted">
              v{index + 1} ·{" "}
              {version.origin === "user-edit"
                ? "用户编辑"
                : version.origin === "create"
                  ? "AI 原始版本"
                  : "AI 更新"}
            </span>
            <Button
              disabled={disabled}
              onClick={() => onRestore(version.state)}
              size="sm"
              variant="outline"
            >
              恢复
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function PlanDraftEditor({
  id,
  draft,
  disabled,
  isPending,
  error,
  onChangeMessage,
  onChangeDetails,
  onRestoreOriginal,
  onRestoreState,
  onSave,
}: {
  id: string;
  draft: PlanDraftState;
  disabled: boolean;
  isPending: boolean;
  error: unknown;
  onChangeMessage: (message: string) => void;
  onChangeDetails: (patch: Partial<PlanDraftDetails>) => void;
  onRestoreOriginal: () => void;
  onRestoreState: (state: PlanDraftState) => void;
  onSave: () => void;
}) {
  const messageId = useId();
  const objectiveId = useId();
  const details = draft.details;

  return (
    <section
      aria-label="计划审阅草稿"
      className="border-b border-hairline bg-surface-1/35 px-4 py-4"
      data-testid="plan-draft-editor"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-medium text-ink">计划审阅草稿</h4>
            <Badge
              data-testid="plan-draft-dirty"
              tone={draft.dirty ? "yellow" : "neutral"}
            >
              {draft.dirty ? "已修改" : "AI 原文"}
            </Badge>
            {isPending ? <span className="text-xs text-muted">保存中…</span> : null}
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
            草稿修改只影响审阅内容，不会改变下方即将写入的操作。要改变写入项，请回到对话让
            AI 重新生成计划。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            data-testid="plan-draft-reset"
            disabled={disabled}
            onClick={onRestoreOriginal}
            size="sm"
            variant="outline"
          >
            <RotateCcw aria-hidden="true" />
            恢复 AI 原始版本
          </Button>
          <Button
            data-testid="plan-draft-save"
            disabled={disabled || isPending}
            onClick={onSave}
            size="sm"
            variant="primary"
          >
            <Save aria-hidden="true" />
            保存草稿
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-xs leading-5 text-accent-red">
          草稿保存失败，请重试。当前输入仍保留在本页。
        </p>
      ) : null}

      <details className="group mt-3 rounded-control border border-hairline bg-surface-1">
        <summary
          className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-body outline-none focus-visible:ring-2 focus-visible:ring-focus-ring [&::-webkit-details-marker]:hidden"
          data-testid="plan-draft-toggle"
        >
          编辑计划正文与详情
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="space-y-5 border-t border-hairline p-3">
          <div>
            <Label htmlFor={messageId}>计划正文（Markdown）</Label>
            <Textarea
              aria-label="计划草稿正文"
              className="min-h-44 font-mono text-xs"
              disabled={disabled}
              id={messageId}
              onChange={(event) => onChangeMessage(event.currentTarget.value)}
              value={draft.message}
            />
          </div>

          <div>
            <Label htmlFor={objectiveId}>目标</Label>
            <Textarea
              aria-label="计划草稿目标"
              className="min-h-20"
              disabled={disabled}
              id={objectiveId}
              onChange={(event) =>
                onChangeDetails({ objective: event.currentTarget.value })
              }
              value={details.objective}
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <StringListEditor
              disabled={disabled}
              id="constraints"
              items={details.constraints}
              label="明确约束"
              onChange={(items) => onChangeDetails({ constraints: items })}
              placeholder="例如：两个人同行"
            />
            <StringListEditor
              disabled={disabled}
              id="assumptions"
              items={details.assumptions}
              label="假设"
              onChange={(items) => onChangeDetails({ assumptions: items })}
              placeholder="例如：机票按 3200 元估算"
            />
            <StringListEditor
              disabled={disabled}
              id="open-questions"
              items={details.openQuestions}
              label="待确认问题"
              onChange={(items) => onChangeDetails({ openQuestions: items })}
              placeholder="例如：是否需要预约"
            />
            <StringListEditor
              disabled={disabled}
              id="logistics"
              items={details.logistics}
              label="交通与后勤"
              onChange={(items) => onChangeDetails({ logistics: items })}
              placeholder="例如：购买公交一日券"
            />
            <StringListEditor
              disabled={disabled}
              id="risks"
              items={details.risks}
              label="风险"
              onChange={(items) => onChangeDetails({ risks: items })}
              placeholder="例如：热门寺院排队"
            />
            <StringListEditor
              disabled={disabled}
              id="alternatives"
              items={details.alternatives}
              label="备选方案"
              onChange={(items) => onChangeDetails({ alternatives: items })}
              placeholder="例如：雨天改去博物馆"
            />
          </div>

          <DaysEditor
            days={details.days}
            disabled={disabled}
            onChange={(days) => onChangeDetails({ days })}
          />

          <BudgetEditor
            budget={details.budget}
            disabled={disabled}
            onChange={(budget) => onChangeDetails({ budget })}
          />
        </div>
      </details>

      <div className="mt-3">
        <VersionHistory
          disabled={disabled}
          draft={draft}
          id={id}
          onRestore={onRestoreState}
        />
      </div>
    </section>
  );
}

export function PlanDraftEditorFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)} data-testid="plan-draft-frame">
      {children}
    </div>
  );
}
