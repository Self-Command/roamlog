import type { Job } from "bullmq";
import { defineProcessor, type JobProcessor, type ProcessorContext } from "../processor.js";
import { objectBucket } from "./storage-bucket.js";
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
  let missingExportBuckets = 0;
  let firstMissingExportId: string | null = null;
  for (const record of expired) {
    counts.expiredExports = (counts.expiredExports ?? 0) + 1;
    if (data.dryRun) {
      continue;
    }
    if (record.storageKey) {
      const bucket = objectBucket(record.bucket);
      if (!bucket) {
        missingExportBuckets += 1;
        firstMissingExportId ??= String(record.id);
      }
      try {
        // `bucket` null means the row predates 0011_export_bucket; the storage
        // layer falls back to the current bucket and this run warns once.
        await deps.storage.deleteObject(record.storageKey, bucket);
      } catch {
        // Object may already be gone.
      }
    }
    await deps.db.export.updateMany({
      where: { id: record.id },
      data: { status: "expired", error: "Export expired." },
    });
  }
  if (missingExportBuckets > 0) {
    context.logger.warn(
      {
        jobId: context.jobId,
        event: "export.bucket_missing",
        count: missingExportBuckets,
        sampleExportId: firstMissingExportId,
        fallback: "current",
      },
      "export row has no bucket; deleting with the current bucket",
    );
  }

  const deletedMedia = await deps.db.media.findMany({
    where: { deletedAt: { not: null, lte: new Date(now.getTime() - DAY_MS) } },
    take: 200,
  });
  let missingMediaBuckets = 0;
  let firstMissingMediaId: string | null = null;
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
    const bucket = objectBucket(media.bucket);
    if (!bucket) {
      missingMediaBuckets += 1;
      firstMissingMediaId ??= String(media.id);
    }
    for (const key of keys) {
      try {
        await deps.storage.deleteObject(key, bucket);
      } catch {
        // Idempotent cleanup.
      }
    }
    await deps.db.media.updateMany({
      where: { id: media.id },
      data: { variants: {}, error: "Media objects deleted after retention window." },
    });
  }
  if (missingMediaBuckets > 0) {
    context.logger.warn(
      {
        jobId: context.jobId,
        event: "media.bucket_missing",
        count: missingMediaBuckets,
        sampleMediaId: firstMissingMediaId,
        fallback: "current",
      },
      "media rows have no bucket; deleting with the current bucket",
    );
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
