import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { AdminGuard } from "../admin/admin.guard.js";
import { RequireAdminAction } from "../admin/admin.decorator.js";
import { PlatformTwoFactorGuard } from "../admin/platform-two-factor.guard.js";
import { SettingsService } from "./settings.service.js";

@Controller("admin/settings")
@UseGuards(SessionGuard, PlatformTwoFactorGuard, AdminGuard)
export class AdminSettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Get()
  @RequireAdminAction("admin:settings:read")
  list() {
    return this.settings.listAdminSettings();
  }

  @Get(":key")
  @RequireAdminAction("admin:settings:read")
  get(@Param("key") key: string) {
    return this.settings.getAdminSetting(key);
  }

  @Patch()
  @RequireAdminAction("admin:settings:write")
  update(@CurrentActor() actor: AuthenticatedActor, @Body() body: unknown) {
    return this.settings.update(actor, body);
  }

  @Post(":key/reveal")
  @HttpCode(HttpStatus.OK)
  @RequireAdminAction("admin:settings:read")
  reveal(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("key") key: string,
    @Body() body: unknown,
  ) {
    return this.settings.reveal(actor, key, body);
  }
}
