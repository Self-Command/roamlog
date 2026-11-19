import { Global, Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { AuditModule } from "../audit/audit.module.js";
import { AdminGuard } from "../admin/admin.guard.js";
import { PlatformTwoFactorGuard } from "../admin/platform-two-factor.guard.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { SETTINGS_REGISTRY } from "../settings/settings.registry.js";
import { SettingsModule } from "../settings/settings.module.js";
import { SettingsService } from "../settings/settings.service.js";
import {
  STORAGE_ENV_SETTINGS,
  STORAGE_SETTINGS_READER,
  STORAGE_SETTINGS_REGISTRY,
  StorageSettingsConsumer,
} from "../settings/storage-settings.consumer.js";
import { StorageAdminController } from "./storage-admin.controller.js";
import {
  buildStorageClients,
  type StorageClientBuilder,
} from "./storage-clients.js";
import { STORAGE_CLIENT_BUILDER, StorageClientFactory } from "./storage-client.factory.js";
import { StorageProbeService } from "./storage-probe.service.js";
import { StorageService } from "./storage.service.js";

@Global()
@Module({
  imports: [AccessControlModule, AuditModule, SettingsModule],
  controllers: [StorageAdminController],
  providers: [
    {
      provide: STORAGE_ENV_SETTINGS,
      useFactory: (config: AppConfigService) => config.storageSettings,
      inject: [AppConfigService],
    },
    {
      provide: STORAGE_CLIENT_BUILDER,
      useValue: buildStorageClients satisfies StorageClientBuilder,
    },
    { provide: STORAGE_SETTINGS_READER, useExisting: SettingsService },
    { provide: STORAGE_SETTINGS_REGISTRY, useValue: SETTINGS_REGISTRY },
    AdminGuard,
    PlatformTwoFactorGuard,
    StorageSettingsConsumer,
    StorageClientFactory,
    StorageProbeService,
    {
      provide: StorageService,
      useFactory: (config: AppConfigService, logger: PinoLoggerService, factory: StorageClientFactory) =>
        new StorageService(config.storageSettings, logger, undefined, undefined, factory),
      inject: [AppConfigService, PinoLoggerService, StorageClientFactory],
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}