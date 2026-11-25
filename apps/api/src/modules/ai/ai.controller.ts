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
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  AI_ERROR_CODES,
  AiChatRequestSchema,
  AiRunIdSchema,
  CancelAiStreamRequestSchema,
  ResumeAiStreamQuerySchema,
  UuidV7Schema,
} from "@roamlog/contracts";
import type {
  AiChatModelsResponse,
  AiErrorCode,
  AiStreamErrorEvent,
  AiStreamEvent,
  AiStreamStatusResponse,
  CancelAiStreamResponse,
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
import { AiConversationService } from "./ai-conversation.service.js";
import { AiExecuteService } from "./ai-execute.service.js";
import { AiPlanService } from "./ai-plan.service.js";
import { AiRewriteService } from "./ai-rewrite.service.js";
import { AiRunStore } from "./ai-run.store.js";
import { serializeSseEvent } from "./sse-frame.js";

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
    @Inject(AiConversationService)
    private readonly conversations?: AiConversationService,
    @Optional() @Inject(AiRunStore) private readonly runs?: AiRunStore,
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

    const lifecycle = new AbortController();
    const stream = this.planner.streamChat(actor, membership, parsed, {
      signal: lifecycle.signal,
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

    const streamId = first.value.type === "meta" ? first.value.streamId : undefined;
    let closed = false;
    let resumable: ReadableStream<string> | null = null;
    let directFrames: AsyncGenerator<string, void, void> | undefined;
    // The producer itself watches the stop flag. This interval must outlive the
    // original HTTP response so Stop still works after a refresh or when the
    // stop request was handled by another API replica.
    const cancelPoll = streamId
      ? setInterval(() => {
          if (!this.runs || lifecycle.signal.aborted) return;
          void this.runs.isCancelRequested(streamId).then((cancelled) => {
            if (cancelled) lifecycle.abort();
          });
        }, 500)
      : undefined;
    cancelPoll?.unref?.();
    const cleanupProducer = (): void => {
      if (cancelPoll) clearInterval(cancelPoll);
      this.runs?.unregisterStreamController(streamId!);
      void this.runs?.clearCancelRequest(streamId!);
    };

    if (streamId && this.runs) {
      this.runs.registerStreamController(streamId, lifecycle);
      const makeFrames = () => readableFromAsync(frameStream(first.value, stream, cleanupProducer));
      try {
        resumable = await this.runs.createResumableStream(streamId, makeFrames);
      } catch {
        // Redis is a durability layer, not a reason to make chat unavailable.
        resumable = null;
      }
      if (!resumable) {
        directFrames = frameStream(first.value, stream, cleanupProducer);
      }
    } else {
      directFrames = frameStream(first.value, stream);
      if (cancelPoll) clearInterval(cancelPoll);
    }

    this.openSse(res);
    const heartbeat = setInterval(
      () => {
        if (!res.writableEnded && !res.destroyed) {
          res.write(`: hb ${new Date().toISOString()}\n\n`);
        }
      },
      Math.max(1, this.heartbeatMs),
    );
    heartbeat.unref?.();

    const onClose = (): void => {
      closed = true;
      // A resumable producer keeps running so another tab can attach. The
      // fallback stream has no replay buffer, so a disconnected browser must
      // abort it and let the planner persist the cancelled terminal state.
      if (!resumable) lifecycle.abort();
    };
    res.on("close", onClose);
    res.on("error", onClose);

    try {
      if (resumable) {
        await pipeStringStream(resumable, res, () => closed);
      } else if (directFrames) {
        for await (const frame of directFrames) {
          // Without a resumable producer there is nobody left to consume this
          // fallback stream after the browser disconnects. Close the generator
          // so the planner aborts the upstream and persists
          // assistant=incomplete/cancelled instead of writing into a dead
          // socket or leaving AiStream active.
          if (closed || res.writableEnded || res.destroyed) break;
          if (!(await writeChunk(res, frame))) break;
        }
      }
    } catch (error) {
      // Safety net only: `streamChat` already converts post-flush failures into
      // error+done. This covers a failure in the framing/transport itself.
      if (!res.writableEnded && !res.destroyed && !lifecycle.signal.aborted) {
        const mapped = toSseError(error);
        await writeSse(res, mapped, 1);
        await writeSse(
          res,
          {
            type: "done",
            messageId: "unknown",
            finishReason: "error",
          },
          2,
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

  /**
   * Probe used by `useAutoResume` before calling assistant-ui `resumeRun`.
   *
   * The DB row proves the conversation existed; the Redis sentinel proves this
   * process still has a replayable producer. A stale DB row must answer
   * `active: false`, otherwise the browser appends a blank assistant message
   * and has nothing to stream into it.
   */
  @Get("conversations/:conversationId/stream/status")
  @RequirePermission("trip:create", "trip")
  async streamStatus(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("conversationId") conversationId: string,
  ): Promise<AiStreamStatusResponse> {
    if (!this.conversations || !this.runs) return { active: false };
    const parsedId = parseRequest(UuidV7Schema, conversationId);
    const active = await this.conversations.findRecoverableStream(
      actor.user.id,
      membership.workspaceId,
      parsedId,
    );
    if (!active) return { active: false };
    const available = await this.runs.hasResumableStream(active.streamId);
    return available ? { active: true, streamId: active.streamId } : { active: false };
  }

  /**
   * `GET .../ai/conversations/:conversationId/stream` — reconnect to the SSE
   * producer buffered by `resumable-stream`.
   *
   * The client filters already-seen event ids, so replaying from the beginning
   * is intentional: it also makes a fresh page load reconstruct the full
   * assistant message without a second write path.
   */
  @Get("conversations/:conversationId/stream")
  @RequirePermission("trip:create", "trip")
  async resumeStream(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("conversationId") conversationId: string,
    @Query() query: unknown,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    if (!this.conversations || !this.runs) {
      res.status(HttpStatus.NO_CONTENT).end();
      return;
    }
    const parsedConversationId = parseRequest(UuidV7Schema, conversationId);
    const parsedQuery = parseRequest(ResumeAiStreamQuerySchema, query);
    const active = await this.conversations.findRecoverableStream(
      actor.user.id,
      membership.workspaceId,
      parsedConversationId,
    );
    if (!active) {
      res.status(HttpStatus.NO_CONTENT).end();
      return;
    }

    if (parsedQuery.assistantMessageId) {
      await this.runs.bindAssistantMessage(active.streamId, parsedQuery.assistantMessageId);
    }

    let stream: ReadableStream<string> | null | undefined;
    try {
      stream = await this.runs.resumeResumableStream(active.streamId);
    } catch {
      stream = undefined;
    }
    if (!stream) {
      res.status(HttpStatus.NO_CONTENT).end();
      return;
    }

    this.openSse(res);
    let closed = false;
    const onClose = (): void => {
      closed = true;
    };
    res.on("close", onClose);
    res.on("error", onClose);
    const heartbeat = setInterval(
      () => {
        if (!res.writableEnded && !res.destroyed) {
          res.write(`: hb ${new Date().toISOString()}\n\n`);
        }
      },
      Math.max(1, this.heartbeatMs),
    );
    heartbeat.unref?.();

    try {
      await pipeStringStream(stream, res, () => closed);
    } finally {
      clearInterval(heartbeat);
      res.off("close", onClose);
      res.off("error", onClose);
      if (!res.writableEnded && !res.destroyed) res.end();
    }
  }

  /**
   * Explicit user stop. A browser network disconnect deliberately does not
   * call this route: the producer keeps running so a refresh can resume it.
   */
  @Post("conversations/:conversationId/stream/cancel")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("trip:create", "trip")
  async cancelStream(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("conversationId") conversationId: string,
    @Body() body: unknown,
  ): Promise<CancelAiStreamResponse> {
    if (!this.conversations || !this.runs) return { cancelled: false };
    const parsedConversationId = parseRequest(UuidV7Schema, conversationId);
    const input = parseRequest(CancelAiStreamRequestSchema, body);
    const stream = await this.conversations.findStream(
      actor.user.id,
      membership.workspaceId,
      parsedConversationId,
      input.streamId,
    );
    if (!stream || stream.status !== "active") return { cancelled: false };

    await this.runs.requestCancel(input.streamId);
    this.runs.cancelStream(input.streamId);
    return { cancelled: true };
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
async function writeSse(res: Response, event: AiStreamEvent, seq: number): Promise<number> {
  if (res.writableEnded || res.destroyed) {
    return seq;
  }
  const serialized = serializeSseEvent(event, seq);
  return (await writeChunk(res, serialized.frame)) ? serialized.nextSeq : seq;
}

/**
 * Streams already-consumed first event + the rest of the planner generator as
 * raw SSE frames. This exact frame sequence is what `resumable-stream` buffers
 * and replays, including the terminal `done` frame.
 */
async function* frameStream(
  first: AiStreamEvent,
  rest: AsyncGenerator<AiStreamEvent, void, void>,
  onDone?: () => void,
): AsyncGenerator<string, void, void> {
  let seq = 0;
  try {
    const firstFrame = serializeSseEvent(first, seq + 1);
    seq = firstFrame.nextSeq;
    yield firstFrame.frame;
    for await (const event of rest) {
      const next = serializeSseEvent(event, seq);
      seq = next.nextSeq;
      yield next.frame;
    }
  } finally {
    onDone?.();
  }
}

/**
 * Adapts the async frame generator to `resumable-stream`'s ReadableStream API.
 *
 * The important detail is `cancel()`: it stops forwarding chunks to the
 * disconnected HTTP consumer but deliberately keeps draining the generator so
 * the provider and persistence complete for a later resume.
 */
function readableFromAsync(source: AsyncGenerator<string, void, void>): ReadableStream<string> {
  let cancelled = false;
  return new ReadableStream<string>({
    async start(controller) {
      try {
        for await (const chunk of source) {
          if (cancelled) continue;
          try {
            controller.enqueue(chunk);
          } catch {
            cancelled = true;
          }
        }
        if (!cancelled) {
          try {
            controller.close();
          } catch {
            // The consumer disconnected after the final read.
          }
        }
      } catch (error) {
        if (!cancelled) controller.error(error);
      }
    },
    cancel() {
      cancelled = true;
    },
  });
}

async function pipeStringStream(
  stream: ReadableStream<string>,
  res: Response,
  isClosed: () => boolean,
): Promise<void> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || isClosed()) break;
      if (value && !(await writeChunk(res, value))) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function writeChunk(res: Response, frame: string): Promise<boolean> {
  if (res.writableEnded || res.destroyed) {
    return false;
  }
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
      retryable:
        code === "AI_UPSTREAM" ||
        code === "AI_INTERNAL" ||
        code === "AI_PLAN_INCOMPLETE",
    };
  }
  return {
    type: "error",
    code: "AI_INTERNAL",
    message: "The AI stream failed. Try again.",
    retryable: true,
  };
}
