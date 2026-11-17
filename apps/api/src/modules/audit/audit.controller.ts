import { Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { RequirePermission } from "../../common/guards/require-permission.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { AuditService } from "./audit.service.js";

@Controller("workspaces/:workspaceId/audit")
@UseGuards(TenantGuard, RolesGuard)
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  @RequirePermission("workspace:view-audit", "audit")
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("workspaceId") workspaceId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.audit.listWorkspace(actor, workspaceId, query);
  }
}
