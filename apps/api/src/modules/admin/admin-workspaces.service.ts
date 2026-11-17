import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AdminWorkspaceDetailSchema,
  AdminWorkspaceQuerySchema,
  UpdateAdminWorkspaceRequestSchema,
  type AdminWorkspaceDetail,
  type AdminWorkspacePage,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId, toCursorPage } from "../../common/services/cursor-page.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { presentWorkspace } from "../workspaces/workspace-presenter.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { assertAdminAction } from "./admin-access.js";
import { workspaceSelect } from "./admin-selects.js";

interface WorkspaceSource {
  id: string;
  name: string;
  slug: string;
  logoMediaId: string | null;
  ownerId: string;
  plan: string;
  status: string;
  defaultCurrency: string;
  timezone: string;
  weekStartsOn: number;
  settings: unknown;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

@Injectable()
export class AdminWorkspacesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedActor, rawQuery: unknown): Promise<AdminWorkspacePage> {
    assertAdminAction(actor, "admin:workspaces:read");
    const query = parseRequest(AdminWorkspaceQuerySchema, rawQuery);
    const cursor = cursorId(query.cursor);

    const rows = await this.prisma.client.workspace.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.plan ? { plan: query.plan } : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: "insensitive" } },
                { slug: { contains: query.q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: workspaceOrderBy(query.sort),
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: workspaceSelect,
    });

    return toCursorPage(rows, query.limit, presentWorkspace) as AdminWorkspacePage;
  }

  async get(actor: AuthenticatedActor, id: string): Promise<AdminWorkspaceDetail> {
    assertAdminAction(actor, "admin:workspaces:read");
    const record = await this.requireWorkspace(id);
    return this.detail(record);
  }

  async update(
    actor: AuthenticatedActor,
    id: string,
    rawBody: unknown,
  ): Promise<AdminWorkspaceDetail> {
    const body = parseRequest(UpdateAdminWorkspaceRequestSchema, rawBody);
    const record = await this.requireWorkspace(id);
    this.assertWorkspaceMutation(actor, body);

    const data: Record<string, unknown> = {};
    if (body.status) {
      data.status = body.status;
      if (body.status === "active") {
        data.deletedAt = null;
      }
      if (body.status === "deleted") {
        data.deletedAt = new Date();
      }
    }
    if (body.plan) {
      data.plan = body.plan;
    }

    let updated: WorkspaceSource;
    if (body.ownerId && body.ownerId !== record.ownerId) {
      updated = await this.transferOwnership(actor, record, body.ownerId, data);
    } else {
      updated = await this.prisma.client.workspace.update({
        where: { id },
        data,
        select: workspaceSelect,
      });
      await this.audit.record({
        actorId: actor.user.id,
        actorType: "admin",
        action: "admin.workspace.updated",
        targetType: "workspace",
        targetId: id,
        workspaceId: id,
        ip: actor.ip ?? undefined,
        userAgent: actor.userAgent ?? undefined,
        metadata: {
          ...(body.status ? { status: body.status, previousStatus: record.status } : {}),
          ...(body.plan ? { plan: body.plan, previousPlan: record.plan } : {}),
        },
      });
    }

    return this.detail(updated);
  }

  async remove(actor: AuthenticatedActor, id: string): Promise<{ message: string }> {
    assertAdminAction(actor, "admin:workspaces:delete");
    const record = await this.requireWorkspace(id);

    await this.prisma.client.$transaction(async (transaction) => {
      await transaction.workspace.update({
        where: { id },
        data: { status: "deleted", deletedAt: new Date() },
      });
      await transaction.workspaceMember.updateMany({
        where: { workspaceId: id, status: "active" },
        data: { status: "suspended" },
      });
      await transaction.invitation.updateMany({
        where: { workspaceId: id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "admin",
          action: "admin.workspace.deleted",
          targetType: "workspace",
          targetId: id,
          workspaceId: id,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
          metadata: { name: record.name, slug: record.slug },
        },
        transaction,
      );
    });

    return { message: "Workspace deleted." };
  }

  private async transferOwnership(
    actor: AuthenticatedActor,
    record: WorkspaceSource,
    ownerId: string,
    extra: Record<string, unknown>,
  ): Promise<WorkspaceSource> {
    if (ownerId === record.ownerId) {
      throw new ConflictException({
        code: "OWNER_UNCHANGED",
        message: "The selected user already owns this Workspace.",
      });
    }

    return this.prisma.client.$transaction(async (transaction) => {
      const target = await transaction.user.findUnique({
        where: { id: ownerId },
        select: { id: true, status: true, deletedAt: true },
      });
      if (!target || target.deletedAt !== null || target.status !== "active") {
        throw new NotFoundException({
          code: "TARGET_USER_NOT_AVAILABLE",
          message: "The new owner account is not available.",
        });
      }

      const [currentMembership, targetMembership] = await Promise.all([
        transaction.workspaceMember.findFirst({
          where: { workspaceId: record.id, userId: record.ownerId, status: "active" },
          select: { id: true, role: true },
        }),
        transaction.workspaceMember.findFirst({
          where: { workspaceId: record.id, userId: ownerId, status: "active" },
          select: { id: true, role: true },
        }),
      ]);
      if (!targetMembership) {
        throw new ConflictException({
          code: "TARGET_MEMBER_NOT_FOUND",
          message: "The new owner must be an active Workspace member.",
        });
      }

      if (currentMembership) {
        await transaction.workspaceMember.update({
          where: { id: currentMembership.id },
          data: { role: "admin" },
        });
      }
      await transaction.workspaceMember.update({
        where: { id: targetMembership.id },
        data: { role: "owner" },
      });

      const updated = await transaction.workspace.update({
        where: { id: record.id },
        data: { ...extra, ownerId },
        select: workspaceSelect,
      });
      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "admin",
          action: "admin.workspace.ownership_transferred",
          targetType: "workspace",
          targetId: record.id,
          workspaceId: record.id,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
          metadata: { previousOwnerId: record.ownerId, newOwnerId: ownerId },
        },
        transaction,
      );
      return updated;
    });
  }

  private assertWorkspaceMutation(
    actor: AuthenticatedActor,
    body: {
      status?: string;
      plan?: string;
      ownerId?: string;
    },
  ): void {
    if (body.status === "suspended") {
      assertAdminAction(actor, "admin:workspaces:suspend");
    } else if (body.status === "active") {
      assertAdminAction(actor, "admin:workspaces:restore");
    } else if (body.status === "deleted") {
      assertAdminAction(actor, "admin:workspaces:delete");
    }

    if (body.plan !== undefined || body.ownerId !== undefined) {
      // Contracts expose no dedicated plan/ownership action for platform admins.
      // These operations are therefore gated by the operator-level Workspace action.
      assertAdminAction(actor, "admin:workspaces:delete");
    }
  }

  private async requireWorkspace(id: string): Promise<WorkspaceSource> {
    const record = await this.prisma.client.workspace.findUnique({
      where: { id },
      select: workspaceSelect,
    });
    if (!record) {
      throw new NotFoundException({
        code: "WORKSPACE_NOT_FOUND",
        message: "The Workspace was not found.",
      });
    }
    return record;
  }

  private async detail(record: WorkspaceSource): Promise<AdminWorkspaceDetail> {
    const [memberCount, tripCount, entryCount, owner] = await Promise.all([
      this.prisma.client.workspaceMember.count({
        where: { workspaceId: record.id, status: "active" },
      }),
      this.prisma.client.trip.count({ where: { workspaceId: record.id, deletedAt: null } }),
      this.prisma.client.journalEntry.count({
        where: { workspaceId: record.id, deletedAt: null },
      }),
      this.prisma.client.user.findUnique({
        where: { id: record.ownerId },
        select: { id: true, name: true, email: true, image: true },
      }),
    ]);

    if (!owner) {
      throw new NotFoundException({
        code: "WORKSPACE_OWNER_NOT_FOUND",
        message: "The Workspace owner was not found.",
      });
    }

    return AdminWorkspaceDetailSchema.parse({
      ...presentWorkspace(record),
      memberCount,
      tripCount,
      entryCount,
      owner,
    });
  }
}

function workspaceOrderBy(
  sort: string | undefined,
): Array<{ createdAt: "asc" | "desc" } | { name: "asc" | "desc" } | { id: "asc" }> {
  if (!sort) {
    return [{ createdAt: "desc" }, { id: "asc" }];
  }
  const [field, direction] = sort.split(":");
  if (field === "name") {
    return [{ name: direction === "asc" ? "asc" : "desc" }, { id: "asc" }];
  }
  return [{ createdAt: direction === "asc" ? "asc" : "desc" }, { id: "asc" }];
}
