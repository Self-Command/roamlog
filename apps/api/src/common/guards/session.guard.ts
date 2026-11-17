import { ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";

import { AuthService } from "../../modules/auth/auth.service.js";
import { PrismaService } from "../../modules/prisma/prisma.service.js";
import { presentUser } from "../services/user-presenter.js";
import type { AuthenticatedRequest } from "./actor-context.js";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user) {
      return true;
    }

    const session = await this.auth.resolveSession(request.headers);
    if (!session) {
      throw new UnauthorizedException({
        code: "UNAUTHENTICATED",
        message: "A valid session is required.",
      });
    }

    const user = await this.prisma.client.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        name: true,
        image: true,
        platformRole: true,
        status: true,
        locale: true,
        timezone: true,
        lastActiveAt: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });

    if (!user || user.deletedAt !== null) {
      throw new UnauthorizedException({
        code: "UNAUTHENTICATED",
        message: "A valid session is required.",
      });
    }

    if (user.status !== "active") {
      throw new ForbiddenException({
        code: "ACCOUNT_SUSPENDED",
        message: "This account is not available.",
      });
    }

    request.user = presentUser(user);
    request.authSession = session;
    return true;
  }
}
