import { Inject, Injectable } from "@nestjs/common";
import {
  CreateItineraryItemRequestSchema,
  CreatePackingItemRequestSchema,
  CreateStopRequestSchema,
  CreateTripRequestSchema,
  isReadOnlyAiTool,
  type AiToolCall,
  type AiToolError,
  type AiToolName,
  type Place,
} from "@roamlog/contracts";
import { z } from "zod";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { ItineraryService } from "../itinerary/itinerary.service.js";
import { PackingService } from "../packing/packing.service.js";
import { PlacesService } from "../places/places.service.js";
import { StopsService } from "../trips/stops.service.js";
import { TripsService } from "../trips/trips.service.js";
import type { AiToolSpec } from "./adapters/adapter.js";

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
 * Argument whitelists. Deliberately **not** `.strict()`: unknown keys (including
 * an attempted `workspaceId`/`userId`) are stripped, never treated as input.
 */
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
   * Descriptive fields only. `visibility`, `showExactPhotoLocation`, `status`,
   * `favorite`, covers, grants and settings are absent on purpose: the model may
   * fix a mistyped title or extend a trip's dates, never change who can read it
   * or switch off a privacy control. `version` is also absent — the tool reads
   * the current row through the visibility-checked path and passes its version
   * as the optimistic-lock token.
   */
  "trips.update": z
    .object({
      tripId: tripRef,
      title: nonEmpty(160).optional(),
      summary: z.string().max(1000).optional(),
      startDate: dateOnly.optional(),
      endDate: dateOnly.optional(),
    })
    .refine(
      (value) =>
        [value.title, value.summary, value.startDate, value.endDate].some(
          (field) => field !== undefined,
        ),
      { message: "at least one of title/summary/startDate/endDate must change", path: ["title"] },
    ),
  "stops.add": z.object({
    tripId: tripRef,
    providerPlaceId: nonEmpty(200),
    startDate: dateOnly.optional(),
    endDate: dateOnly.optional(),
    notes: z.string().max(4000).optional(),
  }),
  "stops.list": z.object({ tripId: uuid }),
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
  "packing.add": z.object({
    tripId: tripRef,
    name: nonEmpty(160),
    category: z.enum(["documents", "clothing", "gear", "health", "other"]).optional(),
    quantity: z.number().int().min(1).max(999).optional(),
  }),
  "budget.setSummary": z.object({
    tripId: tripRef,
    amountMinor: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/u),
  }),
};

export const AI_TOOL_SPECS: readonly AiToolSpec[] = [
  {
    name: "places.search",
    description:
      "Search the place database and return candidates with providerPlaceId, country and coordinates. Read-only, no side effects. Always search before adding a stop.",
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
    name: "trips.update",
    description:
      "Change an EXISTING trip's title, summary, startDate or endDate (for example \"make it 6 days\" means a new endDate). WRITES DATA. Use this instead of creating a new trip when the user wants to extend, shorten, rename or re-summarise a trip. It cannot delete a trip, change who can see it, or touch settings.",
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
];

function invalid(message: string): AiToolOutcome {
  return { ok: false, payload: { error: "INVALID_ARGUMENTS" }, error: { code: "INVALID_ARGUMENTS", message } };
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
      case "itinerary.addDay":
        return this.addDay(parsed.data as Record<string, unknown>, context);
      case "packing.add":
        return this.addPacking(parsed.data as Record<string, unknown>, context);
      case "budget.setSummary":
        return this.setBudget(parsed.data as Record<string, unknown>, context);
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
   * Only the four descriptive fields survive the whitelist; `version` is read
   * here (never authored by the model) so `TripsService.update` still performs
   * its optimistic-lock check, its `trip:update` role check and its
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