import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { canPlatform, type AdminAction } from "@roamlog/contracts";

import type { AuthenticatedRequest } from "../../common/guards/actor-context.js";
import { ADMIN_PERMISSION_METADATA } from "./admin.decorator.js";

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new UnauthorizedException({
        code: "UNAUTHENTICATED",
        message: "A valid session is required.",
      });
    }

    const action =
      (Reflect.getMetadata(ADMIN_PERMISSION_METADATA, context.getHandler()) as
        | AdminAction
        | undefined) ??
      (Reflect.getMetadata(ADMIN_PERMISSION_METADATA, context.getClass()) as AdminAction | undefined);

    if (!action || !canPlatform(request.user.platformRole, action)) {
      throw new ForbiddenException({
        code: "ADMIN_ACCESS_DENIED",
        message: "This Admin action is not available for your platform role.",
      });
    }

    return true;
  }
}
