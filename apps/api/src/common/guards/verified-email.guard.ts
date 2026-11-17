import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";

import type { AuthenticatedRequest } from "./actor-context.js";

@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new UnauthorizedException({
        code: "UNAUTHENTICATED",
        message: "A valid session is required.",
      });
    }

    if (!request.user.emailVerified) {
      throw new ForbiddenException({
        code: "EMAIL_VERIFICATION_REQUIRED",
        message: "Verify your email address before continuing.",
      });
    }

    return true;
  }
}
