import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "../../../common/guards/actor-context.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import type { StorageService } from "../../storage/storage.service.js";
import type { ExportRecord } from "../export-records.js";
import { ExportsService } from "../exports.service.js";
import type { ExportsRepository } from "../exports.repository.js";

/**
 * Regression cover for the third bucket-propagation gap (after `MEDIA_BUCKET_P0`
 * and `SHARE_BUCKET_PROPAGATION`): an export must be signed — and deleted —
 * against the bucket recorded on its own row, never the bucket that happens to
 * be configured at read time.
 *
 * The `bucketFor(record)` argument passed to `createSignedReadUrl` /
 * `deleteObject` is the propagation under test. Removing it (or replacing it
 * with `undefined`) turns the "after a bucket switch" cases red.
 */
const USER_ID = "0199f090-0000-7000-8000-000000000001";
const WORKSPACE_ID = "0199f090-0000-7000-8000-000000000002";
const EXPORT_ID = "0199f090-0000-7000-8000-000000000003";
const STORAGE_KEY = "exports/0199f090-0000-7000-8000-000000000002/export.zip";

const actor: AuthenticatedActor = {
  user: { id: USER_ID } as AuthenticatedActor["user"],
  ip: null,
  userAgent: null,
};

const membership: WorkspaceMembershipAccess = {
  id: "0199f090-0000-7000-8000-000000000004",
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
  role: "owner",
  status: "active",
  joinedAt: new Date("2026-01-01T00:00:00.000Z"),
  invitedById: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  workspaceName: "Bucket test",
};

function record(overrides: Partial<ExportRecord> = {}): ExportRecord {
  return {
    id: EXPORT_ID,
    workspaceId: WORKSPACE_ID,
    tripId: null,
    requestedById: USER_ID,
    scope: "workspace",
    format: "zip",
    includeComments: false,
    includeExpenses: false,
    includeMedia: false,
    status: "ready",
    storageKey: STORAGE_KEY,
    bucket: "roamlog-bucket-a",
    error: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(Date.now() - 3_600_000),
    completedAt: new Date(Date.now() - 3_600_000),
    ...overrides,
  };
}

/** Storage double: real bucket routing, stub SigV4. */
function createStorage(currentBucket = "roamlog-bucket-a") {
  let bucket = currentBucket;
  const signedCalls: Array<[string, number | undefined, string | undefined]> = [];
  const deletedCalls: Array<[string, string | undefined]> = [];
  const service = {
    currentBucket: vi.fn(async () => bucket),
    createSignedReadUrl: vi.fn(
      async (key: string, ttl?: number, override?: string) => {
        signedCalls.push([key, ttl, override]);
        const target = override ?? bucket;
        return {
          url: `https://media.example.test/${target}/${key}?X-Amz-Signature=stub`,
          key,
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
        };
      },
    ),
    deleteObject: vi.fn(async (key: string, override?: string) => {
      deletedCalls.push([key, override]);
    }),
  };
  return {
    service: service as unknown as StorageService,
    signedCalls,
    deletedCalls,
    setBucket(next: string) {
      bucket = next;
    },
  };
}

function createLogger() {
  const warn = vi.fn();
  return {
    logger: { warn, debug: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as PinoLoggerService,
    warn,
  };
}

function createService(options: {
  storage: ReturnType<typeof createStorage>;
  logger: PinoLoggerService;
  repository: Partial<ExportsRepository>;
}) {
  const repository = {
    createExport: vi.fn(),
    findExport: vi.fn(async () => null),
    deleteExport: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    ...options.repository,
  };
  const access = {
    requireMembership: vi.fn(async () => membership),
  };
  const permissions = { assertCan: vi.fn() };
  const audit = { record: vi.fn(async () => ({ id: "audit-1" })) };
  const queue = {
    enqueue: vi.fn(async (request: { jobId: string; queue: string; name: string }) => ({
      jobId: request.jobId,
      queue: request.queue,
      name: request.name,
    })),
  };

  const service = new ExportsService(
    repository as unknown as ExportsRepository,
    access as never,
    permissions as never,
    options.storage.service,
    audit as never,
    queue as never,
    options.logger,
  );

  return { service, repository, access, permissions, audit, queue };
}

describe("export bucket propagation", () => {
  it("stores the effective StorageService bucket when the task is created", async () => {
    const storage = createStorage("roamlog-bucket-a");
    const { logger } = createLogger();
    const { service, repository } = createService({
      storage,
      logger,
      repository: {
        createExport: vi.fn(async (data: Partial<ExportRecord>) => ({
          ...record({ status: "queued", storageKey: null, bucket: null, expiresAt: null }),
          ...data,
        })),
      },
    });

    const created = await service.create(
      actor,
      { scope: "workspace", format: "zip", includeMedia: true },
      { workspaceId: WORKSPACE_ID },
    );

    expect(storage.service.currentBucket).toHaveBeenCalledOnce();
    expect(repository.createExport).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: "roamlog-bucket-a", workspaceId: WORKSPACE_ID }),
    );
    // `bucket` is storage-internal and must not appear in the contract payload.
    expect(created).not.toHaveProperty("bucket");
  });

  it("does not read process.env.S3_BUCKET: the value comes from currentBucket()", async () => {
    const previous = process.env.S3_BUCKET;
    process.env.S3_BUCKET = "roamlog-env-bucket";
    try {
      const storage = createStorage("roamlog-effective-bucket");
      const { logger } = createLogger();
      const { service, repository } = createService({
        storage,
        logger,
        repository: {
          createExport: vi.fn(async (data: Partial<ExportRecord>) => ({ ...record(), ...data })),
        },
      });

      await service.create(
        actor,
        { scope: "workspace", format: "json" },
        { workspaceId: WORKSPACE_ID },
      );

      expect(repository.createExport).toHaveBeenCalledWith(
        expect.objectContaining({ bucket: "roamlog-effective-bucket" }),
      );
      expect(repository.createExport).not.toHaveBeenCalledWith(
        expect.objectContaining({ bucket: "roamlog-env-bucket" }),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.S3_BUCKET;
      } else {
        process.env.S3_BUCKET = previous;
      }
    }
  });

  it("signs a download against the row bucket after the configured bucket switches", async () => {
    const storage = createStorage("roamlog-bucket-a");
    const { logger, warn } = createLogger();
    const { service } = createService({
      storage,
      logger,
      repository: { findExport: vi.fn(async () => record({ bucket: "roamlog-bucket-a" })) },
    });

    // The operator switches the configured bucket *after* the export was written.
    storage.setBucket("roamlog-bucket-b");

    const detail = await service.get(actor, EXPORT_ID);

    expect(storage.signedCalls).toEqual([[STORAGE_KEY, undefined, "roamlog-bucket-a"]]);
    expect(detail.downloadUrl).toContain("/roamlog-bucket-a/");
    expect(detail.downloadUrl).not.toContain("/roamlog-bucket-b/");
    // A recorded bucket must not warn — this is the normal path.
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([null, "", "   "])(
    "falls back to the current bucket and warns once for bucket=%j",
    async (bucket) => {
      const storage = createStorage("roamlog-bucket-a");
      const { logger, warn } = createLogger();
      const { service } = createService({
        storage,
        logger,
        repository: { findExport: vi.fn(async () => record({ bucket })) },
      });
      storage.setBucket("roamlog-bucket-b");

      const first = await service.get(actor, EXPORT_ID);
      const second = await service.get(actor, EXPORT_ID);

      expect(storage.signedCalls[0]).toEqual([STORAGE_KEY, undefined, undefined]);
      expect(first.downloadUrl).toContain("/roamlog-bucket-b/");
      expect(second.downloadUrl).toContain("/roamlog-bucket-b/");
      expect(warn).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ code: "EXPORT_BUCKET_MISSING", sampleExportId: EXPORT_ID }),
        "export.bucket_missing",
      );
    },
  );

  it("deletes the object in the row bucket, so old exports are cleaned up after a switch", async () => {
    const storage = createStorage("roamlog-bucket-a");
    const { logger } = createLogger();
    const { service, repository } = createService({
      storage,
      logger,
      repository: { findExport: vi.fn(async () => record({ bucket: "roamlog-bucket-a" })) },
    });
    storage.setBucket("roamlog-bucket-b");

    await service.remove(actor, EXPORT_ID);

    expect(storage.deletedCalls).toEqual([[STORAGE_KEY, "roamlog-bucket-a"]]);
    expect(repository.deleteExport).toHaveBeenCalledWith(EXPORT_ID);
  });

  it("deletes a legacy row (NULL bucket) from the current bucket and warns", async () => {
    const storage = createStorage("roamlog-bucket-a");
    const { logger, warn } = createLogger();
    const { service } = createService({
      storage,
      logger,
      repository: { findExport: vi.fn(async () => record({ bucket: null })) },
    });
    storage.setBucket("roamlog-bucket-b");

    await service.remove(actor, EXPORT_ID);

    expect(storage.deletedCalls).toEqual([[STORAGE_KEY, undefined]]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: "EXPORT_BUCKET_MISSING" }),
      "export.bucket_missing",
    );
  });
});