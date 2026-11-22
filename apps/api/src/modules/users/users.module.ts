import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { MediaUrlModule } from "../media/media-url.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { WorkspacesModule } from "../workspaces/workspaces.module.js";
import { AppearanceController } from "./appearance.controller.js";
import { AppearanceService } from "./appearance.service.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";

@Module({
  imports: [AccessControlModule, AuditModule, WorkspacesModule, MediaUrlModule, SettingsModule],
  controllers: [UsersController, AppearanceController],
  providers: [UsersService, AppearanceService],
  exports: [UsersService],
})
export class UsersModule {}
