import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { AdminGuard } from "../admin/admin.guard.js";
import { PlatformTwoFactorGuard } from "../admin/platform-two-factor.guard.js";
import { AuditModule } from "../audit/audit.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { RedisModule } from "../redis/redis.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { ProviderCatalogController } from "./provider-catalog.controller.js";
import { ProviderConfigService } from "./provider-config.service.js";
import { ProviderGroupsController } from "./provider-groups.controller.js";
import { ProviderHealthService } from "./provider-health.service.js";
import { ProviderEgressGuard } from "./provider-egress.js";
import { ProviderModelDiscoveryService } from "./provider-model-discovery.service.js";
import { ProviderModelService } from "./provider-model.service.js";
import { ProviderModelsController } from "./provider-models.controller.js";
import { ProviderProbeService } from "./provider-probe.service.js";
import { ProviderRuntimeService } from "./provider-runtime.service.js";
import { ProviderSecretService } from "./provider-secret.service.js";
import { ProvidersController } from "./providers.controller.js";

@Module({
  imports: [PrismaModule, RedisModule, AuditModule, AccessControlModule, SettingsModule],
  controllers: [
    ProviderCatalogController,
    ProviderGroupsController,
    ProvidersController,
    ProviderModelsController,
  ],
  providers: [
    AdminGuard,
    PlatformTwoFactorGuard,
    ProviderConfigService,
    ProviderSecretService,
    ProviderHealthService,
    ProviderEgressGuard,
    ProviderModelDiscoveryService,
    ProviderModelService,
    ProviderProbeService,
    ProviderRuntimeService,
  ],
  exports: [
    ProviderConfigService,
    ProviderSecretService,
    ProviderHealthService,
    ProviderEgressGuard,
    ProviderModelDiscoveryService,
    ProviderModelService,
    ProviderProbeService,
    ProviderRuntimeService,
  ],
})
export class ProvidersModule {}
