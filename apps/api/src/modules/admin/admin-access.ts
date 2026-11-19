import { ForbiddenException } from "@nestjs/common";
import { canPlatform, type AdminAction, type User } from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";

function forbidden(action: string, platformRole: string): ForbiddenException {
  return new ForbiddenException({
    code: "ADMIN_ACTION_FORBIDDEN",
    message: "Your platform role does not permit this Admin action.",
    action,
    platformRole,
  });
}

export function assertPlatformAction(user: User, action: AdminAction): void {
  if (!canPlatform(user.platformRole, action)) {
    throw forbidden(action, user.platformRole);
  }
}

export function assertAdminAction(actor: AuthenticatedActor, action: AdminAction): void {
  // Admin HTTP routes pass through AdminGuard first, which resolves the
  // permission-matrix override layer and attaches the effective set to the
  // request/actor. When present it is authoritative; callers outside an Admin
  // API request keep the compiled-matrix behavior.
  if (actor.platformActions !== undefined) {
    if (!actor.platformActions.has(action)) {
      throw forbidden(action, actor.user.platformRole);
    }
    return;
  }

  assertPlatformAction(actor.user, action);
}