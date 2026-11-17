import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { RequirePermission } from "../../common/guards/require-permission.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { VerifiedEmailGuard } from "../../common/guards/verified-email.guard.js";
import { WorkspacesService } from "./workspaces.service.js";

@Controller("workspaces")
export class WorkspacesController {
  constructor(@Inject(WorkspacesService) private readonly workspaces: WorkspacesService) {}

  @Post()
  @UseGuards(SessionGuard, VerifiedEmailGuard)
  create(@CurrentActor() actor: AuthenticatedActor, @Body() body: unknown) {
    return this.workspaces.create(actor, body);
  }

  @Get()
  @UseGuards(SessionGuard, VerifiedEmailGuard)
  list(@CurrentActor() actor: AuthenticatedActor) {
    return this.workspaces.list(actor);
  }

  @Get(":workspaceId")
  @RequirePermission("workspace:read", "workspace")
  @UseGuards(TenantGuard, RolesGuard)
  get(@CurrentActor() actor: AuthenticatedActor, @Param("workspaceId") workspaceId: string) {
    return this.workspaces.get(actor, workspaceId);
  }

  @Patch(":workspaceId")
  @RequirePermission("workspace:update", "workspace")
  @UseGuards(TenantGuard, RolesGuard)
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
  ) {
    return this.workspaces.update(actor, workspaceId, body);
  }

  @Delete(":workspaceId")
  @RequirePermission("workspace:delete", "workspace")
  @UseGuards(TenantGuard, RolesGuard)
  remove(@CurrentActor() actor: AuthenticatedActor, @Param("workspaceId") workspaceId: string) {
    return this.workspaces.remove(actor, workspaceId);
  }
}
