import { Body, Controller, HttpCode, HttpException, HttpStatus, Inject, Optional, Post, Res, UseGuards } from "@nestjs/common";
import type { AiErrorCode, AiStreamErrorEvent, AiStreamEvent } from "@roamlog/contracts";
import { AI_ERROR_CODES } from "@roamlog/contracts";
import type { Response } from "express";

import {
  CurrentActor,
  CurrentWorkspaceMembership,
  type AuthenticatedActor,
} from "../../common/guards/actor-context.js";
import { RequirePermission } from "../../common/guards/require-permission.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { AI_SSE_HEARTBEAT_MS, DEFAULT_SSE_HEARTBEAT_MS } from "./ai.controller.js";
import { AiRewriteService } from "./ai-rewrite.service.js";
import { serializeSseEvent } from "./sse-frame.js";

/**
 * The streaming half of selection rewriting.
 *
 * Why a second controller instead of a route on `AiController`: the rewrite
 * endpoints are the only AI surface whose permission is `entry:update` rather
 * than `trip:create`, and `AiController` is shared with the planner work. This
 * controller owns exactly one route:
 *
 *   `POST /v1/workspaces/:workspaceId/ai/rewrite/stream`
 *
 * Route-collision check against the routes that already exist (all under the
 * `v1` global prefix, `apps/api/src/bootstrap/configure-app.ts:32`):
 *   - `AiController`            @Controller("workspaces/:workspaceId/ai")
 *       `POST chat`, `GET models`, `POST chat/stream`, `POST rewrite`,
 *       `POST runs/:runId/execute`
 *   - `AiConversationController` @Controller("workspaces/:workspaceId/ai/conversations")
 *       `GET|POST /`, `GET|PATCH|DELETE :conversationId`, `POST :conversationId/archive`,
 *       `POST :conversationId/unarchive`, `GET :conversationId/messages`,
 *       `PUT :conversationId/messages/:clientId`, `DELETE :conversationId/messages`,
 *       `POST :conversationId/title/generate`
 *   `rewrite/stream` is a distinct segment below `/ai/rewrite`, so it matches no
 *   existing path. `POST /ai/rewrite` (one-shot) stays untouched: Nest matches
 *   the more specific two-segment path for `.../rewrite/stream`.
 *
 * The SSE writing mirrors `AiController.chatStream` (preflight errors stay
 * ordinary ProblemDetails JSON because headers are only flushed after
 * `prepare()` resolves), because those helpers are private to that file.
 */
@Controller("workspaces/:workspaceId/ai/rewrite")
@UseGuards(TenantGuard, RolesGuard)
export class AiRewriteController {
  constructor(
    @Inject(AiRewriteService) private readonly rewriter: AiRewriteService,
    @Optional()
    @Inject(AI_SSE_HEARTBEAT_MS)
    private readonly heartbeatMs: number = DEFAULT_SSE_HEARTBEAT_MS,
  ) {}

  @Post("stream")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("entry:update", "journal_entry")
  async stream(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Body() body: unknown,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    // Commit point: schema, membership, length, hash, provider config and quota
    // all resolve here, so they can still be a normal 4xx/5xx JSON response.
    const prepared = await this.rewriter.prepare(actor, membership, body);
    const client = new AbortController();

    this.openSse(res);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) {
        res.write(`: hb ${new Date().toISOString()}\n\n`);
      }
    }, Math.max(1, this.heartbeatMs));
    heartbeat.unref?.();

    const onClose = (): void => {
      if (!res.writableEnded) client.abort();
    };
    res.on("close", onClose);
    res.on("error", onClose);

    let seq = 0;
    let messageId = "";
    try {
      for await (const event of this.rewriter.stream(prepared, { signal: client.signal })) {
        if (event.type === "meta") messageId = event.assistantMessageId;
        if (event.type === "done") messageId = event.messageId;
        seq = await writeSse(res, event, seq + 1);
      }
    } catch (error) {
      // Safety net only: `stream()` already turns an empty answer into
      // error+done. Anything thrown here is a transport/adapter failure.
      if (!res.writableEnded && !res.destroyed && !client.signal.aborted) {
        seq = await writeSse(res, toSseError(error), seq + 1);
        await writeSse(
          res,
          { type: "done", messageId: messageId || "rewrite-error", finishReason: "error" },
          seq + 1,
        );
      }
    } finally {
      clearInterval(heartbeat);
      res.off("close", onClose);
      res.off("error", onClose);
      if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
    }
  }

  /** §1.4.2 response headers + immediate first byte (same as `chatStream`). */
  private openSse(res: Response): void {
    res.statusCode = HttpStatus.OK;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.write(": ok\n\n");
    res.socket?.setNoDelay(true);
    res.socket?.setTimeout(0);
  }
}

/** `id: <n>` / `event: <type>` / single-line JSON `data:` / blank line. */
async function writeSse(res: Response, event: AiStreamEvent, seq: number): Promise<number> {
  if (res.writableEnded || res.destroyed) return seq;
  const serialized = serializeSseEvent(event, seq);
  if (res.write(serialized.frame)) return serialized.nextSeq;
  await new Promise<void>((resolve) => {
    const done = (): void => {
      res.off("drain", done);
      res.off("close", done);
      resolve();
    };
    res.once("drain", done);
    res.once("close", done);
  });
  return res.writableEnded || res.destroyed ? seq : serialized.nextSeq;
}

const KNOWN_AI_CODES = new Set<string>(Object.values(AI_ERROR_CODES));

/** Mirrors `AiController.toSseError` (private there, so kept in step by hand). */
function toSseError(error: unknown): AiStreamErrorEvent {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    const payload =
      typeof response === "object" && response !== null
        ? (response as Record<string, unknown>)
        : undefined;
    const rawCode = typeof payload?.code === "string" ? payload.code : "AI_INTERNAL";
    const code = KNOWN_AI_CODES.has(rawCode) ? (rawCode as AiErrorCode) : "AI_INTERNAL";
    const rawMessage =
      typeof payload?.message === "string" ? payload.message : error.message || "The AI stream failed.";
    return {
      type: "error",
      code,
      message: rawMessage.slice(0, 1000),
      retryable: code === "AI_UPSTREAM" || code === "AI_INTERNAL",
    };
  }
  return {
    type: "error",
    code: "AI_INTERNAL",
    message: "The AI stream failed. Try again.",
    retryable: true,
  };
}
