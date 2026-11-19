import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  AiRunExecuteRequestSchema,
  type AiRunExecuteRequest,
  type AiRunExecuteResponse,
  type AiToolCall,
  type AiToolResult,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { AuditService } from "../audit/audit.service.js";
import { IdempotencyService } from "../idempotency/idempotency.service.js";
import { aiRunScope } from "./ai.constants.js";
import type { AiToolResultMessage } from "./adapters/adapter.js";
import { AiRunStore } from "./ai-run.store.js";
import { AiToolbox, type AiPlaceCandidate } from "./ai-tools.js";
import { describeToolError, sameCall } from "./ai-plan.service.js";

@Injectable()
export class AiExecuteService {
  constructor(
    @Inject(AiToolbox) private readonly toolbox: AiToolbox,
    @Inject(AiRunStore) private readonly runs: AiRunStore,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Executes the confirmed subset of a plan, call by call, in order.
   *
   * - The plan must belong to the same workspace **and** user.
   * - Every submitted call must have been planned; a subset is fine.
   * - Each call runs as the calling user through the product services, so the
   *   real role/visibility/version checks apply.
   * - Partial failure does not roll back what already succeeded.
   */
  async execute(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    runId: string,
    rawBody: unknown,
  ): Promise<AiRunExecuteResponse> {
    const body = parseRequest(AiRunExecuteRequestSchema, rawBody);

    return this.idempotency.run(
      aiRunScope(actor.user.id, membership.workspaceId),
      body.idempotencyKey,
      () => this.runOnce(actor, membership, runId, body),
    );
  }

  private async runOnce(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    runId: string,
    body: AiRunExecuteRequest,
  ): Promise<AiRunExecuteResponse> {
    const run = await this.runs.load(membership.workspaceId, runId);
    if (!run) {
      if (await this.runs.isConsumed(runId)) {
        throw new HttpException(
          { code: "AI_RUN_CONSUMED", message: "This plan has already been executed." },
          HttpStatus.CONFLICT,
        );
      }
      throw new HttpException(
        { code: "AI_RUN_NOT_FOUND", message: "This plan is unknown or has expired." },
        HttpStatus.NOT_FOUND,
      );
    }
    if (run.userId !== actor.user.id) {
      // Do not leak the existence of another user's plan.
      throw new HttpException(
        { code: "AI_RUN_NOT_FOUND", message: "This plan is unknown or has expired." },
        HttpStatus.NOT_FOUND,
      );
    }

    for (const call of body.calls) {
      if (!run.plannedCalls.some((planned) => sameCall(planned, call))) {
        throw new HttpException(
          {
            code: "AI_RUN_CALL_NOT_PLANNED",
            message: "A submitted call was not part of this plan.",
            errors: [{ field: "calls", code: "AI_RUN_CALL_NOT_PLANNED", message: call.tool }],
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }

    const candidates = new Map<string, AiPlaceCandidate>(
      run.candidates.map((candidate) => [candidate.providerPlaceId, candidate]),
    );
    const context = { actor, membership, runId, candidates };
    const results: AiToolResult[] = [];

    for (const call of body.calls) {
      results.push(await this.executeOne(call, context));
    }

    await this.runs.consume(run);

    const succeeded = results.filter((result) => result.ok).length;
    const failed = results.length - succeeded;
    return {
      results,
      partialFailure: succeeded > 0 && failed > 0,
      summary:
        failed === 0
          ? `${succeeded} action(s) applied.`
          : `${succeeded} action(s) applied, ${failed} failed. Nothing that succeeded was rolled back.`,
    };
  }

  private async executeOne(
    call: AiToolCall,
    context: Parameters<AiToolbox["execute"]>[1],
  ): Promise<AiToolResult> {
    const startedAt = Date.now();
    let result: AiToolResult;

    try {
      const outcome = await this.toolbox.execute(call, context);
      result = outcome.ok
        ? {
            tool: call.tool,
            ok: true,
            ...(outcome.entityId ? { entityId: outcome.entityId } : {}),
          }
        : {
            tool: call.tool,
            ok: false,
            error: outcome.error ?? { code: "AI_TOOL_FAILED", message: "The tool could not run." },
          };
    } catch (error) {
      result = { tool: call.tool, ok: false, error: describeToolError(error) };
    }

    // Audit every executed call. Arguments are never stored: only the identity
    // of the action, its outcome and its timing.
    try {
      await this.audit.record({
        actorId: context.actor.user.id,
        actorType: "user",
        action: "ai.tool_call",
        targetType: "ai_tool",
        targetId: context.runId,
        workspaceId: context.membership.workspaceId,
        ...(context.actor.ip ? { ip: context.actor.ip } : {}),
        ...(context.actor.userAgent ? { userAgent: context.actor.userAgent } : {}),
        metadata: {
          runId: context.runId,
          tool: call.tool,
          ok: result.ok,
          entityId: result.entityId ?? null,
          durationMs: Date.now() - startedAt,
        },
      });
    } catch {
      // Auditing must never turn a successful write into a failed response;
      // the caller still gets the real tool result.
    }

    return result;
  }
}

/** Re-exported so specs can assert the trace shape. */
export type { AiToolResultMessage };