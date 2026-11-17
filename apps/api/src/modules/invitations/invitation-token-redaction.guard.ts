import { Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

import { REDACTED_INVITATION_ACCEPT_PATH } from "../../common/services/log-redaction.js";

@Injectable()
export class InvitationTokenRedactionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    request.url = REDACTED_INVITATION_ACCEPT_PATH;
    request.originalUrl = REDACTED_INVITATION_ACCEPT_PATH;
    return true;
  }
}
