import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { AdminGuard } from "../admin/admin.guard.js";
import { RequireAdminAction } from "../admin/admin.decorator.js";
import { PlatformTwoFactorGuard } from "../admin/platform-two-factor.guard.js";
import { AdminReportsService } from "./admin-reports.service.js";

@Controller("admin/reports")
@UseGuards(SessionGuard, PlatformTwoFactorGuard, AdminGuard)
export class AdminReportsController {
  constructor(@Inject(AdminReportsService) private readonly reports: AdminReportsService) {}

  @Get()
  @RequireAdminAction("admin:content:read")
  list(@CurrentActor() actor: AuthenticatedActor, @Query() query: Record<string, unknown>) {
    return this.reports.list(actor, query);
  }

  @Get(":id")
  @RequireAdminAction("admin:content:read")
  detail(@CurrentActor() actor: AuthenticatedActor, @Param("id") id: string) {
    return this.reports.detail(actor, id);
  }

  @Post(":id/resolve")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:content:delete")
  resolve(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.reports.resolve(actor, id, body);
  }
}