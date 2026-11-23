import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DeleteMeRequestSchema,
  SessionParamsSchema,
  SessionSchema,
  UpdateMeRequestSchema,
  UuidV7Schema,
  type MyWorkspacesResponse,
  type Session,
  type SessionListResponse,
  type UpdateMeRequest,
  type User,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { presentUser, type UserRecordInput } from "../../common/services/user-presenter.js";
import { AuditService } from "../audit/audit.service.js";
import { MediaUrlService } from "../media/media-url.service.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { WorkspacesService } from "../workspaces/workspaces.service.js";
import { isAvatarMediaId, mediaIdFromAvatarUrl } from "./avatar-image.js";

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
    @Inject(MediaUrlService) private readonly mediaUrls: MediaUrlService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
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
    return this.presentAccount(user);
  }

  async updateMe(actor: AuthenticatedActor, rawInput: unknown): Promise<User> {
    const input: UpdateMeRequest = parseRequest(UpdateMeRequestSchema, rawInput);
    const image = await this.storedAvatar(actor, input.image);
    return this.prisma.client.$transaction(async (transaction) => {
      const user = await transaction.user.update({
        where: { id: actor.user.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(image !== undefined ? { image } : {}),
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
      return this.presentAccount(user);
    });
  }

  /**
   * Turns the client's `image` input into the value the row stores.
   *
   * The profile page still sends the signed URL the media pipeline returned
   * (`PATCH /v1/me { image }` is in the published contract), so the media id is
   * recovered from that URL's object key. Storing the id — not the URL — is what
   * keeps the avatar alive past the SigV4 TTL (see `avatar-image.ts`).
   *
   * The recovered id is only used when the media row exists, is not deleted and
   * was uploaded by the caller; anything else keeps the URL verbatim, which is
   * exactly the pre-existing behaviour for an external avatar.
   */
  private async storedAvatar(
    actor: AuthenticatedActor,
    image: string | null | undefined,
  ): Promise<string | null | undefined> {
    if (image === undefined || image === null) {
      return image;
    }
    const mediaId = mediaIdFromAvatarUrl(image);
    if (!mediaId) {
      return image;
    }
    const media = await this.prisma.client.media.findFirst({
      where: { id: mediaId, deletedAt: null },
      select: { id: true, uploaderId: true },
    });
    if (!media) {
      // A URL shaped like our media key that no row backs: do not persist a
      // dangling id, and do not silently accept a forged avatar either.
      throw new BadRequestException({
        code: "AVATAR_MEDIA_NOT_FOUND",
        message: "The uploaded avatar media was not found.",
      });
    }
    if (media.uploaderId !== actor.user.id) {
      throw new BadRequestException({
        code: "AVATAR_MEDIA_NOT_OWNED",
        message: "The avatar must be media uploaded by this account.",
      });
    }
    return media.id;
  }

  /**
   * Presents a user row, re-signing a stored avatar media id on every read.
   *
   * This is the only place that signs, because it is the only caller with the
   * storage dependency (`MediaUrlService`); `presentUser` keeps presenting raw
   * rows for member lists and the Admin API, where a bare id is dropped to
   * `null` rather than breaking the strict `UserSchema.image = z.url()`.
   */
  private async presentAccount(record: UserRecordInput): Promise<User> {
    const presented = presentUser(record);
    const stored = record.image;
    if (!stored || !isAvatarMediaId(stored)) {
      return presented;
    }
    try {
      const media = await this.prisma.client.media.findFirst({
        where: { id: stored.trim(), deletedAt: null },
        select: { id: true, key: true, bucket: true, status: true, variants: true },
      });
      if (!media) {
        return { ...presented, image: null };
      }
      const urls = await this.mediaUrls.sign(media);
      return { ...presented, image: urls.thumbUrl ?? urls.url };
    } catch (error) {
      // A broken storage configuration must not take the whole profile page
      // down: the avatar is decorative, so it degrades to initials.
      this.logger.warn(
        { code: "AVATAR_SIGN_FAILED", error: error instanceof Error ? error.message : "unknown" },
        "user.avatar_sign_failed",
      );
      return { ...presented, image: null };
    }
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
        deviceId: true,
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
        deviceId: session.deviceId,
      }),
    );
  }

  async associateDevice(
    actor: AuthenticatedActor,
    sessionId: string,
    deviceId: string,
  ): Promise<{ message: string }> {
    if (!UuidV7Schema.safeParse(deviceId).success) {
      throw new BadRequestException({
        code: "DEVICE_ID_INVALID",
        message: "A valid device identifier is required.",
      });
    }
    const session = await this.prisma.client.session.findFirst({
      where: { id: sessionId, userId: actor.user.id },
      select: { id: true, deviceId: true },
    });
    if (!session) {
      throw new NotFoundException({
        code: "SESSION_NOT_FOUND",
        message: "Session not found.",
      });
    }
    if (session.deviceId === deviceId) {
      return { message: "Device associated." };
    }
    const updated = await this.prisma.client.session.updateMany({
      where: { id: sessionId, userId: actor.user.id },
      data: { deviceId },
    });
    if (updated.count !== 1) {
      throw new NotFoundException({
        code: "SESSION_NOT_FOUND",
        message: "Session not found.",
      });
    }
    return { message: "Device associated." };
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
