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
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { ContentTenant } from "../trips/content-tenant.decorator.js";
import { ContentTenantGuard } from "../trips/content-tenant.guard.js";
import { VersionConflictFilter } from "../trips/version-conflict.filter.js";
import { PackingService } from "./packing.service.js";
import { PackingTenantGuard } from "./packing-tenant.guard.js";

@Controller()
@UseFilters(VersionConflictFilter)
export class PackingController {
  constructor(@Inject(PackingService) private readonly packing: PackingService) {}

  @Get("trips/:tripId/packing")
  @ContentTenant("trip")
  @RequirePermission("packing:read", "packing")
  @UseGuards(ContentTenantGuard, RolesGuard)
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Query() query: unknown,
  ) {
    return this.packing.list(actor, membership, tripId, query);
  }

  @Post("trips/:tripId/packing")
  @ContentTenant("trip")
  @RequirePermission("packing:create", "packing")
  @UseGuards(ContentTenantGuard, RolesGuard)
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Body() body: unknown,
  ) {
    return this.packing.create(actor, membership, tripId, body);
  }

  @Patch("packing/:itemId")
  @RequirePermission("packing:update", "packing")
  @UseGuards(PackingTenantGuard, RolesGuard)
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ) {
    return this.packing.update(actor, membership, itemId, body);
  }

  @Delete("packing/:itemId")
  @HttpCode(200)
  @RequirePermission("packing:delete", "packing")
  @UseGuards(PackingTenantGuard, RolesGuard)
  remove(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("itemId") itemId: string,
  ) {
    return this.packing.remove(actor, membership, itemId);
  }

  @Post("trips/:tripId/packing/reorder")
  @HttpCode(200)
  @ContentTenant("trip")
  @RequirePermission("packing:reorder", "packing")
  @UseGuards(ContentTenantGuard, RolesGuard)
  reorder(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Body() body: unknown,
  ) {
    return this.packing.reorder(actor, membership, tripId, body);
  }

  @Post("trips/:tripId/packing/bulk")
  @HttpCode(200)
  @ContentTenant("trip")
  @RequirePermission("packing:bulk", "packing")
  @UseGuards(ContentTenantGuard, RolesGuard)
  bulk(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Body() body: unknown,
  ) {
    return this.packing.bulk(actor, membership, tripId, body);
  }
}
