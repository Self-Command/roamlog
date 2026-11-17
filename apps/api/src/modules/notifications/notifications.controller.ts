import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import {
  CurrentActor,
  type AuthenticatedActor,
} from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { VerifiedEmailGuard } from "../../common/guards/verified-email.guard.js";
import { NotificationsService } from "./notifications.service.js";

@Controller("me")
@UseGuards(SessionGuard, VerifiedEmailGuard)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get("notifications")
  list(@CurrentActor() actor: AuthenticatedActor, @Query() query: unknown) {
    return this.notifications.list(actor, query);
  }

  @Patch("notifications/:id/read")
  markRead(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("id") id: string,
  ) {
    return this.notifications.markRead(actor, id);
  }

  @Post("notifications/read-all")
  @HttpCode(200)
  readAll(@CurrentActor() actor: AuthenticatedActor) {
    return this.notifications.readAll(actor);
  }

  @Get("notification-preferences")
  preferences(@CurrentActor() actor: AuthenticatedActor) {
    return this.notifications.listPreferences(actor);
  }

  @Patch("notification-preferences")
  updatePreferences(
    @CurrentActor() actor: AuthenticatedActor,
    @Body() body: unknown,
  ) {
    return this.notifications.updatePreferences(actor, body);
  }
}
