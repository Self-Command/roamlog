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
 * The tool set: read (`places.search`, `trips.get`, `trips.list`, `stops.list`),
 * additive writes, and one field-whitelisted `trips.update`.
 *
 * `trips.list` is the discovery read: a user says "make the Kyoto 5-day trip 6
 * days" by name, not by UUID, so the model needs a workspace-scoped list to
 * turn that name into a `tripId` before `trips.update`/`stops.add` can act on
 * it. It reuses the product list query, so visibility and pagination are the
 * same rules the trips page uses.
 *
 * `trips.update` exists because "make my 5-day trip 6 days" is a real user
 * request that otherwise forces the model to `trips.create` a duplicate. The
 * tool only accepts descriptive fields (`title`/`summary`/`startDate`/
 * `endDate`), so it still cannot delete a trip, change its audience
 * (`visibility`), its sharing/privacy switches or any setting.
 */
export const AI_TOOL_NAMES = [
  "places.search",
  "trips.create",
  "trips.get",
  "trips.list",
  "trips.update",
  "stops.add",
  "stops.list",
  "itinerary.addDay",
  "packing.add",
  "budget.setSummary",
] as const;
export const AiToolNameSchema = z.enum(AI_TOOL_NAMES);
export type AiToolName = z.infer<typeof AiToolNameSchema>;

/** Tools the planner may execute while it is still collecting context. */
export const AI_READ_ONLY_TOOLS = [
  "places.search",
  "trips.get",
  "trips.list",
  "stops.list",
] as const;
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
    /**
     * Existing conversation. When omitted the server creates a new conversation
     * and reads no history; this is what keeps every pre-streaming client working
     * unchanged — none of the three new fields is required.
     */
    conversationId: UuidV7Schema.optional(),
    /**
     * assistant-ui message id of the user message, used for an idempotent append
     * (a retried request reuses the same row instead of duplicating it). 1..64.
     */
    clientMessageId: z.string().min(1).max(64).optional(),
    /**
     * assistant-ui `unstable_assistantMessageId` for this turn, so a reloaded
     * history can align the persisted assistant message with the local one. 1..64.
     */
    assistantMessageId: z.string().min(1).max(64).optional(),
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

/**
 * A non-fatal note about a call the server refused to queue. Additive to the
 * chat envelope: the wire shape stays valid for older clients because the whole
 * `warnings` array is optional, and a warning never changes `plannedCalls`.
 */
export const AiPlanWarningSchema = z
  .object({
    code: z.string().min(1).max(60),
    message: z.string().min(1).max(300),
    /** The tool (or argument) the warning is about, for example `trips.create`. */
    subject: z.string().min(1).max(80),
  })
  .strict();
export type AiPlanWarning = z.infer<typeof AiPlanWarningSchema>;

export const AiChatResponseSchema = z
  .object({
    runId: AiRunIdSchema,
    message: z.string().max(4000),
    /** Write calls the model proposed. Nothing has been written yet. */
    plannedCalls: z.array(AiToolCallSchema).max(20),
    /** Read-only calls the server actually executed while planning. */
    readOnlyTrace: z.array(AiToolCallSchema).max(40),
    /**
     * Calls the server dropped instead of queueing them (for example a past
     * date the model repeated after one retry). Absent when nothing was
     * rejected, so clients that only read `plannedCalls` keep working.
     */
    warnings: z.array(AiPlanWarningSchema).max(20).optional(),
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

/* -------------------------------------------------------------------------- */
/* Selection rewriting ("AI writing", in-place preview)                        */
/* -------------------------------------------------------------------------- */

/**
 * Rewriting a user's *selection* is the one AI surface that writes prose
 * directly into a journal entry, so the request is intentionally narrow:
 *
 * - the operation is a closed enum — there is no free-text `prompt`/`command`
 *   field to forward to the model, so a caller cannot smuggle instructions in;
 * - `text` is the selection the client will replace, and `selectionHash` is its
 *   SHA-256. The server re-hashes `text` and refuses a mismatch, and the client
 *   re-hashes the selection again before it writes anything back, which is what
 *   turns "the paragraph changed under the preview" into a visible error instead
 *   of a silent overwrite;
 * - the response echoes `selectionHash`, so a stale preview can never be applied
 *   to a different selection even if two requests are in flight.
 */
export const AI_REWRITE_INSTRUCTIONS = [
  "shorten",
  "expand",
  "polish",
  "tone_formal",
  "tone_casual",
  "fix_grammar",
] as const;
export const AiRewriteInstructionSchema = z.enum(AI_REWRITE_INSTRUCTIONS);
export type AiRewriteInstruction = z.infer<typeof AiRewriteInstructionSchema>;

/**
 * Domain ceiling for `text`. Longer selections are answered with
 * `422 AI_REWRITE_TEXT_TOO_LONG` (a business rule), not with a schema error:
 * the transport cap below only keeps a hostile body from reaching the model.
 */
export const AI_REWRITE_MAX_INPUT_CHARS = 6_000;
/** Absolute wire cap for `text` and for the returned `replacement`. */
export const AI_REWRITE_MAX_TEXT_CHARS = 20_000;

/** Lowercase hex SHA-256 of the exact selection string. */
export const AiSelectionHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .describe("Lowercase hex SHA-256 of the exact selected text.");

export const AI_REWRITE_LOCALES = ["zh", "en"] as const;
export const AiRewriteLocaleSchema = z.enum(AI_REWRITE_LOCALES);
export type AiRewriteLocale = z.infer<typeof AiRewriteLocaleSchema>;

export const AiRewriteRequestSchema = z
  .object({
    /** Context only: it never scopes the write, the workspace path already does. */
    tripId: UuidV7Schema.optional(),
    text: z.string().min(1).max(AI_REWRITE_MAX_TEXT_CHARS),
    instruction: AiRewriteInstructionSchema,
    selectionHash: AiSelectionHashSchema,
    locale: AiRewriteLocaleSchema.optional(),
  })
  .strict();
export type AiRewriteRequest = z.infer<typeof AiRewriteRequestSchema>;

export const AiRewriteResponseSchema = z
  .object({
    /** The rewritten selection; the client previews it and only then replaces. */
    replacement: z.string().min(1).max(AI_REWRITE_MAX_TEXT_CHARS),
    /** Echo of the request hash, so the client can detect a stale preview. */
    selectionHash: AiSelectionHashSchema,
    model: z.string().min(1).max(200),
    usage: AiUsageSchema,
  })
  .strict();
export type AiRewriteResponse = z.infer<typeof AiRewriteResponseSchema>;

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
  rewriteTextTooLong: "AI_REWRITE_TEXT_TOO_LONG",
  rewriteSelectionMismatch: "AI_SELECTION_HASH_MISMATCH",
  rewriteEmpty: "AI_REWRITE_EMPTY",
  /** Client disconnected or the upstream stream was aborted; stream-only. */
  aborted: "AI_ABORTED",
  /** Unclassified server failure while a stream is already open. */
  internal: "AI_INTERNAL",
  /** Another stream is active for the same conversation (HTTP 409 before flush). */
  conversationBusy: "AI_CONVERSATION_BUSY",
} as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[keyof typeof AI_ERROR_CODES];

/** Every AI problem code as a validator, derived from the single source above. */
export const AiErrorCodeSchema = z.enum(
  Object.values(AI_ERROR_CODES) as [AiErrorCode, ...AiErrorCode[]],
);

/* -------------------------------------------------------------------------- */
/* SSE stream event protocol v1 (frozen: append-only, names must never change) */
/* -------------------------------------------------------------------------- */

/**
 * Event names below are frozen once published. New events may only be appended
 * as a new discriminant; an existing `type` value must never be renamed.
 *
 * Frame protocol: `id: <n>`, `event: <type>`, `data: <single-line JSON>`, then a
 * blank line. `meta` is always first, `done` is exactly once and always last,
 * and `error` is always followed by `done` with `finishReason: "error"`.
 */
export const AiStreamEventTypeSchema = z.enum([
  "meta",
  "text.delta",
  "plan",
  "usage",
  "error",
  "done",
]);
export type AiStreamEventType = z.infer<typeof AiStreamEventTypeSchema>;

export const AiStreamFinishReasonSchema = z.enum([
  "stop",
  "tool-calls",
  "length",
  "aborted",
  "error",
]);
export type AiStreamFinishReason = z.infer<typeof AiStreamFinishReasonSchema>;

/** First event of every stream: binds the turn to conversation/message ids. */
export const AiStreamMetaEventSchema = z
  .object({
    type: z.literal("meta"),
    v: z.literal(1),
    conversationId: UuidV7Schema,
    userMessageId: z.string().min(1).max(128),
    assistantMessageId: z.string().min(1).max(128),
    provider: AiProviderSchema,
  })
  .strict();
export type AiStreamMetaEvent = z.infer<typeof AiStreamMetaEventSchema>;

/** One upstream text delta per event (small coalescing windows are allowed). */
export const AiStreamTextDeltaEventSchema = z
  .object({
    type: z.literal("text.delta"),
    delta: z.string(),
  })
  .strict();
export type AiStreamTextDeltaEvent = z.infer<typeof AiStreamTextDeltaEventSchema>;

/**
 * Tool-call plan, emitted once at the end of a planning round. The payload is
 * intentionally isomorphic to the existing `AiChatResponse` fields so the web
 * `plan-card` can consume it without a translation layer.
 */
export const AiStreamPlanEventSchema = z
  .object({
    type: z.literal("plan"),
    runId: AiRunIdSchema,
    message: z.string().max(4000),
    plannedCalls: z.array(AiToolCallSchema).max(20),
    readOnlyTrace: z.array(AiToolCallSchema).max(40),
    warnings: z.array(AiPlanWarningSchema).max(20).optional(),
    expiresAt: IsoTimestampSchema,
  })
  .strict();
export type AiStreamPlanEvent = z.infer<typeof AiStreamPlanEventSchema>;

/** Accumulated token usage, emitted once before `done` when the upstream reports it. */
export const AiStreamUsageEventSchema = z
  .object({
    type: z.literal("usage"),
    usage: AiUsageSchema,
  })
  .strict();
export type AiStreamUsageEvent = z.infer<typeof AiStreamUsageEventSchema>;

/**
 * In-stream failure. The `code` set reuses `AI_ERROR_CODES` and extends it with
 * `AI_ABORTED`, `AI_INTERNAL` and `AI_CONVERSATION_BUSY`; after this event the
 * server must still emit `done` with `finishReason: "error"`.
 */
export const AiStreamErrorEventSchema = z
  .object({
    type: z.literal("error"),
    code: AiErrorCodeSchema,
    message: z.string().min(1).max(1000),
    retryable: z.boolean(),
    runId: AiRunIdSchema.optional(),
  })
  .strict();
export type AiStreamErrorEvent = z.infer<typeof AiStreamErrorEventSchema>;

/** The only authoritative end of a stream; exactly once and always last. */
export const AiStreamDoneEventSchema = z
  .object({
    type: z.literal("done"),
    messageId: z.string().min(1).max(128),
    finishReason: AiStreamFinishReasonSchema,
    usage: AiUsageSchema.optional(),
  })
  .strict();
export type AiStreamDoneEvent = z.infer<typeof AiStreamDoneEventSchema>;

export const AiStreamEventSchema = z.discriminatedUnion("type", [
  AiStreamMetaEventSchema,
  AiStreamTextDeltaEventSchema,
  AiStreamPlanEventSchema,
  AiStreamUsageEventSchema,
  AiStreamErrorEventSchema,
  AiStreamDoneEventSchema,
]);
export type AiStreamEvent = z.infer<typeof AiStreamEventSchema>;

/* -------------------------------------------------------------------------- */
/* Conversation persistence REST DTOs                                          */
/* -------------------------------------------------------------------------- */

export const AiConversationStatusSchema = z.enum(["regular", "archived"]);
export type AiConversationStatus = z.infer<typeof AiConversationStatusSchema>;

/**
 * `placeholder` is the truncated first-message title, `model` a generated
 * summary and `manual` a user rename that background title generation must
 * never overwrite.
 */
export const AiConversationTitleSourceSchema = z.enum(["placeholder", "model", "manual"]);
export type AiConversationTitleSource = z.infer<typeof AiConversationTitleSourceSchema>;

export const AiConversationSchema = z
  .object({
    id: UuidV7Schema,
    workspaceId: UuidV7Schema,
    userId: UuidV7Schema,
    title: z.string().max(120).nullable(),
    titleSource: AiConversationTitleSourceSchema,
    status: AiConversationStatusSchema,
    lastMessageAt: IsoTimestampSchema.nullable(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();
export type AiConversation = z.infer<typeof AiConversationSchema>;

/** Cursor is `lastMessageAt` + `id` (base64); default page size is 30, max 100. */
export const AiConversationListQuerySchema = z.object({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type AiConversationListQuery = z.infer<typeof AiConversationListQuerySchema>;

export const AiConversationListResponseSchema = z
  .object({
    items: z.array(AiConversationSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type AiConversationListResponse = z.infer<typeof AiConversationListResponseSchema>;

export const CreateAiConversationRequestSchema = z
  .object({
    /** Optional initial title; the server derives a placeholder when omitted. */
    title: z.string().min(1).max(120).optional(),
  })
  .strict();
export type CreateAiConversationRequest = z.infer<typeof CreateAiConversationRequestSchema>;

/** Renaming is the only user-editable conversation field. */
export const UpdateAiConversationRequestSchema = z
  .object({
    title: z.string().min(1).max(120),
  })
  .strict();
export type UpdateAiConversationRequest = z.infer<typeof UpdateAiConversationRequestSchema>;

/**
 * A required-but-open JSON value: `content` must be present, but its shape is
 * deliberately not enumerated here. The server stores an assistant-ui
 * `ThreadMessageLike` JSONB payload (string or parts array), so the contract
 * layer validates only its presence, not its structure.
 */
const RequiredUnknownSchema = z.unknown().refine((value) => value !== undefined, {
  message: "Required.",
});

/** assistant-ui `ThreadMessageLike` equivalent for one persisted message. */
export const AiThreadMessageSchema = z
  .object({
    id: z.string().min(1).max(128),
    role: z.enum(["user", "assistant", "system"]),
    content: RequiredUnknownSchema,
    createdAt: IsoTimestampSchema,
    clientId: z.string().min(1).max(64).nullable(),
    status: z.unknown().optional(),
    metadata: z.unknown().optional(),
    attachments: z.unknown().optional(),
  })
  .strict();
export type AiThreadMessage = z.infer<typeof AiThreadMessageSchema>;

/** Alias for call sites that name the persisted conversation message DTO. */
export const AiConversationMessageSchema = AiThreadMessageSchema;
export type AiConversationMessage = AiThreadMessage;

/** Flat parent-linked replay: `{ parentId, message }[]` plus the current head. */
export const AiConversationMessagesResponseSchema = z
  .object({
    headId: z.string().min(1).max(128).nullable(),
    messages: z.array(
      z
        .object({
          parentId: z.string().min(1).max(128).nullable(),
          message: AiThreadMessageSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type AiConversationMessagesResponse = z.infer<typeof AiConversationMessagesResponseSchema>;

/** Idempotent append/update keyed by the assistant-ui message id (`clientId`). */
export const UpsertAiMessageRequestSchema = z
  .object({
    content: RequiredUnknownSchema,
    parentId: z.string().min(1).max(128).nullable().optional(),
    status: z.unknown().optional(),
  })
  .strict();
export type UpsertAiMessageRequest = z.infer<typeof UpsertAiMessageRequestSchema>;

export const DeleteAiMessagesRequestSchema = z
  .object({
    ids: z.array(z.string().min(1).max(128)).min(1).max(100),
  })
  .strict();
export type DeleteAiMessagesRequest = z.infer<typeof DeleteAiMessagesRequestSchema>;

export const AiConversationTitleResponseSchema = z
  .object({
    title: z.string().min(1).max(120),
  })
  .strict();
export type AiConversationTitleResponse = z.infer<typeof AiConversationTitleResponseSchema>;