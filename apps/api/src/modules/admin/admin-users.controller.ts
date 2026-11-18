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
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { AdminGuard } from "./admin.guard.js";
import { RequireAdminAction } from "./admin.decorator.js";
import { AdminUsersService } from "./admin-users.service.js";
import { PlatformTwoFactorGuard } from "./platform-two-factor.guard.js";

@Controller("admin/users")
@UseGuards(SessionGuard, PlatformTwoFactorGuard, AdminGuard)
export class AdminUsersController {
  constructor(@Inject(AdminUsersService) private readonly users: AdminUsersService) {}

  @Get()
  @RequireAdminAction("admin:users:read")
  list(@CurrentActor() actor: AuthenticatedActor, @Query() query: Record<string, unknown>) {
    return this.users.list(actor, query);
  }

  @Get("export")
  @RequireAdminAction("admin:users:delete")
  async exportCsv(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ): Promise<void> {
    const chunks = this.users.exportCsv(actor, query);
    // Pull the first chunk before sending headers so validation, permission and
    // database failures still render a normal problem response.
    const first = await chunks.next();
    const generatedAt = new Date().toISOString();
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="roamlog-admin-users-${generatedAt.slice(0, 19).replaceAll(":", "-")}.csv"`,
    );
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (!first.done && first.value) {
      response.write(first.value);
    }
    for await (const chunk of chunks) {
      response.write(chunk);
    }
    response.end();
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
