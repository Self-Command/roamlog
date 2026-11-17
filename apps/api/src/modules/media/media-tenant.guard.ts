import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { UuidV7Schema } from "@roamlog/contracts";

import type { AuthenticatedRequest } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { VerifiedEmailGuard } from "../../common/guards/verified-email.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class MediaTenantGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SessionGuard) private readonly sessionGuard: SessionGuard,
    @Inject(VerifiedEmailGuard) private readonly verifiedEmailGuard: VerifiedEmailGuard,
    @Inject(TenantGuard) private readonly tenantGuard: TenantGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.sessionGuard.canActivate(context);
    this.verifiedEmailGuard.canActivate(context);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const mediaId = request.params.mediaId;
    if (typeof mediaId !== "string" || !UuidV7Schema.safeParse(mediaId).success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "A valid media id is required.",
      });
    }

    const media = await this.prisma.client.media.findFirst({
      where: { id: mediaId, deletedAt: null },
      select: { workspaceId: true },
    });
    if (!media) {
      throw new NotFoundException({
        code: "MEDIA_NOT_FOUND",
        message: "The requested media was not found.",
      });
    }

    request.params.workspaceId = media.workspaceId;
    return this.tenantGuard.canActivate(context);
  }
}
