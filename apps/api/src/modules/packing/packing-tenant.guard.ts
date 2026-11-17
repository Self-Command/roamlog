import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { UuidV7Schema } from "@roamlog/contracts";

import type { AuthenticatedRequest } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { VerifiedEmailGuard } from "../../common/guards/verified-email.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class PackingTenantGuard implements CanActivate {
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
    const itemId = request.params.itemId;
    if (typeof itemId !== "string" || !UuidV7Schema.safeParse(itemId).success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "A valid packing item id is required.",
      });
    }
    const item = await this.prisma.client.packingItem.findFirst({
      where: { id: itemId, deletedAt: null, trip: { deletedAt: null } },
      select: { workspaceId: true },
    });
    if (!item) {
      throw new NotFoundException({
        code: "PACKING_ITEM_NOT_FOUND",
        message: "The requested packing item was not found.",
      });
    }
    request.params.workspaceId = item.workspaceId;
    return this.tenantGuard.canActivate(context);
  }
}
