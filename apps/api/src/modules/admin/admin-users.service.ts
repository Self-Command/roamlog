import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AdminUserDetailSchema,
  AdminUserQuerySchema,
  UpdateAdminUserRequestSchema,
  type AdminUserDetail,
  type AdminUserPage,
  type ForceLogoutResponse,
  type ResetTwoFactorResponse,
  type UpdateAdminUserRequest,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId, toCursorPage } from "../../common/services/cursor-page.js";
import { presentUser } from "../../common/services/user-presenter.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { assertAdminAction } from "./admin-access.js";
import { userSelect } from "./admin-selects.js";

interface UserDetailSource {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image: string | null;
  platformRole: string;
  status: string;
  locale: string;
  timezone: string;
  lastActiveAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}

@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedActor, rawQuery: unknown): Promise<AdminUserPage> {
    assertAdminAction(actor, "admin:users:read");
    const query = parseRequest(AdminUserQuerySchema, rawQuery);
    const cursor = cursorId(query.cursor);

    const rows = await this.prisma.client.user.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.platformRole ? { platformRole: query.platformRole } : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: "insensitive" } },
                { email: { contains: query.q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: userOrderBy(query.sort),
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: userSelect,
    });

    return toCursorPage(rows, query.limit, presentUser) as AdminUserPage;
  }

  async get(actor: AuthenticatedActor, id: string): Promise<AdminUserDetail> {
    assertAdminAction(actor, "admin:users:read");
    const record = await this.requireUser(id);
    return this.detail(record);
  }

  async update(
    actor: AuthenticatedActor,
    id: string,
    rawBody: unknown,
  ): Promise<AdminUserDetail> {
    const body = parseRequest(UpdateAdminUserRequestSchema, rawBody);
    const record = await this.requireUser(id);
    this.assertUserMutation(actor, record, body);

    if (
      body.platformRole &&
      record.platformRole === "super_admin" &&
      body.platformRole !== "super_admin"
    ) {
      await this.assertAnotherSuperAdmin();
    }

    const data: Record<string, unknown> = {};
    if (body.platformRole) {
      data.platformRole = body.platformRole;
    }
    if (body.status) {
      data.status = body.status;
      if (body.status === "active") {
        data.deletedAt = null;
      }
      if (body.status === "deleted") {
        data.deletedAt = new Date();
      }
    }

    const updated = await this.prisma.client.user.update({
      where: { id },
      data,
      select: userSelect,
    });
    await this.audit.record({
      actorId: actor.user.id,
      actorType: "admin",
      action: "admin.user.updated",
      targetType: "user",
      targetId: id,
      ip: actor.ip ?? undefined,
      userAgent: actor.userAgent ?? undefined,
      metadata: {
        ...(body.status ? { status: body.status, previousStatus: record.status } : {}),
        ...(body.platformRole
          ? { platformRole: body.platformRole, previousPlatformRole: record.platformRole }
          : {}),
      },
    });

    return this.detail(updated);
  }

  async forceLogout(actor: AuthenticatedActor, id: string): Promise<ForceLogoutResponse> {
    assertAdminAction(actor, "admin:users:force-logout");
    const record = await this.requireUser(id);
    const result = await this.prisma.client.session.deleteMany({ where: { userId: id } });
    await this.audit.record({
      actorId: actor.user.id,
      actorType: "admin",
      action: "admin.user.force_logged_out",
      targetType: "user",
      targetId: id,
      ip: actor.ip ?? undefined,
      userAgent: actor.userAgent ?? undefined,
      metadata: { revokedSessions: result.count, email: record.email },
    });
    return { revokedSessions: result.count };
  }

  async resetTwoFactor(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<ResetTwoFactorResponse> {
    assertAdminAction(actor, "admin:users:reset-2fa");
    await this.requireUser(id);
    await this.prisma.client.twoFactor.deleteMany({ where: { userId: id } });
    await this.prisma.client.user.update({
      where: { id },
      data: { twoFactorEnabled: false },
    });
    await this.audit.record({
      actorId: actor.user.id,
      actorType: "admin",
      action: "admin.user.two_factor_reset",
      targetType: "user",
      targetId: id,
      ip: actor.ip ?? undefined,
      userAgent: actor.userAgent ?? undefined,
    });
    return { message: "Two-factor authentication reset.", totpReset: true };
  }

  async remove(actor: AuthenticatedActor, id: string): Promise<{ message: string }> {
    assertAdminAction(actor, "admin:users:delete");
    const record = await this.requireUser(id);
    if (record.platformRole === "super_admin") {
      await this.assertAnotherSuperAdmin();
    }

    await this.prisma.client.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id },
        data: { status: "deleted", deletedAt: new Date() },
      });
      await transaction.session.deleteMany({ where: { userId: id } });
      await transaction.twoFactor.deleteMany({ where: { userId: id } });
      await transaction.workspaceMember.updateMany({
        where: { userId: id, status: "active" },
        data: { status: "suspended" },
      });
      await transaction.invitation.updateMany({
        where: { invitedById: id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "admin",
          action: "admin.user.deleted",
          targetType: "user",
          targetId: id,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
          metadata: { email: record.email },
        },
        transaction,
      );
    });

    return { message: "User deleted." };
  }

  private async requireUser(id: string): Promise<UserDetailSource> {
    const record = await this.prisma.client.user.findUnique({ where: { id }, select: userSelect });
    if (!record) {
      throw new NotFoundException({
        code: "USER_NOT_FOUND",
        message: "The user was not found.",
      });
    }
    return record;
  }

  private async detail(record: UserDetailSource): Promise<AdminUserDetail> {
    const [workspaceCount, tripCount, entryCount, activeSessionCount] = await Promise.all([
      this.prisma.client.workspaceMember.count({
        where: { userId: record.id, status: "active" },
      }),
      this.prisma.client.trip.count({ where: { createdById: record.id, deletedAt: null } }),
      this.prisma.client.journalEntry.count({
        where: { createdById: record.id, deletedAt: null },
      }),
      this.prisma.client.session.count({
        where: { userId: record.id, expiresAt: { gt: new Date() } },
      }),
    ]);

    return AdminUserDetailSchema.parse({
      ...presentUser(record),
      workspaceCount,
      tripCount,
      entryCount,
      activeSessionCount,
    });
  }

  private assertUserMutation(
    actor: AuthenticatedActor,
    record: UserDetailSource,
    body: UpdateAdminUserRequest,
  ): void {
    if (body.platformRole !== undefined) {
      assertAdminAction(actor, "admin:users:change-role");
    }
    if (body.status === "suspended") {
      assertAdminAction(actor, "admin:users:suspend");
    } else if (body.status === "active") {
      assertAdminAction(actor, "admin:users:restore");
    } else if (body.status === "deleted") {
      assertAdminAction(actor, "admin:users:delete");
    }

    if (record.deletedAt === null && body.status === "active") {
      return;
    }
  }

  private async assertAnotherSuperAdmin(): Promise<void> {
    const count = await this.prisma.client.user.count({
      where: { platformRole: "super_admin", status: "active", deletedAt: null },
    });
    if (count <= 1) {
      throw new ConflictException({
        code: "LAST_SUPER_ADMIN",
        message: "The last super_admin cannot be removed or demoted.",
      });
    }
  }
}

function userOrderBy(
  sort: string | undefined,
): Array<{ createdAt: "asc" | "desc" } | { lastActiveAt: "asc" | "desc" } | { name: "asc" | "desc" } | { id: "asc" }> {
  if (!sort) {
    return [{ createdAt: "desc" }, { id: "asc" }];
  }
  const [field, direction] = sort.split(":");
  if (field === "lastActiveAt") {
    return [{ lastActiveAt: direction === "asc" ? "asc" : "desc" }, { id: "asc" }];
  }
  if (field === "name") {
    return [{ name: direction === "asc" ? "asc" : "desc" }, { id: "asc" }];
  }
  return [{ createdAt: direction === "asc" ? "asc" : "desc" }, { id: "asc" }];
}
