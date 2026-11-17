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
  assertPlatformAction(actor.user, action);
}
