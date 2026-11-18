import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AdminUserDetailSchema,
  AdminUserExportQuerySchema,
  AdminUserQuerySchema,
  UpdateAdminUserRequestSchema,
  type AdminUserDetail,
  type AdminUserExportQuery,
  type AdminUserPage,
  type AdminUserQuery,
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
import { CSV_BOM, csvHeader, csvRow } from "./admin-csv.js";
import { userSelect } from "./admin-selects.js";

const CSV_MAX_ROWS = 50_000;
const CSV_BATCH_SIZE = 500;
const USER_CSV_COLUMNS = [
  "id",
  "email",
  "emailVerified",
  "name",
  "platformRole",
  "status",
  "createdAt",
  "lastActiveAt",
  "deletedAt",
] as const;

interface UserDetailSource {
  id: string;
  email: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
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
      where: this.where(query),
      orderBy: userOrderBy(query.sort),
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: userSelect,
    });

    const visibleIds = rows.slice(0, query.limit).map((row) => row.id);
    const sessionCounts = visibleIds.length
      ? await this.prisma.client.session.groupBy({
          by: ["userId"],
          where: { userId: { in: visibleIds }, expiresAt: { gt: new Date() } },
          _count: { _all: true },
        })
      : [];
    const activeSessionsByUser = new Map(
      sessionCounts.map((entry) => [entry.userId, entry._count._all]),
    );

    return toCursorPage(rows, query.limit, (row) => ({
      ...presentUser(row),
      activeSessionCount: activeSessionsByUser.get(row.id) ?? 0,
    })) as AdminUserPage;
  }

  async *exportCsv(
    actor: AuthenticatedActor,
    rawQuery: unknown,
  ): AsyncGenerator<string, void, undefined> {
    assertAdminAction(actor, "admin:users:delete");
    const query = parseRequest(AdminUserExportQuerySchema, rawQuery);

    yield `${CSV_BOM}${csvHeader(USER_CSV_COLUMNS)}`;

    let cursor: string | undefined;
    let exported = 0;
    while (exported < CSV_MAX_ROWS) {
      const take = Math.min(CSV_BATCH_SIZE, CSV_MAX_ROWS - exported);
      const batch = await this.prisma.client.user.findMany({
        where: this.where(query),
        orderBy: userOrderBy(query.sort),
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: userSelect,
      });
      if (batch.length === 0) {
        return;
      }

      let chunk = "";
      for (const row of batch) {
        chunk += csvRow(USER_CSV_COLUMNS, presentUser(row) as unknown as Record<string, unknown>);
      }
      yield chunk;

      exported += batch.length;
      const last = batch.at(-1);
      if (batch.length < take || !last) {
        return;
      }
      cursor = last.id;
    }
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
    const now = new Date();
    const [
      workspaceCount,
      tripCount,
      entryCount,
      activeSessionCount,
      commentCount,
      mediaCount,
      memberships,
      sessions,
    ] = await Promise.all([
      this.prisma.client.workspaceMember.count({
        where: { userId: record.id, status: "active" },
      }),
      this.prisma.client.trip.count({ where: { createdById: record.id, deletedAt: null } }),
      this.prisma.client.journalEntry.count({
        where: { createdById: record.id, deletedAt: null },
      }),
      this.prisma.client.session.count({
        where: { userId: record.id, expiresAt: { gt: now } },
      }),
      this.prisma.client.comment.count({
        where: { authorId: record.id, deletedAt: null },
      }),
      this.prisma.client.media.count({
        where: { uploaderId: record.id, deletedAt: null },
      }),
      this.prisma.client.workspaceMember.findMany({
        where: { userId: record.id },
        orderBy: [{ joinedAt: "desc" }],
        take: 20,
        select: {
          role: true,
          status: true,
          joinedAt: true,
          workspace: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.client.session.findMany({
        where: { userId: record.id, expiresAt: { gt: now } },
        orderBy: [{ createdAt: "desc" }],
        take: 10,
        select: {
          id: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
          expiresAt: true,
        },
      }),
    ]);

    return AdminUserDetailSchema.parse({
      ...presentUser(record),
      workspaceCount,
      tripCount,
      entryCount,
      activeSessionCount,
      twoFactorEnabled: record.twoFactorEnabled,
      commentCount,
      mediaCount,
      workspaces: memberships.map((membership) => ({
        workspaceId: membership.workspace.id,
        workspaceName: membership.workspace.name,
        workspaceSlug: membership.workspace.slug,
        role: membership.role,
        status: membership.status,
        joinedAt: iso(membership.joinedAt),
      })),
      sessions: sessions.map((session) => ({
        id: session.id,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt: iso(session.createdAt),
        expiresAt: iso(session.expiresAt),
      })),
    });
  }

  private where(query: AdminUserQuery | AdminUserExportQuery): Record<string, unknown> {
    return {
      ...(query.status ? { status: query.status } : {}),
      ...(query.platformRole ? { platformRole: query.platformRole } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: "insensitive" } },
              { email: { contains: query.q, mode: "insensitive" } },
              { memberships: { some: { workspace: { name: { contains: query.q, mode: "insensitive" } } } } },
              { memberships: { some: { workspace: { slug: { contains: query.q, mode: "insensitive" } } } } },
            ],
          }
        : {}),
    };
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

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
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
