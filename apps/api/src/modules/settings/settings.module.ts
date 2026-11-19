import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { AdminSettingsController } from "./admin-settings.controller.js";
import { PublicSettingsController } from "./public-settings.controller.js";
import { SettingsService } from "./settings.service.js";
import { SettingsSaveProbeService } from "./settings-save-probe.service.js";
import { SETTINGS_REGISTRY, SETTINGS_REGISTRY_TOKEN } from "./settings.registry.js";

@Module({
  imports: [AccessControlModule, AuditModule],
  controllers: [AdminSettingsController, PublicSettingsController],
  providers: [
    SettingsService,
    // One-line registration required for the controller's constructor
    // dependency; it keeps the existing providers and exports untouched.
    SettingsSaveProbeService,
    { provide: SETTINGS_REGISTRY_TOKEN, useValue: SETTINGS_REGISTRY },
  ],
  exports: [SettingsService],
})
export class SettingsModule {}
