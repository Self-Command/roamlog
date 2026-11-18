import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";

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

  @Get("export")
  @RequireAdminAction("admin:workspaces:delete")
  async exportCsv(
    @CurrentActor() actor: AuthenticatedActor,
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ): Promise<void> {
    const chunks = this.workspaces.exportCsv(actor, query);
    // Pull the first chunk before sending headers so validation, permission and
    // database failures still render a normal problem response.
    const first = await chunks.next();
    const generatedAt = new Date().toISOString();
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="roamlog-admin-workspaces-${generatedAt.slice(0, 19).replaceAll(":", "-")}.csv"`,
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
