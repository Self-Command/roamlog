import { Controller, Get, Inject, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { AdminGuard } from "./admin.guard.js";
import { RequireAdminAction } from "./admin.decorator.js";
import { AdminMetricsService } from "./admin-metrics.service.js";
import { AdminSystemService } from "./admin-system.service.js";
import { PlatformTwoFactorGuard } from "./platform-two-factor.guard.js";

@Controller("admin")
@UseGuards(SessionGuard, PlatformTwoFactorGuard, AdminGuard)
export class AdminDashboardController {
  constructor(
    @Inject(AdminMetricsService) private readonly metrics: AdminMetricsService,
    @Inject(AdminSystemService) private readonly system: AdminSystemService,
  ) {}

  @Get("metrics")
  @RequireAdminAction("admin:metrics:read")
  async getMetrics(
    @CurrentActor() _actor: AuthenticatedActor,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.metrics.get();
    if (result.degraded.length > 0) {
      response.setHeader("x-roamlog-degraded", result.degraded.join(","));
    }
    return result.metrics;
  }

  @Get("system")
  @RequireAdminAction("admin:system:read")
  getSystem(@CurrentActor() _actor: AuthenticatedActor) {
    return this.system.get();
  }
}
