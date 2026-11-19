import { Global, Module } from "@nestjs/common";

import { AuthModule } from "../../modules/auth/auth.module.js";
import {
  ADMIN_AUTHZ_PORT,
  AdminAuthzService,
} from "../../modules/admin/admin-authz.service.js";
import { PermissionService } from "../services/permission.service.js";
import { WorkspaceAccessService } from "../services/workspace-access.service.js";
import { RolesGuard } from "./roles.guard.js";
import { SessionGuard } from "./session.guard.js";
import { TenantGuard } from "./tenant.guard.js";
import { VerifiedEmailGuard } from "./verified-email.guard.js";

@Global()
@Module({
  imports: [AuthModule],
  providers: [
    // Global singleton for the admin authorization seam: both AdminModule and
    // SettingsModule guards/controllers resolve the same instance, so a PATCH
    // invalidation is visible to every Admin route in this process.
    AdminAuthzService,
    { provide: ADMIN_AUTHZ_PORT, useExisting: AdminAuthzService },
    PermissionService,
    WorkspaceAccessService,
    SessionGuard,
    VerifiedEmailGuard,
    TenantGuard,
    RolesGuard,
  ],
  exports: [
    AdminAuthzService,
    ADMIN_AUTHZ_PORT,
    PermissionService,
    WorkspaceAccessService,
    SessionGuard,
    VerifiedEmailGuard,
    TenantGuard,
    RolesGuard,
  ],
})
export class AccessControlModule {}
