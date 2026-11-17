import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";

import {
  CurrentActor,
  CurrentWorkspaceMembership,
  type AuthenticatedActor,
} from "../../common/guards/actor-context.js";
import { RequirePermission } from "../../common/guards/require-permission.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { ContentTenant } from "../trips/content-tenant.decorator.js";
import { ContentTenantGuard } from "../trips/content-tenant.guard.js";
import { VersionConflictFilter } from "../trips/version-conflict.filter.js";
import { EntriesService } from "./entries.service.js";

@Controller()
@UseFilters(VersionConflictFilter)
export class EntriesController {
  constructor(@Inject(EntriesService) private readonly entries: EntriesService) {}

  @Get("workspaces/:workspaceId/entries")
  @RequirePermission("entry:read", "journal_entry")
  @UseGuards(TenantGuard, RolesGuard)
  listWorkspace(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Query() query: unknown,
  ) {
    return this.entries.listWorkspace(actor, membership, query);
  }

  @Get("trips/:tripId/entries")
  @ContentTenant("trip")
  @RequirePermission("entry:read", "journal_entry")
  @UseGuards(ContentTenantGuard, RolesGuard)
  listTrip(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Query() query: unknown,
  ) {
    return this.entries.listByTrip(actor, membership, tripId, query);
  }

  @Post("trips/:tripId/entries")
  @ContentTenant("trip")
  @RequirePermission("entry:create", "journal_entry")
  @UseGuards(ContentTenantGuard, RolesGuard)
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Body() body: unknown,
  ) {
    return this.entries.create(actor, membership, tripId, body);
  }

  @Get("entries/:entryId")
  @ContentTenant("entry")
  @RequirePermission("entry:read", "journal_entry")
  @UseGuards(ContentTenantGuard, RolesGuard)
  get(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("entryId") entryId: string,
  ) {
    return this.entries.get(actor, membership, entryId);
  }

  @Patch("entries/:entryId")
  @ContentTenant("entry")
  @RequirePermission("entry:update", "journal_entry")
  @UseGuards(ContentTenantGuard, RolesGuard)
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("entryId") entryId: string,
    @Body() body: unknown,
  ) {
    return this.entries.update(actor, membership, entryId, body);
  }

  @Delete("entries/:entryId")
  @HttpCode(200)
  @ContentTenant("entry")
  @RequirePermission("entry:delete", "journal_entry")
  @UseGuards(ContentTenantGuard, RolesGuard)
  remove(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("entryId") entryId: string,
  ) {
    return this.entries.remove(actor, membership, entryId);
  }

  @Post("entries/:entryId/favorite")
  @HttpCode(200)
  @ContentTenant("entry")
  @RequirePermission("entry:favorite", "journal_entry")
  @UseGuards(ContentTenantGuard, RolesGuard)
  favorite(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("entryId") entryId: string,
    @Body() body: unknown,
  ) {
    return this.entries.favorite(actor, membership, entryId, body);
  }

  @Get("entries/:entryId/revisions")
  @ContentTenant("entry")
  @RequirePermission("revision:read", "revision")
  @UseGuards(ContentTenantGuard, RolesGuard)
  revisions(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("entryId") entryId: string,
  ) {
    return this.entries.listRevisions(actor, membership, entryId);
  }

  @Post("entries/:entryId/restore/:revisionId")
  @HttpCode(200)
  @ContentTenant("entry")
  @RequirePermission("revision:restore", "revision")
  @UseGuards(ContentTenantGuard, RolesGuard)
  restore(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("entryId") entryId: string,
    @Param("revisionId") revisionId: string,
  ) {
    return this.entries.restore(actor, membership, entryId, revisionId);
  }
}
