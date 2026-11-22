import { Body, Controller, Delete, Get, Inject, Put, Res, UseGuards } from "@nestjs/common";
import type { CookieOptions, Response } from "express";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { VerifiedEmailGuard } from "../../common/guards/verified-email.guard.js";
import { AppConfigService } from "../../config/app-config.service.js";
import {
  APPEARANCE_COOKIE_MAX_AGE_MS,
  APPEARANCE_COOKIE_NAME,
  AppearanceService,
  serializeAppearanceCookie,
} from "./appearance.service.js";

@Controller("me/appearance")
@UseGuards(SessionGuard, VerifiedEmailGuard)
export class AppearanceController {
  constructor(
    @Inject(AppearanceService) private readonly appearance: AppearanceService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  @Get()
  async get(
    @CurrentActor() actor: AuthenticatedActor,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.appearance.get(actor);
    this.writeCookie(response, result.cookie);
    return result.appearance;
  }

  @Put()
  async update(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.appearance.update(actor, body);
    this.writeCookie(response, result.cookie);
    return result.appearance;
  }

  @Delete()
  async reset(
    @CurrentActor() actor: AuthenticatedActor,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.appearance.reset(actor);
    this.writeCookie(response, result.cookie);
    return result.appearance;
  }

  private writeCookie(
    response: Response,
    cookie: Parameters<typeof serializeAppearanceCookie>[0] | null,
  ): void {
    const options = this.cookieOptions();
    if (cookie) {
      response.cookie(APPEARANCE_COOKIE_NAME, serializeAppearanceCookie(cookie), options);
      return;
    }
    response.clearCookie(APPEARANCE_COOKIE_NAME, options);
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: false,
      secure: this.config.isProduction || this.config.apiUrl.startsWith("https://"),
      sameSite: "lax",
      path: "/",
      maxAge: APPEARANCE_COOKIE_MAX_AGE_MS,
    };
  }
}
