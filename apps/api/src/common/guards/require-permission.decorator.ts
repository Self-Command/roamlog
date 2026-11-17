import { SetMetadata } from "@nestjs/common";
import type { ResourceKind, WorkspaceAction } from "@roamlog/contracts";

export const PERMISSION_METADATA = "roamlog:permission";

export interface RequiredPermission {
  action: WorkspaceAction;
  resource: ResourceKind;
}

export function RequirePermission(
  action: WorkspaceAction,
  resource: ResourceKind,
): MethodDecorator & ClassDecorator {
  return SetMetadata(PERMISSION_METADATA, { action, resource } satisfies RequiredPermission);
}
