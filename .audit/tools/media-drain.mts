/**
 * Local media drain: runs the worker's real media job without BullMQ.
 *
 * Why this exists. `MediaService.complete` only marks a row `processing`; the
 * variants and thumbnails are produced by the worker, and only then does
 * `presentMediaRead` sign a url. The worker itself is fine — this host simply
 * cannot give it a queue: there is no Docker, no WSL and no real Redis, and the
 * in-process Redis the API exposes (e2e/live-support/redis-stub.ts, port 46379)
 * is a passive cache stub. BullMQ drives jobs through Lua scripts, so against
 * that stub the worker connects and then fails (`stalled.forEach is not a
 * function`, `job ingress failed: Unexpected token 'K'`) and never consumes a
 * job.
 *
 * What is real here and what is not:
 *   real   — handleMediaJob from apps/worker/src/jobs/media.ts, unchanged
 *   real   — createWorkerDependencies: prisma client, S3 client, image pipeline
 *   real   — the bytes, the variants, the S3 PUTs, the database rows
 *   NOT    — the queue transport. Jobs are discovered by polling for
 *            `status = processing` instead of being delivered by Redis.
 *
 * So this verifies the media pipeline and the attachment flow end to end; it
 * does not verify queue delivery, retries, stalled-job recovery or job
 * scheduling. Those still need a real Redis, and the report says so.
 *
 * Usage: bash .audit/tools/media-drain.sh   (sets DATABASE_URL/S3_* and calls this)
 */
import { handleMediaJob } from "../../apps/worker/src/jobs/media.js";
import { createWorkerDependencies } from "../../apps/worker/src/dependencies.js";
import { createLogger } from "../../apps/worker/src/logger.js";

const logger = createLogger("info");
const deps = createWorkerDependencies(logger);

/** `--watch` keeps one process alive: tsx + prisma startup costs ~1-2s and an
 * upload window is far shorter than that, so spawning per file drops jobs. */
const watch = process.argv.includes("--watch");
const intervalMs = Number(process.env.MEDIA_DRAIN_INTERVAL_MS ?? 2000);

async function drainOnce(): Promise<number> {
  const pending = await deps.db.media.findMany({
    where: { status: "processing", deletedAt: null },
    select: { id: true, workspaceId: true, mimeType: true, key: true },
    take: 50,
  });

  if (pending.length === 0) {
    if (!watch) console.log("[media-drain] nothing is waiting in processing");
    return 0;
  }

  console.log(`[media-drain] ${pending.length} row(s) in processing`);
  let failed = 0;

  for (const media of pending) {
    try {
      const outcome = await handleMediaJob(
        "media.process",
        { mediaId: media.id, workspaceId: media.workspaceId },
        { queue: "media", jobId: `media-drain:${media.id}`, logger },
        deps,
      );
      console.log(`[media-drain] ${media.id} -> ${outcome.status}`);
      if (outcome.status !== "ready") failed += 1;
    } catch (error) {
      failed += 1;
      console.error(`[media-drain] ${media.id} threw`, error);
    }
  }
  return failed;
}

if (!watch) {
  const failed = await drainOnce();
  process.exit(failed === 0 ? 0 : 1);
}

console.log(`[media-drain] watching for processing rows every ${intervalMs}ms`);
// A drain failure must not tear the watcher down: a single unreadable upload
// should not stop every later one from being processed.
for (;;) {
  try {
    await drainOnce();
  } catch (error) {
    console.error("[media-drain] poll failed", error);
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}