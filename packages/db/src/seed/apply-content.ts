import type { SeedDataset } from "./types.js";
import {
  dateOnly,
  dateTime,
  json,
  nullableDateTime,
  type SeedTransaction,
} from "./apply-utils.js";

export async function applyContent(
  tx: SeedTransaction,
  data: SeedDataset,
): Promise<void> {
  for (const entry of data.entries) {
    const fields = {
      workspaceId: entry.workspaceId,
      tripId: entry.tripId,
      title: entry.title,
      date: dateOnly(entry.date),
      location: entry.location,
      lat: entry.lat,
      lng: entry.lng,
      mood: entry.mood,
      weather: entry.weather,
      contentJson: json(entry.contentJson),
      contentHtml: entry.contentHtml,
      excerpt: entry.excerpt,
      tags: entry.tags,
      favorite: entry.favorite,
      version: entry.version,
      createdById: entry.createdById,
      updatedById: entry.updatedById,
      createdAt: dateTime(entry.createdAt),
      updatedAt: dateTime(entry.updatedAt),
      deletedAt: nullableDateTime(entry.deletedAt),
    };
    await tx.journalEntry.upsert({
      where: { id: entry.id },
      update: fields,
      create: { id: entry.id, ...fields },
    });
  }

  for (const revision of data.revisions) {
    const fields = {
      workspaceId: revision.workspaceId,
      entryId: revision.entryId,
      version: revision.version,
      title: revision.title,
      contentJson: json(revision.contentJson),
      contentHtml: revision.contentHtml,
      editedById: revision.editedById,
      createdAt: dateTime(revision.createdAt),
    };
    await tx.entryRevision.upsert({
      where: { id: revision.id },
      update: fields,
      create: { id: revision.id, ...fields },
    });
  }

  for (const item of data.media) {
    const fields = {
      workspaceId: item.workspaceId,
      tripId: item.tripId,
      uploaderId: item.uploaderId,
      bucket: item.bucket,
      key: item.key,
      mimeType: item.mimeType,
      size: item.size,
      width: item.width,
      height: item.height,
      blurhash: item.blurhash,
      variants: json(item.variants),
      status: item.status,
      error: item.error,
      caption: item.caption,
      date: item.date ? dateOnly(item.date) : null,
      location: item.location,
      createdAt: dateTime(item.createdAt),
      updatedAt: dateTime(item.updatedAt),
      deletedAt: nullableDateTime(item.deletedAt),
    };
    await tx.media.upsert({
      where: { id: item.id },
      update: fields,
      create: { id: item.id, ...fields },
    });
  }

  for (const link of data.entryMedia) {
    const fields = {
      workspaceId: link.workspaceId,
      entryId: link.entryId,
      mediaId: link.mediaId,
      order: link.order,
    };
    await tx.entryMedia.upsert({
      where: {
        entryId_mediaId: {
          entryId: link.entryId,
          mediaId: link.mediaId,
        },
      },
      update: fields,
      create: fields,
    });
  }

  for (const item of data.itineraryItems) {
    const fields = {
      workspaceId: item.workspaceId,
      tripId: item.tripId,
      date: dateOnly(item.date),
      startTime: item.startTime,
      endTime: item.endTime,
      title: item.title,
      type: item.type,
      location: item.location,
      notes: item.notes,
      done: item.done,
      order: item.order,
      assigneeId: item.assigneeId,
      version: item.version,
      createdById: item.createdById,
      updatedById: item.updatedById,
      createdAt: dateTime(item.createdAt),
      updatedAt: dateTime(item.updatedAt),
      deletedAt: nullableDateTime(item.deletedAt),
    };
    await tx.itineraryItem.upsert({
      where: { id: item.id },
      update: fields,
      create: { id: item.id, ...fields },
    });
  }

  for (const comment of data.comments) {
    const fields = {
      workspaceId: comment.workspaceId,
      tripId: comment.tripId,
      targetType: comment.targetType,
      targetId: comment.targetId,
      parentId: comment.parentId,
      authorId: comment.authorId,
      body: comment.body,
      resolvedAt: nullableDateTime(comment.resolvedAt),
      resolvedById: comment.resolvedById,
      createdAt: dateTime(comment.createdAt),
      updatedAt: dateTime(comment.updatedAt),
      deletedAt: nullableDateTime(comment.deletedAt),
    };
    await tx.comment.upsert({
      where: { id: comment.id },
      update: fields,
      create: { id: comment.id, ...fields },
    });
  }

  for (const mention of data.commentMentions) {
    const fields = {
      workspaceId: mention.workspaceId,
      commentId: mention.commentId,
      userId: mention.userId,
    };
    await tx.commentMention.upsert({
      where: {
        commentId_userId: {
          commentId: mention.commentId,
          userId: mention.userId,
        },
      },
      update: fields,
      create: fields,
    });
  }
}
