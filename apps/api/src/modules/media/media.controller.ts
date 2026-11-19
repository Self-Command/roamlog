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

  @Post("workspaces/:workspaceId/media/:mediaId/motion/presign")
  @RequirePermission("media:presign", "media")
  @UseGuards(MediaPresignRateLimitGuard, MediaTenantGuard, RolesGuard)
  presignMotion(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("mediaId") mediaId: string,
    @Body() body: unknown,
  ) {
    return this.media.presignMotion(actor, membership, mediaId, body);
  }

  /**
   * Completion callback for the paired motion asset (`POST .../motion`).
   *
   * Same permission and tenant rules as `complete`: the body is validated by
   * `CompleteMediaMotionRequestSchema`, and the object is HEADed before a
   * `MediaMotion` row exists.
   */
  @Post("workspaces/:workspaceId/media/:mediaId/motion")
  @HttpCode(200)
  @RequirePermission("media:complete", "media")
  @UseGuards(MediaTenantGuard, RolesGuard)
  completeMotion(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("mediaId") mediaId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey) {
      return this.media.completeMotion(actor, membership, mediaId, body);
    }
    const key = parseRequest(IdempotencyKeySchema, idempotencyKey);
    return this.idempotency.run(
      `media:motion:${actor.user.id}:${mediaId}`,
      key,
      () => this.media.completeMotion(actor, membership, mediaId, body),
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

  @Get("media/:mediaId")
  @RequirePermission("media:read", "media")
  @UseGuards(MediaTenantGuard, RolesGuard)
  getOne(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("mediaId") mediaId: string,
  ) {
    return this.media.getOne(actor, membership, mediaId);
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
