import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
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
import { PublicShareRateLimitGuard } from "../../common/security/public-share-rate-limit.guard.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { ContentTenant } from "../trips/content-tenant.decorator.js";
import { ContentTenantGuard } from "../trips/content-tenant.guard.js";
import { ShareLinkTenantGuard } from "./share-link-tenant.guard.js";
import { ShareLinksService } from "./share-links.service.js";

@Controller()
export class ShareLinksController {
  constructor(@Inject(ShareLinksService) private readonly shareLinks: ShareLinksService) {}

  @Post("trips/:tripId/share-links")
  @ContentTenant("trip")
  @RequirePermission("share-link:create", "share_link")
  @UseGuards(ContentTenantGuard, RolesGuard)
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
    @Body() body: unknown,
  ) {
    return this.shareLinks.create(actor, membership, tripId, body);
  }

  @Get("trips/:tripId/share-links")
  @ContentTenant("trip")
  @RequirePermission("share-link:read", "share_link")
  @UseGuards(ContentTenantGuard, RolesGuard)
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("tripId") tripId: string,
  ) {
    return this.shareLinks.list(actor, membership, tripId);
  }

  @Delete("share-links/:shareLinkId")
  @HttpCode(200)
  @RequirePermission("share-link:revoke", "share_link")
  @UseGuards(ShareLinkTenantGuard, RolesGuard)
  revoke(
    @CurrentActor() actor: AuthenticatedActor,
    @CurrentWorkspaceMembership() membership: WorkspaceMembershipAccess,
    @Param("shareLinkId") shareLinkId: string,
  ) {
    return this.shareLinks.revoke(actor, membership, shareLinkId);
  }
}

@Controller("public/trips")
@UseGuards(PublicShareRateLimitGuard)
export class PublicShareController {
  constructor(@Inject(ShareLinksService) private readonly shareLinks: ShareLinksService) {}

  @Get(":token")
  read(@Param("token") token: string, @Query() query: unknown) {
    return this.shareLinks.readPublic(token, query);
  }
}
