import { Body, Controller, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { AiRunIdSchema } from "@roamlog/contracts";

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

/**
 * AI planning is workspace-scoped and editor+ only (gated by `trip:create`,
 * which viewers never hold). The model acts as the calling user — the controller
 * passes the real membership down, so every tool hits the normal authorization.
 */
@Controller("workspaces/:workspaceId/ai")
@UseGuards(TenantGuard, RolesGuard)
export class AiController {
  constructor(
    @Inject(AiPlanService) private readonly planner: AiPlanService,
    @Inject(AiExecuteService) private readonly executor: AiExecuteService,
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
}