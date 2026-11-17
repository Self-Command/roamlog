import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { EmptyBodySchema } from "@roamlog/contracts";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { VerifiedEmailGuard } from "../../common/guards/verified-email.guard.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { InvitationAcceptanceService } from "./invitation-acceptance.service.js";
import { InvitationTokenRedactionGuard } from "./invitation-token-redaction.guard.js";

@Controller("invitations")
@UseGuards(InvitationTokenRedactionGuard, SessionGuard, VerifiedEmailGuard)
export class InvitationAcceptanceController {
  constructor(
    @Inject(InvitationAcceptanceService)
    private readonly invitations: InvitationAcceptanceService,
  ) {}

  @Post(":token/accept")
  @HttpCode(HttpStatus.OK)
  accept(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("token") token: string,
    @Body() body: unknown,
  ) {
    parseRequest(EmptyBodySchema, body ?? {});
    return this.invitations.accept(actor, token);
  }
}
