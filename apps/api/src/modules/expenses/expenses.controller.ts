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
import { ExpenseTenantGuard } from "./expense-tenant.guard.js";
import { ExpensesService } from "./expenses.service.js";

@Controller()
@UseFilters(VersionConflictFilter)
export class ExpensesController {
  constructor(@Inject(ExpensesService) private readonly expenses: ExpensesService) {}

  @Get("trips/:tripId/expenses")
  @ContentTenant("trip")
  @RequirePermission("expense:read", "expense")
  @UseGuards(ContentTenantGuard, RolesGuard)
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Query() query: unknown,
  ) {
    return this.expenses.list(actor, membership, tripId, query);
  }

  @Post("trips/:tripId/expenses")
  @ContentTenant("trip")
  @RequirePermission("expense:create", "expense")
  @UseGuards(ContentTenantGuard, RolesGuard)
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Body() body: unknown,
  ) {
    return this.expenses.create(actor, membership, tripId, body);
  }

  @Patch("expenses/:expenseId")
  @RequirePermission("expense:update", "expense")
  @UseGuards(ExpenseTenantGuard, RolesGuard)
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("expenseId") expenseId: string,
    @Body() body: unknown,
  ) {
    return this.expenses.update(actor, membership, expenseId, body);
  }

  @Delete("expenses/:expenseId")
  @HttpCode(200)
  @RequirePermission("expense:delete", "expense")
  @UseGuards(ExpenseTenantGuard, RolesGuard)
  remove(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("expenseId") expenseId: string,
  ) {
    return this.expenses.remove(actor, membership, expenseId);
  }

  @Get("trips/:tripId/budget/summary")
  @ContentTenant("trip")
  @RequirePermission("budget:read", "budget")
  @UseGuards(ContentTenantGuard, RolesGuard)
  summary(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
  ) {
    return this.expenses.summary(actor, membership, tripId);
  }

  @Get("trips/:tripId/budget/settle-up")
  @ContentTenant("trip")
  @RequirePermission("budget:settle-up", "budget")
  @UseGuards(ContentTenantGuard, RolesGuard)
  settleUp(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
  ) {
    return this.expenses.settleUp(actor, membership, tripId);
  }
}
