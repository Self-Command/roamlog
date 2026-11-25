import { HttpException, Inject, Injectable, Optional } from "@nestjs/common";
import {
  AiAskUserArgsSchema,
  AiConfirmBriefArgsSchema,
  CreateItineraryItemRequestSchema,
  CreatePackingItemRequestSchema,
  CreateStopRequestSchema,
  CreateTripRequestSchema,
  isReadOnlyAiTool,
  type AiHumanToolName,
  type AiPlanSubjects,
  type AiToolCall,
  type AiToolError,
  type AiToolName,
  type Place,
  type AiArtifactReference,
} from "@roamlog/contracts";
import { z } from "zod";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { EntriesService } from "../entries/entries.service.js";
import { ExpensesService } from "../expenses/expenses.service.js";
import { ItineraryService } from "../itinerary/itinerary.service.js";
import { PackingService } from "../packing/packing.service.js";
import { PlacesService } from "../places/places.service.js";
import { StopsService } from "../trips/stops.service.js";
import { TripsService } from "../trips/trips.service.js";
import type { AiToolSpec } from "./adapters/adapter.js";
import { AiArtifactService } from "./ai-artifact.service.js";

/** A place the model may reference by id. Coordinates never come from the model. */
export interface AiPlaceCandidate {
  readonly providerPlaceId: string;
  /** Storable source enum; every search source is now accepted by `Stop`. */
  readonly provider: Place["provider"];
  readonly name: string;
  readonly country: string;
  readonly countryCode: string;
  readonly lat: number;
  readonly lng: number;
  readonly timeZone: string | null;
  /** Provider-formatted address, persisted on `Stop.address`. */
  readonly address: string | null;
  /** `[west, south, east, north]`, persisted on `Stop.bbox`. */
  readonly bbox: Place["bbox"];
}

export interface AiToolContext {
  readonly actor: AuthenticatedActor;
  readonly membership: WorkspaceMembershipAccess;
  readonly runId: string;
  /** Persisted conversation for this run; absent on legacy Redis plans. */
  readonly conversationId?: string;
  /** Places returned by `places.search` during this run, keyed by provider id. */
  readonly candidates: Map<string, AiPlaceCandidate>;
  /**
   * Ids produced by successful `trips.create` calls **in this execution batch**,
   * in execution order. The execute loop owns the array, the toolbox appends to
   * it, and a trip-scoped call that carries no usable id is pointed at its only
   * entry. Two or more creations make that inference ambiguous, which is an
   * error — never a guess.
   */
  readonly createdTripIds?: string[];
  readonly today?: string;
}

export interface AiToolOutcome {
  readonly ok: boolean;
  readonly payload: unknown;
  readonly entityId?: string | null;
  readonly artifact?: AiArtifactReference;
  readonly error?: AiToolError;
}

const MAX_CANDIDATES = 12;
/** Mirrors `Stop.address` (`z.string().max(400)`, `VARCHAR(400)`). */
const MAX_STOP_ADDRESS_LENGTH = 400;

const dateOnly = z.iso.date();
const uuid = z.uuid({ version: "v7" });
const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

/**
 * A trip reference on a write tool. The model may leave it out (or send a
 * placeholder such as `new`) when the same plan creates the trip; `execute`
 * then fills in the id that `trips.create` returned. A string that is already
 * a UUID is never rewritten — see `resolveTripTarget`.
 */
const tripRef = z.string().trim().max(200).optional();

/**
 * Argument whitelists.
 *
 * The additive tools keep their historical "strip unknown keys" mode so a model
 * can never smuggle extra fields into a service. Every tool added by
 * AI_TOOL_SURFACE_EXPAND_2 is `.strict()`: an attempted `workspaceId`, caller
 * `userId`, `createdById` or `version` is rejected as INVALID_ARGUMENTS instead
 * of being silently dropped. `trips.update` stays in the historical mode for
 * compatibility, but its whitelist remains explicit.
 */
const packingCategory = z.enum(["documents", "clothing", "gear", "health", "other"]);
const itineraryType = z.enum(["transit", "food", "activity", "stay", "note"]);
const tripStatus = z.enum(["wishlist", "planning", "upcoming", "active", "completed"]);
const mood = z.enum(["calm", "happy", "awe", "tired", "reflective", "excited"]);
const weather = z.enum(["sunny", "cloudy", "rain", "snow", "wind", "fog"]);
const expenseCategory = z.enum(["transport", "stay", "food", "activity", "shopping", "other"]);
const splitMode = z.enum(["equal", "custom"]);
const countryCode = z.string().regex(/^[A-Z]{2}$/u);
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u);
const ianaTimeZone = z
  .string()
  .trim()
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/u);
const reorderItems = z
  .array(z.object({ id: uuid, order: z.number().int().nonnegative() }).strict())
  .min(1)
  .max(500);
const expenseParticipant = z
  .object({
    memberId: uuid,
    shareAmountMinor: z.number().int().nonnegative().optional(),
  })
  .strict();

/** Human tools are validated here but never executed by the toolbox. */
const HUMAN_TOOL_ARGS: Record<AiHumanToolName, z.ZodType> = {
  ask_user: AiAskUserArgsSchema,
  confirm_brief: AiConfirmBriefArgsSchema,
};

export type HumanToolArgsResult =
  | { readonly ok: true; readonly args: Record<string, unknown> }
  | { readonly ok: false; readonly error: AiToolError };

/** Validates the model-authored arguments before a stream pauses for a human. */
export function parseHumanToolArgs(
  name: AiHumanToolName,
  rawArgs: Record<string, unknown>,
): HumanToolArgsResult {
  const parsed = HUMAN_TOOL_ARGS[name].safeParse(rawArgs);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "INVALID_ARGUMENTS", message: issueMessage(parsed.error) },
    };
  }
  return { ok: true, args: parsed.data as Record<string, unknown> };
}

const ArgsSchemas: Record<AiToolName, z.ZodType> = {
  "places.search": z.object({
    q: nonEmpty(200),
    limit: z.number().int().min(1).max(MAX_CANDIDATES).optional(),
  }),
  "trips.create": z.object({
    title: nonEmpty(160),
    summary: z.string().max(1000).optional(),
    startDate: dateOnly.optional(),
    endDate: dateOnly.optional(),
    budgetAmountMinor: z.number().int().nonnegative().optional(),
    budgetCurrency: z.string().regex(/^[A-Z]{3}$/u).optional(),
    tags: z.array(nonEmpty(40)).max(20).optional(),
    destinations: z.array(nonEmpty(120)).max(30).optional(),
    // Never `public_link`: sharing is a user decision, not a model one.
    // Never `custom` either: a custom trip names individual people and
    // workspaces, and letting the model pick who may read a trip would turn a
    // prompt into an authorization grant. The API accepts `custom` from a user
    // request, but this tool surface stays at the two safe tiers.
    visibility: z.enum(["private", "workspace"]).optional(),
  }),
  "trips.get": z.object({ tripId: uuid }),
  /**
   * Discovery only: a title keyword and a page size. Deliberately no
   * `workspaceId`/`userId`/`ownerId` — the workspace and caller always come
   * from the authenticated membership, so a model cannot widen its own scope.
   */
  "trips.list": z.object({
    query: nonEmpty(80).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  /**
   * Descriptive and lifecycle fields only. `visibility`, `showExactPhotoLocation`,
   * covers, grants and settings are absent on purpose: the model may fix a
   * mistyped title, extend a trip's dates, change its own lifecycle status,
   * favourite it, or set the trip origin — never change who can read it or
   * switch off a privacy control. `version` is also absent — the tool reads the
   * current row through the visibility-checked path and passes its version as
   * the optimistic-lock token.
   */
  "trips.update": z
    .object({
      tripId: tripRef,
      title: nonEmpty(160).optional(),
      summary: z.string().max(1000).optional(),
      startDate: dateOnly.optional(),
      endDate: dateOnly.optional(),
      status: tripStatus.optional(),
      favorite: z.boolean().optional(),
      origin: nonEmpty(120).optional(),
      originLat: z.number().min(-90).max(90).nullable().optional(),
      originLng: z.number().min(-180).max(180).nullable().optional(),
      timeZone: ianaTimeZone.nullable().optional(),
    })
    .refine(
      (value) =>
        [
          value.title,
          value.summary,
          value.startDate,
          value.endDate,
          value.status,
          value.favorite,
          value.origin,
          value.originLat,
          value.originLng,
          value.timeZone,
        ].some((field) => field !== undefined),
      { message: "at least one trip field must change", path: ["title"] },
    )
    .refine(
      (value) => (value.originLat === undefined) === (value.originLng === undefined),
      { message: "originLat and originLng must be provided together", path: ["originLng"] },
    ),
  "stops.add": z.object({
    tripId: tripRef,
    providerPlaceId: nonEmpty(200),
    startDate: dateOnly.optional(),
    endDate: dateOnly.optional(),
    notes: z.string().max(4000).optional(),
  }),
  "stops.list": z.object({ tripId: uuid }),
  "stops.update": z
    .object({
      tripId: uuid,
      stopId: uuid,
      city: nonEmpty(120).optional(),
      country: nonEmpty(120).optional(),
      countryCode: countryCode.optional(),
      startDate: dateOnly.optional(),
      endDate: dateOnly.optional(),
      notes: z.string().max(4000).optional(),
      address: z.string().max(400).nullable().optional(),
    })
    .strict()
    .refine(
      (value) =>
        [
          value.city,
          value.country,
          value.countryCode,
          value.startDate,
          value.endDate,
          value.notes,
          value.address,
        ].some((field) => field !== undefined),
      { message: "at least one stop field must change", path: ["city"] },
    ),
  "stops.delete": z.object({ stopId: uuid }).strict(),
  "stops.reorder": z.object({ tripId: uuid, items: reorderItems }).strict(),
  "itinerary.addDay": z.object({
    tripId: tripRef,
    date: dateOnly,
    title: nonEmpty(180).optional(),
    items: z
      .array(
        z.object({
          title: nonEmpty(180),
          time: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/u)
            .optional(),
          location: nonEmpty(200).optional(),
          notes: z.string().max(4000).optional(),
          type: z.enum(["transit", "food", "activity", "stay", "note"]).optional(),
        }),
      )
      .min(1)
      .max(8),
  }),
  "itinerary.update": z
    .object({
      tripId: uuid,
      itemId: uuid,
      date: dateOnly.optional(),
      startTime: timeOfDay.nullable().optional(),
      endTime: timeOfDay.nullable().optional(),
      title: nonEmpty(180).optional(),
      type: itineraryType.optional(),
      location: nonEmpty(200).optional(),
      notes: z.string().max(4000).optional(),
      done: z.boolean().optional(),
    })
    .strict()
    .refine(
      (value) =>
        [
          value.date,
          value.startTime,
          value.endTime,
          value.title,
          value.type,
          value.location,
          value.notes,
          value.done,
        ].some((field) => field !== undefined),
      { message: "at least one itinerary field must change", path: ["title"] },
    ),
  "itinerary.delete": z.object({ itemId: uuid }).strict(),
  "packing.add": z.object({
    tripId: tripRef,
    name: nonEmpty(160),
    category: packingCategory.optional(),
    quantity: z.number().int().min(1).max(999).optional(),
  }),
  "packing.update": z
    .object({
      tripId: uuid,
      itemId: uuid,
      name: nonEmpty(160).optional(),
      category: packingCategory.optional(),
      quantity: z.number().int().min(1).max(999).optional(),
      packed: z.boolean().optional(),
    })
    .strict()
    .refine(
      (value) =>
        [value.name, value.category, value.quantity, value.packed].some(
          (field) => field !== undefined,
        ),
      { message: "at least one packing field must change", path: ["name"] },
    ),
  "packing.delete": z.object({ itemId: uuid }).strict(),
  "packing.reorder": z.object({ tripId: uuid, items: reorderItems }).strict(),
  "budget.setSummary": z.object({
    tripId: tripRef,
    amountMinor: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/u),
  }),
  "expenses.add": z
    .object({
      tripId: tripRef,
      date: dateOnly,
      category: expenseCategory,
      note: z.string().max(1000).optional(),
      amountMinor: z.number().int().nonnegative(),
      currency: z.string().regex(/^[A-Z]{3}$/u),
      paidByMemberId: uuid,
      splitMode,
      receiptMediaId: uuid.nullable().optional(),
      participants: z.array(expenseParticipant).min(1).max(50),
    })
    .strict()
    .superRefine((value, ctx) => {
      const ids = value.participants.map((participant) => participant.memberId);
      if (!ids.includes(value.paidByMemberId)) {
        ctx.addIssue({
          code: "custom",
          message: "paidByMemberId must appear in participants.",
          path: ["paidByMemberId"],
        });
      }
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({
          code: "custom",
          message: "participants cannot contain the same member twice.",
          path: ["participants"],
        });
      }
    }),
  "expenses.update": z
    .object({
      tripId: uuid,
      expenseId: uuid,
      date: dateOnly.optional(),
      category: expenseCategory.optional(),
      note: z.string().max(1000).optional(),
      amountMinor: z.number().int().nonnegative().optional(),
      currency: z.string().regex(/^[A-Z]{3}$/u).optional(),
      paidByMemberId: uuid.optional(),
      splitMode: splitMode.optional(),
      receiptMediaId: uuid.nullable().optional(),
      participants: z.array(expenseParticipant).min(1).max(50).optional(),
    })
    .strict()
    .refine(
      (value) =>
        [
          value.date,
          value.category,
          value.note,
          value.amountMinor,
          value.currency,
          value.paidByMemberId,
          value.splitMode,
          value.receiptMediaId,
          value.participants,
        ].some((field) => field !== undefined),
      { message: "at least one expense field must change", path: ["note"] },
    )
    .superRefine((value, ctx) => {
      if (value.participants === undefined) {
        return;
      }
      if (
        value.amountMinor === undefined ||
        value.paidByMemberId === undefined ||
        value.splitMode === undefined
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "Changing participants requires amountMinor, paidByMemberId and splitMode together.",
          path: ["participants"],
        });
        return;
      }
      const ids = value.participants.map((participant) => participant.memberId);
      if (!ids.includes(value.paidByMemberId)) {
        ctx.addIssue({
          code: "custom",
          message: "paidByMemberId must appear in participants.",
          path: ["paidByMemberId"],
        });
      }
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({
          code: "custom",
          message: "participants cannot contain the same member twice.",
          path: ["participants"],
        });
      }
    }),
  "expenses.delete": z.object({ expenseId: uuid }).strict(),
  "entries.create": z
    .object({
      tripId: tripRef,
      title: nonEmpty(180),
      date: dateOnly.optional(),
      location: nonEmpty(160).optional(),
      content: nonEmpty(20_000),
      mood: mood.nullable().optional(),
      weather: weather.nullable().optional(),
      tags: z.array(nonEmpty(40)).max(20).optional(),
      favorite: z.boolean().optional(),
    })
    .strict(),
  "entries.update": z
    .object({
      entryId: uuid,
      title: nonEmpty(180).optional(),
      date: dateOnly.optional(),
      location: nonEmpty(160).optional(),
      content: nonEmpty(20_000).optional(),
      mood: mood.nullable().optional(),
      weather: weather.nullable().optional(),
      tags: z.array(nonEmpty(40)).max(20).optional(),
      favorite: z.boolean().optional(),
    })
    .strict()
    .refine(
      (value) =>
        [
          value.title,
          value.date,
          value.location,
          value.content,
          value.mood,
          value.weather,
          value.tags,
          value.favorite,
        ].some((field) => field !== undefined),
      { message: "at least one entry field must change", path: ["title"] },
    ),
  "participants.add": z.object({ tripId: tripRef, memberId: uuid }).strict(),
  "participants.remove": z.object({ tripId: uuid, memberId: uuid }).strict(),
  "participants.role": z
    .object({ tripId: uuid, memberId: uuid, role: z.enum(["viewer", "editor"]) })
    .strict(),
  "artifacts.create": z
    .object({
      title: nonEmpty(160),
      kind: z.enum(["text", "code", "sheet"]),
      brief: z.string().max(4000).optional(),
    })
    .strict(),
  "artifacts.update": z
    .object({
      artifactId: uuid,
      description: nonEmpty(4000),
    })
    .strict(),
  "artifacts.edit": z
    .object({
      artifactId: uuid,
      oldString: nonEmpty(2000),
      newString: z.string().max(2000),
      replaceAll: z.boolean().optional(),
    })
    .strict(),
  "artifacts.suggest": z.object({ artifactId: uuid }).strict(),
};

export const AI_TOOL_SPECS: readonly AiToolSpec[] = [
  {
    name: "ask_user",
    description:
      "Pause and ask the user for information that is required to do the task but is missing from the request. This is a human-input tool: it never writes data, never queues a plan, and must be the only tool call in the model turn. Ask only necessary questions, never re-ask information already provided, and never silently choose a destination, date, budget, companion, pace, preference or approval on the user's behalf. Questions are generic and may use text, single-choice, multi-choice, date or number controls.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", maxLength: 160 },
        intro: { type: "string", maxLength: 1000 },
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              id: { type: "string", maxLength: 64 },
              prompt: { type: "string", maxLength: 500 },
              description: { type: "string", maxLength: 1000 },
              kind: { type: "string", enum: ["text", "single", "multi", "date", "number"] },
              required: { type: "boolean" },
              allowOther: { type: "boolean" },
              options: {
                type: "array",
                minItems: 1,
                maxItems: 20,
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", maxLength: 200 },
                    value: { type: "string", maxLength: 200 },
                    description: { type: "string", maxLength: 500 },
                  },
                  required: ["label", "value"],
                },
              },
              placeholder: { type: "string", maxLength: 500 },
              min: { type: "number" },
              max: { type: "number" },
              minDate: { type: "string" },
              maxDate: { type: "string" },
            },
            required: ["id", "prompt", "kind"],
          },
        },
      },
      required: ["title", "questions"],
      additionalProperties: false,
    },
  },
  {
    name: "confirm_brief",
    description:
      "Pause and show a faithful brief for the user to confirm before planning. Use this only after the important requirements are known. Include explicit constraints, assumptions and any open questions; if open questions remain, the user must resolve them rather than letting the model guess. This is a human-input tool and must be the only tool call in the turn. No write tool or plan may be proposed until the user confirms.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", maxLength: 160 },
        summary: { type: "string", maxLength: 8000 },
        constraints: { type: "array", maxItems: 30, items: { type: "string" } },
        assumptions: { type: "array", maxItems: 30, items: { type: "string" } },
        openQuestions: { type: "array", maxItems: 20, items: { type: "string" } },
      },
      required: ["title", "summary"],
      additionalProperties: false,
    },
  },
  {
    name: "places.search",
    description:
      "Search the place database and return candidates with providerPlaceId, country and coordinates. Read-only, no side effects. Always search before adding a stop. If a Chinese/Japanese name returns degraded with no candidates, retry with the romanized or English name (for example Kiyomizu-dera, Fushimi Inari, Kinkaku-ji).",
    parameters: {
      type: "object",
      properties: {
        q: { type: "string", description: "City, landmark or address to search." },
        limit: { type: "integer", minimum: 1, maximum: MAX_CANDIDATES },
      },
      required: ["q"],
      additionalProperties: false,
    },
  },
  {
    name: "trips.create",
    description:
      "Create a trip in the current workspace. WRITES DATA. It is only queued while planning and is executed after the user confirms.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", maxLength: 160 },
        summary: { type: "string", maxLength: 1000 },
        startDate: { type: "string", description: "YYYY-MM-DD" },
        endDate: { type: "string", description: "YYYY-MM-DD" },
        budgetAmountMinor: { type: "integer", minimum: 0 },
        budgetCurrency: { type: "string", description: "ISO 4217, for example CNY" },
        tags: { type: "array", items: { type: "string" }, maxItems: 20 },
        destinations: { type: "array", items: { type: "string" }, maxItems: 30 },
        // Mirrors the argument schema above: no `public_link` (sharing is a
        // user decision) and no `custom` (the model must never choose a trip's
        // audience — see the tool argument schema for the full reason).
        visibility: { type: "string", enum: ["private", "workspace"] },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "trips.get",
    description:
      "Read one trip in the current workspace, including its dates, budget and version. Read-only, no side effects.",
    parameters: {
      type: "object",
      properties: { tripId: { type: "string", description: "Trip UUID" } },
      required: ["tripId"],
      additionalProperties: false,
    },
  },
  {
    name: "trips.list",
    description:
      "Find trips in the current workspace, optionally filtered by a title keyword. Returns tripId, title, startDate, endDate and primary destination only. Read-only, no side effects. When the user refers to a trip by NAME (for example \"京都 5 日游\") and gives no tripId, call this first and use the matching tripId with trips.update or stops.add. Prefer a short distinctive keyword (for example 京都) if the full phrase does not match; match the returned title and dates to pick the right trip.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          maxLength: 80,
          description: "Optional title keyword, 1-80 characters.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description: "Maximum trips to return, default 10.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "trips.update",
    description:
      "Change an EXISTING trip's title, summary, startDate, endDate, status, favorite, origin or timeZone (for example \"make it 6 days\" means a new endDate; \"mark it completed\" means status=completed). WRITES DATA. Use this instead of creating a new trip when the user wants to extend, shorten, rename, re-summarise, favourite or change the lifecycle of a trip. When the user names the trip instead of giving a tripId, call trips.list first to resolve its id. It cannot delete a trip, change who can see it (visibility), change the exact-photo-location privacy switch, or touch settings.",
    parameters: {
      type: "object",
      properties: {
        tripId: {
          type: "string",
          description:
            "Trip UUID. Omit only when this same plan creates the trip with trips.create: the server then targets that new trip.",
        },
        title: { type: "string", maxLength: 160 },
        summary: { type: "string", maxLength: 1000 },
        startDate: { type: "string", description: "YYYY-MM-DD" },
        endDate: { type: "string", description: "YYYY-MM-DD" },
        status: {
          type: "string",
          enum: ["wishlist", "planning", "upcoming", "active", "completed"],
        },
        favorite: { type: "boolean" },
        origin: { type: "string", maxLength: 120 },
        originLat: { type: "number", minimum: -90, maximum: 90 },
        originLng: { type: "number", minimum: -180, maximum: 180 },
        timeZone: { type: "string", description: "IANA time zone, for example Asia/Tokyo" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "stops.add",
    description:
      "Add a city stop to a trip. WRITES DATA. providerPlaceId must come from places.search in this same run. Omit tripId when this same plan creates the trip; the server attaches the stop to that new trip.",
    parameters: {
      type: "object",
      properties: {
        tripId: {
          type: "string",
          description:
            "Trip UUID. Omit only when an earlier trips.create in this same plan supplies it.",
        },
        providerPlaceId: { type: "string" },
        startDate: { type: "string", description: "YYYY-MM-DD; defaults to the trip start" },
        endDate: { type: "string", description: "YYYY-MM-DD; defaults to startDate" },
        notes: { type: "string", maxLength: 4000 },
      },
      required: ["providerPlaceId"],
      additionalProperties: false,
    },
  },
  {
    name: "stops.list",
    description: "List the stops of a trip. Read-only, no side effects.",
    parameters: {
      type: "object",
      properties: { tripId: { type: "string" } },
      required: ["tripId"],
      additionalProperties: false,
    },
  },
  {
    name: "stops.update",
    description:
      "Edit an existing city stop's city, country, dates, notes or address. WRITES DATA. Use this when the user wants to correct or extend a stop instead of deleting and re-adding it. Call stops.list first to get the stopId and its tripId. It cannot change the trip itself or provider metadata.",
    parameters: {
      type: "object",
      properties: {
        tripId: { type: "string", description: "Trip UUID that owns the stop." },
        stopId: { type: "string", description: "Stop UUID from stops.list." },
        city: { type: "string", maxLength: 120 },
        country: { type: "string", maxLength: 120 },
        countryCode: { type: "string", description: "ISO 3166-1 alpha-2, for example JP" },
        startDate: { type: "string", description: "YYYY-MM-DD" },
        endDate: { type: "string", description: "YYYY-MM-DD" },
        notes: { type: "string", maxLength: 4000 },
        address: { type: "string", maxLength: 400 },
      },
      required: ["tripId", "stopId"],
      additionalProperties: false,
    },
  },
  {
    name: "stops.delete",
    description:
      "Delete one city stop from a trip. WRITES DATA. Destructive: call only when the user explicitly asks to remove that stop. Call stops.list first to resolve the stopId; deletion cannot be undone.",
    parameters: {
      type: "object",
      properties: { stopId: { type: "string", description: "Stop UUID from stops.list." } },
      required: ["stopId"],
      additionalProperties: false,
    },
  },
  {
    name: "stops.reorder",
    description:
      "Reorder the city stops of a trip. WRITES DATA. Send every stop from stops.list in the desired order, each with its zero-based order value. Use this when the user says the stops are in the wrong order.",
    parameters: {
      type: "object",
      properties: {
        tripId: { type: "string", description: "Trip UUID." },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 500,
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Stop UUID" },
              order: { type: "integer", minimum: 0 },
            },
            required: ["id", "order"],
            additionalProperties: false,
          },
        },
      },
      required: ["tripId", "items"],
      additionalProperties: false,
    },
  },
  {
    name: "itinerary.addDay",
    description:
      "Add one day of itinerary items to a trip. WRITES DATA. Items are created in the order given. Omit tripId when this same plan creates the trip; the server attaches the day to that new trip.",
    parameters: {
      type: "object",
      properties: {
        tripId: {
          type: "string",
          description:
            "Trip UUID. Omit only when an earlier trips.create in this same plan supplies it.",
        },
        date: { type: "string", description: "YYYY-MM-DD, within the trip dates" },
        title: { type: "string", maxLength: 180 },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              title: { type: "string", maxLength: 180 },
              time: { type: "string", description: "HH:MM 24h" },
              location: { type: "string", maxLength: 200 },
              notes: { type: "string", maxLength: 4000 },
              type: {
                type: "string",
                enum: ["transit", "food", "activity", "stay", "note"],
              },
            },
            required: ["title"],
            additionalProperties: false,
          },
        },
      },
      required: ["date", "items"],
      additionalProperties: false,
    },
  },
  {
    name: "itinerary.update",
    description:
      "Edit one existing itinerary item's date, times, title, type, location, notes or done state. WRITES DATA. Use this to move an activity, fix its time or mark it done. The itemId and tripId must come from an earlier tool result or from the user; never invent them.",
    parameters: {
      type: "object",
      properties: {
        tripId: { type: "string", description: "Trip UUID that owns the item." },
        itemId: { type: "string", description: "Itinerary item UUID." },
        date: { type: "string", description: "YYYY-MM-DD, within the trip dates" },
        startTime: { type: "string", description: "HH:MM 24h, or null to clear" },
        endTime: { type: "string", description: "HH:MM 24h, or null to clear" },
        title: { type: "string", maxLength: 180 },
        type: {
          type: "string",
          enum: ["transit", "food", "activity", "stay", "note"],
        },
        location: { type: "string", maxLength: 200 },
        notes: { type: "string", maxLength: 4000 },
        done: { type: "boolean" },
      },
      required: ["tripId", "itemId"],
      additionalProperties: false,
    },
  },
  {
    name: "itinerary.delete",
    description:
      "Delete one itinerary item. WRITES DATA. Destructive: call only when the user explicitly asks to remove that item. The itemId must come from an earlier tool result or from the user.",
    parameters: {
      type: "object",
      properties: { itemId: { type: "string", description: "Itinerary item UUID." } },
      required: ["itemId"],
      additionalProperties: false,
    },
  },
  {
    name: "packing.add",
    description:
      "Add one packing item to a trip. WRITES DATA. Use the existing categories; do not invent new ones. Omit tripId when this same plan creates the trip.",
    parameters: {
      type: "object",
      properties: {
        tripId: {
          type: "string",
          description:
            "Trip UUID. Omit only when an earlier trips.create in this same plan supplies it.",
        },
        name: { type: "string", maxLength: 160 },
        category: {
          type: "string",
          enum: ["documents", "clothing", "gear", "health", "other"],
        },
        quantity: { type: "integer", minimum: 1, maximum: 999 },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "packing.update",
    description:
      "Edit one packing item's name, category, quantity or packed state. WRITES DATA. Use this to correct an item or tick it off; use packing.reorder to change its position. The itemId and tripId must come from an earlier tool result or from the user.",
    parameters: {
      type: "object",
      properties: {
        tripId: { type: "string", description: "Trip UUID that owns the item." },
        itemId: { type: "string", description: "Packing item UUID." },
        name: { type: "string", maxLength: 160 },
        category: {
          type: "string",
          enum: ["documents", "clothing", "gear", "health", "other"],
        },
        quantity: { type: "integer", minimum: 1, maximum: 999 },
        packed: { type: "boolean" },
      },
      required: ["tripId", "itemId"],
      additionalProperties: false,
    },
  },
  {
    name: "packing.delete",
    description:
      "Delete one packing item. WRITES DATA. Destructive: call only when the user explicitly asks to remove that item. The itemId must come from an earlier tool result or from the user.",
    parameters: {
      type: "object",
      properties: { itemId: { type: "string", description: "Packing item UUID." } },
      required: ["itemId"],
      additionalProperties: false,
    },
  },
  {
    name: "packing.reorder",
    description:
      "Reorder the packing list of a trip. WRITES DATA. Send every packing item you were given in the desired order, each with its zero-based order value.",
    parameters: {
      type: "object",
      properties: {
        tripId: { type: "string", description: "Trip UUID." },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 500,
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Packing item UUID" },
              order: { type: "integer", minimum: 0 },
            },
            required: ["id", "order"],
            additionalProperties: false,
          },
        },
      },
      required: ["tripId", "items"],
      additionalProperties: false,
    },
  },
  {
    name: "budget.setSummary",
    description:
      "Set the trip budget total. WRITES DATA. Amounts are integer minor units of the currency. Omit tripId when this same plan creates the trip.",
    parameters: {
      type: "object",
      properties: {
        tripId: {
          type: "string",
          description:
            "Trip UUID. Omit only when an earlier trips.create in this same plan supplies it.",
        },
        amountMinor: { type: "integer", minimum: 0 },
        currency: { type: "string", description: "ISO 4217 uppercase" },
      },
      required: ["amountMinor", "currency"],
      additionalProperties: false,
    },
  },
  {
    name: "expenses.add",
    description:
      "Record an expense on a trip and split it among workspace members. WRITES DATA. Amounts are integer minor units. paidByMemberId and every participant memberId must be active Workspace members. Use the same currency the user names; for an equal split send splitMode=equal and only memberId values. Omit tripId when this same plan creates the trip.",
    parameters: {
      type: "object",
      properties: {
        tripId: { type: "string", description: "Trip UUID, or omit when trips.create precedes this call." },
        date: { type: "string", description: "YYYY-MM-DD, within the trip dates" },
        category: {
          type: "string",
          enum: ["transport", "stay", "food", "activity", "shopping", "other"],
        },
        note: { type: "string", maxLength: 1000, description: "What the expense was for." },
        amountMinor: { type: "integer", minimum: 0 },
        currency: { type: "string", description: "ISO 4217 uppercase, for example CNY" },
        paidByMemberId: { type: "string", description: "Workspace member id of the payer." },
        splitMode: { type: "string", enum: ["equal", "custom"] },
        receiptMediaId: { type: "string", description: "Optional receipt media UUID." },
        participants: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              memberId: { type: "string", description: "Workspace member id." },
              shareAmountMinor: { type: "integer", minimum: 0 },
            },
            required: ["memberId"],
            additionalProperties: false,
          },
        },
      },
      required: [
        "date",
        "category",
        "amountMinor",
        "currency",
        "paidByMemberId",
        "splitMode",
        "participants",
      ],
      additionalProperties: false,
    },
  },
  {
    name: "expenses.update",
    description:
      "Edit an existing expense's date, category, note, amount, currency, payer or split. WRITES DATA. When participants change, amountMinor, paidByMemberId and splitMode must also be sent together. The expenseId and tripId must come from an earlier tool result or from the user.",
    parameters: {
      type: "object",
      properties: {
        tripId: { type: "string", description: "Trip UUID that owns the expense." },
        expenseId: { type: "string", description: "Expense UUID." },
        date: { type: "string", description: "YYYY-MM-DD" },
        category: {
          type: "string",
          enum: ["transport", "stay", "food", "activity", "shopping", "other"],
        },
        note: { type: "string", maxLength: 1000 },
        amountMinor: { type: "integer", minimum: 0 },
        currency: { type: "string", description: "ISO 4217 uppercase" },
        paidByMemberId: { type: "string", description: "Workspace member id of the payer." },
        splitMode: { type: "string", enum: ["equal", "custom"] },
        receiptMediaId: { type: "string", description: "Optional receipt media UUID, or null" },
        participants: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              memberId: { type: "string", description: "Workspace member id." },
              shareAmountMinor: { type: "integer", minimum: 0 },
            },
            required: ["memberId"],
            additionalProperties: false,
          },
        },
      },
      required: ["tripId", "expenseId"],
      additionalProperties: false,
    },
  },
  {
    name: "expenses.delete",
    description:
      "Delete one expense. WRITES DATA. Destructive: call only when the user explicitly asks to remove that expense. The expenseId must come from an earlier tool result or from the user.",
    parameters: {
      type: "object",
      properties: { expenseId: { type: "string", description: "Expense UUID." } },
      required: ["expenseId"],
      additionalProperties: false,
    },
  },
  {
    name: "entries.create",
    description:
      "Write a new journal entry on a trip. WRITES DATA. content is plain text; the server converts it to the editor's document format. Use this when the user dictates a memory, daily recap or note to save. Omit tripId when this same plan creates the trip.",
    parameters: {
      type: "object",
      properties: {
        tripId: { type: "string", description: "Trip UUID, or omit when trips.create precedes this call." },
        title: { type: "string", maxLength: 180 },
        date: { type: "string", description: "YYYY-MM-DD; defaults to today" },
        location: { type: "string", maxLength: 160, description: "Where the entry happened." },
        content: { type: "string", maxLength: 20000, description: "Plain-text journal body." },
        mood: {
          type: "string",
          enum: ["calm", "happy", "awe", "tired", "reflective", "excited"],
        },
        weather: { type: "string", enum: ["sunny", "cloudy", "rain", "snow", "wind", "fog"] },
        tags: { type: "array", items: { type: "string" }, maxItems: 20 },
        favorite: { type: "boolean" },
      },
      required: ["title", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "entries.update",
    description:
      "Edit an existing journal entry's title, date, location, text, mood, weather, tags or favorite state. WRITES DATA. Use this to fix or extend what the user already wrote. The entryId must come from an earlier entries.create result or from the user.",
    parameters: {
      type: "object",
      properties: {
        entryId: { type: "string", description: "Journal entry UUID." },
        title: { type: "string", maxLength: 180 },
        date: { type: "string", description: "YYYY-MM-DD" },
        location: { type: "string", maxLength: 160 },
        content: { type: "string", maxLength: 20000, description: "Replacement plain-text body." },
        mood: {
          type: "string",
          enum: ["calm", "happy", "awe", "tired", "reflective", "excited"],
        },
        weather: { type: "string", enum: ["sunny", "cloudy", "rain", "snow", "wind", "fog"] },
        tags: { type: "array", items: { type: "string" }, maxItems: 20 },
        favorite: { type: "boolean" },
      },
      required: ["entryId"],
      additionalProperties: false,
    },
  },
  {
    name: "participants.add",
    description:
      "Add an existing Workspace member to a trip as a participant. WRITES DATA. memberId is the Workspace member's user id. Only the trip creator or a Workspace owner/admin may do this. Omit tripId when this same plan creates the trip.",
    parameters: {
      type: "object",
      properties: {
        tripId: { type: "string", description: "Trip UUID, or omit when trips.create precedes this call." },
        memberId: { type: "string", description: "Workspace member user id to add." },
      },
      required: ["memberId"],
      additionalProperties: false,
    },
  },
  {
    name: "participants.remove",
    description:
      "Remove a participant from a trip. WRITES DATA. Destructive: call only when the user explicitly asks to remove that person. memberId is the participant's user id; the trip owner may not remove themselves through this tool.",
    parameters: {
      type: "object",
      properties: {
        tripId: { type: "string", description: "Trip UUID." },
        memberId: { type: "string", description: "Participant user id to remove." },
      },
      required: ["tripId", "memberId"],
      additionalProperties: false,
    },
  },
  {
    name: "participants.role",
    description:
      "Change a trip participant's role between viewer and editor. WRITES DATA. Only the trip creator or a Workspace owner/admin may do this. Use participants.add first if the person is not yet a participant.",
    parameters: {
      type: "object",
      properties: {
        tripId: { type: "string", description: "Trip UUID." },
        memberId: { type: "string", description: "Participant user id." },
        role: { type: "string", enum: ["viewer", "editor"] },
      },
      required: ["tripId", "memberId", "role"],
      additionalProperties: false,
    },
  },
  {
    name: "artifacts.create",
    description:
      "Create a travel document artifact (text, code, or sheet) from the user's request. WRITES DATA and opens the artifact panel after confirmation.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", maxLength: 160 },
        kind: { type: "string", enum: ["text", "code", "sheet"] },
        brief: { type: "string", maxLength: 4000 },
      },
      required: ["title", "kind"],
      additionalProperties: false,
    },
  },
  {
    name: "artifacts.update",
    description:
      "Rewrite an existing travel document artifact from a natural-language instruction. WRITES DATA.",
    parameters: {
      type: "object",
      properties: {
        artifactId: { type: "string", description: "Artifact UUID." },
        description: { type: "string", maxLength: 4000 },
      },
      required: ["artifactId", "description"],
      additionalProperties: false,
    },
  },
  {
    name: "artifacts.edit",
    description:
      "Apply an exact string replacement to an existing artifact. WRITES DATA. oldString must already exist.",
    parameters: {
      type: "object",
      properties: {
        artifactId: { type: "string", description: "Artifact UUID." },
        oldString: { type: "string", maxLength: 2000 },
        newString: { type: "string", maxLength: 2000 },
        replaceAll: { type: "boolean" },
      },
      required: ["artifactId", "oldString", "newString"],
      additionalProperties: false,
    },
  },
  {
    name: "artifacts.suggest",
    description:
      "Generate up to five concrete edit suggestions for an existing artifact. Read-only, no side effects.",
    parameters: {
      type: "object",
      properties: { artifactId: { type: "string", description: "Artifact UUID." } },
      required: ["artifactId"],
      additionalProperties: false,
    },
  },
];

function invalid(message: string): AiToolOutcome {
  return { ok: false, payload: { error: "INVALID_ARGUMENTS" }, error: { code: "INVALID_ARGUMENTS", message } };
}

function serviceUnavailable(name: string): AiToolOutcome {
  return {
    ok: false,
    payload: { error: "AI_TOOL_SERVICE_UNAVAILABLE" },
    error: {
      code: "AI_TOOL_SERVICE_UNAVAILABLE",
      message: `The ${name} service is unavailable.`,
    },
  };
}

function issueMessage(error: z.ZodError): string {
  const first = error.issues[0];
  const path = first?.path.map(String).join(".") || "args";
  return `${path}: ${first?.message ?? "invalid arguments"}`.slice(0, 300);
}

/** The write tools that act on exactly one existing trip via `args.tripId`. */
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

/**
 * A stored Trip id is always a UUIDv7 (`UuidV7Schema`), so anything else — a
 * missing field, `new`, `{{tripId}}`, a v4-shaped invention — cannot name an
 * existing trip and is treated as a placeholder rather than a target.
 */
const TRIP_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isTripIdPlaceholder(value: unknown): boolean {
  if (typeof value !== "string") {
    return true;
  }
  const candidate = value.trim();
  return candidate.length === 0 || !TRIP_ID_PATTERN.test(candidate);
}

function tripTargetError(code: string, message: string): AiToolOutcome {
  return { ok: false, payload: { error: code }, error: { code, message: message.slice(0, 300) } };
}

/** Upper bound on the `subjects` map sent with a plan (ids referenced, not rows). */
const MAX_PLAN_SUBJECTS = 80;
/** Subject lookups probe at most this many distinct trips, never a workspace scan. */
const MAX_SUBJECT_TRIPS = 3;

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function recordList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Problem code for a lookup failure, for the debug log only (never the response). */
function lookupErrorCode(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === "object" && response !== null) {
      const code = (response as Record<string, unknown>).code;
      if (typeof code === "string") return code.slice(0, 60);
    }
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code.slice(0, 60);
  }
  return "AI_TOOL_FAILED";
}

type TripTargetResolution =
  | { readonly kind: "ok"; readonly call: AiToolCall }
  | { readonly kind: "error"; readonly outcome: AiToolOutcome };

/**
 * Fills a trip-scoped write's `tripId` from the batch, or fails loudly.
 *
 * Only a missing/placeholder id is ever replaced: a well-formed UUID is the
 * caller's explicit target and still goes through the normal visibility and
 * role checks, so a 404/403 is reported instead of being silently redirected.
 * When the batch created exactly one trip, every placeholder resolves to it;
 * zero or two-plus creations cannot be resolved unambiguously and produce a
 * readable per-call failure instead of a guess.
 */
function resolveTripTarget(call: AiToolCall, context: AiToolContext): TripTargetResolution {
  if (!TRIP_SCOPED_WRITE_TOOLS.has(call.tool)) {
    return { kind: "ok", call };
  }
  if (!isTripIdPlaceholder(call.args.tripId)) {
    return { kind: "ok", call };
  }

  const created = context.createdTripIds ?? [];
  const [only] = created;
  if (created.length === 1 && only) {
    return { kind: "ok", call: { tool: call.tool, args: { ...call.args, tripId: only } } };
  }
  if (created.length === 0) {
    return {
      kind: "error",
      outcome: tripTargetError(
        "TRIP_ID_UNRESOLVED",
        `${call.tool} needs a tripId, and no trips.create succeeded before it in this plan. Create the trip first in the same plan, or name an existing trip id.`,
      ),
    };
  }
  return {
    kind: "error",
    outcome: tripTargetError(
      "TRIP_ID_AMBIGUOUS",
      `${call.tool} needs an explicit tripId: this plan created ${created.length} trips, so the server will not guess which one it means.`,
    ),
  };
}

/**
 * Executes one tool call **as the calling user**.
 *
 * Every write delegates to the existing Nest services, so workspace membership,
 * role checks, trip visibility, date bounds and version conflicts are all the
 * real product rules — the AI has no privileged path and never touches Prisma.
 */
@Injectable()
export class AiToolbox {
  constructor(
    @Inject(PlacesService) private readonly places: PlacesService,
    @Inject(TripsService) private readonly trips: TripsService,
    @Inject(StopsService) private readonly stops: StopsService,
    @Inject(ItineraryService) private readonly itinerary: ItineraryService,
    @Inject(PackingService) private readonly packing: PackingService,
    // Optional so the existing hand-built specs keep compiling. `AiModule`
    // imports both modules in production, so DI always supplies them there.
    @Optional() @Inject(ExpensesService) private readonly expenses?: ExpensesService,
    @Optional() @Inject(EntriesService) private readonly entries?: EntriesService,
    @Optional() @Inject(AiArtifactService)
    private readonly artifactService?: AiArtifactService,
  ) {}

  definitions(): AiToolSpec[] {
    return [...AI_TOOL_SPECS];
  }

  isReadOnly(name: AiToolName): boolean {
    return isReadOnlyAiTool(name);
  }

  /**
   * Validates a call **without executing it**, so the planning phase can reject
   * an unusable write (bad arguments, or a place id never resolved in this run)
   * before it ever reaches `plannedCalls`.
   */
  preview(call: AiToolCall, context: AiToolContext): AiToolError | null {
    const schema = ArgsSchemas[call.tool];
    if (!schema) {
      return { code: "UNKNOWN_TOOL", message: `Unknown tool ${call.tool}.` };
    }
    const parsed = schema.safeParse(call.args);
    if (!parsed.success) {
      return { code: "INVALID_ARGUMENTS", message: issueMessage(parsed.error) };
    }
    if (call.tool === "stops.add") {
      const { providerPlaceId } = parsed.data as { providerPlaceId: string };
      if (!context.candidates.has(providerPlaceId)) {
        return {
          code: "UNRESOLVED_PLACE",
          message: "providerPlaceId was not returned by places.search in this run.",
        };
      }
    }
    return null;
  }

  /**
   * Remembers human-readable names a read-only tool already returned, so a
   * later write call can be named instead of shown by id.
   *
   * Additive and non-fatal: an unexpected payload is ignored. `places.search`
   * names are keyed by `providerPlaceId` (that is what `stops.add` carries),
   * `stops.list` by `stopId`, `trips.get`/`trips.list` by `tripId`.
   */
  rememberLabels(call: AiToolCall, payload: unknown, into: Map<string, string>): void {
    const body = recordValue(payload);
    if (!body) return;
    const remember = (id: unknown, label: unknown): void => {
      const key = textValue(id);
      const value = textValue(label);
      if (key && value && !into.has(key)) into.set(key, value.slice(0, 160));
    };

    switch (call.tool) {
      case "places.search":
        for (const candidate of recordList(body.candidates)) {
          remember(candidate.providerPlaceId, candidate.name);
        }
        break;
      case "stops.list":
        for (const stop of recordList(body.stops)) remember(stop.stopId, stop.city);
        break;
      case "trips.get":
        remember(body.tripId, body.title);
        break;
      case "trips.list":
        for (const trip of recordList(body.trips)) remember(trip.tripId, trip.title);
        break;
      default:
        break;
    }
  }

  /**
   * Builds the optional `plan.subjects` map (`id → { label }`) for the ids the
   * plan's calls reference.
   *
   * Sources, in order: names the planner already read (`rememberLabels`),
   * permission-checked single lookups (`entries.get`), and one listing per real
   * trip id for stops / itinerary / packing / expenses when a call carries only
   * an item id. Participants are not resolved because the trip participant
   * projection only exposes `userId` (no display name) — those ids stay
   * nameless and the UI falls back to its generic copy.
   *
   * A failed lookup is reported through `onLookupError` and never fails the
   * plan; a plan with no resolvable names returns an empty map.
   */
  async planSubjects(
    calls: readonly AiToolCall[],
    context: AiToolContext,
    seen: ReadonlyMap<string, string>,
    onLookupError?: (message: string) => void,
  ): Promise<AiPlanSubjects> {
    const names = new Map(seen);
    const referenced = new Set<string>();
    const trips = new Set<string>();
    const stopTargets = new Set<string>();
    const itemTargets = new Set<string>();
    const expenseTargets = new Set<string>();
    const entryTargets = new Set<string>();

    const track = (id: unknown, bucket?: Set<string>): void => {
      const value = textValue(id);
      if (!value) return;
      referenced.add(value);
      if (bucket && !names.has(value)) bucket.add(value);
    };

    for (const call of calls) {
      const args = recordValue(call.args) ?? {};
      const tripId = textValue(args.tripId);
      if (tripId && !isTripIdPlaceholder(tripId)) {
        trips.add(tripId);
        // `trips.update` is shown by the trip's current title (From column).
        referenced.add(tripId);
      }
      switch (call.tool) {
        case "stops.add":
          track(args.providerPlaceId);
          break;
        case "stops.update":
        case "stops.delete":
          track(args.stopId, stopTargets);
          break;
        case "itinerary.update":
        case "itinerary.delete":
        case "packing.update":
        case "packing.delete":
          track(args.itemId, itemTargets);
          break;
        case "expenses.update":
        case "expenses.delete":
          track(args.expenseId, expenseTargets);
          break;
        case "entries.update":
          track(args.entryId, entryTargets);
          break;
        case "participants.add":
        case "participants.remove":
        case "participants.role":
          track(args.memberId);
          break;
        default:
          break;
      }
    }

    const report = (scope: string, error: unknown): void => {
      onLookupError?.(`${scope}: ${lookupErrorCode(error)}`);
    };

    const entries = this.entries;
    if (entries) {
      for (const entryId of entryTargets) {
        try {
          const entry = await entries.get(context.actor, context.membership, entryId);
          names.set(entryId, entry.title.slice(0, 160));
        } catch (error) {
          report(`entries.get(${entryId})`, error);
        }
      }
    }

    const expensesService = this.expenses;

    for (const tripId of [...trips].slice(0, MAX_SUBJECT_TRIPS)) {
      if (!names.has(tripId)) {
        try {
          const trip = await this.trips.get(context.actor, context.membership, tripId);
          names.set(tripId, trip.title.slice(0, 160));
        } catch (error) {
          report(`trips.get(${tripId})`, error);
        }
      }

      if (stopTargets.size > 0) {
        try {
          const stops = await this.stops.list(context.actor, context.membership, tripId);
          for (const stop of stops) {
            if (!names.has(stop.id)) names.set(stop.id, stop.city.slice(0, 160));
            stopTargets.delete(stop.id);
          }
        } catch (error) {
          report(`stops.list(${tripId})`, error);
        }
      }

      if (itemTargets.size > 0) {
        try {
          const items = await this.itinerary.list(context.actor, context.membership, tripId);
          for (const item of items) {
            if (!names.has(item.id)) names.set(item.id, item.title.slice(0, 160));
            itemTargets.delete(item.id);
          }
          const packing = await this.packing.list(context.actor, context.membership, tripId, {
            limit: 100,
          });
          for (const item of packing.items) {
            if (!names.has(item.id)) names.set(item.id, item.name.slice(0, 160));
            itemTargets.delete(item.id);
          }
        } catch (error) {
          report(`items.list(${tripId})`, error);
        }
      }

      if (expenseTargets.size > 0 && expensesService) {
        try {
          const expenses = await expensesService.list(context.actor, context.membership, tripId, {
            limit: 100,
          });
          for (const expense of expenses.items) {
            const label = textValue(expense.note);
            if (label && !names.has(expense.id)) names.set(expense.id, label.slice(0, 160));
            expenseTargets.delete(expense.id);
          }
        } catch (error) {
          report(`expenses.list(${tripId})`, error);
        }
      }
    }

    const subjects: AiPlanSubjects = {};
    let count = 0;
    for (const id of referenced) {
      if (count >= MAX_PLAN_SUBJECTS) break;
      const label = names.get(id);
      if (!label) continue;
      subjects[id] = { label: label.slice(0, 160) };
      count += 1;
    }
    return subjects;
  }

  async execute(call: AiToolCall, context: AiToolContext): Promise<AiToolOutcome> {
    // A trip-scoped write may leave `tripId` to the batch: `trips.create` ran
    // earlier in this same execute loop and its id is the only new trip.
    const target = resolveTripTarget(call, context);
    if (target.kind === "error") {
      return target.outcome;
    }
    const effective = target.call;
    const schema = ArgsSchemas[effective.tool];
    if (!schema) {
      return {
        ok: false,
        payload: { error: "UNKNOWN_TOOL" },
        error: { code: "UNKNOWN_TOOL", message: `Unknown tool ${effective.tool}.` },
      };
    }
    const parsed = schema.safeParse(effective.args);
    if (!parsed.success) {
      return invalid(issueMessage(parsed.error));
    }

    switch (effective.tool) {
      case "places.search":
        return this.searchPlaces(parsed.data as { q: string; limit?: number }, context);
      case "trips.get":
        return this.getTrip((parsed.data as { tripId: string }).tripId, context);
      case "trips.list":
        return this.listTrips(parsed.data as { query?: string; limit?: number }, context);
      case "stops.list":
        return this.listStops((parsed.data as { tripId: string }).tripId, context);
      case "trips.create": {
        const outcome = await this.createTrip(parsed.data as Record<string, unknown>, context);
        // Remember the new trip so later calls in this batch can reference it.
        if (outcome.ok && outcome.entityId) {
          context.createdTripIds?.push(outcome.entityId);
        }
        return outcome;
      }
      case "trips.update":
        return this.updateTrip(parsed.data as Record<string, unknown>, context);
      case "stops.add":
        return this.addStop(parsed.data as Record<string, unknown>, context);
      case "stops.update":
        return this.updateStop(parsed.data as Record<string, unknown>, context);
      case "stops.delete":
        return this.deleteStop((parsed.data as { stopId: string }).stopId, context);
      case "stops.reorder":
        return this.reorderStops(parsed.data as Record<string, unknown>, context);
      case "itinerary.addDay":
        return this.addDay(parsed.data as Record<string, unknown>, context);
      case "itinerary.update":
        return this.updateItinerary(parsed.data as Record<string, unknown>, context);
      case "itinerary.delete":
        return this.deleteItinerary((parsed.data as { itemId: string }).itemId, context);
      case "packing.add":
        return this.addPacking(parsed.data as Record<string, unknown>, context);
      case "packing.update":
        return this.updatePacking(parsed.data as Record<string, unknown>, context);
      case "packing.delete":
        return this.deletePacking((parsed.data as { itemId: string }).itemId, context);
      case "packing.reorder":
        return this.reorderPacking(parsed.data as Record<string, unknown>, context);
      case "budget.setSummary":
        return this.setBudget(parsed.data as Record<string, unknown>, context);
      case "expenses.add":
        return this.addExpense(parsed.data as Record<string, unknown>, context);
      case "expenses.update":
        return this.updateExpense(parsed.data as Record<string, unknown>, context);
      case "expenses.delete":
        return this.deleteExpense((parsed.data as { expenseId: string }).expenseId, context);
      case "entries.create":
        return this.createEntry(parsed.data as Record<string, unknown>, context);
      case "entries.update":
        return this.updateEntry(parsed.data as Record<string, unknown>, context);
      case "participants.add":
        return this.addParticipant(parsed.data as Record<string, unknown>, context);
      case "participants.remove":
        return this.removeParticipant(parsed.data as Record<string, unknown>, context);
      case "participants.role":
        return this.updateParticipantRole(parsed.data as Record<string, unknown>, context);
      case "artifacts.create": {
        if (!this.artifactService) return serviceUnavailable("artifacts");
        const created = await this.artifactService.createGenerated(
          context.actor,
          context.membership,
          {
            ...(parsed.data as { title: string; kind: "text" | "code" | "sheet"; brief?: string }),
            ...(context.conversationId ? { conversationId: context.conversationId } : {}),
          },
        );
        return {
          ok: true,
          entityId: created.id,
          artifact: { id: created.id, title: created.title, kind: created.kind },
          payload: { artifactId: created.id, title: created.title, kind: created.kind },
        };
      }
      case "artifacts.update": {
        if (!this.artifactService) return serviceUnavailable("artifacts");
        const artifactArgs = parsed.data as { artifactId: string; description: string };
        const updated = await this.artifactService.updateGenerated(
          context.actor,
          context.membership,
          artifactArgs.artifactId,
          artifactArgs.description,
        );
        return {
          ok: true,
          entityId: updated.id,
          artifact: { id: updated.id, title: updated.title, kind: updated.kind },
          payload: { artifactId: updated.id, title: updated.title, kind: updated.kind },
        };
      }
      case "artifacts.edit": {
        if (!this.artifactService) return serviceUnavailable("artifacts");
        const artifactArgs = parsed.data as {
          artifactId: string;
          oldString: string;
          newString: string;
          replaceAll?: boolean;
        };
        const edited = await this.artifactService.editExact(
          context.actor,
          context.membership,
          artifactArgs.artifactId,
          {
            oldString: artifactArgs.oldString,
            newString: artifactArgs.newString,
            ...(artifactArgs.replaceAll === undefined
              ? {}
              : { replaceAll: artifactArgs.replaceAll }),
          },
        );
        return {
          ok: true,
          entityId: edited.id,
          artifact: { id: edited.id, title: edited.title, kind: edited.kind },
          payload: { artifactId: edited.id, title: edited.title, kind: edited.kind },
        };
      }
      case "artifacts.suggest": {
        if (!this.artifactService) return serviceUnavailable("artifacts");
        const artifactArgs = parsed.data as { artifactId: string };
        const result = await this.artifactService.generateSuggestions(
          context.actor,
          context.membership,
          artifactArgs.artifactId,
        );
        return {
          ok: true,
          entityId: artifactArgs.artifactId,
          artifact: undefined,
          payload: { artifactId: artifactArgs.artifactId, suggestions: result.suggestions },
        };
      }
    }
  }

  private async searchPlaces(
    args: { q: string; limit?: number },
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const response = await this.places.search({
      q: args.q,
      limit: Math.min(args.limit ?? 6, MAX_CANDIDATES),
    });
    const candidates = response.items
      .flatMap(toCandidate)
      .slice(0, MAX_CANDIDATES);
    for (const candidate of candidates) {
      context.candidates.set(candidate.providerPlaceId, candidate);
    }
    return {
      ok: true,
      payload: {
        candidates: candidates.map((candidate) => ({
          providerPlaceId: candidate.providerPlaceId,
          name: candidate.name,
          country: candidate.country,
          countryCode: candidate.countryCode,
          lat: candidate.lat,
          lng: candidate.lng,
          timeZone: candidate.timeZone,
        })),
      },
    };
  }

  private async getTrip(tripId: string, context: AiToolContext): Promise<AiToolOutcome> {
    const trip = await this.trips.get(context.actor, context.membership, tripId);
    return {
      ok: true,
      entityId: trip.id,
      payload: {
        tripId: trip.id,
        title: trip.title,
        summary: trip.summary,
        status: trip.status,
        startDate: trip.startDate,
        endDate: trip.endDate,
        budgetAmountMinor: trip.budgetAmountMinor,
        budgetCurrency: trip.budgetCurrency,
        tags: trip.tags,
        destinations: trip.destinations,
        visibility: trip.visibility,
        version: trip.version,
      },
    };
  }

  /**
   * Lists trips through the product's own read path.
   *
   * `TripsService.list` applies the `trip:read` role check, the workspace
   * scope and `tripVisibilityWhere`, so the model sees exactly what the trips
   * page shows this caller — private trips of other people and trips of other
   * workspaces never enter the payload. Only small discovery fields are
   * projected: the summary body is deliberately dropped to keep the planning
   * context small.
   */
  private async listTrips(
    args: { query?: string; limit?: number },
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const page = await this.trips.list(context.actor, context.membership, {
      limit: args.limit ?? 10,
      sort: "startDate:desc",
      ...(args.query === undefined ? {} : { q: args.query }),
    });
    return {
      ok: true,
      payload: {
        trips: page.items.map((trip) => ({
          tripId: trip.id,
          title: trip.title,
          startDate: trip.startDate,
          endDate: trip.endDate,
          ...(trip.destinations[0] ? { destination: trip.destinations[0] } : {}),
        })),
      },
    };
  }

  private async listStops(tripId: string, context: AiToolContext): Promise<AiToolOutcome> {
    const stops = await this.stops.list(context.actor, context.membership, tripId);
    return {
      ok: true,
      payload: {
        stops: stops.map((stop) => ({
          stopId: stop.id,
          city: stop.city,
          country: stop.country,
          startDate: stop.startDate,
          endDate: stop.endDate,
          providerPlaceId: stop.providerPlaceId,
        })),
      },
    };
  }

  private async createTrip(
    args: Record<string, unknown>,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const today = context.today ?? new Date().toISOString().slice(0, 10);
    const request = {
      title: args.title,
      status: "planning",
      startDate: (args.startDate as string | undefined) ?? today,
      endDate: (args.endDate as string | undefined) ?? (args.startDate as string | undefined) ?? today,
      visibility: (args.visibility as string | undefined) ?? "private",
      ...(args.summary === undefined ? {} : { summary: args.summary }),
      ...(args.budgetAmountMinor === undefined
        ? {}
        : {
            budgetAmountMinor: args.budgetAmountMinor,
            budgetCurrency: args.budgetCurrency ?? "CNY",
          }),
      ...(args.tags === undefined ? {} : { tags: args.tags }),
      ...(args.destinations === undefined ? {} : { destinations: args.destinations }),
    };
    const parsed = CreateTripRequestSchema.safeParse(request);
    if (!parsed.success) {
      return invalid(issueMessage(parsed.error));
    }
    const trip = await this.trips.create(context.actor, context.membership, parsed.data);
    return {
      ok: true,
      entityId: trip.id,
      payload: { tripId: trip.id, title: trip.title, startDate: trip.startDate, endDate: trip.endDate },
    };
  }

  /**
   * Edits an existing trip through the product's own update path.
   *
   * Only the whitelisted descriptive/lifecycle fields survive; `version` is
   * read here (never authored by the model) so `TripsService.update` still
   * performs its optimistic-lock check, its `trip:update` role check and its
   * visibility check. A refusal therefore comes back as the same error code the
   * HTTP route returns, not as a 500.
   */
  private async updateTrip(
    args: Record<string, unknown>,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const tripId = args.tripId as string;
    const current = await this.trips.get(context.actor, context.membership, tripId);
    const patch = {
      version: current.version,
      ...(args.title === undefined ? {} : { title: args.title }),
      ...(args.summary === undefined ? {} : { summary: args.summary }),
      ...(args.startDate === undefined ? {} : { startDate: args.startDate }),
      ...(args.endDate === undefined ? {} : { endDate: args.endDate }),
      ...(args.status === undefined ? {} : { status: args.status }),
      ...(args.favorite === undefined ? {} : { favorite: args.favorite }),
      ...(args.origin === undefined ? {} : { origin: args.origin }),
      ...(args.originLat === undefined ? {} : { originLat: args.originLat }),
      ...(args.originLng === undefined ? {} : { originLng: args.originLng }),
      ...(args.timeZone === undefined ? {} : { timeZone: args.timeZone }),
    };
    const trip = await this.trips.update(context.actor, context.membership, tripId, patch);
    return {
      ok: true,
      entityId: trip.id,
      payload: {
        tripId: trip.id,
        title: trip.title,
        summary: trip.summary,
        startDate: trip.startDate,
        endDate: trip.endDate,
        version: trip.version,
      },
    };
  }

  private async addStop(
    args: Record<string, unknown>,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const placeId = args.providerPlaceId as string;
    const candidate = context.candidates.get(placeId);
    if (!candidate) {
      // The model tried to reference a place it never resolved in this run.
      return {
        ok: false,
        payload: { error: "UNRESOLVED_PLACE" },
        error: {
          code: "UNRESOLVED_PLACE",
          message: "providerPlaceId was not returned by places.search in this run.",
        },
      };
    }

    const tripId = args.tripId as string;
    const trip = await this.trips.get(context.actor, context.membership, tripId);
    const startDate = (args.startDate as string | undefined) ?? trip.startDate;
    const endDate = (args.endDate as string | undefined) ?? startDate;

    const parsed = CreateStopRequestSchema.safeParse({
      city: candidate.name,
      country: candidate.country,
      countryCode: candidate.countryCode,
      lat: candidate.lat,
      lng: candidate.lng,
      provider: candidate.provider,
      providerPlaceId: candidate.providerPlaceId,
      timeZone: candidate.timeZone,
      address: storableStopAddress(candidate.address),
      bbox: candidate.bbox,
      startDate,
      endDate,
      ...(args.notes === undefined ? {} : { notes: args.notes }),
    });
    if (!parsed.success) {
      return invalid(issueMessage(parsed.error));
    }

    const stop = await this.stops.create(context.actor, context.membership, tripId, parsed.data);
    return {
      ok: true,
      entityId: stop.id,
      payload: { stopId: stop.id, city: stop.city, startDate: stop.startDate, endDate: stop.endDate },
    };
  }

  /**
   * Edits a stop through `StopsService.update`. The model never sends a version:
   * the current row is read through `stops.list` (the same visibility-checked
   * read the UI uses) and its version becomes the optimistic-lock token.
   */
  private async updateStop(
    args: Record<string, unknown>,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const tripId = args.tripId as string;
    const stopId = args.stopId as string;
    const stops = await this.stops.list(context.actor, context.membership, tripId);
    const current = stops.find((stop) => stop.id === stopId);
    if (!current) {
      return tripTargetError(
        "STOP_NOT_FOUND",
        "The requested stop was not found in that trip.",
      );
    }
    const patch = {
      version: current.version,
      ...(args.city === undefined ? {} : { city: args.city }),
      ...(args.country === undefined ? {} : { country: args.country }),
      ...(args.countryCode === undefined ? {} : { countryCode: args.countryCode }),
      ...(args.startDate === undefined ? {} : { startDate: args.startDate }),
      ...(args.endDate === undefined ? {} : { endDate: args.endDate }),
      ...(args.notes === undefined ? {} : { notes: args.notes }),
      ...(args.address === undefined ? {} : { address: args.address }),
    };
    const stop = await this.stops.update(context.actor, context.membership, stopId, patch);
    return {
      ok: true,
      entityId: stop.id,
      payload: {
        stopId: stop.id,
        city: stop.city,
        country: stop.country,
        startDate: stop.startDate,
        endDate: stop.endDate,
        version: stop.version,
      },
    };
  }

  private async deleteStop(stopId: string, context: AiToolContext): Promise<AiToolOutcome> {
    const result = await this.stops.remove(context.actor, context.membership, stopId);
    return { ok: true, entityId: stopId, payload: { stopId, message: result.message } };
  }

  private async reorderStops(
    args: Record<string, unknown>,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const tripId = args.tripId as string;
    const stops = await this.stops.reorder(context.actor, context.membership, tripId, {
      items: args.items,
    });
    return {
      ok: true,
      payload: {
        reorderedCount: stops.length,
        stops: stops.map((stop) => ({ stopId: stop.id, order: stop.order })),
      },
    };
  }

  private async addDay(
    args: Record<string, unknown>,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const tripId = args.tripId as string;
    const date = args.date as string;
    const items = (args.items as Array<Record<string, unknown>>) ?? [];
    const created: string[] = [];

    for (const item of items) {
      const parsed = CreateItineraryItemRequestSchema.safeParse({
        date,
        title: item.title,
        type: (item.type as string | undefined) ?? "activity",
        location: (item.location as string | undefined) ?? (args.title as string | undefined) ?? item.title,
        ...(item.time === undefined ? {} : { startTime: item.time }),
        ...(item.notes === undefined ? {} : { notes: item.notes }),
      });
      if (!parsed.success) {
        return invalid(issueMessage(parsed.error));
      }
      const record = await this.itinerary.create(
        context.actor,
        context.membership,
        tripId,
        parsed.data,
      );
      created.push(record.id);
    }

    return {
      ok: true,
      entityId: created[0] ?? null,
      payload: { createdCount: created.length, itemIds: created },
    };
  }

  private async updateItinerary(
    args: Record<string, unknown>,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const tripId = args.tripId as string;
    const itemId = args.itemId as string;
    const items = await this.itinerary.list(context.actor, context.membership, tripId);
    const current = items.find((item) => item.id === itemId);
    if (!current) {
      return tripTargetError(
        "ITINERARY_ITEM_NOT_FOUND",
        "The requested itinerary item was not found in that trip.",
      );
    }
    const patch = {
      version: current.version,
      ...(args.date === undefined ? {} : { date: args.date }),
      ...(args.startTime === undefined ? {} : { startTime: args.startTime }),
      ...(args.endTime === undefined ? {} : { endTime: args.endTime }),
      ...(args.title === undefined ? {} : { title: args.title }),
      ...(args.type === undefined ? {} : { type: args.type }),
      ...(args.location === undefined ? {} : { location: args.location }),
      ...(args.notes === undefined ? {} : { notes: args.notes }),
      ...(args.done === undefined ? {} : { done: args.done }),
    };
    const item = await this.itinerary.update(context.actor, context.membership, itemId, patch);
    return {
      ok: true,
      entityId: item.id,
      payload: {
        itemId: item.id,
        date: item.date,
        title: item.title,
        done: item.done,
        version: item.version,
      },
    };
  }

  private async deleteItinerary(itemId: string, context: AiToolContext): Promise<AiToolOutcome> {
    const result = await this.itinerary.remove(context.actor, context.membership, itemId);
    return { ok: true, entityId: itemId, payload: { itemId, message: result.message } };
  }

  private async addPacking(
    args: Record<string, unknown>,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const parsed = CreatePackingItemRequestSchema.safeParse({
      name: args.name,
      category: (args.category as string | undefined) ?? "other",
      ...(args.quantity === undefined ? {} : { quantity: args.quantity }),
    });
    if (!parsed.success) {
      return invalid(issueMessage(parsed.error));
    }
    // `tripId` is a path segment, not part of CreatePackingItemRequest.
    const item = await this.packing.create(
      context.actor,
      context.membership,
      args.tripId as string,
      parsed.data,
    );
    return { ok: true, entityId: item.id, payload: { packingItemId: item.id, name: item.name } };
  }

  private async updatePacking(
    args: Record<string, unknown>,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const tripId = args.tripId as string;
    const itemId = args.itemId as string;
    const current = await findPageItem(
      (cursor) =>
        this.packing.list(context.actor, context.membership, tripId, {
          limit: 100,
          sort: "order:asc",
          ...(cursor === undefined ? {} : { cursor }),
        }),
      itemId,
    );
    if (!current) {
      return tripTargetError(
        "PACKING_ITEM_NOT_FOUND",
        "The requested packing item was not found in that trip.",
      );
    }
    const patch = {
      version: current.version,
      ...(args.name === undefined ? {} : { name: args.name }),
      ...(args.category === undefined ? {} : { category: args.category }),
      ...(args.quantity === undefined ? {} : { quantity: args.quantity }),
      ...(args.packed === undefined ? {} : { packed: args.packed }),
    };
    const item = await this.packing.update(context.actor, context.membership, itemId, patch);
    return {
      ok: true,
      entityId: item.id,
      payload: {
        packingItemId: item.id,
        name: item.name,
        quantity: item.quantity,
        packed: item.packed,
        version: item.version,
      },
    };
  }

  private async deletePacking(itemId: string, context: AiToolContext): Promise<AiToolOutcome> {
    const result = await this.packing.remove(context.actor, context.membership, itemId);
    return { ok: true, entityId: itemId, payload: { packingItemId: itemId, message: result.message } };
  }

  private async reorderPacking(
    args: Record<string, unknown>,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const tripId = args.tripId as string;
    const items = await this.packing.reorder(context.actor, context.membership, tripId, {
      items: args.items,
    });
    return {
      ok: true,
      payload: {
        reorderedCount: items.length,
        items: items.map((item) => ({ packingItemId: item.id, order: item.order })),
      },
    };
  }

  private async setBudget(
    args: Record<string, unknown>,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const tripId = args.tripId as string;
    const current = await this.trips.get(context.actor, context.membership, tripId);
    const trip = await this.trips.update(context.actor, context.membership, tripId, {
      version: current.version,
      budgetAmountMinor: args.amountMinor,
      budgetCurrency: args.currency,
    });
    return {
      ok: true,
      entityId: trip.id,
      payload: {
        tripId: trip.id,
        budgetAmountMinor: trip.budgetAmountMinor,
        budgetCurrency: trip.budgetCurrency,
      },
    };
  }

  private requireExpenses(): ExpensesService {
    if (!this.expenses) {
      throw new Error("ExpensesService is not configured on the AI toolbox.");
    }
    return this.expenses;
  }

  private requireEntries(): EntriesService {
    if (!this.entries) {
      throw new Error("EntriesService is not configured on the AI toolbox.");
    }
    return this.entries;
  }

  private async addExpense(
    args: Record<string, unknown>,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const participants = (
      args.participants as Array<{ memberId: string; shareAmountMinor?: number }>
    ).map((participant) => ({
      userId: participant.memberId,
      ...(participant.shareAmountMinor === undefined
        ? {}
        : { shareAmountMinor: participant.shareAmountMinor }),
    }));
    const request = {
      date: args.date,
      category: args.category,
      note: (args.note as string | undefined) ?? "",
      amountMinor: args.amountMinor,
      currency: args.currency,
      paidById: args.paidByMemberId,
      splitMode: args.splitMode,
      participants,
      ...(args.receiptMediaId === undefined ? {} : { receiptMediaId: args.receiptMediaId }),
    };
    const expense = await this.requireExpenses().create(
      context.actor,
      context.membership,
      args.tripId as string,
      request,
    );
    return {
      ok: true,
      entityId: expense.id,
      payload: {
        expenseId: expense.id,
        amountMinor: expense.amountMinor,
        currency: expense.currency,
        splitMode: expense.splitMode,
      },
    };
  }

  private async updateExpense(
    args: Record<string, unknown>,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const tripId = args.tripId as string;
    const expenseId = args.expenseId as string;
    const current = await findPageItem(
      (cursor) =>
        this.requireExpenses().list(context.actor, context.membership, tripId, {
          limit: 100,
          sort: "date:desc",
          ...(cursor === undefined ? {} : { cursor }),
        }),
      expenseId,
    );
    if (!current) {
      return tripTargetError(
        "EXPENSE_NOT_FOUND",
        "The requested expense was not found in that trip.",
      );
    }
    const patch = {
      version: current.version,
      ...(args.date === undefined ? {} : { date: args.date }),
      ...(args.category === undefined ? {} : { category: args.category }),
      ...(args.note === undefined ? {} : { note: args.note }),
      ...(args.amountMinor === undefined ? {} : { amountMinor: args.amountMinor }),
      ...(args.currency === undefined ? {} : { currency: args.currency }),
      ...(args.paidByMemberId === undefined ? {} : { paidById: args.paidByMemberId }),
      ...(args.splitMode === undefined ? {} : { splitMode: args.splitMode }),
      ...(args.receiptMediaId === undefined ? {} : { receiptMediaId: args.receiptMediaId }),
      ...(args.participants === undefined
        ? {}
        : {
            participants: (
              args.participants as Array<{ memberId: string; shareAmountMinor?: number }>
            ).map((participant) => ({
              userId: participant.memberId,
              ...(participant.shareAmountMinor === undefined
                ? {}
                : { shareAmountMinor: participant.shareAmountMinor }),
            })),
          }),
    };
    const expense = await this.requireExpenses().update(
      context.actor,
      context.membership,
      expenseId,
      patch,
    );
    return {
      ok: true,
      entityId: expense.id,
      payload: {
        expenseId: expense.id,
        amountMinor: expense.amountMinor,
        currency: expense.currency,
        version: expense.version,
      },
    };
  }

  private async deleteExpense(
    expenseId: string,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const result = await this.requireExpenses().remove(
      context.actor,
      context.membership,
      expenseId,
    );
    return { ok: true, entityId: expenseId, payload: { expenseId, message: result.message } };
  }

  private async createEntry(
    args: Record<string, unknown>,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const date = (args.date as string | undefined) ?? context.today ??
      new Date().toISOString().slice(0, 10);
    const document = entryDocument(args.content as string);
    const request = {
      title: args.title,
      date,
      location: (args.location as string | undefined) ?? "未填写",
      contentJson: document.contentJson,
      contentHtml: document.contentHtml,
      ...(args.mood === undefined ? {} : { mood: args.mood }),
      ...(args.weather === undefined ? {} : { weather: args.weather }),
      ...(args.tags === undefined ? {} : { tags: args.tags }),
      ...(args.favorite === undefined ? {} : { favorite: args.favorite }),
    };
    const entry = await this.requireEntries().create(
      context.actor,
      context.membership,
      args.tripId as string,
      request,
    );
    return {
      ok: true,
      entityId: entry.id,
      payload: { entryId: entry.id, title: entry.title, date: entry.date },
    };
  }

  private async updateEntry(
    args: Record<string, unknown>,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const entryId = args.entryId as string;
    const current = await this.requireEntries().get(
      context.actor,
      context.membership,
      entryId,
    );
    const document =
      args.content === undefined ? undefined : entryDocument(args.content as string);
    const patch = {
      version: current.version,
      ...(args.title === undefined ? {} : { title: args.title }),
      ...(args.date === undefined ? {} : { date: args.date }),
      ...(args.location === undefined ? {} : { location: args.location }),
      ...(args.mood === undefined ? {} : { mood: args.mood }),
      ...(args.weather === undefined ? {} : { weather: args.weather }),
      ...(args.tags === undefined ? {} : { tags: args.tags }),
      ...(args.favorite === undefined ? {} : { favorite: args.favorite }),
      ...(document === undefined
        ? {}
        : {
            contentJson: document.contentJson,
            contentHtml: document.contentHtml,
            excerpt: entryExcerpt(args.content as string),
          }),
    };
    const entry = await this.requireEntries().update(
      context.actor,
      context.membership,
      entryId,
      patch,
    );
    return {
      ok: true,
      entityId: entry.id,
      payload: { entryId: entry.id, title: entry.title, date: entry.date, version: entry.version },
    };
  }

  private async addParticipant(
    args: Record<string, unknown>,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const participant = await this.trips.addParticipant(
      context.actor,
      context.membership,
      args.tripId as string,
      { userId: args.memberId },
    );
    return {
      ok: true,
      entityId: participant.id,
      payload: {
        participantId: participant.id,
        memberId: participant.userId,
        role: participant.role,
        status: participant.status,
      },
    };
  }

  private async removeParticipant(
    args: Record<string, unknown>,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const result = await this.trips.removeParticipant(
      context.actor,
      context.membership,
      args.tripId as string,
      args.memberId as string,
    );
    return {
      ok: true,
      payload: { tripId: args.tripId, memberId: args.memberId, message: result.message },
    };
  }

  private async updateParticipantRole(
    args: Record<string, unknown>,
    context: AiToolContext,
  ): Promise<AiToolOutcome> {
    const participant = await this.trips.updateParticipant(
      context.actor,
      context.membership,
      args.tripId as string,
      args.memberId as string,
      { role: args.role },
    );
    return {
      ok: true,
      entityId: participant.id,
      payload: {
        participantId: participant.id,
        memberId: participant.userId,
        role: participant.role,
        status: participant.status,
      },
    };
  }
}

function toCandidate(place: Place): AiPlaceCandidate[] {
  if (!place.providerPlaceId) {
    return [];
  }
  // Every search source (`geoapify` included) is storable since 0007, so the
  // candidate keeps the place's provider verbatim instead of dropping it.
  return [
    {
      providerPlaceId: place.providerPlaceId,
      provider: place.provider,
      name: place.name,
      country: place.country,
      countryCode: place.countryCode,
      lat: place.lat,
      lng: place.lng,
      timeZone: place.timeZone,
      address: place.address,
      bbox: place.bbox,
    },
  ];
}

/**
 * `Place.address` allows 500 characters, the `Stop.address` contract and column
 * 400. An over-long provider address is dropped rather than failing the whole
 * stop write: the stop still lands with coordinates and the other metadata.
 */
function storableStopAddress(address: string | null): string | null {
  return address !== null && address.length <= MAX_STOP_ADDRESS_LENGTH ? address : null;
}

interface CursorPageLike<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * Finds one item in a cursor-paginated product list without ever bypassing its
 * service. Update tools only receive an entity id, so the current `version`
 * (never supplied by the model) has to be read through the same visibility and
 * role checks the UI uses.
 */
async function findPageItem<T extends { id: string }>(
  load: (cursor: string | undefined) => Promise<CursorPageLike<T>>,
  id: string,
): Promise<T | undefined> {
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const result = await load(cursor);
    const found = result.items.find((item) => item.id === id);
    if (found) {
      return found;
    }
    if (!result.hasMore || result.nextCursor === null) {
      return undefined;
    }
    cursor = result.nextCursor;
  }
  return undefined;
}

/**
 * Converts the plain text the model writes into the editor's document shape
 * (`{ type: "doc", content: [...] }`) plus a sanitized-HTML body. This is an
 * adaptation layer: the HTTP contract only accepts `contentJson`/`contentHtml`,
 * while the model should not have to emit ProseMirror JSON.
 */
function entryDocument(text: string): {
  contentJson: Record<string, unknown>;
  contentHtml: string;
} {
  const paragraphs = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const body = paragraphs.length > 0 ? paragraphs : [text.trim()];
  return {
    contentJson: {
      type: "doc",
      content: body.map((paragraph) => ({
        type: "paragraph",
        content: [{ type: "text", text: paragraph }],
      })),
    },
    contentHtml: body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join(""),
  };
}

function entryExcerpt(text: string): string {
  return text.replace(/\s+/gu, " ").trim().slice(0, 600);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}
