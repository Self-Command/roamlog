import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { AdminGuard } from "./admin.guard.js";
import { RequireAdminAction } from "./admin.decorator.js";
import { AdminUsersService } from "./admin-users.service.js";

@Controller("admin/users")
@UseGuards(SessionGuard, AdminGuard)
export class AdminUsersController {
  constructor(@Inject(AdminUsersService) private readonly users: AdminUsersService) {}

  @Get()
  @RequireAdminAction("admin:users:read")
  list(@CurrentActor() actor: AuthenticatedActor, @Query() query: Record<string, unknown>) {
    return this.users.list(actor, query);
  }

  @Get(":id")
  @RequireAdminAction("admin:users:read")
  get(@CurrentActor() actor: AuthenticatedActor, @Param("id") id: string) {
    return this.users.get(actor, id);
  }

  @Patch(":id")
  @RequireAdminAction("admin:users:read")
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.users.update(actor, id, body);
  }

  @Post(":id/force-logout")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:users:force-logout")
  forceLogout(@CurrentActor() actor: AuthenticatedActor, @Param("id") id: string) {
    return this.users.forceLogout(actor, id);
  }

  @Post(":id/reset-2fa")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:users:reset-2fa")
  resetTwoFactor(@CurrentActor() actor: AuthenticatedActor, @Param("id") id: string) {
    return this.users.resetTwoFactor(actor, id);
  }

  @Delete(":id")
  @RequireAdminAction("admin:users:delete")
  remove(@CurrentActor() actor: AuthenticatedActor, @Param("id") id: string) {
    return this.users.remove(actor, id);
  }
}
