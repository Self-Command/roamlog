import { describe, expect, it, vi } from "vitest";

import { createStorage } from "../src/dependencies.js";
import { handleMaintenanceJob } from "../src/jobs/maintenance.js";
import { handleMediaJob } from "../src/jobs/media.js";
import type { WorkerDependencies } from "../src/jobs/types.js";
import type { ProcessorContext } from "../src/processor.js";

/**
 * Object deletion must use the bucket recorded on the row that owns the
 * object, not the worker's currently configured bucket. The fixture models the
 * dangerous case explicitly: the worker's current bucket is `current-b`, while
 * every row lives in `bucket-a`.
 */

const NOW = new Date("2026-11-19T00:00:00.000Z");

function contextWithWarn(): {
  context: ProcessorContext;
  warn: ReturnType<typeof vi.fn>;
} {
  const warn = vi.fn();
  return {
    warn,
    context: {
      queue: "maintenance",
      jobId: "bucket-job",
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn,
        error: () => undefined,
      },
    },
  };
}

type DeleteObject = (key: string, bucket?: string) => Promise<void>;

function deleteObjectMock() {
  return vi.fn<DeleteObject>(async () => undefined);
}

function createDeps(
  db: Record<string, unknown>,
  deleteObject: DeleteObject,
): WorkerDependencies {
  return {
    db,
    storage: {
      getObject: vi.fn(),
      putObject: vi.fn(),
      deleteObject,
    },
    images: { process: vi.fn() },
    email: { send: vi.fn(), render: vi.fn() },
    now: () => NOW,
    logger: contextWithWarn().context.logger,
  };
}

describe("worker storage: row bucket wins over the current bucket", () => {
  it("sends DeleteObject to the bucket recorded on the row", async () => {
    const commands: Array<{ Bucket?: string; Key?: string }> = [];
    const client = {
      async send(command: unknown) {
        commands.push((command as { input: { Bucket?: string; Key?: string } }).input);
        return {};
      },
    };
    const storage = createStorage({ bucket: "current-b", client });

    await storage.deleteObject("media/w1/old.jpg", "bucket-a");
    await storage.deleteObject("legacy/object.jpg");

    expect(commands).toEqual([
      { Bucket: "bucket-a", Key: "media/w1/old.jpg" },
      { Bucket: "current-b", Key: "legacy/object.jpg" },
    ]);
  });
});

describe("worker maintenance: expired exports", () => {
  const expiredBase = {
    id: "export-1",
    workspaceId: "w1",
    storageKey: "exports/w1/export-1/export.zip",
    status: "ready",
    expiresAt: new Date("2026-11-18T00:00:00.000Z"),
  };

  function maintenanceDb(rows: Array<Record<string, unknown>>): Record<string, unknown> {
    return {
      export: {
        findMany: vi.fn(async () => rows),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      media: {
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(async () => ({ count: 0 })),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      journalEntry: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      comment: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      expense: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      packingItem: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      session: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    };
  }

  it("deletes the artifact from the export row's bucket", async () => {
    const deleteObject = deleteObjectMock();
    const deps = createDeps(maintenanceDb([{ ...expiredBase, bucket: "bucket-a" }]), deleteObject);

    await handleMaintenanceJob({}, contextWithWarn().context, deps);

    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith(
      "exports/w1/export-1/export.zip",
      "bucket-a",
    );
  });

  it("falls back to the current bucket with one warn for NULL bucket rows", async () => {
    const deleteObject = deleteObjectMock();
    const { context, warn } = contextWithWarn();
    const deps = createDeps(maintenanceDb([{ ...expiredBase, bucket: null }]), deleteObject);

    await handleMaintenanceJob({}, context, deps);

    expect(deleteObject).toHaveBeenCalledWith("exports/w1/export-1/export.zip", undefined);
    const bucketWarn = warn.mock.calls.find(
      ([entry]) => (entry as { event?: string }).event === "export.bucket_missing",
    );
    expect(bucketWarn?.[0]).toMatchObject({
      count: 1,
      sampleExportId: "export-1",
      fallback: "current",
    });
  });
});

describe("worker maintenance: soft-deleted media", () => {
  it("deletes every variant from the media row's bucket", async () => {
    const deleteObject = deleteObjectMock();
    const mediaRow = {
      id: "media-1",
      bucket: "bucket-a",
      key: "media/w1/still.jpg",
      variants: {
        thumb: { key: "media/w1/thumb.jpg" },
        large: { key: "media/w1/large.jpg" },
      },
      deletedAt: new Date("2026-11-17T00:00:00.000Z"),
    };
    const deps = createDeps(
      {
        export: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
        media: {
          findMany: vi.fn(async () => [mediaRow]),
          updateMany: vi.fn(async () => ({ count: 1 })),
          deleteMany: vi.fn(async () => ({ count: 1 })),
        },
        journalEntry: { deleteMany: vi.fn(async () => ({ count: 0 })) },
        comment: { deleteMany: vi.fn(async () => ({ count: 0 })) },
        expense: { deleteMany: vi.fn(async () => ({ count: 0 })) },
        packingItem: { deleteMany: vi.fn(async () => ({ count: 0 })) },
        session: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      },
      deleteObject,
    );

    await handleMaintenanceJob({}, contextWithWarn().context, deps);

    expect(deleteObject).toHaveBeenCalledTimes(3);
    for (const call of deleteObject.mock.calls) {
      expect(call[1]).toBe("bucket-a");
    }
    expect(deleteObject.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining([
        "media/w1/still.jpg",
        "media/w1/thumb.jpg",
        "media/w1/large.jpg",
      ]),
    );
  });
});

describe("worker media cleanup job", () => {
  it("uses the media row bucket for the still, variants and motion assets", async () => {
    const deleteObject = deleteObjectMock();
    const deps = createDeps(
      {
        media: {
          findFirst: vi.fn(async () => ({
            id: "media-1",
            bucket: "bucket-a",
            key: "media/w1/still.jpg",
            variants: { thumb: { key: "media/w1/thumb.jpg" } },
            deletedAt: new Date("2026-11-17T00:00:00.000Z"),
          })),
        },
        mediaMotion: {
          findFirst: vi.fn(async () => ({
            storageKey: "media/w1/motion.mp4",
            thumbKey: "media/w1/motion-thumb.webp",
          })),
        },
      },
      deleteObject,
    );

    await handleMediaJob(
      "media.cleanup",
      { mediaId: "media-1", workspaceId: "w1" },
      contextWithWarn().context,
      deps,
    );

    expect(deleteObject).toHaveBeenCalledTimes(4);
    for (const call of deleteObject.mock.calls) {
      expect(call[1]).toBe("bucket-a");
    }
  });

  it("warns and falls back when the row has no bucket", async () => {
    const deleteObject = deleteObjectMock();
    const { context, warn } = contextWithWarn();
    const deps = createDeps(
      {
        media: {
          findFirst: vi.fn(async () => ({
            id: "media-1",
            bucket: "",
            key: "media/w1/still.jpg",
            variants: {},
            deletedAt: new Date("2026-11-17T00:00:00.000Z"),
          })),
        },
        mediaMotion: { findFirst: vi.fn(async () => null) },
      },
      deleteObject,
    );

    await handleMediaJob(
      "media.cleanup",
      { mediaId: "media-1", workspaceId: "w1" },
      context,
      deps,
    );

    expect(deleteObject).toHaveBeenCalledWith("media/w1/still.jpg", undefined);
    const bucketWarn = warn.mock.calls.find(
      ([entry]) => (entry as { event?: string }).event === "media.bucket_missing",
    );
    expect(bucketWarn?.[0]).toMatchObject({ fallback: "current" });
  });
});