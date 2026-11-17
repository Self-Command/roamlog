import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  InvitationParamsSchema,
  InviteMemberRequestSchema,
  type Invitation,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { WorkspaceAccessService } from "../../common/services/workspace-access.service.js";
import { AuditService } from "../audit/audit.service.js";
import { EmailDeliveryService } from "../auth/email-delivery.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { INVITATION_CLOCK, defaultInvitationClock } from "./invitation-clock.js";
import { invitationSelect, forbidden, normalizeEmail } from "./invitation-records.js";
import {
  INVITATION_TTL_MS,
  createInvitationToken,
  hashInvitationToken,
} from "./invitation-token.js";
import {
  presentInvitation,
  type InvitationRecordInput,
} from "../workspaces/workspace-presenter.js";

@Injectable()
export class InvitationsService {
  private readonly now: () => Date;
  private readonly invitationBaseUrl = process.env.APP_URL ?? "http://localhost:3000";

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EmailDeliveryService) private readonly email: EmailDeliveryService,
    @Inject(PermissionService)
    private readonly permissions: PermissionService = new PermissionService(),
    @Inject(INVITATION_CLOCK)
    now: () => Date = defaultInvitationClock,
  ) {
    this.now = now;
  }

  async create(
    actor: AuthenticatedActor,
    workspaceId: string,
    rawInput: unknown,
  ): Promise<Invitation> {
    if (!actor.user.emailVerified) {
      throw forbidden(
        "EMAIL_VERIFICATION_REQUIRED",
        "Verify your email address before inviting collaborators.",
      );
    }
    const membership = await this.access.requireMembership(actor.user.id, workspaceId);
    this.permissions.assertCan(membership.role, "invitation:create", "invitation");
    const input = parseRequest(InviteMemberRequestSchema, rawInput);
    if (input.role === "admin") {
      this.permissions.assertCan(membership.role, "invitation:create-admin", "invitation");
    }

    const email = normalizeEmail(input.email);
    const token = createInvitationToken();
    const tokenHash = hashInvitationToken(token);
    const currentTime = this.now();
    const expiresAt = new Date(currentTime.getTime() + INVITATION_TTL_MS);

    let created: InvitationRecordInput;
    try {
      created = await this.prisma.client.$transaction(async (transaction) => {
        const existingMember = await transaction.workspaceMember.findFirst({
          where: {
            workspaceId,
            user: {
              email: {
                equals: email,
                mode: "insensitive",
              },
            },
          },
          select: { id: true, status: true },
        });
        if (existingMember) {
          throw new ConflictException({
            code: "MEMBER_ALREADY_EXISTS",
            message: "This user is already a Workspace member.",
          });
        }

        const pending = await transaction.invitation.findFirst({
          where: {
            workspaceId,
            email,
            acceptedAt: null,
            revokedAt: null,
          },
          orderBy: { createdAt: "desc" },
          select: invitationSelect,
        });
        if (pending && pending.expiresAt > currentTime) {
          throw new ConflictException({
            code: "INVITATION_ALREADY_PENDING",
            message: "A pending invitation already exists for this email.",
          });
        }

        const invitation = pending
          ? await transaction.invitation.update({
              where: { id: pending.id },
              data: {
                role: input.role,
                tokenHash,
                invitedById: actor.user.id,
                expiresAt,
                acceptedAt: null,
                revokedAt: null,
                createdAt: currentTime,
              },
              select: invitationSelect,
            })
          : await transaction.invitation.create({
              data: {
                workspaceId,
                email,
                role: input.role,
                tokenHash,
                invitedById: actor.user.id,
                expiresAt,
                createdAt: currentTime,
              },
              select: invitationSelect,
            });

        await this.audit.record(
          {
            actorId: actor.user.id,
            actorType: "user",
            action: "invitation.created",
            targetType: "invitation",
            targetId: invitation.id,
            workspaceId,
            ip: actor.ip ?? undefined,
            userAgent: actor.userAgent ?? undefined,
            metadata: { role: invitation.role },
          },
          transaction,
        );
        return invitation;
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      ) {
        throw new ConflictException({
          code: "INVITATION_ALREADY_PENDING",
          message: "A pending invitation already exists for this email.",
        });
      }
      throw error;
    }

    try {
      await this.email.sendInvitation({
        to: email,
        workspaceName: membership.workspaceName,
        inviterName: actor.user.name,
        url: new URL(`/invite/${token}`, this.invitationBaseUrl).toString(),
      });
    } catch {
      const revokedAt = this.now();
      await this.prisma.client.$transaction(async (transaction) => {
        await transaction.invitation.update({
          where: { id: created.id },
          data: { revokedAt },
        });
        await this.audit.record(
          {
            actorId: actor.user.id,
            actorType: "user",
            action: "invitation.delivery_failed",
            targetType: "invitation",
            targetId: created.id,
            workspaceId,
            ip: actor.ip ?? undefined,
            userAgent: actor.userAgent ?? undefined,
          },
          transaction,
        );
      });
      throw new ServiceUnavailableException({
        code: "INVITATION_DELIVERY_FAILED",
        message: "The invitation could not be delivered. No pending invitation was left behind.",
      });
    }

    return presentInvitation(created);
  }

  async revoke(
    actor: AuthenticatedActor,
    workspaceId: string,
    invitationId: string,
  ): Promise<{ message: string }> {
    const params = parseRequest(InvitationParamsSchema, { workspaceId, invitationId });
    const membership = await this.access.requireMembership(actor.user.id, params.workspaceId);
    this.permissions.assertCan(membership.role, "invitation:revoke", "invitation");
    const invitation = await this.prisma.client.invitation.findFirst({
      where: { id: params.invitationId, workspaceId: params.workspaceId },
      select: invitationSelect,
    });
    if (!invitation) {
      throw new NotFoundException({
        code: "INVITATION_NOT_FOUND",
        message: "Invitation not found.",
      });
    }
    if (membership.role === "admin" && invitation.role === "admin") {
      throw forbidden("MANAGE_ADMIN_FORBIDDEN", "Only the Owner can revoke an Admin invitation.");
    }
    if (invitation.acceptedAt) {
      throw new ConflictException({
        code: "INVITATION_ALREADY_ACCEPTED",
        message: "Accepted invitations cannot be revoked.",
      });
    }
    if (invitation.revokedAt) {
      throw new ConflictException({
        code: "INVITATION_ALREADY_REVOKED",
        message: "Invitation was already revoked.",
      });
    }

    const revokedAt = this.now();
    await this.prisma.client.$transaction(async (transaction) => {
      await transaction.invitation.update({
        where: { id: invitation.id },
        data: { revokedAt },
      });
      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "user",
          action: "invitation.revoked",
          targetType: "invitation",
          targetId: invitation.id,
          workspaceId: params.workspaceId,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
          metadata: { role: invitation.role },
        },
        transaction,
      );
    });

    return { message: "Invitation revoked." };
  }
}
