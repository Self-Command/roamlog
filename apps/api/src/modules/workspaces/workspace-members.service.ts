import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  MemberParamsSchema,
  UpdateMemberRequestSchema,
  WorkspaceMemberQuerySchema,
  type WorkspaceMemberPage,
  type WorkspaceMemberWithUser,
  type WorkspaceRole,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId, toCursorPage } from "../../common/services/cursor-page.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { WorkspaceAccessService } from "../../common/services/workspace-access.service.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { forbidden, memberWithUserSelect, parseMemberSort } from "./workspace-member-records.js";
import { presentMember, type MembershipWithUserRecordInput } from "./workspace-presenter.js";

@Injectable()
export class WorkspaceMembersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PermissionService)
    private readonly permissions: PermissionService = new PermissionService(),
  ) {}

  async list(
    actor: AuthenticatedActor,
    workspaceId: string,
    rawQuery: unknown,
  ): Promise<WorkspaceMemberPage> {
    const membership = await this.access.requireMembership(actor.user.id, workspaceId);
    this.permissions.assertCan(membership.role, "member:read", "member");
    const query = parseRequest(WorkspaceMemberQuerySchema, rawQuery);
    const cursor = cursorId(query.cursor);

    const records = await this.prisma.client.workspaceMember.findMany({
      where: {
        workspaceId,
        ...(query.role ? { role: query.role } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.q
          ? {
              user: {
                OR: [
                  { name: { contains: query.q, mode: "insensitive" } },
                  { email: { contains: query.q, mode: "insensitive" } },
                ],
              },
            }
          : {}),
      },
      select: memberWithUserSelect,
      orderBy: parseMemberSort(query.sort),
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    return toCursorPage(records, query.limit, (record) =>
      presentMember(record as MembershipWithUserRecordInput),
    ) as WorkspaceMemberPage;
  }

  async update(
    actor: AuthenticatedActor,
    workspaceId: string,
    memberId: string,
    rawInput: unknown,
  ): Promise<WorkspaceMemberWithUser> {
    const params = parseRequest(MemberParamsSchema, { workspaceId, memberId });
    const input = parseRequest(UpdateMemberRequestSchema, rawInput);
    const actorMembership = await this.access.requireMembership(actor.user.id, params.workspaceId);
    const target = await this.findTarget(
      actor,
      params.workspaceId,
      params.memberId,
      actorMembership.role,
    );

    if (input.role !== undefined) {
      this.permissions.assertCan(actorMembership.role, "member:update-role", "member");
    }
    if (input.status !== undefined) {
      this.permissions.assertCan(actorMembership.role, "member:suspend", "member");
    }
    this.assertMayManage(actorMembership.role, target.role, target.userId, actor.user.id);
    if (actorMembership.role === "admin" && input.role === "admin") {
      throw forbidden("MANAGE_ADMIN_FORBIDDEN", "Only the Owner can grant the Admin role.");
    }

    return this.prisma.client.$transaction(async (transaction) => {
      const updated = await transaction.workspaceMember.update({
        where: { id: target.id },
        data: {
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
        select: memberWithUserSelect,
      });

      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "user",
          action:
            input.role !== undefined && target.role !== input.role
              ? "member.role_updated"
              : "member.status_updated",
          targetType: "member",
          targetId: target.id,
          workspaceId,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
          metadata: {
            fromRole: target.role,
            toRole: updated.role,
            fromStatus: target.status,
            toStatus: updated.status,
          },
        },
        transaction,
      );
      return presentMember(updated as MembershipWithUserRecordInput);
    });
  }

  async remove(
    actor: AuthenticatedActor,
    workspaceId: string,
    memberId: string,
  ): Promise<{ message: string }> {
    const params = parseRequest(MemberParamsSchema, { workspaceId, memberId });
    const actorMembership = await this.access.requireMembership(actor.user.id, params.workspaceId);
    this.permissions.assertCan(actorMembership.role, "member:remove", "member");
    const target = await this.findTarget(
      actor,
      params.workspaceId,
      params.memberId,
      actorMembership.role,
    );
    this.assertMayManage(actorMembership.role, target.role, target.userId, actor.user.id, true);

    const privateTrips = await this.prisma.client.trip.count({
      where: {
        workspaceId,
        createdById: target.userId,
        visibility: "private",
        deletedAt: null,
      },
    });
    if (privateTrips > 0) {
      throw new ConflictException({
        code: "PRIVATE_TRIP_OWNERSHIP_REQUIRED",
        message: "Transfer or archive this member's private trips before removing them.",
      });
    }

    await this.prisma.client.$transaction(async (transaction) => {
      await transaction.workspaceMember.delete({ where: { id: target.id } });
      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "user",
          action: "member.removed",
          targetType: "member",
          targetId: target.id,
          workspaceId,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
          metadata: { role: target.role, userId: target.userId },
        },
        transaction,
      );
    });

    return { message: "Member removed." };
  }

  private async findTarget(
    _actor: AuthenticatedActor,
    workspaceId: string,
    memberId: string,
    _actorRole: WorkspaceRole,
  ) {
    const target = await this.prisma.client.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
      select: memberWithUserSelect,
    });
    if (!target) {
      throw new NotFoundException({
        code: "MEMBER_NOT_FOUND",
        message: "Member not found.",
      });
    }
    return target;
  }

  private assertMayManage(
    actorRole: WorkspaceRole,
    targetRole: WorkspaceRole,
    targetUserId: string,
    actorUserId: string,
    removing = false,
  ): void {
    if (targetUserId === actorUserId) {
      throw forbidden(
        removing ? "CANNOT_REMOVE_SELF" : "CANNOT_MODIFY_SELF",
        removing
          ? "Transfer ownership or use Workspace deletion instead of removing yourself."
          : "You cannot modify your own Workspace role or status.",
      );
    }
    if (targetRole === "owner") {
      throw forbidden(
        "OWNER_IMMUTABLE",
        "The Workspace Owner cannot be changed or removed through member management.",
      );
    }
    if (actorRole === "admin" && targetRole === "admin") {
      throw forbidden("MANAGE_ADMIN_FORBIDDEN", "Only the Owner can manage another Admin.");
    }
  }
}
