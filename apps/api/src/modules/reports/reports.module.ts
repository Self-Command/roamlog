import { Module } from "@nestjs/common";

import { AdminGuard } from "../admin/admin.guard.js";
import { PlatformTwoFactorGuard } from "../admin/platform-two-factor.guard.js";
import { AuditModule } from "../audit/audit.module.js";
import { AdminReportsController } from "./admin-reports.controller.js";
import { AdminReportsService } from "./admin-reports.service.js";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";

@Module({
  imports: [AuditModule],
  controllers: [ReportsController, AdminReportsController],
  providers: [
    ReportsService,
    AdminReportsService,
    // The Admin guards are provided by AdminModule, which does not export
    // them; their dependencies (authorization port, Prisma, config) are global,
    // so a local provider instance is correct and avoids editing AdminModule.
    AdminGuard,
    PlatformTwoFactorGuard,
  ],
})
export class ReportsModule {}