import { createHash, randomUUID } from "node:crypto";

import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  AI_REWRITE_MAX_CONTEXT_CHARS,
  AI_REWRITE_MAX_INPUT_CHARS,
  AiRewriteRequestSchema,
  type AiRewriteRequest,
  type AiRewriteResponse,
  type AiStreamEvent,
  type AiUsage,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { parseRequest } from "../../common/services/request-validation.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { generateUuidV7 } from "../auth/uuid.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import type { AiStepInput, AiProtocolAdapter } from "./adapters/adapter.js";
import { AiUpstreamError } from "./adapters/http.js";
import { AI_ADAPTER_FACTORY, type AiAdapterFactory } from "./adapters/index.js";
import { rewriteSystemPrompt, rewriteUserMessage } from "./ai-rewrite.prompts.js";
import {
  AI_SETTINGS_SOURCE,
  type AiSettings,
  type AiSettingsSource,
} from "./ai.settings.js";
import { AiQuotaService } from "./ai-quota.service.js";

/**
 * Hard cap on the tokens a rewrite may spend. A rewrite is bounded by the
 * selection that produced it, so `ai.maxOutputTokens` (sized for a whole plan)
 * is not the right ceiling here. Upstream Novel uses `maxTokens: 4096`
 * (`apps/web/app/api/generate/route.ts:120`) for the same single-pass call.
 */
export const REWRITE_MAX_OUTPUT_TOKENS = 2_000;

/** Lowercase hex SHA-256 of a string; the client computes the same value. */
export function selectionHashOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Strips the wrappers a model adds even when it is told not to: a fenced block,
 * or a whole answer wrapped in matching quotes. It never touches the interior,
 * so the preview shows exactly what will be inserted.
 */
export function normalizeRewrite(raw: string): string {
  let value = raw.trim();

  const fence = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```$/u.exec(value);
  if (fence?.[1] !== undefined) {
    value = fence[1].trim();
  }

  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "“" && last === "”")) {
      value = value.slice(1, -1).trim();
    }
  }

  return value;
}

/**
 * `continue` feeds the model the text *before* the selection (Novel
 * `getPrevText`), and Novel never truncates it
 * (`packages/headless/src/utils/index.ts:25-36`). A whole long entry would then
 * blow the context window, so the service keeps the trailing
 * `AI_REWRITE_MAX_CONTEXT_CHARS` characters — the tail, because Novel's own
 * `continue` system prompt says "Give more weight/priority to the later
 * characters than the beginning ones" (`route.ts:45`).
 */
export function truncateContextBefore(text: string): string {
  if (text.length <= AI_REWRITE_MAX_CONTEXT_CHARS) return text;
  return text.slice(-AI_REWRITE_MAX_CONTEXT_CHARS);
}

/** Everything a rewrite needs after preflight has passed. */
export interface PreparedRewrite {
  readonly body: AiRewriteRequest;
  readonly settings: AiSettings;
  readonly adapter: AiProtocolAdapter;
}

/**
 * Rewrites one selection.
 *
 * This is the only AI endpoint that produces prose for the user's own content
 * rather than tool calls. The client owns the write (it replaces the selection
 * and saves through the normal journal entry endpoint with `version`), which is
 * what keeps the concurrency check in one place.
 */
@Injectable()
export class AiRewriteService {
  constructor(
    @Inject(AI_SETTINGS_SOURCE) private readonly settingsSource: AiSettingsSource,
    @Inject(AI_ADAPTER_FACTORY) private readonly adapterFactory: AiAdapterFactory,
    @Inject(AiQuotaService) private readonly quota: AiQuotaService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  /**
   * Every check that must answer with ordinary ProblemDetails JSON *before* an
   * SSE stream commits its headers: schema, membership, length, hash, provider
   * configuration and quota. `stream()` starts after this resolves, which is why
   * a quota/validation failure can still be a normal 4xx response.
   */
  async prepare(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    rawBody: unknown,
  ): Promise<PreparedRewrite> {
    const body = parseRequest(AiRewriteRequestSchema, rawBody);
    // Defense in depth: the route already requires `entry:update`, and a caller
    // without an active membership never gets that far.
    this.assertMember(membership);

    // `continue` has no selection: its source is the preceding text, which is
    // truncated instead of rejected (upstream never bounds it at all).
    if (body.instruction !== "continue" && body.text.length > AI_REWRITE_MAX_INPUT_CHARS) {
      // The response body is normalized to ProblemDetails, so the field and the
      // ceiling travel in `errors[]` rather than as custom top-level keys.
      throw new HttpException(
        {
          code: "AI_REWRITE_TEXT_TOO_LONG",
          message: `Select at most ${AI_REWRITE_MAX_INPUT_CHARS} characters and try again.`,
          errors: [
            {
              field: "text",
              code: "TOO_LONG",
              message: `The selection is ${body.text.length} characters; the limit is ${AI_REWRITE_MAX_INPUT_CHARS}.`,
            },
          ],
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // The hash is the client's proof of *which* text it is rewriting. A mismatch
    // means a stale preview (the paragraph changed under it), so the request is
    // refused before any quota is spent or any model call is made.
    if (selectionHashOf(body.text) !== body.selectionHash) {
      throw new HttpException(
        {
          code: "AI_SELECTION_HASH_MISMATCH",
          message: "The selection changed before the request arrived. Select the text again.",
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const settings = await this.settingsSource.resolve();
    const adapter = this.adapterFactory(settings);
    this.assertConfigured(settings, adapter);

    const decision = await this.quota.consume(actor.user.id);
    if (!decision.allowed) {
      throw new HttpException(
        {
          code: "AI_QUOTA",
          message: "Your daily AI quota is exhausted.",
          retryAfterSeconds: decision.retryAfterSeconds,
          limit: decision.limit,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return { body, settings, adapter: adapter! };
  }

  /** One-shot (non-streaming) rewrite; kept for callers that do not want SSE. */
  async rewrite(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    rawBody: unknown,
  ): Promise<AiRewriteResponse> {
    const prepared = await this.prepare(actor, membership, rawBody);
    const startedAt = Date.now();

    let turn;
    try {
      turn = await prepared.adapter.step(this.stepInput(prepared));
    } catch (error) {
      this.logFailure(prepared.body, error, startedAt);
      throw new HttpException(
        { code: "AI_UPSTREAM", message: "The AI provider did not answer correctly. Try again." },
        HttpStatus.BAD_GATEWAY,
      );
    }

    const replacement = normalizeRewrite(turn.text ?? "");
    if (replacement.length === 0) {
      this.logEmpty(prepared.body);
      throw new HttpException(
        { code: "AI_REWRITE_EMPTY", message: "The AI returned an empty rewrite. Try again." },
        HttpStatus.BAD_GATEWAY,
      );
    }

    this.logGenerated(prepared.body, replacement, startedAt);

    return {
      replacement,
      selectionHash: prepared.body.selectionHash,
      model: prepared.settings.model,
      usage: usageOf(turn.usage),
    };
  }

  /**
   * Streaming rewrite in the frozen SSE v1 protocol.
   *
   * Ported control flow: Novel streams the completion into the panel only
   * (`ai-selector.tsx:47-55`); the document is never touched while text arrives,
   * and the user applies it explicitly afterwards. Same here — this generator
   * produces events, never editor mutations.
   *
   * The one upstream defect this deliberately fixes is `route.ts:119`: Novel
   * passes only the last message (`prompt: messages[last].content`) to
   * `streamText`, so its system prompts never took effect. `AiProtocolAdapter`
   * takes `system` as its own field and every adapter writes it into the provider
   * body, so the system sentence below is actually delivered.
   */
  async *stream(
    prepared: PreparedRewrite,
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<AiStreamEvent, void, void> {
    const startedAt = Date.now();
    const assistantMessageId = `rewrite-${randomUUID()}`;

    yield {
      type: "meta",
      v: 1,
      // A rewrite persists no conversation; the frozen meta frame still requires a
      // UUIDv7 here, so this is a per-stream id that is never stored or reused.
      conversationId: generateUuidV7(),
      userMessageId: `rewrite-${prepared.body.selectionHash.slice(0, 16)}`,
      assistantMessageId,
      provider: { protocol: prepared.settings.protocol, model: prepared.settings.model },
    };

    const input = this.stepInput(prepared);
    let text = "";
    let usage: AiUsage = {};

    if (typeof prepared.adapter.streamStep === "function") {
      // Bridge `onDelta` (push callback) to this generator (pull) without
      // buffering the whole answer: deltas are handed over as they arrive.
      const pending: string[] = [];
      let wake: (() => void) | null = null;
      const notify = (): void => {
        const resume = wake;
        wake = null;
        resume?.();
      };

      let settled = false;
      const running = prepared.adapter.streamStep(input, {
        ...(options.signal ? { signal: options.signal } : {}),
        onDelta: (delta) => {
          if (delta.length === 0) return;
          pending.push(delta);
          notify();
        },
      });
      // Rejections surface from `await running` below; this only ends the wait.
      running.then(
        () => {
          settled = true;
          notify();
        },
        () => {
          settled = true;
          notify();
        },
      );

      const waitForChange = (): Promise<void> =>
        new Promise<void>((resolve) => {
          wake = resolve;
        });

      while (!settled || pending.length > 0) {
        while (pending.length > 0) {
          const delta = pending.shift() as string;
          text += delta;
          yield { type: "text.delta", delta };
        }
        if (settled) break;
        await Promise.race([running.catch(() => undefined), waitForChange()]);
      }

      const result = await running;
      if (result.usage) usage = usageOf(result.usage);
    } else {
      // Adapters without `streamStep` still answer: one delta carries the whole text.
      const result = await prepared.adapter.step(input);
      const whole = result.text ?? "";
      if (whole.length > 0) {
        text += whole;
        yield { type: "text.delta", delta: whole };
      }
      if (result.usage) usage = usageOf(result.usage);
    }

    if (options.signal?.aborted) {
      yield {
        type: "done",
        messageId: assistantMessageId,
        finishReason: "aborted",
        ...(Object.keys(usage).length > 0 ? { usage } : {}),
      };
      return;
    }

    const replacement = normalizeRewrite(text);
    if (replacement.length === 0) {
      this.logEmpty(prepared.body);
      yield {
        type: "error",
        code: "AI_REWRITE_EMPTY",
        message: "The AI returned an empty rewrite. Try again.",
        retryable: true,
      };
      yield { type: "done", messageId: assistantMessageId, finishReason: "error" };
      return;
    }

    this.logGenerated(prepared.body, replacement, startedAt);

    if (Object.keys(usage).length > 0) {
      yield { type: "usage", usage };
    }
    yield {
      type: "done",
      messageId: assistantMessageId,
      finishReason: "stop",
      ...(Object.keys(usage).length > 0 ? { usage } : {}),
    };
  }

  /** One adapter turn from a prepared request (system *and* user are both sent). */
  private stepInput(prepared: PreparedRewrite): AiStepInput {
    const { body, settings } = prepared;
    return {
      system: rewriteSystemPrompt(body.instruction, body.locale),
      messages: [
        {
          role: "user",
          content: rewriteUserMessage(body.instruction, {
            text: body.text,
            ...(body.contextBefore === undefined
              ? {}
              : { contextBefore: truncateContextBefore(body.contextBefore) }),
            ...(body.command === undefined ? {} : { command: body.command }),
          }),
        },
      ],
      tools: [],
      maxTokens: Math.min(settings.maxOutputTokens, REWRITE_MAX_OUTPUT_TOKENS),
      timeoutMs: settings.timeoutMs,
    };
  }

  private logFailure(body: AiRewriteRequest, error: unknown, startedAt: number): void {
    this.logger.error(
      {
        event: "ai.rewrite_failed",
        durationMs: Date.now() - startedAt,
        instruction: body.instruction,
        reason: error instanceof AiUpstreamError ? error.kind : "unexpected",
        ...(error instanceof AiUpstreamError && error.httpStatus
          ? { httpStatus: error.httpStatus }
          : {}),
      },
      "ai.rewrite_failed",
    );
  }

  private logEmpty(body: AiRewriteRequest): void {
    this.logger.warn({ event: "ai.rewrite_empty", instruction: body.instruction }, "ai.rewrite_empty");
  }

  private logGenerated(body: AiRewriteRequest, replacement: string, startedAt: number): void {
    this.logger.log(
      {
        event: "ai.rewrite_generated",
        instruction: body.instruction,
        locale: body.locale ?? null,
        inputChars: body.text.length,
        contextChars: body.contextBefore?.length ?? 0,
        outputChars: replacement.length,
        durationMs: Date.now() - startedAt,
      },
      "ai.rewrite_generated",
    );
  }

  private assertMember(membership: WorkspaceMembershipAccess | undefined | null): void {
    if (!membership?.role) {
      throw new HttpException(
        { code: "WORKSPACE_ROLE_FORBIDDEN", message: "This Workspace action is not available." },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private assertConfigured(settings: AiSettings, adapter: AiProtocolAdapter | undefined): void {
    if (!settings.configured || !adapter) {
      this.logger.warn(
        { event: "ai.not_configured", protocol: settings.protocol, configured: settings.configured },
        "ai.not_configured",
      );
      throw new HttpException(
        { code: "AI_NOT_CONFIGURED", message: "AI writing is not configured on this server." },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}

/** Maps adapter usage to the contract shape, dropping non-numeric values. */
function usageOf(usage: { inputTokens?: number; outputTokens?: number } | undefined): AiUsage {
  const result: AiUsage = {};
  if (typeof usage?.inputTokens === "number") result.inputTokens = usage.inputTokens;
  if (typeof usage?.outputTokens === "number") result.outputTokens = usage.outputTokens;
  return result;
}