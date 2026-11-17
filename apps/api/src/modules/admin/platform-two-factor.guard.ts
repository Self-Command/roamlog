import { ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";

import type { AuthenticatedRequest } from "../../common/guards/actor-context.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class PlatformTwoFactorGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new UnauthorizedException({
        code: "UNAUTHENTICATED",
        message: "A valid session is required.",
      });
    }

    if (!this.config.adminTwoFactorEnforced || request.user.platformRole === "user") {
      return true;
    }

    const state = await this.prisma.client.user.findUnique({
      where: { id: request.user.id },
      select: {
        twoFactorEnabled: true,
        twoFactors: {
          where: { verified: true },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!state?.twoFactorEnabled || state.twoFactors.length === 0) {
      throw new ForbiddenException({
        code: "ADMIN_2FA_REQUIRED",
        message: "Enroll and verify TOTP before accessing the Admin API.",
      });
    }

    return true;
  }
}
