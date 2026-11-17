import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AcceptInvitationResponseSchema, type WorkspaceMember } from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { INVITATION_CLOCK, defaultInvitationClock } from "./invitation-clock.js";
import {
  invitationMemberSelect,
  invitationSelect,
  forbidden,
  normalizeEmail,
} from "./invitation-records.js";
import { hashInvitationToken, isValidInvitationToken } from "./invitation-token.js";

@Injectable()
export class InvitationAcceptanceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(INVITATION_CLOCK)
    private readonly now: () => Date = defaultInvitationClock,
  ) {}

  async accept(actor: AuthenticatedActor, token: string): Promise<WorkspaceMember> {
    if (!actor.user.emailVerified) {
      throw forbidden(
        "EMAIL_VERIFICATION_REQUIRED",
        "Verify your email address before accepting an invitation.",
      );
    }
    if (!isValidInvitationToken(token)) {
      throw new NotFoundException({
        code: "INVITATION_NOT_FOUND",
        message: "Invitation not found.",
      });
    }

    const tokenHash = hashInvitationToken(token);
    const currentTime = this.now();

    return this.prisma.client.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Invitation"
        WHERE "tokenHash" = ${tokenHash}
        FOR UPDATE
      `;
      const invitationId = locked[0]?.id;
      if (!invitationId) {
        throw new NotFoundException({
          code: "INVITATION_NOT_FOUND",
          message: "Invitation not found.",
        });
      }

      const invitation = await transaction.invitation.findUnique({
        where: { id: invitationId },
        select: {
          ...invitationSelect,
          tokenHash: true,
        },
      });
      if (!invitation) {
        throw new NotFoundException({
          code: "INVITATION_NOT_FOUND",
          message: "Invitation not found.",
        });
      }
      if (invitation.revokedAt) {
        throw new GoneException({
          code: "INVITATION_REVOKED",
          message: "This invitation was revoked.",
        });
      }
      if (invitation.acceptedAt) {
        throw new ConflictException({
          code: "INVITATION_ALREADY_ACCEPTED",
          message: "This invitation was already accepted.",
        });
      }
      if (invitation.expiresAt <= currentTime) {
        throw new GoneException({
          code: "INVITATION_EXPIRED",
          message: "This invitation has expired.",
        });
      }
      if (normalizeEmail(invitation.email) !== normalizeEmail(actor.user.email)) {
        throw forbidden(
          "INVITATION_EMAIL_MISMATCH",
          "This invitation was issued to a different email address.",
        );
      }

      const workspace = await transaction.workspace.findFirst({
        where: {
          id: invitation.workspaceId,
          status: "active",
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!workspace) {
        throw new NotFoundException({
          code: "WORKSPACE_NOT_FOUND",
          message: "Workspace not found.",
        });
      }

      const existing = await transaction.workspaceMember.findFirst({
        where: {
          workspaceId: invitation.workspaceId,
          userId: actor.user.id,
        },
        select: invitationMemberSelect,
      });
      if (existing?.status === "suspended") {
        throw new ConflictException({
          code: "MEMBER_SUSPENDED",
          message: "This Workspace membership is suspended.",
        });
      }

      const member =
        existing ??
        (await transaction.workspaceMember.create({
          data: {
            workspaceId: invitation.workspaceId,
            userId: actor.user.id,
            role: invitation.role,
            status: "active",
            invitedById: invitation.invitedById,
            joinedAt: currentTime,
          },
          select: invitationMemberSelect,
        }));

      await transaction.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: currentTime },
      });
      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "user",
          action: "invitation.accepted",
          targetType: "invitation",
          targetId: invitation.id,
          workspaceId: invitation.workspaceId,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
          metadata: { role: member.role },
        },
        transaction,
      );

      return AcceptInvitationResponseSchema.parse({
        id: member.id,
        workspaceId: member.workspaceId,
        userId: member.userId,
        role: member.role,
        status: member.status,
        joinedAt: member.joinedAt.toISOString(),
        invitedById: member.invitedById,
        createdAt: member.createdAt.toISOString(),
        updatedAt: member.updatedAt.toISOString(),
      });
    });
  }
}
