import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { MemberParamsSchema, type Workspace } from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { WorkspaceAccessService } from "../../common/services/workspace-access.service.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { presentWorkspace } from "./workspace-presenter.js";
import { forbidden } from "./workspace-member-records.js";
import { workspaceSelect } from "./workspace-records.js";

@Injectable()
export class WorkspaceOwnershipService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PermissionService)
    private readonly permissions: PermissionService = new PermissionService(),
  ) {}

  async transferOwnership(
    actor: AuthenticatedActor,
    workspaceId: string,
    toUserId: string,
  ): Promise<Workspace> {
    const parsed = parseRequest(
      MemberParamsSchema.pick({ workspaceId: true }).extend({
        toUserId: MemberParamsSchema.shape.memberId,
      }),
      { workspaceId, toUserId },
    );
    const actorMembership = await this.access.requireMembership(actor.user.id, parsed.workspaceId);
    this.permissions.assertCan(actorMembership.role, "workspace:transfer-ownership", "workspace");

    return this.prisma.client.$transaction(
      async (transaction) => {
        const locked = await transaction.$queryRaw<Array<{ ownerId: string }>>`
          SELECT "ownerId" FROM "Workspace"
          WHERE "id" = ${parsed.workspaceId}::uuid
            AND "status" = 'active'
            AND "deletedAt" IS NULL
          FOR UPDATE
        `;
        const ownerId = locked[0]?.ownerId;
        if (!ownerId) {
          throw new NotFoundException({
            code: "WORKSPACE_NOT_FOUND",
            message: "Workspace not found.",
          });
        }
        if (ownerId !== actor.user.id) {
          throw forbidden("OWNER_ONLY", "Only the current Owner can transfer ownership.");
        }
        if (parsed.toUserId === actor.user.id) {
          throw new ConflictException({
            code: "OWNER_TRANSFER_SAME_USER",
            message: "Ownership is already held by this user.",
          });
        }

        const target = await transaction.workspaceMember.findFirst({
          where: {
            workspaceId: parsed.workspaceId,
            userId: parsed.toUserId,
            status: "active",
          },
          select: {
            id: true,
            role: true,
            userId: true,
            status: true,
            user: {
              select: {
                status: true,
                deletedAt: true,
              },
            },
          },
        });
        if (!target) {
          throw new NotFoundException({
            code: "TARGET_MEMBER_NOT_FOUND",
            message: "The target must be an active Workspace member.",
          });
        }
        if (target.user.status !== "active" || target.user.deletedAt !== null) {
          throw new ConflictException({
            code: "TARGET_ACCOUNT_UNAVAILABLE",
            message: "The target account is not available.",
          });
        }

        await transaction.workspaceMember.update({
          where: { id: actorMembership.id },
          data: { role: "admin" },
        });
        await transaction.workspaceMember.update({
          where: { id: target.id },
          data: { role: "owner" },
        });
        const workspace = await transaction.workspace.update({
          where: { id: parsed.workspaceId },
          data: { ownerId: parsed.toUserId },
          select: workspaceSelect,
        });
        await this.audit.record(
          {
            actorId: actor.user.id,
            actorType: "user",
            action: "workspace.ownership_transferred",
            targetType: "workspace",
            targetId: parsed.workspaceId,
            workspaceId: parsed.workspaceId,
            ip: actor.ip ?? undefined,
            userAgent: actor.userAgent ?? undefined,
            metadata: {
              previousOwnerId: actor.user.id,
              newOwnerId: parsed.toUserId,
            },
          },
          transaction,
        );
        return presentWorkspace(workspace);
      },
      { isolationLevel: "Serializable" },
    );
  }
}
