import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CommentTargetQuerySchema,
  CommentSchema,
  CreateCommentRequestSchema,
  UpdateCommentRequestSchema,
  type Comment,
  type CommentPage,
  type CommentTargetType,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId, toCursorPage } from "../../common/services/cursor-page.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { SanitizeService } from "../../common/services/sanitize.service.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { ActivitiesService } from "../activities/activities.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { RealtimePublisher } from "../realtime/realtime.publisher.js";
import { assertTripVisible, sortParts } from "../trips/content-values.js";
import { CommentsRepository, type CommentRecord, type CommentTargetRecord } from "./comments.repository.js";

@Injectable()
export class CommentsService {
  constructor(
    @Inject(CommentsRepository) private readonly repository: CommentsRepository,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(ActivitiesService) private readonly activities: ActivitiesService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(RealtimePublisher) private readonly publisher: RealtimePublisher,
    @Inject(SanitizeService)
    private readonly sanitizer: SanitizeService = new SanitizeService(),
  ) {}

  async list(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    rawQuery: unknown,
  ): Promise<CommentPage> {
    this.permissions.assertCan(membership.role, "comment:read", "comment");
    const query = parseRequest(CommentTargetQuerySchema, rawQuery);
    const target = await this.requireTarget(
      membership,
      query.targetType,
      query.targetId,
    );
    const { direction } = sortParts(query.sort, ["createdAt"], "createdAt");
    const records = await this.repository.listComments({
      workspaceId: membership.workspaceId,
      targetType: target.targetType,
      targetId: target.id,
      ...(cursorId(query.cursor) ? { cursor: cursorId(query.cursor) } : {}),
      take: query.limit + 1,
      direction,
    });
    return toCursorPage(records, query.limit, (record) =>
      this.presentComment(record),
    ) as CommentPage;
  }

  async create(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    rawInput: unknown,
  ): Promise<Comment> {
    this.permissions.assertCan(membership.role, "comment:create", "comment");
    const input = parseRequest(CreateCommentRequestSchema, normalizeMentionInput(rawInput));
    const target = await this.requireTarget(
      membership,
      input.targetType,
      input.targetId,
    );
    if (target.tripId !== input.tripId) {
      throw this.targetNotFound();
    }
    const mentionUserIds = [...new Set(input.mentionUserIds ?? [])];
    await this.assertMentionsBelongToWorkspace(membership.workspaceId, mentionUserIds);

    let parent: CommentRecord | null = null;
    if (input.parentId) {
      parent = await this.repository.findParent(membership.workspaceId, input.parentId);
      if (!parent) {
        throw this.commentNotFound();
      }
      if (parent.parentId !== null) {
        throw new BadRequestException({
          code: "COMMENT_REPLY_DEPTH_EXCEEDED",
          message: "Only one level of comment replies is supported.",
        });
      }
      if (
        parent.targetType !== target.targetType ||
        parent.targetId !== target.id ||
        parent.tripId !== target.tripId
      ) {
        throw new BadRequestException({
          code: "COMMENT_PARENT_TARGET_MISMATCH",
          message: "The parent comment belongs to a different discussion.",
        });
      }
    }

    const body = this.sanitizeBody(input.body);
    const mutation = await this.repository.transaction(async (tx) => {
      const record = await this.repository.createComment(tx, {
        workspaceId: membership.workspaceId,
        tripId: target.tripId,
        targetType: target.targetType,
        targetId: target.id,
        parentId: input.parentId ?? null,
        authorId: actor.user.id,
        body,
      });
      await this.repository.createMentions(
        tx,
        mentionUserIds.map((userId) => ({
          workspaceId: membership.workspaceId,
          commentId: record.id,
          userId,
        })),
      );
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: target.tripId,
        actorId: actor.user.id,
        verb: "comment.created",
        entityType: "comment",
        entityId: record.id,
        metadata: {
          targetType: target.targetType,
          targetId: target.id,
          parentId: record.parentId,
        },
      });
      const notificationResult = await this.notifications.createInTransaction(
        tx,
        this.notificationInputs(
          record,
          target,
          parent,
          mentionUserIds,
          actor.user.id,
          actor.user.name,
        ),
      );
      return { record, notificationEvents: notificationResult.events };
    });

    this.publisher.publish({
      type: "comment.changed",
      workspaceId: membership.workspaceId,
      tripId: target.tripId,
      payload: { actorId: actor.user.id, commentId: mutation.record.id },
    });
    this.publisher.publishMany(mutation.notificationEvents);
    return this.presentComment(mutation.record);
  }

  async update(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    commentId: string,
    rawInput: unknown,
  ): Promise<Comment> {
    this.permissions.assertCan(membership.role, "comment:update", "comment");
    const input = parseRequest(UpdateCommentRequestSchema, rawInput);
    const current = await this.requireComment(membership.workspaceId, commentId);
    this.assertCanModerate(actor, membership, current);
    await this.assertTripVisibleById(membership, current.tripId);
    const body = this.sanitizeBody(input.body);

    const updated = await this.repository.transaction(async (tx) => {
      const record = await this.repository.updateComment(tx, {
        workspaceId: membership.workspaceId,
        commentId,
        body,
      });
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: record.tripId,
        actorId: actor.user.id,
        verb: "comment.updated",
        entityType: "comment",
        entityId: record.id,
        metadata: {},
      });
      return record;
    });
    this.publisher.publish({
      type: "comment.changed",
      workspaceId: membership.workspaceId,
      tripId: updated.tripId,
      payload: { actorId: actor.user.id, commentId: updated.id },
    });
    return this.presentComment(updated);
  }

  async remove(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    commentId: string,
  ): Promise<{ message: string }> {
    this.permissions.assertCan(membership.role, "comment:delete", "comment");
    const current = await this.requireComment(membership.workspaceId, commentId);
    this.assertCanModerate(actor, membership, current);
    await this.assertTripVisibleById(membership, current.tripId);
    await this.repository.transaction(async (tx) => {
      const count = await this.repository.softDeleteComment(tx, {
        workspaceId: membership.workspaceId,
        commentId,
      });
      if (count === 0) {
        throw this.commentNotFound();
      }
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: current.tripId,
        actorId: actor.user.id,
        verb: "comment.deleted",
        entityType: "comment",
        entityId: commentId,
        metadata: {},
      });
    });
    this.publisher.publish({
      type: "comment.changed",
      workspaceId: membership.workspaceId,
      tripId: current.tripId,
      payload: { actorId: actor.user.id, commentId },
    });
    return { message: "Comment deleted." };
  }

  async resolve(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    commentId: string,
  ): Promise<Comment> {
    return this.setResolved(actor, membership, commentId, true);
  }

  async unresolve(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    commentId: string,
  ): Promise<Comment> {
    return this.setResolved(actor, membership, commentId, false);
  }

  private async setResolved(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    commentId: string,
    resolved: boolean,
  ): Promise<Comment> {
    this.permissions.assertCan(
      membership.role,
      resolved ? "comment:resolve" : "comment:unresolve",
      "comment",
    );
    const current = await this.requireComment(membership.workspaceId, commentId);
    await this.assertTripVisibleById(membership, current.tripId);
    const updated = await this.repository.transaction(async (tx) => {
      const record = await this.repository.setResolved(tx, {
        workspaceId: membership.workspaceId,
        commentId,
        resolvedAt: resolved ? new Date() : null,
        resolvedById: resolved ? actor.user.id : null,
      });
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: record.tripId,
        actorId: actor.user.id,
        verb: resolved ? "comment.resolved" : "comment.unresolved",
        entityType: "comment",
        entityId: record.id,
        metadata: {},
      });
      return record;
    });
    this.publisher.publish({
      type: "comment.changed",
      workspaceId: membership.workspaceId,
      tripId: updated.tripId,
      payload: { actorId: actor.user.id, commentId: updated.id },
    });
    return this.presentComment(updated);
  }

  private async requireTarget(
    membership: WorkspaceMembershipAccess,
    targetType: CommentTargetType,
    targetId: string,
  ): Promise<CommentTargetRecord> {
    const target = await this.repository.findTarget(targetType, targetId);
    if (!target || target.workspaceId !== membership.workspaceId) {
      throw this.targetNotFound();
    }
    const trip = await this.repository.findTrip(membership.workspaceId, target.tripId);
    if (!trip) {
      throw this.targetNotFound();
    }
    assertTripVisible(membership, trip);
    return target;
  }

  private async requireComment(
    workspaceId: string,
    commentId: string,
  ): Promise<CommentRecord> {
    const comment = await this.repository.findComment(workspaceId, commentId);
    if (!comment) {
      throw this.commentNotFound();
    }
    return comment;
  }

  private async assertTripVisibleById(
    membership: WorkspaceMembershipAccess,
    tripId: string,
  ): Promise<void> {
    const trip = await this.repository.findTrip(membership.workspaceId, tripId);
    if (!trip) {
      throw this.commentNotFound();
    }
    assertTripVisible(membership, trip);
  }

  private assertCanModerate(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    comment: CommentRecord,
  ): void {
    if (
      comment.authorId !== actor.user.id &&
      membership.role !== "owner" &&
      membership.role !== "admin"
    ) {
      throw new ForbiddenException({
        code: "COMMENT_FORBIDDEN",
        message: "Only the comment author or a Workspace administrator can do that.",
      });
    }
  }

  private async assertMentionsBelongToWorkspace(
    workspaceId: string,
    userIds: string[],
  ): Promise<void> {
    if (userIds.length === 0) {
      return;
    }
    const valid = await this.repository.findActiveMemberIds(workspaceId, userIds);
    if (valid.length !== userIds.length) {
      throw new BadRequestException({
        code: "COMMENT_MENTION_INVALID",
        message: "Every mentioned user must be an active Workspace member.",
      });
    }
  }

  private sanitizeBody(body: string): string {
    const sanitized = this.sanitizer.sanitizeHtml(body).trim();
    if (!sanitized) {
      throw new BadRequestException({
        code: "COMMENT_BODY_INVALID",
        message: "The comment body cannot be empty.",
      });
    }
    if (sanitized.length > 10_000) {
      throw new BadRequestException({
        code: "COMMENT_BODY_TOO_LONG",
        message: "The sanitized comment body cannot exceed 10000 characters.",
      });
    }
    return sanitized;
  }

  private notificationInputs(
    comment: CommentRecord,
    target: CommentTargetRecord,
    parent: CommentRecord | null,
    mentionUserIds: string[],
    actorId: string,
    actorName: string,
  ) {
    const inputs = [];
    const mentioned = new Set<string>();
    for (const userId of mentionUserIds) {
      if (userId === actorId) {
        continue;
      }
      mentioned.add(userId);
      inputs.push({
        userId,
        workspaceId: comment.workspaceId,
        tripId: comment.tripId,
        actorId,
        type: "mention",
        title: `${actorName} mentioned you`,
        body: plainText(comment.body).slice(0, 500),
        entityType: "comment",
        entityId: comment.id,
      });
    }

    if (parent && parent.authorId !== actorId && !mentioned.has(parent.authorId)) {
      inputs.push({
        userId: parent.authorId,
        workspaceId: comment.workspaceId,
        tripId: comment.tripId,
        actorId,
        type: "comment_reply",
        title: `${actorName} replied to your comment`,
        body: plainText(comment.body).slice(0, 500),
        entityType: "comment",
        entityId: comment.id,
      });
    } else if (
      !parent &&
      target.createdById !== actorId &&
      !mentioned.has(target.createdById)
    ) {
      inputs.push({
        userId: target.createdById,
        workspaceId: comment.workspaceId,
        tripId: comment.tripId,
        actorId,
        type: "comment",
        title: `${actorName} commented`,
        body: plainText(comment.body).slice(0, 500),
        entityType: "comment",
        entityId: comment.id,
      });
    }
    return inputs;
  }

  private presentComment(record: CommentRecord): Comment {
    return CommentSchema.parse({
      id: record.id,
      workspaceId: record.workspaceId,
      tripId: record.tripId,
      targetType: record.targetType,
      targetId: record.targetId,
      parentId: record.parentId,
      authorId: record.authorId,
      body: this.sanitizer.sanitizeHtml(record.body).slice(0, 10_000),
      resolvedAt: record.resolvedAt?.toISOString() ?? null,
      resolvedById: record.resolvedById,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      deletedAt: record.deletedAt?.toISOString() ?? null,
    });
  }

  private targetNotFound(): NotFoundException {
    return new NotFoundException({
      code: "COMMENT_TARGET_NOT_FOUND",
      message: "The requested comment target was not found.",
    });
  }

  private commentNotFound(): NotFoundException {
    return new NotFoundException({
      code: "COMMENT_NOT_FOUND",
      message: "The requested comment was not found.",
    });
  }
}

function normalizeMentionInput(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const input = { ...(value as Record<string, unknown>) };
  if (Array.isArray(input.mentionUserIds)) {
    input.mentionUserIds = [
      ...new Set(
        input.mentionUserIds.filter((item): item is string => typeof item === "string"),
      ),
    ];
  }
  return input;
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
