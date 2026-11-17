import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IdempotencyKeySchema } from "@roamlog/contracts";

import { CurrentActor, type AuthenticatedActor } from "../../common/guards/actor-context.js";
import { RequirePermission } from "../../common/guards/require-permission.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { IdempotencyService } from "../idempotency/idempotency.service.js";
import { InvitationQueryService } from "./invitation-query.service.js";
import { InvitationsService } from "./invitations.service.js";

@Controller("workspaces/:workspaceId/invitations")
@UseGuards(TenantGuard, RolesGuard)
export class WorkspaceInvitationsController {
  constructor(
    @Inject(InvitationsService) private readonly invitations: InvitationsService,
    @Inject(InvitationQueryService)
    private readonly invitationQueries: InvitationQueryService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @RequirePermission("invitation:create", "invitation")
  async create(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey) {
      return this.invitations.create(actor, workspaceId, body);
    }
    const key = parseRequest(IdempotencyKeySchema, idempotencyKey);
    return this.idempotency.run(`invitation:create:${actor.user.id}:${workspaceId}`, key, () =>
      this.invitations.create(actor, workspaceId, body),
    );
  }

  @Get()
  @RequirePermission("invitation:read", "invitation")
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("workspaceId") workspaceId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.invitationQueries.list(actor, workspaceId, query);
  }

  @Delete(":invitationId")
  @RequirePermission("invitation:revoke", "invitation")
  revoke(
    @CurrentActor() actor: AuthenticatedActor,
    @Param("workspaceId") workspaceId: string,
    @Param("invitationId") invitationId: string,
  ) {
    return this.invitations.revoke(actor, workspaceId, invitationId);
  }
}
