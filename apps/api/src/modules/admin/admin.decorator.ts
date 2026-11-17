import { SetMetadata } from "@nestjs/common";
import type { AdminAction } from "@roamlog/contracts";

export const ADMIN_PERMISSION_METADATA = "roamlog:admin-permission";

export function RequireAdminAction(action: AdminAction): MethodDecorator & ClassDecorator {
  return SetMetadata(ADMIN_PERMISSION_METADATA, action);
}
