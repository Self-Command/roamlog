import { Body, Controller, Delete, Get, Inject, Param, Patch, UseGuards } from "@nestjs/common";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { VerifiedEmailGuard } from "../../common/guards/verified-email.guard.js";
import { UsersService } from "./users.service.js";

@Controller("me")
@UseGuards(SessionGuard, VerifiedEmailGuard)
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

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

  @Delete("sessions/:id")
  revokeSession(@CurrentActor() actor: AuthenticatedActor, @Param("id") id: string) {
    return this.users.revokeSession(actor, id);
  }

  @Delete()
  deleteMe(@CurrentActor() actor: AuthenticatedActor, @Body() body: unknown) {
    return this.users.deleteMe(actor, body);
  }
}
