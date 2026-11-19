import { ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { AdminAction } from "@roamlog/contracts";

import type { AuthenticatedRequest } from "../../common/guards/actor-context.js";
import { ADMIN_AUTHZ_PORT, type AdminAuthzPort } from "./admin-authz.service.js";
import { ADMIN_PERMISSION_METADATA } from "./admin.decorator.js";

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(ADMIN_AUTHZ_PORT) private readonly authz: AdminAuthzPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    if (!action) {
      throw new ForbiddenException({
        code: "ADMIN_ACCESS_DENIED",
        message: "This Admin action is not available for your platform role.",
      });
    }

    // Deliberately uncaught: an unavailable authorization source is a 500, not a
    // silent allow. The service itself degrades to the compiled matrix when only
    // the override table is unavailable.
    const granted = await this.authz.getEffectiveActions(request.user.platformRole);

    if (!granted.has(action)) {
      throw new ForbiddenException({
        code: "ADMIN_ACCESS_DENIED",
        message: "This Admin action is not available for your platform role.",
      });
    }

    // Hand the resolved set to downstream service-level assertions. Without it
    // a `granted=true` override would pass the guard and then be rejected by the
    // compiled-matrix check inside the service.
    request.adminActions = granted;
    return true;
  }
}