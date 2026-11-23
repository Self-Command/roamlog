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
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  AiConversationListQuerySchema,
  CreateAiConversationRequestSchema,
  DeleteAiMessagesRequestSchema,
  UpdateAiConversationRequestSchema,
  UpsertAiMessageRequestSchema,
  UuidV7Schema,
} from "@roamlog/contracts";
import { z } from "zod";

import {
  CurrentActor,
  CurrentWorkspaceMembership,
  type AuthenticatedActor,
} from "../../common/guards/actor-context.js";
import { RequirePermission } from "../../common/guards/require-permission.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { parseRequest } from "../../common/services/request-validation.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { AiConversationService } from "./ai-conversation.service.js";

const ClientMessageIdSchema = z.string().min(1).max(64);

/**
 * Conversation persistence REST surface (§2.5).
 *
 * `TenantGuard` resolves the active Workspace membership for every route;
 * `RolesGuard` enforces the `@RequirePermission` action. The action/resource
 * pair is exactly the one used by `AiController.chat` (`trip:create` /
 * `trip`), so a viewer cannot read or mutate AI conversations either.
 */
@Controller("workspaces/:workspaceId/ai/conversations")
@UseGuards(TenantGuard, RolesGuard)
export class AiConversationController {
  constructor(
    @Inject(AiConversationService) private readonly conversations: AiConversationService,
  ) {}

  @Get()
  @RequirePermission("trip:create", "trip")
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Query() query: unknown,
  ) {
    return this.conversations.list(
      actor.user.id,
      membership.workspaceId,
      parseRequest(AiConversationListQuerySchema, query),
    );
  }

  @Delete()
  @RequirePermission("trip:create", "trip")
  removeAll(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
  ) {
    return this.conversations.removeAll(actor.user.id, membership.workspaceId);
  }

  @Post()
  @RequirePermission("trip:create", "trip")
  async create(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Body() body: unknown,
  ) {
    const input = parseRequest(CreateAiConversationRequestSchema, body);
    const created = await this.conversations.getOrCreate({
      workspaceId: membership.workspaceId,
      userId: actor.user.id,
      ...(input.title ? { title: input.title } : {}),
    });
    // `getOrCreate` is the frozen §2.7 primitive and returns only `{ id, title }`.
    // The REST contract for create answers a full `AiConversation`, so re-read
    // the row through the same tenant/owner-scoped fetch.
    return this.conversations.fetch(actor.user.id, membership.workspaceId, created.id);
  }

  @Get(":conversationId")
  @RequirePermission("trip:create", "trip")
  fetch(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("conversationId") conversationId: string,
  ) {
    return this.conversations.fetch(
      actor.user.id,
      membership.workspaceId,
      parseRequest(UuidV7Schema, conversationId),
    );
  }

  @Patch(":conversationId")
  @RequirePermission("trip:create", "trip")
  rename(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("conversationId") conversationId: string,
    @Body() body: unknown,
  ) {
    return this.conversations.rename(
      actor.user.id,
      membership.workspaceId,
      parseRequest(UuidV7Schema, conversationId),
      parseRequest(UpdateAiConversationRequestSchema, body),
    );
  }

  @Post(":conversationId/archive")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("trip:create", "trip")
  archive(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("conversationId") conversationId: string,
  ) {
    return this.conversations.archive(
      actor.user.id,
      membership.workspaceId,
      parseRequest(UuidV7Schema, conversationId),
    );
  }

  @Post(":conversationId/unarchive")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("trip:create", "trip")
  unarchive(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("conversationId") conversationId: string,
  ) {
    return this.conversations.unarchive(
      actor.user.id,
      membership.workspaceId,
      parseRequest(UuidV7Schema, conversationId),
    );
  }

  @Delete(":conversationId")
  @RequirePermission("trip:create", "trip")
  remove(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("conversationId") conversationId: string,
  ) {
    return this.conversations.remove(
      actor.user.id,
      membership.workspaceId,
      parseRequest(UuidV7Schema, conversationId),
    );
  }

  @Get(":conversationId/messages")
  @RequirePermission("trip:create", "trip")
  listMessages(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("conversationId") conversationId: string,
  ) {
    return this.conversations.listMessages(
      actor.user.id,
      membership.workspaceId,
      parseRequest(UuidV7Schema, conversationId),
    );
  }

  @Put(":conversationId/messages/:clientId")
  @RequirePermission("trip:create", "trip")
  upsertMessage(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("conversationId") conversationId: string,
    @Param("clientId") clientId: string,
    @Body() body: unknown,
  ) {
    return this.conversations.upsertMessage(
      actor.user.id,
      membership.workspaceId,
      parseRequest(UuidV7Schema, conversationId),
      parseRequest(ClientMessageIdSchema, clientId),
      parseRequest(UpsertAiMessageRequestSchema, body),
    );
  }

  @Delete(":conversationId/messages")
  @RequirePermission("trip:create", "trip")
  deleteMessages(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("conversationId") conversationId: string,
    @Body() body: unknown,
  ) {
    return this.conversations.deleteMessages(
      actor.user.id,
      membership.workspaceId,
      parseRequest(UuidV7Schema, conversationId),
      parseRequest(DeleteAiMessagesRequestSchema, body),
    );
  }

  @Post(":conversationId/title/generate")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("trip:create", "trip")
  generateTitle(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("conversationId") conversationId: string,
  ) {
    return this.conversations.generateTitle(
      actor.user.id,
      membership.workspaceId,
      parseRequest(UuidV7Schema, conversationId),
    );
  }
}
