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
  Put,
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
import { ContentTenant } from "./content-tenant.decorator.js";
import { ContentTenantGuard } from "./content-tenant.guard.js";
import { StopsService } from "./stops.service.js";
import { TripsService } from "./trips.service.js";
import { VersionConflictFilter } from "./version-conflict.filter.js";

@Controller()
@UseFilters(VersionConflictFilter)
export class TripsController {
  constructor(
    @Inject(TripsService) private readonly trips: TripsService,
    @Inject(StopsService) private readonly stops: StopsService,
  ) {}

  @Get("workspaces/:workspaceId/trips")
  @RequirePermission("trip:read", "trip")
  @UseGuards(TenantGuard, RolesGuard)
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Query() query: unknown,
  ) {
    return this.trips.list(actor, membership, query);
  }

  @Post("workspaces/:workspaceId/trips")
  @RequirePermission("trip:create", "trip")
  @UseGuards(TenantGuard, RolesGuard)
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Body() body: unknown,
  ) {
    return this.trips.create(actor, membership, body);
  }

  @Get("trips/:tripId")
  @ContentTenant("trip")
  @RequirePermission("trip:read", "trip")
  @UseGuards(ContentTenantGuard, RolesGuard)
  get(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
  ) {
    return this.trips.get(actor, membership, tripId);
  }

  @Patch("trips/:tripId")
  @ContentTenant("trip")
  @RequirePermission("trip:update", "trip")
  @UseGuards(ContentTenantGuard, RolesGuard)
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Body() body: unknown,
  ) {
    return this.trips.update(actor, membership, tripId, body);
  }

  @Delete("trips/:tripId")
  @HttpCode(200)
  @ContentTenant("trip")
  @RequirePermission("trip:delete", "trip")
  @UseGuards(ContentTenantGuard, RolesGuard)
  remove(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
  ) {
    return this.trips.remove(actor, membership, tripId);
  }

  @Post("trips/:tripId/duplicate")
  @ContentTenant("trip")
  @RequirePermission("trip:duplicate", "trip")
  @UseGuards(ContentTenantGuard, RolesGuard)
  duplicate(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Body() body: unknown,
  ) {
    return this.trips.duplicate(actor, membership, tripId, body);
  }

  @Get("trips/:tripId/participants")
  @ContentTenant("trip")
  @RequirePermission("participant:read", "participant")
  @UseGuards(ContentTenantGuard, RolesGuard)
  listParticipants(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
  ) {
    return this.trips.listParticipants(actor, membership, tripId);
  }

  @Post("trips/:tripId/participants")
  @ContentTenant("trip")
  @RequirePermission("participant:add", "participant")
  @UseGuards(ContentTenantGuard, RolesGuard)
  addParticipant(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Body() body: unknown,
  ) {
    return this.trips.addParticipant(actor, membership, tripId, body);
  }

  @Delete("trips/:tripId/participants/:userId")
  @HttpCode(200)
  @ContentTenant("trip")
  @RequirePermission("participant:remove", "participant")
  @UseGuards(ContentTenantGuard, RolesGuard)
  removeParticipant(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Param("userId") userId: string,
  ) {
    return this.trips.removeParticipant(actor, membership, tripId, userId);
  }

  @Patch("trips/:tripId/participants/:userId")
  @ContentTenant("trip")
  @RequirePermission("trip:update", "trip")
  @UseGuards(ContentTenantGuard, RolesGuard)
  updateParticipant(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    return this.trips.updateParticipant(actor, membership, tripId, userId, body);
  }

  @Get("trips/:tripId/access-grants")
  @ContentTenant("trip")
  @RequirePermission("trip:read", "trip")
  @UseGuards(ContentTenantGuard, RolesGuard)
  listAccessGrants(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
  ) {
    return this.trips.listAccessGrants(actor, membership, tripId);
  }

  @Put("trips/:tripId/access-grants")
  @ContentTenant("trip")
  @RequirePermission("trip:update", "trip")
  @UseGuards(ContentTenantGuard, RolesGuard)
  setAccessGrants(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Body() body: unknown,
  ) {
    return this.trips.setAccessGrants(actor, membership, tripId, body);
  }

  @Get("trips/:tripId/activity")
  @ContentTenant("trip")
  @RequirePermission("activity:read", "trip")
  @UseGuards(ContentTenantGuard, RolesGuard)
  activity(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Query() query: unknown,
  ) {
    return this.trips.listActivity(actor, membership, tripId, query);
  }

  @Get("trips/:tripId/stops")
  @ContentTenant("trip")
  @RequirePermission("stop:read", "stop")
  @UseGuards(ContentTenantGuard, RolesGuard)
  listStops(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
  ) {
    return this.stops.list(actor, membership, tripId);
  }

  @Post("trips/:tripId/stops")
  @ContentTenant("trip")
  @RequirePermission("stop:create", "stop")
  @UseGuards(ContentTenantGuard, RolesGuard)
  createStop(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Body() body: unknown,
  ) {
    return this.stops.create(actor, membership, tripId, body);
  }

  @Patch("stops/:stopId")
  @ContentTenant("stop")
  @RequirePermission("stop:update", "stop")
  @UseGuards(ContentTenantGuard, RolesGuard)
  updateStop(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("stopId") stopId: string,
    @Body() body: unknown,
  ) {
    return this.stops.update(actor, membership, stopId, body);
  }

  @Delete("stops/:stopId")
  @HttpCode(200)
  @ContentTenant("stop")
  @RequirePermission("stop:delete", "stop")
  @UseGuards(ContentTenantGuard, RolesGuard)
  removeStop(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("stopId") stopId: string,
  ) {
    return this.stops.remove(actor, membership, stopId);
  }

  @Post("trips/:tripId/stops/reorder")
  @HttpCode(200)
  @ContentTenant("trip")
  @RequirePermission("stop:reorder", "stop")
  @UseGuards(ContentTenantGuard, RolesGuard)
  reorderStops(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Body() body: unknown,
  ) {
    return this.stops.reorder(actor, membership, tripId, body);
  }
}
