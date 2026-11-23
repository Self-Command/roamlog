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

export const AiProtocolSchema = z.enum(["openai-chat", "openai-responses", "anthropic-messages"]);
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
 * tool accepts descriptive fields plus the lifecycle/location fields the trip
 * page itself exposes (`title`/`summary`/`status`/`startDate`/`endDate`/
 * `favorite`/`origin`/`originLat`/`originLng`/`timeZone`). It still cannot
 * delete a trip, change its audience (`visibility`), its sharing/privacy
 * switches or any setting.
 *
 * The edit tools (`stops.update`, `itinerary.update`, `packing.update`,
 * `expenses.update`, `entries.update`) and the destructive tools
 * (`*.delete`) exist because the product UI already supports those actions.
 * Each one delegates to the owning Nest service, so Workspace role checks,
 * trip visibility and optimistic versions are the same rules the HTTP routes
 * enforce.
 */
export const AI_TOOL_NAMES = [
  "places.search",
  "trips.create",
  "trips.get",
  "trips.list",
  "trips.update",
  "stops.add",
  "stops.list",
  "stops.update",
  "stops.delete",
  "stops.reorder",
  "itinerary.addDay",
  "itinerary.update",
  "itinerary.delete",
  "packing.add",
  "packing.update",
  "packing.delete",
  "packing.reorder",
  "budget.setSummary",
  "expenses.add",
  "expenses.update",
  "expenses.delete",
  "entries.create",
  "entries.update",
  "participants.add",
  "participants.remove",
  "participants.role",
  "artifacts.create",
  "artifacts.update",
  "artifacts.edit",
  "artifacts.suggest",
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

/** BCP-47 language tag used as a prompt fallback, never as a hard override. */
export const AiChatLocaleSchema = z
  .string()
  .max(35)
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
  .describe("BCP-47 language tag (max 35 characters).");
export type AiChatLocale = z.infer<typeof AiChatLocaleSchema>;

/* -------------------------------------------------------------------------- */
/* Attachments (Stage 2)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Upload limits and the accepted MIME whitelist for one chat attachment.
 *
 * Source: vercel/chatbot `lib/types.ts` L59–L63 (`Attachment = { name, url,
 * contentType }`, produced by `components/chat/multimodal-input.tsx` L270–L298
 * `uploadFile` → `POST /api/files/upload`) and its composer cap of one upload
 * queue per turn. Roamlog reuses its own media pipeline instead of Vercel Blob,
 * so the numeric limits are the media contract's (`MediaPresignRequestSchema`,
 * `packages/contracts/src/api/media.ts` L25–L35) and the MIME list is exactly
 * `apps/api/src/modules/media/media-rules.ts` `ALLOWED_IMAGE_MIME_TYPES`.
 * The task's own cap is ≤5 attachments / ≤20 MB each, which is stricter than
 * the 25 MB media ceiling and is therefore the binding limit here.
 */
export const AI_ATTACHMENT_MAX_COUNT = 5;
export const AI_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const AI_ATTACHMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
] as const;
export const AiAttachmentMimeTypeSchema = z.enum(AI_ATTACHMENT_MIME_TYPES);
export type AiAttachmentMimeType = z.infer<typeof AiAttachmentMimeTypeSchema>;

/**
 * One attachment reference for the current turn.
 *
 * The bytes never travel in this body: the client uploads through the existing
 * media presign→PUT→complete pipeline first and sends the resulting `mediaId`.
 * `kind` mirrors the user-facing distinction between an inline image and a file
 * chip; the media pipeline stores images only today, so `kind: "file"` is
 * accepted by the contract but cannot be produced until media accepts documents
 * (see the delivery report's "未做/阻塞").
 */
export const AiAttachmentSchema = z
  .object({
    mediaId: UuidV7Schema,
    kind: z.enum(["image", "file"]),
    name: z.string().min(1).max(200),
    mimeType: AiAttachmentMimeTypeSchema,
    sizeBytes: z.number().int().positive().max(AI_ATTACHMENT_MAX_BYTES),
  })
  .strict();
export type AiAttachment = z.infer<typeof AiAttachmentSchema>;

export const AiChatAttachmentsSchema = z
  .array(AiAttachmentSchema)
  .min(1)
  .max(AI_ATTACHMENT_MAX_COUNT);
export type AiChatAttachments = z.infer<typeof AiChatAttachmentsSchema>;

/* -------------------------------------------------------------------------- */
/* Model + reasoning effort (Stage 3)                                          */
/* -------------------------------------------------------------------------- */

/**
 * Reasoning-depth values.
 *
 * Taken verbatim from vercel/chatbot `lib/ai/models.ts` L23:
 * `reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high"`, passed to
 * the gateway as `openai: { reasoningEffort }` at
 * `app/(chat)/api/chat/route.ts` L301–L302. Nothing is invented here.
 */
export const AI_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high"] as const;
export const AiReasoningEffortSchema = z.enum(AI_REASONING_EFFORTS);
export type AiReasoningEffort = z.infer<typeof AiReasoningEffortSchema>;

/** A gateway model id, for example `openai/gpt-4o-mini`. 1..200 chars. */
export const AiChatModelIdSchema = z.string().min(1).max(200);
export type AiChatModelId = z.infer<typeof AiChatModelIdSchema>;

/**
 * One selectable model. Port of vercel/chatbot `lib/ai/models.ts` L17–L24
 * (`ChatModel`) plus the capability record of `app/(chat)/api/models/route.ts`
 * L8–L19, reduced to the fields Roamlog can actually know: the admin-configured
 * gateway model and the operator allow-list. `reasoning`/`vision`/`tools` are
 * declared by the operator, never guessed.
 */
export const AiChatModelSchema = z
  .object({
    id: AiChatModelIdSchema,
    name: z.string().min(1).max(80),
    description: z.string().max(200).optional(),
    provider: z.string().min(1).max(40),
    /** `true` when the operator allows `reasoningEffort` for this model. */
    reasoning: z.boolean(),
    /**
     * `true` only when the operator explicitly enabled image input for this
     * deployment (`AI_VISION_SUPPORTED`; default `false`).
     *
     * Never derived from the gateway catalog: `GET /v1/models` reports
     * `modalities.input: ["text","image"]` for routes that cannot read an image
     * (observed 2026-11-20: HTTP 200, empty content, "visual analysis skipped").
     * When `false`, attachments are still accepted and persisted with the
     * conversation, but the API sends no image part to the model.
     */
    vision: z.boolean(),
  })
  .strict();
export type AiChatModel = z.infer<typeof AiChatModelSchema>;

/** `GET .../ai/models`: the same shape the upstream model selector consumes. */
export const AiChatModelsResponseSchema = z
  .object({
    models: z.array(AiChatModelSchema).max(20),
    defaultModel: AiChatModelIdSchema,
    /** `true` when `reasoningEffort` is forwarded to the gateway. */
    reasoningSupported: z.boolean(),
  })
  .strict();
export type AiChatModelsResponse = z.infer<typeof AiChatModelsResponseSchema>;

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
    /**
     * UI locale (BCP-47, max 35). Only a fallback for the system prompt when the
     * user's latest message is too short or ambiguous to infer a language; it
     * never overrides a detectable message language.
     */
    locale: AiChatLocaleSchema.optional(),
    /**
     * Per-turn model override. **Whitelisted server-side**: the API rejects any
     * id that is not the admin-configured model or on the operator allow-list
     * (`AI_ALLOWED_MODELS`). Absent means the configured default.
     */
    model: AiChatModelIdSchema.optional(),
    /**
     * Per-turn reasoning depth. Forwarded verbatim to protocols that define the
     * parameter (`reasoning_effort` for OpenAI Chat Completions, `reasoning.effort`
     * for the Responses API); ignored for Anthropic Messages, which has no
     * equivalent field.
     */
    reasoningEffort: AiReasoningEffortSchema.optional(),
    /** Media already uploaded through the media presign→PUT→complete pipeline. */
    attachments: AiChatAttachmentsSchema.optional(),
  })
  .strict();
export type AiChatRequest = z.infer<typeof AiChatRequestSchema>;

/**
 * Opaque, server-generated poll handle for a plan that has not been executed.
 *
 * Two shapes are accepted on purpose; this is a pure widening, never a
 * narrowing:
 *  - `newRunId()` used to return 32 hyphenless hex digits, and those plans are
 *    still alive in Redis (`ai:run:*`, 15-minute TTL) and were already echoed to
 *    clients as `AiChatResponse.runId` / `AiStreamPlanEvent.runId`. They must
 *    keep confirming against `POST .../ai/runs/:runId/execute`;
 *  - the current UUIDv7 form (`generateUuidV7()`, 8-4-4-4-12), which is what
 *    `newRunId()` returns now and what survives a PostgreSQL `uuid` column
 *    (`AuditLog.targetId`) without changing its version/variant nibbles.
 *
 * Never drop the 32-hex branch: doing so would 400 every plan minted by a
 * process that has not restarted since the writer fix deployed.
 */
export const AiRunIdSchema = z
  .string()
  .regex(/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  .describe("Opaque plan-run identifier: legacy 32-hex digits or an RFC 4122 UUID (8-4-4-4-12).");

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

/**
 * One human-readable name for an entity id referenced by `plannedCalls`.
 *
 * Additive and optional: a `stops.delete` call only carries `stopId`, so
 * without this map the plan preview can only show an opaque id. The server
 * fills it best-effort from reads it already performed (place search,
 * `stops.list`, `trips.get`/`trips.list`) and from permission-checked lookups;
 * an id it cannot resolve is simply absent and the UI falls back to its generic
 * copy. Only a label ever crosses the wire — never an entity object.
 */
export const AiPlanSubjectSchema = z
  .object({
    label: z.string().min(1).max(160),
  })
  .strict();
export type AiPlanSubject = z.infer<typeof AiPlanSubjectSchema>;

/**
 * `id → subject`, keyed by the exact id a tool argument carries (a UUID, or a
 * provider place id for `stops.add`). The server caps the number of entries
 * before sending; the schema only guarantees a bounded key/label size.
 */
export const AiPlanSubjectsSchema = z.record(z.string().min(1).max(300), AiPlanSubjectSchema);
export type AiPlanSubjects = z.infer<typeof AiPlanSubjectsSchema>;

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
    /** Human labels for ids referenced by `plannedCalls`; absent when none resolved. */
    subjects: AiPlanSubjectsSchema.optional(),
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

/**
 * Artifact kinds supported by the AI artifact panel.
 *
 * Port of vercel/chatbot `components/chat/artifact.tsx:32-41` plus the
 * `artifacts/*` definitions. Upstream's create-document tool only creates
 * text/code/sheet; image artifacts are opened from an existing media id.
 */
export const AI_ARTIFACT_KINDS = ["text", "code", "sheet", "image"] as const;
export const AiArtifactKindSchema = z.enum(AI_ARTIFACT_KINDS);
export type AiArtifactKind = z.infer<typeof AiArtifactKindSchema>;

/** Small artifact reference returned by an AI tool result. */
export const AiArtifactReferenceSchema = z
  .object({
    id: UuidV7Schema,
    title: z.string().min(1).max(160),
    kind: AiArtifactKindSchema,
  })
  .strict();
export type AiArtifactReference = z.infer<typeof AiArtifactReferenceSchema>;

export const AiToolResultSchema = z
  .object({
    tool: AiToolNameSchema,
    ok: z.boolean(),
    entityId: UuidV7Schema.nullable().optional(),
    /** Present for `artifacts.*` so the client can open the panel. */
    artifact: AiArtifactReferenceSchema.optional(),
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
 * directly into a journal entry, so the request is intentionally narrow.
 *
 * The instruction set is no longer purely a closed set of verbs: it is Novel's
 * own option list, ported verbatim from its `/api/generate` route
 * (`apps/web/app/api/generate/route.ts:39-116` @
 * `fa95098e66476c466faebb8211baa5869c101a9c`), which includes `zap` — a
 * free-form instruction. That is why `command` exists:
 *
 * - `text` is the string whose SHA-256 travels in `selectionHash`. The server
 *   re-hashes `text` and refuses a mismatch, and the client re-hashes again
 *   before it writes anything back, which is what turns "the paragraph changed
 *   under the preview" into a visible error instead of a silent overwrite;
 * - `contextBefore` is Novel's `getPrevText`: the Markdown of the document
 *   *before* the selection. Only `continue` writes from it (Novel sends no
 *   selection for `continue`, see `ai-selector-commands.tsx:55-68`). The server
 *   truncates it — upstream never does;
 * - `command` is the single-line free-form instruction Novel's `zap` takes from
 *   its input box (`ai-selector.tsx:76-94`). It is refused for every other
 *   instruction, and it is always treated as untrusted data, never as rules;
 * - the response echoes `selectionHash`, so a stale preview can never be applied
 *   to a different selection even if two requests are in flight.
 */
export const AI_REWRITE_INSTRUCTIONS = [
  "continue",
  "improve",
  "shorter",
  "longer",
  "fix",
  "zap",
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
/**
 * How much preceding text `continue` may actually feed the model. Novel's
 * `getPrevText` serializes the whole head of the document with no cap
 * (`packages/headless/src/utils/index.ts:25-36`); the server keeps only this
 * many trailing characters so a long entry cannot blow the context window.
 */
export const AI_REWRITE_MAX_CONTEXT_CHARS = 6_000;
/** Ceiling for the `zap` free-form instruction (Novel caps nothing upstream). */
export const AI_REWRITE_MAX_COMMAND_CHARS = 500;

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
    /**
     * Novel `getPrevText`: the document text *before* the selection, as
     * Markdown. `continue` writes from this instead of from a selection. The
     * wire cap is the same as `text`; the server truncates to
     * `AI_REWRITE_MAX_CONTEXT_CHARS` before it reaches the model.
     */
    contextBefore: z.string().max(AI_REWRITE_MAX_TEXT_CHARS).optional(),
    /**
     * The `zap` free-form instruction (Novel's input box). Only valid together
     * with `instruction: "zap"`; always delimited as untrusted data server-side.
     */
    command: z.string().max(AI_REWRITE_MAX_COMMAND_CHARS).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // `continue` has no selection: its source is the preceding text. The field
    // is optional in the schema only so the other five instructions stay
    // byte-identical to the previous wire shape.
    if (value.instruction === "continue" && !value.contextBefore?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contextBefore"],
        message: "`continue` requires the preceding text in `contextBefore`.",
      });
    }
    // Novel only reads `command` inside its `zap` branch; accepting it for any
    // other instruction would let free text ride along with a closed verb.
    if (value.instruction !== "zap" && value.command !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["command"],
        message: "`command` is only accepted with instruction `zap`.",
      });
    }
  });
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
  /** A provider stream failed after its first user-visible event was committed. */
  providerStreamFailed: "AI_PROVIDER_STREAM_FAILED",
  rewriteTextTooLong: "AI_REWRITE_TEXT_TOO_LONG",
  rewriteSelectionMismatch: "AI_SELECTION_HASH_MISMATCH",
  rewriteEmpty: "AI_REWRITE_EMPTY",
  /** Client disconnected or the upstream stream was aborted; stream-only. */
  aborted: "AI_ABORTED",
  /** Unclassified server failure while a stream is already open. */
  internal: "AI_INTERNAL",
  /** Another stream is active for the same conversation (HTTP 409 before flush). */
  conversationBusy: "AI_CONVERSATION_BUSY",
  /** The requested per-turn model is not on this deployment's allow-list. */
  modelNotAllowed: "AI_MODEL_NOT_ALLOWED",
  /** An attachment reference is unknown, not ready, too large or unreadable. */
  attachmentInvalid: "AI_ATTACHMENT_INVALID",
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
 *
 * Ordering constraints for the appended tool lifecycle events:
 * - `meta` is the first event of every stream.
 * - Every `tool.start` precedes its matching `tool.end` (same `toolCallId`).
 * - Every `tool.end` precedes `plan` / `done`.
 * - `done` is the last event and appears exactly once.
 * - A `toolCallId` receives exactly one `tool.start`; reconnecting clients must
 *   upsert by `toolCallId` instead of appending a duplicate card.
 */
export const AiStreamEventTypeSchema = z.enum([
  "meta",
  "text.delta",
  "plan",
  "usage",
  "error",
  "done",
  "progress",
  "tool.start",
  "tool.progress",
  "tool.end",
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
    /**
     * Durable stream handle. It was added after the v1 meta frame shipped, so
     * it is optional for wire compatibility with already-running clients; the
     * current server always sets it.
     */
    streamId: UuidV7Schema.optional(),
    provider: AiProviderSchema,
  })
  .strict();
export type AiStreamMetaEvent = z.infer<typeof AiStreamMetaEventSchema>;

/**
 * Probe used before `ThreadRuntime.resumeRun`. A refresh has no SSE buffer in
 * memory, so the client must first learn whether the server still owns an
 * active resumable stream for this conversation.
 */
export const AiStreamStatusResponseSchema = z
  .object({
    active: z.boolean(),
    streamId: UuidV7Schema.optional(),
  })
  .strict();
export type AiStreamStatusResponse = z.infer<typeof AiStreamStatusResponseSchema>;

/** Explicit user stop. A network drop must never call this endpoint. */
export const CancelAiStreamRequestSchema = z
  .object({
    streamId: UuidV7Schema,
  })
  .strict();
export type CancelAiStreamRequest = z.infer<typeof CancelAiStreamRequestSchema>;

export const CancelAiStreamResponseSchema = z
  .object({
    cancelled: z.boolean(),
  })
  .strict();
export type CancelAiStreamResponse = z.infer<typeof CancelAiStreamResponseSchema>;

/**
 * Query for the resumable GET endpoint. `assistantMessageId` is supplied by
 * assistant-ui after `resumeRun` allocates its replacement message; the server
 * binds the still-running producer's final persistence to that id.
 */
export const ResumeAiStreamQuerySchema = z
  .object({
    assistantMessageId: z.string().min(1).max(128).optional(),
  })
  .strict();
export type ResumeAiStreamQuery = z.infer<typeof ResumeAiStreamQuerySchema>;

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
    /** Human labels for ids referenced by `plannedCalls`; absent when none resolved. */
    subjects: AiPlanSubjectsSchema.optional(),
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

/**
 * Lightweight, transient status line for long tool rounds. Appended to the v1
 * protocol without changing any existing event: `label` is user-facing Chinese
 * and capped at 40 characters. Clients must render it as status text, never as
 * answer content, and may drop it once `text.delta` has arrived.
 */
export const AiStreamProgressStageSchema = z.enum(["thinking", "searching", "reading"]);
export type AiStreamProgressStage = z.infer<typeof AiStreamProgressStageSchema>;

export const AiStreamProgressEventSchema = z
  .object({
    type: z.literal("progress"),
    stage: AiStreamProgressStageSchema,
    label: z.string().min(1).max(40),
    at: IsoTimestampSchema.optional(),
  })
  .strict();
export type AiStreamProgressEvent = z.infer<typeof AiStreamProgressEventSchema>;

/**
 * A tool call just started. Event semantics are ported from vercel/chatbot
 * `components/ai-elements/tool.tsx` L25–L172 (the seven-state tool card model),
 * without its React implementation: the UI inserts a running card immediately.
 * `stepId` groups parallel calls from the same planning round.
 */
export const AiStreamToolStartEventSchema = z
  .object({
    type: z.literal("tool.start"),
    toolCallId: z.string().min(1).max(128),
    name: z.string().min(1).max(100),
    stepId: z.string().min(1).max(128).optional(),
    parentToolCallId: z.string().min(1).max(128).optional(),
    args: JsonObjectSchema,
    startedAt: IsoTimestampSchema,
  })
  .strict();
export type AiStreamToolStartEvent = z.infer<typeof AiStreamToolStartEventSchema>;

/** Optional progress for one running tool; `percent` is 0–100. */
export const AiStreamToolProgressEventSchema = z
  .object({
    type: z.literal("tool.progress"),
    toolCallId: z.string().min(1).max(128),
    percent: z.number().int().min(0).max(100).optional(),
    label: z.string().min(1).max(200).optional(),
    at: IsoTimestampSchema.optional(),
  })
  .strict();
export type AiStreamToolProgressEvent = z.infer<typeof AiStreamToolProgressEventSchema>;

/** Terminal state of one tool call; always follows the matching `tool.start`. */
export const AiStreamToolEndEventSchema = z
  .object({
    type: z.literal("tool.end"),
    toolCallId: z.string().min(1).max(128),
    status: z.enum(["ok", "error", "cancelled"]),
    result: z.unknown().optional(),
    error: AiToolErrorSchema.optional(),
    finishedAt: IsoTimestampSchema,
    durationMs: z.number().int().nonnegative(),
  })
  .strict();
export type AiStreamToolEndEvent = z.infer<typeof AiStreamToolEndEventSchema>;

export const AiStreamEventSchema = z.discriminatedUnion("type", [
  AiStreamMetaEventSchema,
  AiStreamTextDeltaEventSchema,
  AiStreamPlanEventSchema,
  AiStreamUsageEventSchema,
  AiStreamErrorEventSchema,
  AiStreamDoneEventSchema,
  AiStreamProgressEventSchema,
  AiStreamToolStartEventSchema,
  AiStreamToolProgressEventSchema,
  AiStreamToolEndEventSchema,
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

/**
 * Result of the upstream `DELETE /api/history` action
 * (`vercel/chatbot@app/(chat)/api/history/route.ts`): the number of rows the
 * server soft-deleted in one transaction-like operation.
 */
export const AiConversationBulkDeleteResponseSchema = z
  .object({
    deletedCount: z.number().int().nonnegative(),
  })
  .strict();
export type AiConversationBulkDeleteResponse = z.infer<
  typeof AiConversationBulkDeleteResponseSchema
>;

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

/** One assistant-message vote. Ported from vercel/chatbot's `Vote_v2`. */
export const AiMessageVoteSchema = z
  .object({
    messageId: z.string().min(1).max(128),
    isUpvoted: z.boolean(),
  })
  .strict();
export type AiMessageVote = z.infer<typeof AiMessageVoteSchema>;

export const AiMessageVotesResponseSchema = z.array(AiMessageVoteSchema);
export type AiMessageVotesResponse = z.infer<typeof AiMessageVotesResponseSchema>;

export const SetAiMessageVoteRequestSchema = z
  .object({
    type: z.enum(["up", "down"]),
  })
  .strict();
export type SetAiMessageVoteRequest = z.infer<typeof SetAiMessageVoteRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Artifact / Document DTOs                                                   */
/* -------------------------------------------------------------------------- */

export const AI_ARTIFACT_CONTENT_MAX_CHARS = 1_000_000;
export const AI_ARTIFACT_TITLE_MAX_CHARS = 160;

const AiArtifactFieldsSchema = z.object({
  id: UuidV7Schema,
  workspaceId: UuidV7Schema,
  userId: UuidV7Schema,
  conversationId: UuidV7Schema.nullable(),
  title: z.string().min(1).max(AI_ARTIFACT_TITLE_MAX_CHARS),
  kind: AiArtifactKindSchema,
  content: z.string().max(AI_ARTIFACT_CONTENT_MAX_CHARS),
  mediaId: UuidV7Schema.nullable(),
  version: z.number().int().positive(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});

/**
 * One artifact. Ported from vercel/chatbot `Document` / `Document_v2`
 * (`lib/db/schema.ts`), with the Roamlog additions `workspaceId`, media-backed
 * image content and optimistic `version`.
 */
export const AiArtifactSchema = AiArtifactFieldsSchema.strict();
export type AiArtifact = z.infer<typeof AiArtifactSchema>;

/** List projection: content is intentionally omitted, one row can be large. */
export const AiArtifactSummarySchema = AiArtifactFieldsSchema.omit({
  content: true,
  userId: true,
  workspaceId: true,
}).strict();
export type AiArtifactSummary = z.infer<typeof AiArtifactSummarySchema>;

export const AiArtifactVersionSchema = z
  .object({
    id: UuidV7Schema,
    artifactId: UuidV7Schema,
    version: z.number().int().positive(),
    content: z.string().max(AI_ARTIFACT_CONTENT_MAX_CHARS),
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type AiArtifactVersion = z.infer<typeof AiArtifactVersionSchema>;

export const AiArtifactSuggestionSchema = z
  .object({
    id: UuidV7Schema,
    artifactId: UuidV7Schema,
    description: z.string().min(1).max(600),
    originalText: z.string().min(1).max(20_000),
    suggestedText: z.string().min(1).max(20_000),
    isResolved: z.boolean(),
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type AiArtifactSuggestion = z.infer<typeof AiArtifactSuggestionSchema>;

export const AiArtifactListQuerySchema = z.object({
  conversationId: UuidV7Schema.optional(),
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type AiArtifactListQuery = z.infer<typeof AiArtifactListQuerySchema>;

export const AiArtifactListResponseSchema = z
  .object({
    items: z.array(AiArtifactSummarySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type AiArtifactListResponse = z.infer<typeof AiArtifactListResponseSchema>;

export const CreateAiArtifactRequestSchema = z
  .object({
    conversationId: UuidV7Schema.optional(),
    title: z.string().trim().min(1).max(AI_ARTIFACT_TITLE_MAX_CHARS),
    kind: AiArtifactKindSchema,
    content: z.string().max(AI_ARTIFACT_CONTENT_MAX_CHARS).optional(),
    mediaId: UuidV7Schema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "image" && !value.mediaId && !value.content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mediaId"],
        message: "An image artifact requires an existing media asset.",
      });
    }
    if (value.kind !== "image" && value.mediaId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mediaId"],
        message: "Only an image artifact can reference a media asset.",
      });
    }
  });
export type CreateAiArtifactRequest = z.infer<typeof CreateAiArtifactRequestSchema>;

export const UpdateAiArtifactRequestSchema = z
  .object({
    /** Required optimistic-lock token; the server rejects a stale writer. */
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(AI_ARTIFACT_TITLE_MAX_CHARS).optional(),
    content: z.string().max(AI_ARTIFACT_CONTENT_MAX_CHARS).optional(),
    mediaId: UuidV7Schema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.content !== undefined ||
      value.mediaId !== undefined,
    { message: "At least one artifact field must change.", path: ["content"] },
  );
export type UpdateAiArtifactRequest = z.infer<typeof UpdateAiArtifactRequestSchema>;

export const AiArtifactVersionsResponseSchema = z
  .object({
    versions: z.array(AiArtifactVersionSchema),
  })
  .strict();
export type AiArtifactVersionsResponse = z.infer<typeof AiArtifactVersionsResponseSchema>;

export const AiArtifactSuggestionsResponseSchema = z
  .object({
    suggestions: z.array(AiArtifactSuggestionSchema),
  })
  .strict();
export type AiArtifactSuggestionsResponse = z.infer<typeof AiArtifactSuggestionsResponseSchema>;

export const SetAiArtifactSuggestionRequestSchema = z
  .object({
    isResolved: z.boolean(),
  })
  .strict();
export type SetAiArtifactSuggestionRequest = z.infer<
  typeof SetAiArtifactSuggestionRequestSchema
>;

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
