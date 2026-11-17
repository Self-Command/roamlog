import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { UuidV7Schema } from "@roamlog/contracts";

import type { AuthenticatedRequest } from "../../common/guards/actor-context.js";
import { SessionGuard } from "../../common/guards/session.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { VerifiedEmailGuard } from "../../common/guards/verified-email.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class ExpenseTenantGuard implements CanActivate {
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
    const expenseId = request.params.expenseId;
    if (typeof expenseId !== "string" || !UuidV7Schema.safeParse(expenseId).success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "A valid expense id is required.",
      });
    }
    const expense = await this.prisma.client.expense.findFirst({
      where: { id: expenseId, deletedAt: null, trip: { deletedAt: null } },
      select: { workspaceId: true },
    });
    if (!expense) {
      throw new NotFoundException({
        code: "EXPENSE_NOT_FOUND",
        message: "The requested expense was not found.",
      });
    }
    request.params.workspaceId = expense.workspaceId;
    return this.tenantGuard.canActivate(context);
  }
}
