import { Body, Controller, Get, Inject, Patch, UseGuards } from "@nestjs/common";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { AdminGuard } from "./admin.guard.js";
import { RequireAdminAction } from "./admin.decorator.js";
import { AdminPermissionsService } from "./admin-permissions.service.js";
import { PlatformTwoFactorGuard } from "./platform-two-factor.guard.js";

@Controller("admin/permissions")
@UseGuards(SessionGuard, PlatformTwoFactorGuard, AdminGuard)
export class AdminPermissionsController {
  constructor(
    @Inject(AdminPermissionsService) private readonly permissions: AdminPermissionsService,
  ) {}

  @Get()
  @RequireAdminAction("admin:permissions:read")
  get(@CurrentActor() actor: AuthenticatedActor) {
    return this.permissions.get(actor);
  }

  @Patch()
  @RequireAdminAction("admin:permissions:write")
  update(@CurrentActor() actor: AuthenticatedActor, @Body() body: unknown) {
    return this.permissions.update(actor, body);
  }
}