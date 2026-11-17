import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";

import {
  CurrentActor,
  CurrentWorkspaceMembership,
  type AuthenticatedActor,
} from "../../common/guards/actor-context.js";
import { RequirePermission } from "../../common/guards/require-permission.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { SearchService } from "./search.service.js";

@Controller("workspaces/:workspaceId/search")
@RequirePermission("search:read", "search")
@UseGuards(TenantGuard, RolesGuard)
export class SearchController {
  constructor(@Inject(SearchService) private readonly searchService: SearchService) {}

  @Get()
  search(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Query() query: unknown,
  ) {
    return this.searchService.search(actor, membership, query);
  }
}
