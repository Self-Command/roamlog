import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { UuidV7Schema, type MemberStatus, type WorkspaceRole } from "@roamlog/contracts";

import { PrismaService } from "../../modules/prisma/prisma.service.js";

export interface WorkspaceMembershipAccess {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  status: MemberStatus;
  joinedAt: Date;
  invitedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  workspaceName: string;
}

@Injectable()
export class WorkspaceAccessService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async requireMembership(userId: string, workspaceId: string): Promise<WorkspaceMembershipAccess> {
    if (!UuidV7Schema.safeParse(workspaceId).success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "A valid Workspace id is required.",
        errors: [{ field: "workspaceId", code: "INVALID_INPUT", message: "Expected a UUIDv7." }],
      });
    }

    const membership = await this.prisma.client.workspaceMember.findFirst({
      where: {
        userId,
        workspaceId,
        status: "active",
        workspace: {
          status: "active",
          deletedAt: null,
        },
      },
      select: {
        id: true,
        workspaceId: true,
        userId: true,
        role: true,
        status: true,
        joinedAt: true,
        invitedById: true,
        createdAt: true,
        updatedAt: true,
        workspace: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException({
        code: "WORKSPACE_NOT_FOUND",
        message: "Workspace not found.",
      });
    }

    return {
      id: membership.id,
      workspaceId: membership.workspaceId,
      userId: membership.userId,
      role: membership.role,
      status: membership.status,
      joinedAt: membership.joinedAt,
      invitedById: membership.invitedById,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
      workspaceName: membership.workspace.name,
    };
  }
}
