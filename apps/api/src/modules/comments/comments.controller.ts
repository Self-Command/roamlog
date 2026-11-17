import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import {
  CurrentActor,
  CurrentWorkspaceMembership,
  type AuthenticatedActor,
} from "../../common/guards/actor-context.js";
import { RequirePermission } from "../../common/guards/require-permission.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { CommentsService } from "./comments.service.js";
import { CommentsTenantGuard } from "./comments-tenant.guard.js";

@Controller()
export class CommentsController {
  constructor(@Inject(CommentsService) private readonly comments: CommentsService) {}

  @Get("comments")
  @RequirePermission("comment:read", "comment")
  @UseGuards(CommentsTenantGuard, RolesGuard)
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Query() query: unknown,
  ) {
    return this.comments.list(actor, membership, query);
  }

  @Post("comments")
  @RequirePermission("comment:create", "comment")
  @UseGuards(CommentsTenantGuard, RolesGuard)
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Body() body: unknown,
  ) {
    return this.comments.create(actor, membership, body);
  }

  @Patch("comments/:commentId")
  @RequirePermission("comment:update", "comment")
  @UseGuards(CommentsTenantGuard, RolesGuard)
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("commentId") commentId: string,
    @Body() body: unknown,
  ) {
    return this.comments.update(actor, membership, commentId, body);
  }

  @Delete("comments/:commentId")
  @HttpCode(200)
  @RequirePermission("comment:delete", "comment")
  @UseGuards(CommentsTenantGuard, RolesGuard)
  remove(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("commentId") commentId: string,
  ) {
    return this.comments.remove(actor, membership, commentId);
  }

  @Post("comments/:commentId/resolve")
  @HttpCode(200)
  @RequirePermission("comment:resolve", "comment")
  @UseGuards(CommentsTenantGuard, RolesGuard)
  resolve(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("commentId") commentId: string,
  ) {
    return this.comments.resolve(actor, membership, commentId);
  }

  @Post("comments/:commentId/unresolve")
  @HttpCode(200)
  @RequirePermission("comment:unresolve", "comment")
  @UseGuards(CommentsTenantGuard, RolesGuard)
  unresolve(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("commentId") commentId: string,
  ) {
    return this.comments.unresolve(actor, membership, commentId);
  }
}
