import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  CreateWorkspaceRequestSchema,
  UpdateWorkspaceRequestSchema,
  type CreateWorkspaceRequest,
  type UpdateWorkspaceRequest,
  type Workspace,
  type WorkspaceRole,
  type WorkspaceWithRole,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { WorkspaceAccessService } from "../../common/services/workspace-access.service.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ensureDefaultWorkspace } from "./workspace-onboarding.js";
import {
  presentWorkspace,
  presentWorkspaceWithRole,
  type WorkspaceRecordInput,
} from "./workspace-presenter.js";
import {
  assertVerifiedEmail,
  isUniqueConstraintError,
  workspaceSelect,
} from "./workspace-records.js";

@Injectable()
export class WorkspacesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PermissionService)
    private readonly permissions: PermissionService = new PermissionService(),
  ) {}

  async list(actor: AuthenticatedActor): Promise<WorkspaceWithRole[]> {
    const workspaces = await this.prisma.client.workspace.findMany({
      where: {
        status: "active",
        deletedAt: null,
        members: {
          some: {
            userId: actor.user.id,
            status: "active",
          },
        },
      },
      include: {
        members: {
          where: {
            userId: actor.user.id,
            status: "active",
          },
          select: { role: true },
          take: 1,
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });

    return workspaces.flatMap((workspace) => {
      const role = workspace.members[0]?.role;
      return role ? [presentWorkspaceWithRole(workspace, role)] : [];
    });
  }

  async get(actor: AuthenticatedActor, workspaceId: string): Promise<Workspace> {
    const membership = await this.access.requireMembership(actor.user.id, workspaceId);
    this.permissions.assertCan(membership.role, "workspace:read", "workspace");

    const workspace = await this.prisma.client.workspace.findFirst({
      where: {
        id: workspaceId,
        status: "active",
        deletedAt: null,
      },
      select: workspaceSelect,
    });
    if (!workspace) {
      throw new NotFoundException({
        code: "WORKSPACE_NOT_FOUND",
        message: "Workspace not found.",
      });
    }
    return presentWorkspace(workspace);
  }

  async create(actor: AuthenticatedActor, rawInput: unknown): Promise<Workspace> {
    assertVerifiedEmail(actor);
    const input = parseRequest(CreateWorkspaceRequestSchema, rawInput);
    const settings = input.settings ?? {};

    try {
      return await this.prisma.client.$transaction(async (transaction) => {
        const workspace = await transaction.workspace.create({
          data: {
            name: input.name,
            slug: input.slug,
            logoMediaId: input.logoMediaId ?? null,
            ownerId: actor.user.id,
            defaultCurrency: input.defaultCurrency,
            timezone: input.timezone,
            weekStartsOn: input.weekStartsOn ?? 1,
            settings,
          },
          select: workspaceSelect,
        });
        await transaction.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: actor.user.id,
            role: "owner",
            status: "active",
            invitedById: null,
          },
        });
        await this.audit.record(
          {
            actorId: actor.user.id,
            actorType: "user",
            action: "workspace.created",
            targetType: "workspace",
            targetId: workspace.id,
            workspaceId: workspace.id,
            ip: actor.ip ?? undefined,
            userAgent: actor.userAgent ?? undefined,
            metadata: { name: workspace.name, slug: workspace.slug },
          },
          transaction,
        );
        return presentWorkspace(workspace);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException({
          code: "WORKSPACE_SLUG_TAKEN",
          message: "That Workspace slug is already in use.",
        });
      }
      throw error;
    }
  }

  async update(
    actor: AuthenticatedActor,
    workspaceId: string,
    rawInput: unknown,
  ): Promise<Workspace> {
    const membership = await this.access.requireMembership(actor.user.id, workspaceId);
    this.permissions.assertCan(membership.role, "workspace:update", "workspace");
    const input = parseRequest(UpdateWorkspaceRequestSchema, rawInput);

    try {
      return await this.prisma.client.$transaction(async (transaction) => {
        const workspace = await transaction.workspace.update({
          where: { id: workspaceId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.slug !== undefined ? { slug: input.slug } : {}),
            ...(input.logoMediaId !== undefined ? { logoMediaId: input.logoMediaId } : {}),
            ...(input.defaultCurrency !== undefined
              ? { defaultCurrency: input.defaultCurrency }
              : {}),
            ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
            ...(input.weekStartsOn !== undefined ? { weekStartsOn: input.weekStartsOn } : {}),
            ...(input.settings !== undefined ? { settings: input.settings } : {}),
          },
          select: workspaceSelect,
        });
        await this.audit.record(
          {
            actorId: actor.user.id,
            actorType: "user",
            action: "workspace.updated",
            targetType: "workspace",
            targetId: workspaceId,
            workspaceId,
            ip: actor.ip ?? undefined,
            userAgent: actor.userAgent ?? undefined,
            metadata: { fields: Object.keys(input).sort() },
          },
          transaction,
        );
        return presentWorkspace(workspace);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException({
          code: "WORKSPACE_SLUG_TAKEN",
          message: "That Workspace slug is already in use.",
        });
      }
      throw error;
    }
  }

  async remove(actor: AuthenticatedActor, workspaceId: string): Promise<{ message: string }> {
    const membership = await this.access.requireMembership(actor.user.id, workspaceId);
    this.permissions.assertCan(membership.role, "workspace:delete", "workspace");

    await this.prisma.client.$transaction(async (transaction) => {
      await transaction.workspace.update({
        where: { id: workspaceId },
        data: {
          status: "deleted",
          deletedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "user",
          action: "workspace.deleted",
          targetType: "workspace",
          targetId: workspaceId,
          workspaceId,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
        },
        transaction,
      );
    });

    return { message: "Workspace deleted." };
  }

  async ensureDefaultWorkspace(actor: AuthenticatedActor): Promise<Workspace | null> {
    return ensureDefaultWorkspace({ prisma: this.prisma, audit: this.audit }, actor);
  }
}

export type WorkspaceCreateInput = CreateWorkspaceRequest;
export type WorkspaceUpdateInput = UpdateWorkspaceRequest;
export type WorkspaceRoleName = WorkspaceRole;
export type WorkspaceRecord = WorkspaceRecordInput;
