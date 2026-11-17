import { ForbiddenException, Injectable } from "@nestjs/common";
import {
  can,
  type ResourceKind,
  type WorkspaceAction,
  type WorkspaceRole,
} from "@roamlog/contracts";

@Injectable()
export class PermissionService {
  can(
    actor: WorkspaceRole | { role: WorkspaceRole },
    action: WorkspaceAction,
    resource: ResourceKind,
  ): boolean {
    const role = typeof actor === "string" ? actor : actor.role;
    return can(role, action, resource);
  }

  assertCan(
    actor: WorkspaceRole | { role: WorkspaceRole },
    action: WorkspaceAction,
    resource: ResourceKind,
  ): void {
    if (!this.can(actor, action, resource)) {
      throw new ForbiddenException({
        code: "WORKSPACE_ROLE_FORBIDDEN",
        message: "Your Workspace role does not permit this action.",
      });
    }
  }
}
