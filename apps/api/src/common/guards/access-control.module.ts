import { Global, Module } from "@nestjs/common";

import { AuthModule } from "../../modules/auth/auth.module.js";
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
    PermissionService,
    WorkspaceAccessService,
    SessionGuard,
    VerifiedEmailGuard,
    TenantGuard,
    RolesGuard,
  ],
  exports: [
    PermissionService,
    WorkspaceAccessService,
    SessionGuard,
    VerifiedEmailGuard,
    TenantGuard,
    RolesGuard,
  ],
})
export class AccessControlModule {}
