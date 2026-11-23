import { Body, Controller, Get, Inject, Param, Patch, UseGuards } from "@nestjs/common";

import { CurrentActor, CurrentWorkspaceMembership, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { RequirePermission } from "../../common/guards/require-permission.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { AiMessageVoteService } from "./ai-message-vote.service.js";

@Controller("workspaces/:workspaceId/ai/conversations/:conversationId")
@UseGuards(TenantGuard, RolesGuard)
export class AiMessageVoteController {
  constructor(@Inject(AiMessageVoteService) private readonly votes: AiMessageVoteService) {}

  @Get("votes")
  @RequirePermission("trip:create", "trip")
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("conversationId") conversationId: string,
  ) {
    return this.votes.list(actor.user.id, membership.workspaceId, conversationId);
  }

  @Patch("messages/:messageId/vote")
  @RequirePermission("trip:create", "trip")
  set(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("conversationId") conversationId: string,
    @Param("messageId") messageId: string,
    @Body() body: unknown,
  ) {
    return this.votes.set(
      actor.user.id,
      membership.workspaceId,
      conversationId,
      messageId,
      body,
    );
  }
}
