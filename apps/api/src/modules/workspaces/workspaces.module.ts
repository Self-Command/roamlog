import { Module } from "@nestjs/common";

import { AccessControlModule } from "../../common/guards/access-control.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { WorkspaceMembersController } from "./workspace-members.controller.js";
import { WorkspaceMembersService } from "./workspace-members.service.js";
import { WorkspaceOwnershipService } from "./workspace-ownership.service.js";
import { WorkspacesController } from "./workspaces.controller.js";
import { WorkspacesService } from "./workspaces.service.js";

@Module({
  imports: [AccessControlModule, AuditModule],
  controllers: [WorkspacesController, WorkspaceMembersController],
  providers: [WorkspacesService, WorkspaceMembersService, WorkspaceOwnershipService],
  exports: [WorkspacesService, WorkspaceMembersService, WorkspaceOwnershipService],
})
export class WorkspacesModule {}
