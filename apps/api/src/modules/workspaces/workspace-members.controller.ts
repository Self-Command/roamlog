import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { TransferOwnershipRequestSchema } from "@roamlog/contracts";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { RequirePermission } from "../../common/guards/require-permission.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { WorkspaceMembersService } from "./workspace-members.service.js";
import { WorkspaceOwnershipService } from "./workspace-ownership.service.js";

@Controller("workspaces/:workspaceId")
@UseGuards(TenantGuard, RolesGuard)
export class WorkspaceMembersController {
  constructor(
    @Inject(WorkspaceMembersService)
    private readonly members: WorkspaceMembersService,
    @Inject(WorkspaceOwnershipService)
    private readonly ownership: WorkspaceOwnershipService,
  ) {}

  @Get("members")
  @RequirePermission("member:read", "member")
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("workspaceId") workspaceId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.members.list(actor, workspaceId, query);
  }

  @Patch("members/:memberId")
  @RequirePermission("member:update-role", "member")
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("workspaceId") workspaceId: string,
    @Param("memberId") memberId: string,
    @Body() body: unknown,
  ) {
    return this.members.update(actor, workspaceId, memberId, body);
  }

  @Delete("members/:memberId")
  @RequirePermission("member:remove", "member")
  remove(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("workspaceId") workspaceId: string,
    @Param("memberId") memberId: string,
  ) {
    return this.members.remove(actor, workspaceId, memberId);
  }

  @Post("transfer-ownership")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("workspace:transfer-ownership", "workspace")
  transferOwnership(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
  ) {
    const input = parseRequest(TransferOwnershipRequestSchema, body);
    return this.ownership.transferOwnership(actor, workspaceId, input.toUserId);
  }
}
