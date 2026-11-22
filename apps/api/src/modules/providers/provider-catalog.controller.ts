import { Controller, Get, UseGuards } from "@nestjs/common";

import { SessionGuard } from "../../common/guards/session.guard.js";
import { AdminGuard } from "../admin/admin.guard.js";
import { RequireAdminAction } from "../admin/admin.decorator.js";
import { PlatformTwoFactorGuard } from "../admin/platform-two-factor.guard.js";
import { providerCatalogResponse } from "./provider-catalog.js";

@Controller("admin/provider-catalog")
@UseGuards(SessionGuard, PlatformTwoFactorGuard, AdminGuard)
export class ProviderCatalogController {
  @Get()
  @RequireAdminAction("admin:settings:read")
  catalog() {
    return providerCatalogResponse();
  }
}
