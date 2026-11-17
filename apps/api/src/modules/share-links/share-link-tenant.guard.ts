import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { UuidV7Schema } from "@roamlog/contracts";

import type { AuthenticatedRequest } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { VerifiedEmailGuard } from "../../common/guards/verified-email.guard.js";
import { ShareLinksRepository } from "./share-links.repository.js";

@Injectable()
export class ShareLinkTenantGuard implements CanActivate {
  constructor(
    @Inject(ShareLinksRepository) private readonly repository: ShareLinksRepository,
    @Inject(SessionGuard) private readonly sessionGuard: SessionGuard,
    @Inject(VerifiedEmailGuard) private readonly verifiedEmailGuard: VerifiedEmailGuard,
    @Inject(TenantGuard) private readonly tenantGuard: TenantGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.sessionGuard.canActivate(context);
    this.verifiedEmailGuard.canActivate(context);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const shareLinkId = request.params.shareLinkId;
    if (typeof shareLinkId !== "string" || !UuidV7Schema.safeParse(shareLinkId).success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "A valid share link id is required.",
      });
    }
    const link = await this.repository.findShareLinkById(shareLinkId);
    if (!link) {
      throw new NotFoundException({
        code: "SHARE_LINK_NOT_FOUND",
        message: "The requested share link was not found.",
      });
    }
    request.params.workspaceId = link.workspaceId;
    return this.tenantGuard.canActivate(context);
  }
}
