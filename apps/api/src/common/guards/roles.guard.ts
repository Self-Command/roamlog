import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";

import { PermissionService } from "../services/permission.service.js";
import type { AuthenticatedRequest } from "./actor-context.js";
import { PERMISSION_METADATA, type RequiredPermission } from "./require-permission.decorator.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    @Inject(PermissionService)
    private readonly permissions: PermissionService = new PermissionService(),
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = Reflect.getMetadata(PERMISSION_METADATA, context.getHandler()) as
      RequiredPermission | undefined;
    const classRequired = Reflect.getMetadata(PERMISSION_METADATA, context.getClass()) as
      RequiredPermission | undefined;
    const permission = required ?? classRequired;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!permission || !request.workspaceMembership) {
      throw new ForbiddenException({
        code: "WORKSPACE_ROLE_FORBIDDEN",
        message: "This Workspace action is not available.",
      });
    }

    this.permissions.assertCan(
      request.workspaceMembership.role,
      permission.action,
      permission.resource,
    );
    return true;
  }
}
