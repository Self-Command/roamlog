import { describe, expect, it, vi } from "vitest";

import type { ProcessorContext } from "../src/processor.js";
import type { WorkerDependencies } from "../src/jobs/types.js";
import { detectImageMime, handleMediaJob } from "../src/jobs/media.js";
import { handleEmailJob } from "../src/jobs/email.js";
import { handleExportJob } from "../src/jobs/export.js";
import { handleMaintenanceJob } from "../src/jobs/maintenance.js";

const NOW = new Date("2026-11-17T00:00:00.000Z");

function context(jobId = "job-1"): ProcessorContext {
  return {
    queue: "media",
    jobId,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };
}

function createDeps(overrides: Partial<WorkerDependencies> & { db?: any } = {}): WorkerDependencies {
  const { db: overrideDb, ...rest } = overrides;
  const db = overrideDb ?? {};
  return {
    db,
    storage: {
      getObject: vi.fn(),
      putObject: vi.fn(),
      deleteObject: vi.fn(),
      ...(overrides.storage ?? {}),
    },
    images: {
      process: vi.fn(),
      ...(overrides.images ?? {}),
    },
    email: {
      send: vi.fn(),
      render: vi.fn(),
      ...(overrides.email ?? {}),
    },
    now: () => NOW,
    logger: context().logger,
    ...rest,
  };
}

describe("worker media jobs", () => {
  it("verifies magic bytes before processing", () => {
    expect(detectImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(
      detectImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe("image/png");
    expect(detectImageMime(Uint8Array.from([0x47, 0x49, 0x46]))).toBeNull();
  });

  it("is idempotent when duplicate media jobs arrive after readiness", async () => {
    const deps = createDeps({
      db: {
        media: {
          findFirst: vi.fn().mockResolvedValue({
            id: "m1",
            status: "ready",
            key: "w/2026/11/m1/original.jpg",
          }),
          updateMany: vi.fn(),
        },
      },
    });
    const result = await handleMediaJob(
      "media.process",
      { mediaId: "m1", workspaceId: "w1" },
      context(),
      deps,
    );
    expect(result.status).toBe("ready");
    expect(deps.images.process).not.toHaveBeenCalled();
    expect(deps.storage.putObject).not.toHaveBeenCalled();
  });

  it("stores variants and marks media ready", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const deps = createDeps({
      db: {
        media: {
          findFirst: vi.fn().mockResolvedValue({
            id: "m1",
            status: "processing",
            key: "w/2026/11/m1/original.jpg",
            mimeType: "image/jpeg",
          }),
          updateMany,
        },
      },
    });
    vi.mocked(deps.storage.getObject).mockResolvedValue({
      bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
      contentType: "image/jpeg",
    });
    vi.mocked(deps.images.process).mockResolvedValue({
      width: 1600,
      height: 900,
      blurhash: "LEHV6nWB2yk8",
      variants: [
        {
          name: "thumb",
          key: "w/2026/11/m1/thumb.webp",
          mimeType: "image/webp",
          size: 3,
          width: 400,
          bytes: Uint8Array.from([1, 2, 3]),
        },
      ],
    });

    const result = await handleMediaJob(
      "media.process",
      { mediaId: "m1", workspaceId: "w1" },
      context(),
      deps,
    );
    expect(result.status).toBe("ready");
    expect(deps.storage.putObject).toHaveBeenCalledWith(
      "w/2026/11/m1/thumb.webp",
      expect.any(Uint8Array),
      "image/webp",
    );
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ready", blurhash: "LEHV6nWB2yk8" }),
      }),
    );
  });

  it("marks media failed and rethrows so BullMQ can retry", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const deps = createDeps({
      db: {
        media: {
          findFirst: vi.fn().mockResolvedValue({
            id: "m1",
            status: "processing",
            key: "w/2026/11/m1/original.jpg",
            mimeType: "image/jpeg",
          }),
          updateMany,
        },
      },
    });
    vi.mocked(deps.storage.getObject).mockResolvedValue({
      bytes: Uint8Array.from([0x47, 0x49, 0x46]),
      contentType: "image/gif",
    });

    await expect(
      handleMediaJob("media.process", { mediaId: "m1", workspaceId: "w1" }, context(), deps),
    ).rejects.toThrow("not a supported image");
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });
});

describe("worker email jobs", () => {
  it("does not resend an already delivered email", async () => {
    const deps = createDeps({
      db: {
        emailLog: {
          findUnique: vi.fn().mockResolvedValue({
            id: "e1",
            status: "sent",
          }),
          findFirst: vi.fn(),
          create: vi.fn(),
          updateMany: vi.fn(),
        },
      },
    });
    const result = await handleEmailJob(
      { emailLogId: "e1", to: "a@example.com", template: "mention" },
      context(),
      deps,
    );
    expect(result.status).toBe("sent");
    expect(deps.email.send).not.toHaveBeenCalled();
  });
});

describe("worker export jobs", () => {
  it("does not regenerate an export that is already ready", async () => {
    const deps = createDeps({
      db: {
        export: {
          findFirst: vi.fn().mockResolvedValue({
            id: "x1",
            workspaceId: "w1",
            status: "ready",
            format: "zip",
          }),
        },
      },
    });
    const result = await handleExportJob(
      { exportId: "x1", workspaceId: "w1" },
      context("export-job"),
      deps,
    );
    expect(result.status).toBe("ready");
    expect(deps.storage.putObject).not.toHaveBeenCalled();
  });

  it("marks an expired export without generating a file", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const deps = createDeps({
      db: {
        export: {
          findFirst: vi.fn().mockResolvedValue({
            id: "x1",
            workspaceId: "w1",
            status: "ready",
            format: "zip",
            expiresAt: new Date(NOW.getTime() - 1),
          }),
          updateMany,
        },
      },
    });
    const result = await handleExportJob(
      { exportId: "x1", workspaceId: "w1" },
      context("export-job"),
      deps,
    );
    expect(result.status).toBe("expired");
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "expired" }) }),
    );
  });
});

describe("worker maintenance jobs", () => {
  it("supports a dry run without deleting data", async () => {
    const deps = createDeps({
      db: {
        export: { findMany: vi.fn().mockResolvedValue([]) },
        media: { findMany: vi.fn().mockResolvedValue([]) },
        journalEntry: { deleteMany: vi.fn() },
        comment: { deleteMany: vi.fn() },
        expense: { deleteMany: vi.fn() },
        packingItem: { deleteMany: vi.fn() },
        session: { deleteMany: vi.fn() },
      },
    });
    const result = await handleMaintenanceJob({ dryRun: true }, context("maint"), deps);
    expect(result.expiredExports).toBe(0);
    expect(deps.db.journalEntry.deleteMany).not.toHaveBeenCalled();
  });
});
