/**
 * `plannedCalls` → 「方案预览」 model (pure, no DOM, no I/O).
 *
 * Porting notes (§C of `.audit/ai-plan-review-spec.md`):
 * - The 26-tool → bucket/action table is exhaustive through
 *   `Record<AiToolName, …>`; adding a 27th tool fails `tsc` instead of being
 *   silently dropped.
 * - Per-row copy comes from `describePlannedCall` (copy.ts), never a second
 *   set of Chinese labels.
 * - Placeholder-trip semantics mirror the server exactly
 *   (`ai-tools.ts` L1016–L1090): one `trips.create` resolves every placeholder,
 *   zero or two-plus refuse to guess.
 * - Counts/grouping follow the Terraform "legend + per-block + final summary"
 *   shape; group/fold follows GitHub "Files changed"; the action words are
 *   Chinese (新增 / 修改 / 移除), not OpenTofu's `+ ~ -` symbols.
 */
import type { AiToolCall, AiToolName } from "@roamlog/contracts";

import { describePlannedCall, formatMoney, planBucketTitle } from "./copy";

export type PlanAction = "add" | "change" | "remove";

export type PlanBucket =
  | "trip"
  | "stops"
  | "itinerary"
  | "packing"
  | "budget"
  | "expenses"
  | "entries"
  | "participants"
  | "orphan";

/** `id → human label`, the additive `plan.subjects` field from the contract. */
export type PlanSubjectMap = Readonly<Record<string, { label: string }>>;

export type PlanRowMode = "add" | "change" | "reorder" | "remove" | "note";

export interface PlanRow {
  /** Index into `plannedCalls`; the submitted subset is built from this. */
  readonly callIndex: number;
  readonly tool: AiToolName;
  readonly action: PlanAction;
  readonly bucket: PlanBucket;
  readonly mode: PlanRowMode;
  /** Distinct per-group render key; stable even for duplicate calls. */
  readonly key: string;
  /** Human action name from copy.ts (e.g. 「添加装备」). */
  readonly label: string;
  /** Primary line: the subject name when known, otherwise copy.ts' headline. */
  readonly headline: string;
  /** New values / supporting facts, already human copy. */
  readonly details: readonly string[];
  /** The existing object this call acts on, when `subjects` named it. */
  readonly targetLabel?: string;
  /** `change` only: the current value column (payload From/To layout). */
  readonly from: readonly string[];
  /** `change` only: the proposed value column. */
  readonly to: readonly string[];
  /** Why this call cannot run, or what the user must know before confirming. */
  readonly note?: string;
  /** True when the placeholder trip id is resolved by the plan's single creation. */
  readonly dependsOnCreate: boolean;
}

export interface PlanGroupCounts {
  readonly add: number;
  readonly change: number;
  readonly remove: number;
}

export interface PlanGroup {
  readonly bucket: PlanBucket;
  readonly title: string;
  readonly rows: readonly PlanRow[];
  readonly counts: PlanGroupCounts;
  /** Destructive/orphan groups start open so risk is never hidden behind a fold. */
  readonly defaultOpen: boolean;
}

export interface PlanTripSummary {
  readonly title: string;
  readonly dateRange?: string;
  readonly destinations?: string;
  readonly days?: number;
  readonly budget?: string;
}

export interface PlanReview {
  readonly empty: boolean;
  readonly headerTitle: string;
  readonly trip?: PlanTripSummary;
  readonly groups: readonly PlanGroup[];
  readonly summary: PlanGroupCounts & { readonly total: number };
  readonly hasDestructive: boolean;
  readonly orphanCount: number;
}

const DAY_MS = 86_400_000;

/**
 * Server parity (`ai-tools.ts` L1032): a stored trip id is a UUIDv7; anything
 * else — missing, `new`, `{{tripId}}` — is a placeholder, never a target.
 */
const TRIP_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isPlaceholderTripId(value: unknown): boolean {
  if (typeof value !== "string") return true;
  const candidate = value.trim();
  return candidate.length === 0 || !TRIP_ID_PATTERN.test(candidate);
}

/** Exactly the tools whose placeholder `tripId` the server resolves (L1016). */
const TRIP_SCOPED_WRITE_TOOLS: ReadonlySet<AiToolName> = new Set<AiToolName>([
  "trips.update",
  "stops.add",
  "itinerary.addDay",
  "packing.add",
  "budget.setSummary",
  "expenses.add",
  "entries.create",
  "participants.add",
]);

/** The rest of the trip-keyed writes require a real UUID; placeholders fail. */
const EXISTING_TRIP_REQUIRED_TOOLS: ReadonlySet<AiToolName> = new Set<AiToolName>([
  "stops.update",
  "stops.reorder",
  "itinerary.update",
  "packing.update",
  "packing.reorder",
  "expenses.update",
  "participants.remove",
  "participants.role",
]);

const BUCKET: Readonly<Record<AiToolName, PlanBucket | null>> = {
  "places.search": null,
  "trips.create": "trip",
  "trips.get": null,
  "trips.list": null,
  "trips.update": "trip",
  "stops.add": "stops",
  "stops.list": null,
  "stops.update": "stops",
  "stops.delete": "stops",
  "stops.reorder": "stops",
  "itinerary.addDay": "itinerary",
  "itinerary.update": "itinerary",
  "itinerary.delete": "itinerary",
  "packing.add": "packing",
  "packing.update": "packing",
  "packing.delete": "packing",
  "packing.reorder": "packing",
  "budget.setSummary": "budget",
  "expenses.add": "expenses",
  "expenses.update": "expenses",
  "expenses.delete": "expenses",
  "entries.create": "entries",
  "entries.update": "entries",
  "participants.add": "participants",
  "participants.remove": "participants",
  "participants.role": "participants",
};

const ACTION: Readonly<Record<AiToolName, PlanAction>> = {
  "places.search": "change",
  "trips.create": "add",
  "trips.get": "change",
  "trips.list": "change",
  "trips.update": "change",
  "stops.add": "add",
  "stops.list": "change",
  "stops.update": "change",
  "stops.delete": "remove",
  "stops.reorder": "change",
  "itinerary.addDay": "add",
  "itinerary.update": "change",
  "itinerary.delete": "remove",
  "packing.add": "add",
  "packing.update": "change",
  "packing.delete": "remove",
  "packing.reorder": "change",
  "budget.setSummary": "change",
  "expenses.add": "add",
  "expenses.update": "change",
  "expenses.delete": "remove",
  "entries.create": "add",
  "entries.update": "change",
  "participants.add": "add",
  "participants.remove": "remove",
  "participants.role": "change",
};

/** The argument that names the object each tool acts on. */
const SUBJECT_ARGUMENT: Partial<Record<AiToolName, string>> = {
  "trips.update": "tripId",
  "stops.add": "providerPlaceId",
  "stops.update": "stopId",
  "stops.delete": "stopId",
  "itinerary.update": "itemId",
  "itinerary.delete": "itemId",
  "packing.update": "itemId",
  "packing.delete": "itemId",
  "expenses.update": "expenseId",
  "expenses.delete": "expenseId",
  "entries.update": "entryId",
  "participants.add": "memberId",
  "participants.remove": "memberId",
  "participants.role": "memberId",
};

const GROUP_ORDER: readonly PlanBucket[] = [
  "trip",
  "stops",
  "itinerary",
  "packing",
  "budget",
  "expenses",
  "entries",
  "participants",
  "orphan",
];

/** copy.ts headlines that describe the edit, not a value; never print them as "new value". */
const ACTION_HEADLINES: ReadonlySet<string> = new Set([
  "调整旅行日期",
  "调整旅行信息",
  "调整停留日期",
  "调整停留地点信息",
  "调整一项日程",
  "调整一件装备",
  "调整一笔开销",
  "调整同行人角色",
  "调整装备顺序",
  "重排停留顺序",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringList(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function validDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : time;
}

/** Inclusive day count; absent unless both dates parse (never a guessed number). */
export function countTripDays(startDate?: string, endDate?: string): number | undefined {
  const start = validDate(startDate);
  const end = validDate(endDate);
  if (start === undefined || end === undefined) return undefined;
  const days = Math.floor((end - start) / DAY_MS) + 1;
  return days >= 1 ? days : undefined;
}

function dateRange(startDate?: string, endDate?: string): string | undefined {
  if (startDate && endDate) return `${startDate} → ${endDate}`;
  if (startDate) return `从 ${startDate} 开始`;
  if (endDate) return `截至 ${endDate}`;
  return undefined;
}

function buildBudget(args: Record<string, unknown>): string | undefined {
  const amount = numberArg(args, "budgetAmountMinor") ?? numberArg(args, "amountMinor");
  const currency = text(args, "budgetCurrency") ?? text(args, "currency");
  if (amount === undefined) return undefined;
  return currency ? formatMoney(amount, currency) : "已给出预算总量（币种未指定）";
}

function tripSummary(calls: readonly AiToolCall[]): PlanTripSummary | undefined {
  const creates = calls.filter((call) => call.tool === "trips.create");
  const updates = calls.filter((call) => call.tool === "trips.update");
  const budgetCall = calls.find(
    (call) => call.tool === "budget.setSummary" && isRecord(call.args),
  );
  const budget = budgetCall && isRecord(budgetCall.args) ? buildBudget(budgetCall.args) : undefined;

  if (creates.length === 1 && isRecord(creates[0]?.args)) {
    const args = creates[0].args;
    const range = dateRange(text(args, "startDate"), text(args, "endDate"));
    const destinations = stringList(args, "destinations");
    const days = countTripDays(text(args, "startDate"), text(args, "endDate"));
    const createBudget = buildBudget(args);
    return {
      title: text(args, "title") ?? "未命名旅行",
      ...(range ? { dateRange: range } : {}),
      ...(destinations.length > 0 ? { destinations: destinations.join("、") } : {}),
      ...(days !== undefined ? { days } : {}),
      ...(createBudget ?? budget ? { budget: createBudget ?? budget } : {}),
    };
  }

  // A plan that only edits one existing trip still gets a real header.
  if (creates.length === 0 && updates.length === 1 && isRecord(updates[0]?.args)) {
    const args = updates[0].args;
    const title = text(args, "title");
    const range = dateRange(text(args, "startDate"), text(args, "endDate"));
    const days = countTripDays(text(args, "startDate"), text(args, "endDate"));
    if (title || range || budget) {
      return {
        title: title ?? "调整已有旅行",
        ...(range ? { dateRange: range } : {}),
        ...(days !== undefined ? { days } : {}),
        ...(budget ? { budget } : {}),
      };
    }
  }
  return undefined;
}

interface RowBuildResult {
  readonly row: PlanRow;
  readonly bucket: PlanBucket;
}

function buildRow(
  call: AiToolCall,
  callIndex: number,
  creates: readonly AiToolCall[],
  subjects: PlanSubjectMap | undefined,
): RowBuildResult {
  const args: Record<string, unknown> = isRecord(call.args) ? call.args : {};
  // The contract guarantees an object, but a malformed persisted message must
  // degrade to copy.ts' "unknown" headline instead of throwing in the card.
  const copy = describePlannedCall({ tool: call.tool, args } as AiToolCall);
  const baseBucket = BUCKET[call.tool];
  const action = ACTION[call.tool];

  let bucket: PlanBucket = baseBucket ?? "orphan";
  let note: string | undefined;

  if (baseBucket === null) {
    note = "这个操作不会写入数据，确认后会被跳过。";
  } else if (
    call.tool !== "trips.create" &&
    TRIP_SCOPED_WRITE_TOOLS.has(call.tool) &&
    isPlaceholderTripId(args.tripId)
  ) {
    if (creates.length === 0) {
      bucket = "orphan";
      note = "本次计划没有创建旅行，也没有指定旅行 ID，执行时会失败。";
    } else if (creates.length > 1) {
      bucket = "orphan";
      note = `本次计划创建了 ${creates.length} 个旅行，无法判断这一项属于哪一个。`;
    }
  } else if (EXISTING_TRIP_REQUIRED_TOOLS.has(call.tool) && isPlaceholderTripId(args.tripId)) {
    bucket = "orphan";
    note = "这条操作需要一个已有旅行的 ID，执行时会失败。";
  }

  const subjectKey = SUBJECT_ARGUMENT[call.tool];
  const subjectId = subjectKey ? text(args, subjectKey) : undefined;
  const targetLabel = subjectId ? subjects?.[subjectId]?.label : undefined;

  const mode: PlanRowMode =
    call.tool === "trips.create" || action === "add"
      ? "add"
      : action === "remove"
        ? "remove"
        : call.tool === "stops.reorder" || call.tool === "packing.reorder"
          ? "reorder"
          : baseBucket === null
            ? "note"
            : "change";

  const headline = targetLabel ?? copy.headline;
  const values = copy.details.filter((detail) => detail !== targetLabel);
  const headlineIsValue = !ACTION_HEADLINES.has(copy.headline);
  const newValues = headlineIsValue && copy.headline !== targetLabel ? [copy.headline, ...values] : values;

  if (action === "remove") {
    note = targetLabel
      ? "删除后无法恢复。"
      : "未能获取对象名称，执行时将按记录 ID 处理；删除后无法恢复。";
  }
  if (mode === "reorder" && !note) {
    note = "只调整顺序，不改动内容。";
  }

  const dependsOnCreate =
    call.tool !== "trips.create" &&
    TRIP_SCOPED_WRITE_TOOLS.has(call.tool) &&
    isPlaceholderTripId(args.tripId) &&
    creates.length === 1;

  return {
    bucket,
    row: {
      callIndex,
      tool: call.tool,
      action,
      bucket,
      mode,
      key: `${call.tool}-${callIndex}`,
      label: copy.label,
      headline,
      details: copy.details,
      ...(targetLabel ? { targetLabel } : {}),
      from: mode === "change" ? [targetLabel ?? "—"] : [],
      to: mode === "change" ? newValues : [],
      ...(note ? { note } : {}),
      dependsOnCreate,
    },
  };
}

function emptyCounts(): PlanGroupCounts {
  return { add: 0, change: 0, remove: 0 };
}

function countRow(counts: PlanGroupCounts, action: PlanAction): PlanGroupCounts {
  return {
    add: counts.add + (action === "add" ? 1 : 0),
    change: counts.change + (action === "change" ? 1 : 0),
    remove: counts.remove + (action === "remove" ? 1 : 0),
  };
}

export function buildPlanReview(
  plannedCalls: readonly AiToolCall[],
  subjects?: PlanSubjectMap,
): PlanReview {
  if (plannedCalls.length === 0) {
    return {
      empty: true,
      headerTitle: "没有需要写入的操作",
      groups: [],
      summary: { add: 0, change: 0, remove: 0, total: 0 },
      hasDestructive: false,
      orphanCount: 0,
    };
  }

  const creates = plannedCalls.filter((call) => call.tool === "trips.create");
  const trip = tripSummary(plannedCalls);
  const byBucket = new Map<PlanBucket, PlanRow[]>();

  plannedCalls.forEach((call, callIndex) => {
    const { row, bucket } = buildRow(call, callIndex, creates, subjects);
    const rows = byBucket.get(bucket);
    if (rows) rows.push(row);
    else byBucket.set(bucket, [row]);
  });

  const groups: PlanGroup[] = [];
  let summary = emptyCounts();
  let orphanCount = 0;

  for (const bucket of GROUP_ORDER) {
    const rows = byBucket.get(bucket);
    if (!rows || rows.length === 0) continue;
    if (bucket === "orphan") orphanCount = rows.length;
    const counts = rows.reduce((acc, row) => countRow(acc, row.action), emptyCounts());
    summary = {
      add: summary.add + counts.add,
      change: summary.change + counts.change,
      remove: summary.remove + counts.remove,
    };
    groups.push({
      bucket,
      title: planBucketTitle(bucket),
      rows,
      counts,
      defaultOpen: bucket === "trip" || bucket === "orphan" || counts.remove > 0,
    });
  }

  const headerTitle =
    trip?.title ??
    (creates.length > 1 ? `${creates.length} 个新行程` : undefined) ??
    "待确认的方案";

  return {
    empty: false,
    headerTitle,
    ...(trip ? { trip } : {}),
    groups,
    summary: { ...summary, total: summary.add + summary.change + summary.remove },
    hasDestructive: summary.remove > 0,
    orphanCount,
  };
}

/**
 * Keeps the selection consistent with the server's trip-resolution rule:
 * once no `trips.create` is selected, every placeholder-trip write that was
 * leaning on it would fail (`TRIP_ID_UNRESOLVED`), so it is deselected too.
 */
export function normalizeSelection(
  plannedCalls: readonly AiToolCall[],
  selected: readonly boolean[],
): boolean[] {
  const next = plannedCalls.map((_, index) => selected[index] === true);
  const creates = plannedCalls.filter((call) => call.tool === "trips.create");
  if (creates.length !== 1) return next;

  const createIndex = plannedCalls.findIndex((call) => call.tool === "trips.create");
  if (next[createIndex]) return next;

  return plannedCalls.map((call, index) => {
    if (index === createIndex) return false;
    if (!TRIP_SCOPED_WRITE_TOOLS.has(call.tool)) return next[index] ?? false;
    const args = isRecord(call.args) ? call.args : {};
    return isPlaceholderTripId(args.tripId) ? false : (next[index] ?? false);
  });
}