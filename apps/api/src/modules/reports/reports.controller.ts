import { Body, Controller, Inject, Post, UseGuards } from "@nestjs/common";

import {
  CurrentActor,
  CurrentWorkspaceMembership,
  type AuthenticatedActor,
} from "../../common/guards/actor-context.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { ReportsService } from "./reports.service.js";

/**
 * Member-facing report submission. Deliberately no `@RequirePermission`:
 * reporting is available to every Workspace member including Viewers, and the
 * tenant guard is the only gate.
 */
@Controller("workspaces/:workspaceId/reports")
@UseGuards(TenantGuard)
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Post()
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Body() body: unknown,
  ) {
    return this.reports.create(actor, membership, body);
  }
}