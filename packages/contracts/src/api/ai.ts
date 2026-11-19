import { z } from "zod";

import { DateOnlySchema, IsoTimestampSchema, JsonObjectSchema, UuidV7Schema } from "../common/ids";
import { AmountMinorSchema, CurrencyCodeSchema } from "../common/money";

/**
 * AI planning contracts.
 *
 * The planner is an **agent loop with tools**, not a "generate a form draft"
 * endpoint: the model only ever proposes tool calls, the server executes the
 * read-only ones while planning and the write ones after an explicit user
 * confirmation. There is deliberately no draft/trip shape here — no lat/lng,
 * timezone, per-item price or visibility can be expressed by the model.
 */

export const AiProtocolSchema = z.enum([
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
]);
export type AiProtocol = z.infer<typeof AiProtocolSchema>;

/**
 * The first tool set: read (`places.search`, `trips.get`, `stops.list`) and
 * additive writes only. Deletes, role changes and settings are not exposed —
 * an agent must not be able to destroy or escalate.
 */
export const AI_TOOL_NAMES = [
  "places.search",
  "trips.create",
  "trips.get",
  "stops.add",
  "stops.list",
  "itinerary.addDay",
  "packing.add",
  "budget.setSummary",
] as const;
export const AiToolNameSchema = z.enum(AI_TOOL_NAMES);
export type AiToolName = z.infer<typeof AiToolNameSchema>;

/** Tools the planner may execute while it is still collecting context. */
export const AI_READ_ONLY_TOOLS = ["places.search", "trips.get", "stops.list"] as const;
const readOnlyTools = new Set<string>(AI_READ_ONLY_TOOLS);
export function isReadOnlyAiTool(tool: string): boolean {
  return readOnlyTools.has(tool);
}

export const AiToolCallSchema = z
  .object({
    tool: AiToolNameSchema,
    /**
     * Tool arguments are an open object on purpose: each tool validates its own
     * whitelisted arguments server-side and silently drops everything else, so
     * an unknown key can never become an instruction.
     */
    args: JsonObjectSchema,
  })
  .strict();
export type AiToolCall = z.infer<typeof AiToolCallSchema>;

export const AiPlanHintSchema = z
  .object({
    dates: z.object({ start: DateOnlySchema, end: DateOnlySchema }).strict().optional(),
    budgetMinor: AmountMinorSchema.optional(),
    currency: CurrencyCodeSchema.optional(),
    styles: z.array(z.string().min(1).max(40)).max(12).optional(),
    destinations: z.array(z.string().min(1).max(120)).max(10).optional(),
  })
  .strict();
export type AiPlanHint = z.infer<typeof AiPlanHintSchema>;

export const AiChatRequestSchema = z
  .object({
    message: z.string().min(1).max(2000),
    hints: AiPlanHintSchema.optional(),
  })
  .strict();
export type AiChatRequest = z.infer<typeof AiChatRequestSchema>;

/** Opaque, server-generated poll handle for a plan that has not been executed. */
export const AiRunIdSchema = z
  .string()
  .regex(/^[0-9a-f]{32}$/)
  .describe("Opaque plan-run identifier returned by POST .../ai/chat.");

export const AiUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
  })
  .strict();
export type AiUsage = z.infer<typeof AiUsageSchema>;

export const AiProviderSchema = z
  .object({
    protocol: AiProtocolSchema,
    model: z.string().min(1).max(200),
  })
  .strict();
export type AiProvider = z.infer<typeof AiProviderSchema>;

export const AiChatResponseSchema = z
  .object({
    runId: AiRunIdSchema,
    message: z.string().max(4000),
    /** Write calls the model proposed. Nothing has been written yet. */
    plannedCalls: z.array(AiToolCallSchema).max(20),
    /** Read-only calls the server actually executed while planning. */
    readOnlyTrace: z.array(AiToolCallSchema).max(40),
    usage: AiUsageSchema,
    provider: AiProviderSchema,
    expiresAt: IsoTimestampSchema,
  })
  .strict();
export type AiChatResponse = z.infer<typeof AiChatResponseSchema>;

export const AiRunExecuteRequestSchema = z
  .object({
    /** A subset of `plannedCalls`; the user may drop entries in the UI. */
    calls: z.array(AiToolCallSchema).min(1).max(20),
    idempotencyKey: z.string().min(8).max(120),
  })
  .strict();
export type AiRunExecuteRequest = z.infer<typeof AiRunExecuteRequestSchema>;

export const AiToolErrorSchema = z
  .object({
    code: z.string().min(1).max(60),
    message: z.string().min(1).max(300),
  })
  .strict();
export type AiToolError = z.infer<typeof AiToolErrorSchema>;

export const AiToolResultSchema = z
  .object({
    tool: AiToolNameSchema,
    ok: z.boolean(),
    entityId: UuidV7Schema.nullable().optional(),
    error: AiToolErrorSchema.nullable().optional(),
  })
  .strict();
export type AiToolResult = z.infer<typeof AiToolResultSchema>;

export const AiRunExecuteResponseSchema = z
  .object({
    results: z.array(AiToolResultSchema).max(20),
    /** True when at least one call failed and at least one succeeded. */
    partialFailure: z.boolean(),
    summary: z.string().max(1000),
  })
  .strict();
export type AiRunExecuteResponse = z.infer<typeof AiRunExecuteResponseSchema>;

/** Problem codes the AI endpoints may answer with (for client copy and tests). */
export const AI_ERROR_CODES = {
  notConfigured: "AI_NOT_CONFIGURED",
  invalidOutput: "AI_SCHEMA_INVALID",
  quota: "AI_QUOTA",
  loopLimit: "AI_LOOP_LIMIT",
  runNotFound: "AI_RUN_NOT_FOUND",
  runConsumed: "AI_RUN_CONSUMED",
  callNotPlanned: "AI_RUN_CALL_NOT_PLANNED",
  unresolvedPlace: "UNRESOLVED_PLACE",
  toolFailed: "AI_TOOL_FAILED",
  upstream: "AI_UPSTREAM",
} as const;