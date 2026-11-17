import type { Job } from "bullmq";
import { defineProcessor, type JobProcessor, type ProcessorContext } from "../processor.js";
import type { WorkerDependencies } from "./types.js";

export interface MaintenanceJobData {
  dryRun?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function handleMaintenanceJob(
  data: MaintenanceJobData,
  context: ProcessorContext,
  deps: WorkerDependencies,
): Promise<Record<string, number>> {
  const now = deps.now();
  const counts: Record<string, number> = {
    expiredExports: 0,
    deletedMediaObjects: 0,
    purgedEntries: 0,
    purgedComments: 0,
    purgedExpenses: 0,
    purgedPacking: 0,
    purgedMedia: 0,
    expiredSessions: 0,
  };

  const expired = await deps.db.export.findMany({
    where: {
      status: { in: ["ready", "processing", "queued"] },
      expiresAt: { not: null, lte: now },
    },
    take: 100,
  });
  for (const record of expired) {
    counts.expiredExports = (counts.expiredExports ?? 0) + 1;
    if (data.dryRun) {
      continue;
    }
    if (record.storageKey) {
      try {
        await deps.storage.deleteObject(record.storageKey);
      } catch {
        // Object may already be gone.
      }
    }
    await deps.db.export.updateMany({
      where: { id: record.id },
      data: { status: "expired", error: "Export expired." },
    });
  }

  const deletedMedia = await deps.db.media.findMany({
    where: { deletedAt: { not: null, lte: new Date(now.getTime() - DAY_MS) } },
    take: 200,
  });
  for (const media of deletedMedia) {
    counts.deletedMediaObjects = (counts.deletedMediaObjects ?? 0) + 1;
    if (data.dryRun) {
      continue;
    }
    const variants = isRecord(media.variants) ? media.variants : {};
    const keys = new Set<string>([media.key]);
    for (const value of Object.values(variants)) {
      if (isRecord(value) && typeof value.key === "string") {
        keys.add(value.key);
      }
    }
    for (const key of keys) {
      try {
        await deps.storage.deleteObject(key);
      } catch {
        // Idempotent cleanup.
      }
    }
    await deps.db.media.updateMany({
      where: { id: media.id },
      data: { variants: {}, error: "Media objects deleted after retention window." },
    });
  }

  if (!data.dryRun) {
    const cutoff = new Date(now.getTime() - 30 * DAY_MS);
    const entries = await deps.db.journalEntry.deleteMany({
      where: { deletedAt: { not: null, lte: cutoff } },
    });
    counts.purgedEntries = entries.count;
    const comments = await deps.db.comment.deleteMany({
      where: { deletedAt: { not: null, lte: cutoff } },
    });
    counts.purgedComments = comments.count;
    const expenses = await deps.db.expense.deleteMany({
      where: { deletedAt: { not: null, lte: cutoff } },
    });
    counts.purgedExpenses = expenses.count;
    const packing = await deps.db.packingItem.deleteMany({
      where: { deletedAt: { not: null, lte: cutoff } },
    });
    counts.purgedPacking = packing.count;
    const media = await deps.db.media.deleteMany({
      where: { deletedAt: { not: null, lte: cutoff } },
    });
    counts.purgedMedia = media.count;
    const sessions = await deps.db.session.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    counts.expiredSessions = sessions.count;
  }

  context.logger.info({ jobId: context.jobId, ...counts }, "maintenance completed");
  return counts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createMaintenanceProcessor(
  deps: WorkerDependencies,
): JobProcessor<MaintenanceJobData> {
  return defineProcessor<MaintenanceJobData>({
    name: "maintenance",
    handle(job: Job<MaintenanceJobData>, context: ProcessorContext) {
      return handleMaintenanceJob(job.data ?? {}, context, deps);
    },
  });
}
