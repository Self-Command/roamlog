import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  DeleteMeRequestSchema,
  SessionParamsSchema,
  SessionSchema,
  UpdateMeRequestSchema,
  type MyWorkspacesResponse,
  type Session,
  type SessionListResponse,
  type UpdateMeRequest,
  type User,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { presentUser } from "../../common/services/user-presenter.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { WorkspacesService } from "../workspaces/workspaces.service.js";

const userSelect = {
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
} as const;

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspacesService) private readonly workspaces: WorkspacesService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async getMe(actor: AuthenticatedActor): Promise<User> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: actor.user.id },
      select: userSelect,
    });
    if (!user || user.deletedAt !== null) {
      throw new NotFoundException({
        code: "USER_NOT_FOUND",
        message: "User not found.",
      });
    }
    return presentUser(user);
  }

  async updateMe(actor: AuthenticatedActor, rawInput: unknown): Promise<User> {
    const input: UpdateMeRequest = parseRequest(UpdateMeRequestSchema, rawInput);
    return this.prisma.client.$transaction(async (transaction) => {
      const user = await transaction.user.update({
        where: { id: actor.user.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.image !== undefined ? { image: input.image } : {}),
          ...(input.locale !== undefined ? { locale: input.locale } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        },
        select: userSelect,
      });
      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "user",
          action: "user.profile_updated",
          targetType: "user",
          targetId: actor.user.id,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
          metadata: { fields: Object.keys(input).sort().join(",") },
        },
        transaction,
      );
      return presentUser(user);
    });
  }

  async listMyWorkspaces(actor: AuthenticatedActor): Promise<MyWorkspacesResponse> {
    await this.workspaces.ensureDefaultWorkspace(actor);
    return this.workspaces.list(actor);
  }

  async listSessions(actor: AuthenticatedActor): Promise<SessionListResponse> {
    const sessions = await this.prisma.client.session.findMany({
      where: {
        userId: actor.user.id,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        createdAt: true,
        ipAddress: true,
        userAgent: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return sessions.map((session): Session =>
      SessionSchema.parse({
        id: session.id,
        userId: session.userId,
        expiresAt: session.expiresAt.toISOString(),
        createdAt: session.createdAt.toISOString(),
        ip: session.ipAddress,
        userAgent: session.userAgent,
      }),
    );
  }

  async revokeSession(actor: AuthenticatedActor, sessionId: string): Promise<{ message: string }> {
    const params = parseRequest(SessionParamsSchema, { id: sessionId });
    const session = await this.prisma.client.session.findFirst({
      where: { id: params.id, userId: actor.user.id },
      select: { id: true },
    });
    if (!session) {
      throw new NotFoundException({
        code: "SESSION_NOT_FOUND",
        message: "Session not found.",
      });
    }

    await this.prisma.client.$transaction(async (transaction) => {
      await transaction.session.delete({ where: { id: session.id } });
      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "user",
          action: "session.revoked",
          targetType: "session",
          targetId: session.id,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
        },
        transaction,
      );
    });
    return { message: "Session revoked." };
  }

  async deleteMe(actor: AuthenticatedActor, rawInput: unknown): Promise<{ message: string }> {
    parseRequest(DeleteMeRequestSchema, rawInput);
    const ownedWorkspaces = await this.prisma.client.workspace.count({
      where: {
        ownerId: actor.user.id,
        status: "active",
        deletedAt: null,
      },
    });
    if (ownedWorkspaces > 0) {
      throw new ConflictException({
        code: "OWNER_MUST_TRANSFER_OR_DELETE_WORKSPACE",
        message: "Transfer or delete every Workspace you own before deleting your account.",
      });
    }

    const now = new Date();
    const anonymizedEmail = `deleted+${actor.user.id.replaceAll("-", "")}@invalid.roamlog.local`;
    await this.prisma.client.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: actor.user.id },
        data: {
          email: anonymizedEmail,
          name: "Deleted user",
          image: null,
          status: "deleted",
          deletedAt: now,
          lastActiveAt: null,
        },
      });
      await transaction.session.deleteMany({ where: { userId: actor.user.id } });
      await transaction.account.deleteMany({ where: { userId: actor.user.id } });
      await transaction.twoFactor.deleteMany({ where: { userId: actor.user.id } });
      await transaction.notificationPreference.deleteMany({
        where: { userId: actor.user.id },
      });
      await transaction.invitation.updateMany({
        where: { email: actor.user.email },
        data: { email: anonymizedEmail },
      });
      await transaction.emailLog.updateMany({
        where: { to: actor.user.email },
        data: { to: anonymizedEmail },
      });
      await transaction.workspaceMember.updateMany({
        where: { userId: actor.user.id, status: "active" },
        data: { status: "suspended" },
      });
      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "user",
          action: "user.account_deleted",
          targetType: "user",
          targetId: actor.user.id,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
        },
        transaction,
      );
    });

    return { message: "Account deleted." };
  }
}
