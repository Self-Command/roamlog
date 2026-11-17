import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IdempotencyKeySchema } from "@roamlog/contracts";

import {
  CurrentActor,
  CurrentWorkspaceMembership,
  type AuthenticatedActor,
} from "../../common/guards/actor-context.js";
import { RequirePermission } from "../../common/guards/require-permission.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { MediaPresignRateLimitGuard } from "../../common/security/media-presign-rate-limit.guard.js";
import { parseRequest } from "../../common/services/request-validation.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { IdempotencyService } from "../idempotency/idempotency.service.js";
import { ContentTenant } from "../trips/content-tenant.decorator.js";
import { ContentTenantGuard } from "../trips/content-tenant.guard.js";
import { MediaService } from "./media.service.js";
import { MediaTenantGuard } from "./media-tenant.guard.js";

@Controller()
export class MediaController {
  constructor(
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  @Post("workspaces/:workspaceId/media/presign")
  @RequirePermission("media:presign", "media")
  @UseGuards(MediaPresignRateLimitGuard, TenantGuard, RolesGuard)
  presign(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Body() body: unknown,
  ) {
    return this.media.presign(actor, membership, body);
  }

  @Post("media/:mediaId/complete")
  @HttpCode(200)
  @RequirePermission("media:complete", "media")
  @UseGuards(MediaTenantGuard, RolesGuard)
  complete(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("mediaId") mediaId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey) {
      return this.media.complete(actor, membership, mediaId, body);
    }
    const key = parseRequest(IdempotencyKeySchema, idempotencyKey);
    return this.idempotency.run(
      `media:complete:${actor.user.id}:${mediaId}`,
      key,
      () => this.media.complete(actor, membership, mediaId, body),
    );
  }

  @Get("workspaces/:workspaceId/media")
  @RequirePermission("media:read", "media")
  @UseGuards(TenantGuard, RolesGuard)
  listWorkspace(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Query() query: unknown,
  ) {
    return this.media.listWorkspace(actor, membership, query);
  }

  @Get("trips/:tripId/media")
  @ContentTenant("trip")
  @RequirePermission("media:read", "media")
  @UseGuards(ContentTenantGuard, RolesGuard)
  listTrip(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Query() query: unknown,
  ) {
    return this.media.listTrip(actor, membership, tripId, query);
  }

  @Delete("media/:mediaId")
  @HttpCode(200)
  @RequirePermission("media:delete", "media")
  @UseGuards(MediaTenantGuard, RolesGuard)
  remove(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("mediaId") mediaId: string,
  ) {
    return this.media.remove(actor, membership, mediaId);
  }

  @Patch("media/:mediaId")
  @RequirePermission("media:update", "media")
  @UseGuards(MediaTenantGuard, RolesGuard)
  update(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("mediaId") mediaId: string,
    @Body() body: unknown,
  ) {
    return this.media.update(actor, membership, mediaId, body);
  }

  @Post("trips/:tripId/cover")
  @HttpCode(200)
  @ContentTenant("trip")
  @RequirePermission("trip:set-cover", "media")
  @UseGuards(ContentTenantGuard, RolesGuard)
  setCover(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Body() body: unknown,
  ) {
    return this.media.setCover(actor, membership, tripId, body);
  }
}
