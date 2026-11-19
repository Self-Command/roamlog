import { createHash } from "node:crypto";

import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  AI_REWRITE_MAX_INPUT_CHARS,
  AiRewriteRequestSchema,
  type AiRewriteResponse,
  type AiUsage,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { parseRequest } from "../../common/services/request-validation.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import type { AiProtocolAdapter } from "./adapters/adapter.js";
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
 * is not the right ceiling here.
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
 * Rewrites one selection.
 *
 * This is the only AI endpoint that produces prose for the user's own content
 * rather than tool calls, so it is deliberately a single request/response: no
 * run id, no tools, nothing persisted. The client owns the write (it replaces
 * the selection and saves through the normal journal entry endpoint with
 * `version`), which is what keeps the concurrency check in one place.
 */
@Injectable()
export class AiRewriteService {
  constructor(
    @Inject(AI_SETTINGS_SOURCE) private readonly settingsSource: AiSettingsSource,
    @Inject(AI_ADAPTER_FACTORY) private readonly adapterFactory: AiAdapterFactory,
    @Inject(AiQuotaService) private readonly quota: AiQuotaService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  async rewrite(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    rawBody: unknown,
  ): Promise<AiRewriteResponse> {
    const body = parseRequest(AiRewriteRequestSchema, rawBody);
    // Defense in depth: the route already requires `entry:update`, and a caller
    // without an active membership never gets that far.
    this.assertMember(membership);

    if (body.text.length > AI_REWRITE_MAX_INPUT_CHARS) {
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

    // The hash is the client's proof of *which* selection it is rewriting. A
    // mismatch means a stale preview (the paragraph changed under it), so the
    // request is refused before any quota is spent or any model call is made.
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

    const startedAt = Date.now();
    let turn;
    try {
      turn = await adapter!.step({
        system: rewriteSystemPrompt(body.instruction, body.locale),
        messages: [{ role: "user", content: rewriteUserMessage(body.text) }],
        tools: [],
        maxTokens: Math.min(settings.maxOutputTokens, REWRITE_MAX_OUTPUT_TOKENS),
        timeoutMs: settings.timeoutMs,
      });
    } catch (error) {
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
      throw new HttpException(
        {
          code: "AI_UPSTREAM",
          message: "The AI provider did not answer correctly. Try again.",
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    const replacement = normalizeRewrite(turn.text ?? "");
    if (replacement.length === 0) {
      this.logger.warn(
        { event: "ai.rewrite_empty", instruction: body.instruction },
        "ai.rewrite_empty",
      );
      throw new HttpException(
        { code: "AI_REWRITE_EMPTY", message: "The AI returned an empty rewrite. Try again." },
        HttpStatus.BAD_GATEWAY,
      );
    }

    const usage: AiUsage = {};
    if (typeof turn.usage?.inputTokens === "number") usage.inputTokens = turn.usage.inputTokens;
    if (typeof turn.usage?.outputTokens === "number") usage.outputTokens = turn.usage.outputTokens;

    this.logger.log(
      {
        event: "ai.rewrite_generated",
        instruction: body.instruction,
        locale: body.locale ?? null,
        inputChars: body.text.length,
        outputChars: replacement.length,
        durationMs: Date.now() - startedAt,
      },
      "ai.rewrite_generated",
    );

    return {
      replacement,
      selectionHash: body.selectionHash,
      model: settings.model,
      usage,
    };
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
