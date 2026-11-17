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
import { ItineraryService } from "./itinerary.service.js";

@Controller()
@UseFilters(VersionConflictFilter)
export class ItineraryController {
  constructor(@Inject(ItineraryService) private readonly itinerary: ItineraryService) {}

  @Get("trips/:tripId/itinerary")
  @ContentTenant("trip")
  @RequirePermission("itinerary:read", "itinerary")
  @UseGuards(ContentTenantGuard, RolesGuard)
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
  ) {
    return this.itinerary.list(actor, membership, tripId);
  }

  @Post("trips/:tripId/itinerary")
  @ContentTenant("trip")
  @RequirePermission("itinerary:create", "itinerary")
  @UseGuards(ContentTenantGuard, RolesGuard)
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Body() body: unknown,
  ) {
    return this.itinerary.create(actor, membership, tripId, body);
  }

  @Patch("itinerary/:itemId")
  @ContentTenant("itinerary")
  @RequirePermission("itinerary:update", "itinerary")
  @UseGuards(ContentTenantGuard, RolesGuard)
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ) {
    return this.itinerary.update(actor, membership, itemId, body);
  }

  @Delete("itinerary/:itemId")
  @HttpCode(200)
  @ContentTenant("itinerary")
  @RequirePermission("itinerary:delete", "itinerary")
  @UseGuards(ContentTenantGuard, RolesGuard)
  remove(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("itemId") itemId: string,
  ) {
    return this.itinerary.remove(actor, membership, itemId);
  }

  @Post("trips/:tripId/itinerary/reorder")
  @HttpCode(200)
  @ContentTenant("trip")
  @RequirePermission("itinerary:reorder", "itinerary")
  @UseGuards(ContentTenantGuard, RolesGuard)
  reorder(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Body() body: unknown,
  ) {
    return this.itinerary.reorder(actor, membership, tripId, body);
  }
}
