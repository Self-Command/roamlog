import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { CurrentWorkspaceMembership } from "../../common/guards/actor-context.js";
import { RequirePermission } from "../../common/guards/require-permission.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { ActivitiesService } from "./activities.service.js";

@Controller("workspaces/:workspaceId/activity")
@RequirePermission("activity:read", "activity")
@UseGuards(TenantGuard, RolesGuard)
export class ActivitiesController {
  constructor(@Inject(ActivitiesService) private readonly activities: ActivitiesService) {}

  @Get()
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Query() query: unknown,
  ) {
    return this.activities.listWorkspace(actor, membership, query);
  }
}
