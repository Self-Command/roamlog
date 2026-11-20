import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { AI_ERROR_CODES, AiChatRequestSchema, AiRunIdSchema } from "@roamlog/contracts";
import type {
  AiChatModelsResponse,
  AiErrorCode,
  AiStreamErrorEvent,
  AiStreamEvent,
} from "@roamlog/contracts";
import type { Request, Response } from "express";

import {
  CurrentActor,
  CurrentWorkspaceMembership,
  type AuthenticatedActor,
} from "../../common/guards/actor-context.js";
import { RequirePermission } from "../../common/guards/require-permission.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { parseRequest } from "../../common/services/request-validation.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { AiExecuteService } from "./ai-execute.service.js";
import { AiPlanService } from "./ai-plan.service.js";
import { AiRewriteService } from "./ai-rewrite.service.js";

/**
 * Optional injection token for the SSE heartbeat interval. Production uses the
 * 15 s default from `.audit/ai-port-spec.md` §1.3.5; tests provide 50 ms so a
 * heartbeat can be asserted without a 15-second test.
 */
export const AI_SSE_HEARTBEAT_MS = Symbol("ROAMLOG_AI_SSE_HEARTBEAT_MS");

/** §1.3.5: 15 s keeps every common 60 s idle proxy timeout warm. */
export const DEFAULT_SSE_HEARTBEAT_MS = 15_000;

/**
 * AI planning is workspace-scoped and editor+ only (gated by `trip:create`,
 * which viewers never hold). The model acts as the calling user — the controller
 * passes the real membership down, so every tool hits the normal authorization.
 *
 * Rewriting is gated by `entry:update` instead: it edits journal prose, so the
 * permission must be the one the journal editor itself requires.
 */
@Controller("workspaces/:workspaceId/ai")
@UseGuards(TenantGuard, RolesGuard)
export class AiController {
  constructor(
    @Inject(AiPlanService) private readonly planner: AiPlanService,
    @Inject(AiExecuteService) private readonly executor: AiExecuteService,
    @Inject(AiRewriteService) private readonly rewriter: AiRewriteService,
    @Optional()
    @Inject(AI_SSE_HEARTBEAT_MS)
    private readonly heartbeatMs: number = DEFAULT_SSE_HEARTBEAT_MS,
  ) {}

  @Post("chat")
  @RequirePermission("trip:create", "trip")
  chat(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Body() body: unknown,
  ) {
    return this.planner.chat(actor, membership, body);
  }

  /**
   * `GET /v1/workspaces/:workspaceId/ai/models` — the selectable model list.
   *
   * Port of vercel/chatbot `app/(chat)/api/models/route.ts` L1–L20, which the
   * model selector reads (`components/chat/multimodal-input.tsx` L794–L803).
   * Upstream serves a curated gateway catalog + capabilities; Roamlog serves the
   * admin-configured model plus the operator allow-list, so every id the selector
   * offers is one the API will accept.
   */
  @Get("models")
  @RequirePermission("trip:create", "trip")
  models(
    @CurrentWorkspaceMembership() _membership: WorkspaceMembershipAccess,
  ): Promise<AiChatModelsResponse> {
    return this.planner.chatModels();
  }

  /**
   * `POST /v1/workspaces/:workspaceId/ai/chat/stream` (§1.4.1/§1.4.2).
   *
   * The response is written by hand because `@Sse()` only supports GET +
   * RxJS Observables. The first `stream.next()` is deliberately awaited before
   * any header is flushed: settings/config (503), validation (400),
   * conversation (404) and quota (429) errors therefore still get the normal
   * ProblemDetails JSON from Nest. After `flushHeaders()` every failure becomes
   * an in-stream `error` + `done(finishReason:"error")`, never a thrown
   * exception ("Cannot set headers after they are sent").
   */
  @Post("chat/stream")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("trip:create", "trip")
  async chatStream(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Body() body: unknown,
    @Req() _req: Request,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    // Validation happens before the generator is created: a bad body is a plain
    // 400 JSON response, exactly like POST /chat.
    const parsed = parseRequest(AiChatRequestSchema, body);

    const client = new AbortController();
    const stream = this.planner.streamChat(actor, membership, parsed, {
      signal: client.signal,
    });

    // Commit point: pull the first event before touching the response. Any
    // preflight failure rejects here and is handled by Nest's JSON filter.
    const first = await stream.next();
    if (first.done) {
      if (!res.headersSent) {
        res.status(HttpStatus.NO_CONTENT).end();
      } else if (!res.writableEnded) {
        res.end();
      }
      return;
    }

    this.openSse(res);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) {
        res.write(`: hb ${new Date().toISOString()}\n\n`);
      }
    }, Math.max(1, this.heartbeatMs));
    heartbeat.unref?.();

    const onClose = (): void => {
      // `close` also fires after our own `res.end()`; only a prematurely closed
      // socket means the client is gone and the upstream work should stop.
      if (!res.writableEnded) {
        client.abort();
      }
    };
    res.on("close", onClose);
    res.on("error", onClose);

    let seq = 0;
    let messageId = "";
    if (first.value.type === "meta") {
      messageId = first.value.assistantMessageId;
    }

    try {
      await writeSse(res, first.value, ++seq);
      for await (const event of stream) {
        if (event.type === "meta") {
          messageId = event.assistantMessageId;
        }
        await writeSse(res, event, ++seq);
      }
    } catch (error) {
      // Safety net only: `streamChat` already converts post-flush failures into
      // error+done. This covers a failure in `writeSse`/the generator itself.
      if (!res.writableEnded && !res.destroyed && !client.signal.aborted) {
        const mapped = toSseError(error);
        await writeSse(res, mapped, ++seq);
        await writeSse(
          res,
          {
            type: "done",
            messageId: messageId || "unknown",
            finishReason: "error",
          },
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

  @Post("rewrite")
  // 200, not the usual 201: the endpoint computes a rewrite and stores nothing.
  @HttpCode(HttpStatus.OK)
  @RequirePermission("entry:update", "journal_entry")
  rewrite(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Body() body: unknown,
  ) {
    return this.rewriter.rewrite(actor, membership, body);
  }

  @Post("runs/:runId/execute")
  @RequirePermission("trip:create", "trip")
  execute(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("runId") runId: string,
    @Body() body: unknown,
  ) {
    const parsedRunId = parseRequest(AiRunIdSchema, runId);
    return this.executor.execute(actor, membership, parsedRunId, body);
  }

  /** §1.4.2 response headers + immediate first byte. */
  private openSse(res: Response): void {
    res.statusCode = HttpStatus.OK;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // nginx buffers proxied responses by default and would collapse the stream
    // into one block; this opt-out is the documented deployment requirement.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    // An SSE comment frame: valid on the wire, ignored by EventSource clients,
    // and it gives proxies/browsers a first byte immediately.
    res.write(": ok\n\n");
    res.socket?.setNoDelay(true);
    res.socket?.setTimeout(0);
  }
}

/**
 * Writes one SSE frame: `id: <n>`, `event: <type>`, single-line JSON `data:`,
 * then a blank line (§1.3.1). Backpressure is respected — `res.write() === false`
 * only means the kernel buffer is full, and ignoring `drain` would let a slow
 * client grow process memory without bound.
 */
async function writeSse(res: Response, event: AiStreamEvent, seq: number): Promise<boolean> {
  if (res.writableEnded || res.destroyed) {
    return false;
  }
  const frame = `id: ${String(seq).padStart(6, "0")}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  if (res.write(frame)) {
    return true;
  }
  await new Promise<void>((resolve) => {
    const done = (): void => {
      res.off("drain", done);
      res.off("close", done);
      resolve();
    };
    res.once("drain", done);
    res.once("close", done);
  });
  return !res.writableEnded && !res.destroyed;
}

const KNOWN_AI_CODES = new Set<string>(Object.values(AI_ERROR_CODES));

/** Maps any thrown value to the frozen `error` event shape (§1.3.2/§1.3.4). */
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
      typeof payload?.message === "string"
        ? payload.message
        : error.message || "The AI stream failed.";
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
