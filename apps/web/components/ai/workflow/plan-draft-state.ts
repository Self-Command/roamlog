/**
 * Persisted human-tool draft state.
 *
 * Mirrors assistant-ui `examples/with-interactables/app/state.ts` (MIT,
 * commit 4a0d2a5b9f04c8fb7ff9cd224827a958096b52dc): the upstream example
 * declares the interactable state schema and initial value next to the
 * component model, while the persistence adapter lives at the app scope.
 *
 * JSON Schema is used because this web workspace does not have a direct zod
 * dependency. assistant-ui accepts either StandardSchemaV1 or JSONSchema7 for
 * `stateSchema`; the runtime behavior is the same.
 */

import type { Unstable_InteractableStateSchema } from "@assistant-ui/react";

import type {
  AiPlanDetailItem,
  AiPlanDetails,
  AiToolCall,
} from "@roamlog/contracts";

export interface QuestionDraftState {
  readonly values: readonly string[];
  readonly text: string;
}

export interface AskUserDraftState {
  readonly answers: Readonly<Record<string, QuestionDraftState>>;
  readonly attempted: boolean;
}

export interface ConfirmBriefDraftState {
  readonly revising: boolean;
  readonly revision: string;
}

export const EMPTY_ASK_USER_DRAFT: AskUserDraftState = {
  answers: {},
  attempted: false,
};

export const EMPTY_CONFIRM_BRIEF_DRAFT: ConfirmBriefDraftState = {
  revising: false,
  revision: "",
};

export type PlanDraftItemType = NonNullable<AiPlanDetailItem["type"]>;

export interface PlanDraftItem {
  readonly time?: string;
  readonly title: string;
  readonly location?: string;
  readonly transport?: string;
  readonly notes?: string;
  readonly type?: PlanDraftItemType;
}

export interface PlanDraftDay {
  readonly date: string;
  readonly title?: string;
  readonly items: PlanDraftItem[];
}

export interface PlanDraftBudget {
  readonly amountMinor: number;
  readonly currency: string;
  readonly breakdown: string[];
}

export interface PlanDraftDetails {
  readonly objective: string;
  readonly constraints: string[];
  readonly assumptions: string[];
  readonly openQuestions: string[];
  readonly days: PlanDraftDay[];
  readonly budget: PlanDraftBudget | null;
  readonly logistics: string[];
  readonly risks: string[];
  readonly alternatives: string[];
}

/**
 * Same-device plan review draft.
 *
 * The persistence/version pattern is ported from assistant-ui
 * `examples/with-agent-document-editor` and the array edit pattern from
 * `examples/with-interactables` (MIT,
 * `4a0d2a5b9f04c8fb7ff9cd224827a958096b52dc`). Roamlog maps those patterns
 * onto the structured plan payload instead of porting Lexical.
 *
 * `selected` only narrows the existing `plannedCalls`; edited prose/details
 * never become executable tool calls.
 */
export interface PlanDraftState {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly message: string;
  readonly details: PlanDraftDetails;
  readonly selected: readonly boolean[];
  readonly openGroups: Readonly<Record<string, boolean>>;
  readonly dirty: boolean;
  readonly updatedAt: string;
}

export interface PlanDraftSeed {
  readonly runId: string;
  readonly message: string;
  readonly details?: AiPlanDetails | null;
  readonly plannedCalls: readonly AiToolCall[];
}

const PLAN_DRAFT_MAX_MESSAGE = 16_000;
const PLAN_DRAFT_MAX_SELECTED = 20;
const PLAN_DRAFT_MAX_DAYS = 30;
const PLAN_DRAFT_MAX_ITEMS_PER_DAY = 8;
const PLAN_DRAFT_MAX_OPEN_QUESTIONS = 20;
const PLAN_DRAFT_MAX_OPEN_GROUPS = 20;

const ITEM_TYPES = new Set<PlanDraftItemType>([
  "transit",
  "food",
  "activity",
  "stay",
  "note",
]);

export const ASK_USER_DRAFT_STATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answers: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        properties: {
          values: {
            type: "array",
            items: { type: "string" },
          },
          text: { type: "string" },
        },
        required: ["values", "text"],
      },
    },
    attempted: { type: "boolean" },
  },
  required: ["answers", "attempted"],
} as unknown as Unstable_InteractableStateSchema;

export const CONFIRM_BRIEF_DRAFT_STATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    revising: { type: "boolean" },
    revision: { type: "string" },
  },
  required: ["revising", "revision"],
} as unknown as Unstable_InteractableStateSchema;

export const PLAN_DRAFT_STATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { const: 1 },
    runId: { type: "string" },
    message: { type: "string" },
    details: { type: "object" },
    selected: {
      type: "array",
      items: { type: "boolean" },
    },
    openGroups: {
      type: "object",
      additionalProperties: { type: "boolean" },
    },
    dirty: { type: "boolean" },
    updatedAt: { type: "string" },
  },
  required: [
    "schemaVersion",
    "runId",
    "message",
    "details",
    "selected",
    "openGroups",
    "dirty",
    "updatedAt",
  ],
} as unknown as Unstable_InteractableStateSchema;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 20_000) : "";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, 100)
    .map((entry) => entry.slice(0, 2_000));
}

function boundedText(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function boundedStringList(
  value: unknown,
  maxItems: number,
  maxItemLength: number,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, maxItems)
    .map((entry) => entry.slice(0, maxItemLength));
}

function planDraftItem(value: unknown): PlanDraftItem | null {
  if (!isRecord(value) || typeof value.title !== "string") return null;
  const rawType = typeof value.type === "string" ? value.type : "";
  const type = ITEM_TYPES.has(rawType as PlanDraftItemType)
    ? (rawType as PlanDraftItemType)
    : undefined;
  return {
    title: value.title.slice(0, 180),
    ...(typeof value.time === "string" ? { time: value.time.slice(0, 5) } : {}),
    ...(typeof value.location === "string"
      ? { location: value.location.slice(0, 200) }
      : {}),
    ...(typeof value.transport === "string"
      ? { transport: value.transport.slice(0, 400) }
      : {}),
    ...(typeof value.notes === "string" ? { notes: value.notes.slice(0, 1_500) } : {}),
    ...(type ? { type } : {}),
  };
}

function planDraftDay(value: unknown): PlanDraftDay | null {
  if (!isRecord(value) || typeof value.date !== "string") return null;
  const items = Array.isArray(value.items)
    ? value.items
        .slice(0, PLAN_DRAFT_MAX_ITEMS_PER_DAY)
        .map(planDraftItem)
        .filter((item): item is PlanDraftItem => item !== null)
    : [];
  return {
    date: value.date.slice(0, 10),
    ...(typeof value.title === "string" ? { title: value.title.slice(0, 180) } : {}),
    items,
  };
}

function planDraftBudget(value: unknown): PlanDraftBudget | null {
  if (!isRecord(value)) return null;
  const amountMinor =
    typeof value.amountMinor === "number" &&
    Number.isSafeInteger(value.amountMinor) &&
    value.amountMinor >= 0
      ? value.amountMinor
      : null;
  const currency =
    typeof value.currency === "string" && /^[A-Z]{3}$/u.test(value.currency)
      ? value.currency
      : null;
  if (amountMinor === null || currency === null) return null;
  return {
    amountMinor,
    currency,
    breakdown: boundedStringList(value.breakdown, 20, 300),
  };
}

function planDraftDetails(
  value: unknown,
  fallback: PlanDraftDetails,
): PlanDraftDetails {
  if (!isRecord(value)) return fallback;
  return {
    objective: boundedText(value.objective, 4_000, fallback.objective),
    constraints: Array.isArray(value.constraints)
      ? boundedStringList(value.constraints, 30, 500)
      : fallback.constraints,
    assumptions: Array.isArray(value.assumptions)
      ? boundedStringList(value.assumptions, 30, 500)
      : fallback.assumptions,
    openQuestions: Array.isArray(value.openQuestions)
      ? boundedStringList(value.openQuestions, PLAN_DRAFT_MAX_OPEN_QUESTIONS, 500)
      : fallback.openQuestions,
    days: Array.isArray(value.days)
      ? value.days
          .slice(0, PLAN_DRAFT_MAX_DAYS)
          .map(planDraftDay)
          .filter((day): day is PlanDraftDay => day !== null)
      : fallback.days,
    budget:
      value.budget === null
        ? null
        : value.budget === undefined
          ? fallback.budget
          : planDraftBudget(value.budget) ?? fallback.budget,
    logistics: Array.isArray(value.logistics)
      ? boundedStringList(value.logistics, 30, 500)
      : fallback.logistics,
    risks: Array.isArray(value.risks)
      ? boundedStringList(value.risks, 30, 500)
      : fallback.risks,
    alternatives: Array.isArray(value.alternatives)
      ? boundedStringList(value.alternatives, 30, 500)
      : fallback.alternatives,
  };
}

function planDraftDetailsFromContract(
  details: AiPlanDetails | null | undefined,
): PlanDraftDetails {
  if (!details) {
    return {
      objective: "",
      constraints: [],
      assumptions: [],
      openQuestions: [],
      days: [],
      budget: null,
      logistics: [],
      risks: [],
      alternatives: [],
    };
  }
  return {
    objective: details.objective ?? "",
    constraints: [...(details.constraints ?? [])],
    assumptions: [...(details.assumptions ?? [])],
    openQuestions: [...(details.openQuestions ?? [])],
    days: (details.days ?? []).map((day) => ({
      date: day.date,
      ...(day.title ? { title: day.title } : {}),
      items: day.items.map((item) => ({
        title: item.title,
        ...(item.time ? { time: item.time } : {}),
        ...(item.location ? { location: item.location } : {}),
        ...(item.transport ? { transport: item.transport } : {}),
        ...(item.notes ? { notes: item.notes } : {}),
        ...(item.type ? { type: item.type } : {}),
      })),
    })),
    budget: details.budget
      ? {
          amountMinor: details.budget.amountMinor,
          currency: details.budget.currency,
          breakdown: [...(details.budget.breakdown ?? [])],
        }
      : null,
    logistics: [...(details.logistics ?? [])],
    risks: [...(details.risks ?? [])],
    alternatives: [...(details.alternatives ?? [])],
  };
}

export function initialPlanDraft(seed: PlanDraftSeed): PlanDraftState {
  return {
    schemaVersion: 1,
    runId: seed.runId,
    message: seed.message.slice(0, PLAN_DRAFT_MAX_MESSAGE),
    details: planDraftDetailsFromContract(seed.details),
    selected: seed.plannedCalls
      .slice(0, PLAN_DRAFT_MAX_SELECTED)
      .map(() => true),
    openGroups: {},
    dirty: false,
    updatedAt: new Date().toISOString(),
  };
}

export function readPlanDraftState(
  value: unknown,
  fallback: PlanDraftState,
): PlanDraftState {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.runId !== fallback.runId
  ) {
    return fallback;
  }
  const selected =
    Array.isArray(value.selected) &&
    value.selected.length === fallback.selected.length
      ? value.selected
          .slice(0, PLAN_DRAFT_MAX_SELECTED)
          .map((entry) => entry === true)
      : [...fallback.selected];
  const openGroups: Readonly<Record<string, boolean>> = isRecord(value.openGroups)
    ? Object.fromEntries(
        Object.entries(value.openGroups)
          .filter(
            (entry): entry is [string, boolean] =>
              entry[0].length > 0 &&
              entry[0].length <= 120 &&
              typeof entry[1] === "boolean",
          )
          .slice(0, PLAN_DRAFT_MAX_OPEN_GROUPS),
      )
    : {};
  return {
    schemaVersion: 1,
    runId: fallback.runId,
    message:
      typeof value.message === "string"
        ? value.message.slice(0, PLAN_DRAFT_MAX_MESSAGE)
        : fallback.message,
    details: planDraftDetails(value.details, fallback.details),
    selected,
    openGroups,
    dirty: value.dirty === true,
    updatedAt:
      typeof value.updatedAt === "string" && value.updatedAt.length > 0
        ? value.updatedAt.slice(0, 40)
        : fallback.updatedAt,
  };
}

export function hasPlanDraft(draft: PlanDraftState): boolean {
  return draft.dirty;
}

/**
 * Converts the editable draft into the display-only contract shape. `null`
 * budget is omitted because the API contract represents an absent budget as
 * `undefined`; it still never participates in execute.
 */
export function planDetailsForSurface(details: PlanDraftDetails): AiPlanDetails {
  return {
    ...(details.objective ? { objective: details.objective } : {}),
    constraints: [...details.constraints],
    assumptions: [...details.assumptions],
    openQuestions: [...details.openQuestions],
    days: details.days.map((day) => ({
      date: day.date,
      ...(day.title ? { title: day.title } : {}),
      items: day.items.map((item) => ({
        title: item.title,
        ...(item.time ? { time: item.time } : {}),
        ...(item.location ? { location: item.location } : {}),
        ...(item.transport ? { transport: item.transport } : {}),
        ...(item.notes ? { notes: item.notes } : {}),
        ...(item.type ? { type: item.type } : {}),
      })),
    })),
    ...(details.budget
      ? {
          budget: {
            amountMinor: details.budget.amountMinor,
            currency: details.budget.currency,
            breakdown: [...details.budget.breakdown],
          },
        }
      : {}),
    logistics: [...details.logistics],
    risks: [...details.risks],
    alternatives: [...details.alternatives],
  };
}

export function readAskUserDraft(value: unknown): AskUserDraftState {
  if (!isRecord(value)) return EMPTY_ASK_USER_DRAFT;
  const answers = isRecord(value.answers)
    ? Object.fromEntries(
        Object.entries(value.answers).flatMap(([id, answer]) => {
          if (!isRecord(answer) || id.length === 0) return [];
          return [
            [
              id.slice(0, 128),
              {
                values: stringList(answer.values),
                text: text(answer.text),
              },
            ],
          ];
        }),
      )
    : {};
  return {
    answers,
    attempted: value.attempted === true,
  };
}

export function readConfirmBriefDraft(value: unknown): ConfirmBriefDraftState {
  if (!isRecord(value)) return EMPTY_CONFIRM_BRIEF_DRAFT;
  const revision = text(value.revision);
  return {
    revising: value.revising === true || revision.trim().length > 0,
    revision,
  };
}

export function hasAskUserDraft(draft: AskUserDraftState): boolean {
  if (draft.attempted) return true;
  return Object.values(draft.answers).some(
    (answer) => answer.values.length > 0 || answer.text.trim().length > 0,
  );
}

export function hasConfirmBriefDraft(draft: ConfirmBriefDraftState): boolean {
  return draft.revising || draft.revision.trim().length > 0;
}
