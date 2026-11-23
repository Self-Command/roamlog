import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
} from "@nestjs/common";
import type { Response } from "express";

import { AppConfigService } from "../../config/app-config.service.js";
import {
  CurrentActor,
  type AuthenticatedActor,
  type AuthenticatedRequest,
} from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { VerifiedEmailGuard } from "../../common/guards/verified-email.guard.js";
import { generateUuidV7 } from "../auth/uuid.js";
import {
  DEVICE_ID_COOKIE_MAX_AGE_MS,
  DEVICE_ID_COOKIE_NAME,
  normalizeDeviceId,
} from "./device-cookie.js";
import { UsersService } from "./users.service.js";

@Controller("me")
@UseGuards(SessionGuard, VerifiedEmailGuard)
export class UsersController {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  @Get()
  getMe(@CurrentActor() actor: AuthenticatedActor) {
    return this.users.getMe(actor);
  }

  @Patch()
  updateMe(@CurrentActor() actor: AuthenticatedActor, @Body() body: unknown) {
    return this.users.updateMe(actor, body);
  }

  @Get("workspaces")
  listMyWorkspaces(@CurrentActor() actor: AuthenticatedActor) {
    return this.users.listMyWorkspaces(actor);
  }

  @Get("sessions")
  listSessions(@CurrentActor() actor: AuthenticatedActor) {
    return this.users.listSessions(actor);
  }

  @Post("device")
  @HttpCode(HttpStatus.OK)
  async associateDevice(
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const sessionId = request.authSession?.sessionId;
    if (!sessionId) {
      throw new UnauthorizedException({
        code: "UNAUTHENTICATED",
        message: "A valid session is required.",
      });
    }
    const deviceId =
      normalizeDeviceId(request.cookies?.[DEVICE_ID_COOKIE_NAME]) ?? generateUuidV7();
    response.cookie(DEVICE_ID_COOKIE_NAME, deviceId, {
      httpOnly: true,
      secure: this.config.isProduction || request.secure,
      sameSite: "lax",
      path: "/",
      maxAge: DEVICE_ID_COOKIE_MAX_AGE_MS,
    });
    return this.users.associateDevice(actor, sessionId, deviceId);
  }

  @Delete("sessions/:id")
  revokeSession(@CurrentActor() actor: AuthenticatedActor, @Param("id") id: string) {
    return this.users.revokeSession(actor, id);
  }

  @Delete()
  deleteMe(@CurrentActor() actor: AuthenticatedActor, @Body() body: unknown) {
    return this.users.deleteMe(actor, body);
  }
}
