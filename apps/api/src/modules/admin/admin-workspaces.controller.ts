import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { AdminGuard } from "./admin.guard.js";
import { RequireAdminAction } from "./admin.decorator.js";
import { AdminWorkspacesService } from "./admin-workspaces.service.js";
import { PlatformTwoFactorGuard } from "./platform-two-factor.guard.js";

@Controller("admin/workspaces")
@UseGuards(SessionGuard, PlatformTwoFactorGuard, AdminGuard)
export class AdminWorkspacesController {
  constructor(
    @Inject(AdminWorkspacesService) private readonly workspaces: AdminWorkspacesService,
  ) {}

  @Get()
  @RequireAdminAction("admin:workspaces:read")
  list(@CurrentActor() actor: AuthenticatedActor, @Query() query: Record<string, unknown>) {
    return this.workspaces.list(actor, query);
  }

  @Get(":id")
  @RequireAdminAction("admin:workspaces:read")
  get(@CurrentActor() actor: AuthenticatedActor, @Param("id") id: string) {
    return this.workspaces.get(actor, id);
  }

  @Patch(":id")
  @RequireAdminAction("admin:workspaces:read")
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.workspaces.update(actor, id, body);
  }

  @Delete(":id")
  @RequireAdminAction("admin:workspaces:delete")
  remove(@CurrentActor() actor: AuthenticatedActor, @Param("id") id: string) {
    return this.workspaces.remove(actor, id);
  }
}
