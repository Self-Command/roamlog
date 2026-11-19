import type { AdminReportItem, ReportTargetType } from "@roamlog/contracts";

import type { PrismaService } from "../prisma/prisma.service.js";

type Db = PrismaService["client"];

export interface ReportRow {
  id: string;
  workspaceId: string;
  targetType: string;
  targetId: string;
  reason: string;
  detail: string | null;
  reporterId: string;
  status: string;
  resolvedById: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  createdAt: Date;
}

export interface TargetKey {
  type: ReportTargetType;
  id: string;
}

/** A valid UUIDv7 used when the author account no longer exists. */
const UNKNOWN_ID = "00000000-0000-7000-8000-000000000000";

interface SnapshotRecord {
  type: ReportTargetType;
  id: string;
  title: string;
  authorId: string;
  workspaceId: string;
  deletedAt: Date | null;
  moderatedAt: Date | null;
}

function key(type: string, id: string): string {
  return `${type}:${id}`;
}

function excerpt(value: string, max = 500): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed || "（无标题）";
}

function fileName(key: string): string {
  return key.split("/").at(-1) ?? key;
}

/**
 * Resolves the polymorphic report target to a read-only snapshot.
 *
 * Targets may have been hard-deleted by a later cleanup, so every lookup is
 * allowed to miss and falls back to a clearly-labelled placeholder instead of
 * dropping the report from the queue.
 */
async function loadSnapshots(db: Db, targets: TargetKey[]): Promise<Map<string, SnapshotRecord>> {
  const result = new Map<string, SnapshotRecord>();
  const byType = (type: ReportTargetType) => [
    ...new Set(targets.filter((target) => target.type === type).map((target) => target.id)),
  ];

  const tripIds = byType("trip");
  if (tripIds.length > 0) {
    const rows = await db.trip.findMany({
      where: { id: { in: tripIds } },
      select: {
        id: true,
        workspaceId: true,
        title: true,
        createdById: true,
        deletedAt: true,
        moderatedAt: true,
      },
    });
    for (const row of rows) {
      result.set(key("trip", row.id), {
        type: "trip",
        id: row.id,
        workspaceId: row.workspaceId,
        authorId: row.createdById,
        title: row.title,
        deletedAt: row.deletedAt,
        moderatedAt: row.moderatedAt,
      });
    }
  }

  const entryIds = byType("entry");
  if (entryIds.length > 0) {
    const rows = await db.journalEntry.findMany({
      where: { id: { in: entryIds } },
      select: {
        id: true,
        workspaceId: true,
        title: true,
        createdById: true,
        deletedAt: true,
        moderatedAt: true,
      },
    });
    for (const row of rows) {
      result.set(key("entry", row.id), {
        type: "entry",
        id: row.id,
        workspaceId: row.workspaceId,
        authorId: row.createdById,
        title: row.title,
        deletedAt: row.deletedAt,
        moderatedAt: row.moderatedAt,
      });
    }
  }

  const commentIds = byType("comment");
  if (commentIds.length > 0) {
    const rows = await db.comment.findMany({
      where: { id: { in: commentIds } },
      select: {
        id: true,
        workspaceId: true,
        body: true,
        authorId: true,
        deletedAt: true,
        moderatedAt: true,
      },
    });
    for (const row of rows) {
      result.set(key("comment", row.id), {
        type: "comment",
        id: row.id,
        workspaceId: row.workspaceId,
        authorId: row.authorId,
        title: excerpt(row.body),
        deletedAt: row.deletedAt,
        moderatedAt: row.moderatedAt,
      });
    }
  }

  const mediaIds = byType("media");
  if (mediaIds.length > 0) {
    const rows = await db.media.findMany({
      where: { id: { in: mediaIds } },
      select: {
        id: true,
        workspaceId: true,
        key: true,
        caption: true,
        uploaderId: true,
        deletedAt: true,
        moderatedAt: true,
      },
    });
    for (const row of rows) {
      result.set(key("media", row.id), {
        type: "media",
        id: row.id,
        workspaceId: row.workspaceId,
        authorId: row.uploaderId,
        title: row.caption?.trim() || fileName(row.key),
        deletedAt: row.deletedAt,
        moderatedAt: row.moderatedAt,
      });
    }
  }

  return result;
}

/**
 * Returns the queue rows with content snapshots and per-target report counts.
 * The queue mixes four content kinds, so this is a bounded batch (page size is
 * at most 100) rather than one join per row.
 */
export async function buildAdminReportItems(
  db: Db,
  rows: ReportRow[],
): Promise<AdminReportItem[]> {
  if (rows.length === 0) {
    return [];
  }

  const pairs: TargetKey[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = key(row.targetType, row.targetId);
    if (!seen.has(id)) {
      seen.add(id);
      pairs.push({ type: row.targetType as ReportTargetType, id: row.targetId });
    }
  }

  const snapshots = await loadSnapshots(db, pairs);
  const [counts, workspaces, authors] = await Promise.all([
    db.report.groupBy({
      by: ["targetType", "targetId"],
      where: { OR: pairs.map((pair) => ({ targetType: pair.type, targetId: pair.id })) },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    db.workspace.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.workspaceId))] } },
      select: { id: true, name: true },
    }),
    db.user.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              [...snapshots.values()]
                .filter((snapshot) => snapshot.authorId !== UNKNOWN_ID)
                .map((snapshot) => snapshot.authorId),
            ),
          ],
        },
      },
      select: { id: true, name: true },
    }),
  ]);

  const workspaceNames = new Map(workspaces.map((entry) => [entry.id, entry.name]));
  const authorNames = new Map(authors.map((entry) => [entry.id, entry.name]));
  const aggregate = new Map(
    counts.map((group) => [
      key(group.targetType, group.targetId),
      {
        count: group._count._all,
        lastReportedAt: group._max.createdAt ?? new Date(0),
      },
    ]),
  );

  return rows.map((row) => {
    const snapshot = snapshots.get(key(row.targetType, row.targetId));
    const stats = aggregate.get(key(row.targetType, row.targetId));
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      targetType: row.targetType as ReportTargetType,
      targetId: row.targetId,
      reason: row.reason as AdminReportItem["reason"],
      detail: row.detail,
      reporterId: row.reporterId,
      status: row.status as AdminReportItem["status"],
      resolvedById: row.resolvedById,
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
      resolutionNote: row.resolutionNote,
      createdAt: row.createdAt.toISOString(),
      target: {
        type: row.targetType as ReportTargetType,
        id: row.targetId,
        title: snapshot?.title ?? "内容已删除",
        authorId: snapshot?.authorId ?? UNKNOWN_ID,
        authorName: authorNames.get(snapshot?.authorId ?? "") ?? "未知作者",
        workspaceId: row.workspaceId,
        workspaceName: workspaceNames.get(row.workspaceId) ?? "未知工作区",
        deletedAt: snapshot?.deletedAt ? snapshot.deletedAt.toISOString() : null,
        moderatedAt: snapshot?.moderatedAt ? snapshot.moderatedAt.toISOString() : null,
      },
      reportCount: stats?.count ?? 1,
      lastReportedAt: (stats?.lastReportedAt ?? row.createdAt).toISOString(),
    };
  });
}

/**
 * A report is only accepted for content the reporter can actually see in this
 * workspace: same tenant, not author-deleted, not already moderated away, and
 * not somebody else's private trip. Missing and forbidden look identical (404)
 * so the endpoint cannot be used to probe for content.
 */
export async function isVisibleReportTarget(
  db: Db,
  type: ReportTargetType,
  id: string,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const sharedTrip = {
    deletedAt: null,
    moderatedAt: null,
    OR: [{ visibility: { not: "private" as const } }, { createdById: userId }],
  };

  if (type === "trip") {
    const trip = await db.trip.findFirst({
      where: { id, workspaceId, ...sharedTrip },
      select: { id: true },
    });
    return trip !== null;
  }
  if (type === "entry") {
    const entry = await db.journalEntry.findFirst({
      where: { id, workspaceId, trip: sharedTrip },
      select: { id: true },
    });
    return entry !== null;
  }
  if (type === "comment") {
    const comment = await db.comment.findFirst({
      where: { id, workspaceId, trip: sharedTrip },
      select: { id: true },
    });
    return comment !== null;
  }
  const media = await db.media.findFirst({
    where: { id, workspaceId, deletedAt: null, moderatedAt: null },
    select: { id: true },
  });
  return media !== null;
}

/**
 * Applies a takedown / restore to the reported target.
 *
 * Takedown reuses the existing soft-delete visibility filter (`deletedAt`) and
 * records `moderatedAt` / `moderatedById` so an admin takedown stays
 * distinguishable from the author deleting their own content. Restore only
 * reverses content that was actually moderated, so an author-deleted row is
 * never resurrected by a `restore` decision.
 */
export async function applyModerationToTarget(
  db: Db,
  type: ReportTargetType,
  id: string,
  actorId: string,
  action: "remove" | "restore",
): Promise<void> {
  const now = new Date();
  const data =
    action === "remove"
      ? { deletedAt: now, moderatedAt: now, moderatedById: actorId }
      : { deletedAt: null, moderatedAt: null, moderatedById: null };

  if (type === "trip") {
    await db.trip.updateMany({
      where:
        action === "restore"
          ? { id, moderatedAt: { not: null } }
          : { id },
      data,
    });
  } else if (type === "entry") {
    await db.journalEntry.updateMany({
      where: action === "restore" ? { id, moderatedAt: { not: null } } : { id },
      data,
    });
  } else if (type === "comment") {
    await db.comment.updateMany({
      where: action === "restore" ? { id, moderatedAt: { not: null } } : { id },
      data,
    });
  } else {
    await db.media.updateMany({
      where: action === "restore" ? { id, moderatedAt: { not: null } } : { id },
      data,
    });
  }
}

export { UNKNOWN_ID };