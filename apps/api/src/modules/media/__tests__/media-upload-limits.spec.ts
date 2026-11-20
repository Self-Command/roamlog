/**
 * UPLOAD_LIMITS_WIRED — presign/batch enforcement of the `limits.*` ceilings.
 *
 * The point of these tests is that the numbers come from the *settings at
 * request time*, not from a contract constant: the same request payload is
 * accepted with the default ceiling and refused with `422 MEDIA_FILE_TOO_LARGE`
 * as soon as the configured ceiling is lowered, without touching the contract.
 *
 * `MediaService` is exercised directly (no Nest, no database): the storage,
 * repository and settings source are doubles, matching the harness style of
 * `media-bucket.spec.ts`. The HTTP-level route wiring is covered by
 * `media-upload-limits-http.spec.ts`.
 */

import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "../../../common/services/permission.service.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import type { LimitsRuntime, LimitsSettingsSource } from "../../settings/limits-settings.consumer.js";
import { MediaService } from "../media.service.js";
import {
  DEFAULT_LIMITS_RUNTIME,
  MediaUploadLimitsService,
  toEffectiveUploadLimits,
} from "../media-upload-limits.service.js";
import { MediaUploadRateLimitGuard } from "../media-upload-rate-limit.guard.js";

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const USER_ID = "01942f30-1200-7000-8000-000000000002";
const NOW = "2026-11-19T00:00:00.000Z";
const MiB = 1024 * 1024;

function createLogger(): PinoLoggerService {
  return {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    fatal: vi.fn(),
  } as unknown as PinoLoggerService;
}

function membership(): WorkspaceMembershipAccess {
  return {
    id: "01942f30-1200-7000-8000-0000000000aa",
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    role: "editor",
    status: "active",
    joinedAt: new Date(NOW),
    invitedById: null,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    workspaceName: "Upload Limits",
  };
}

const actor = { user: { id: USER_ID } } as never;

/** Storage double: real URLs are not needed, only that one was minted per file. */
function storageDouble() {
  return {
    currentBucket: vi.fn(async () => "roamlog-test"),
    createPresignedUpload: vi.fn(async (key: string, mime: string) => ({
      url: `https://media.example.test/${key}`,
      method: "PUT" as const,
      headers: { "Content-Type": mime },
      expiresAt: NOW,
    })),
    completeUpload: vi.fn(async () => ({ size: 2048, contentType: "image/jpeg" })),
  };
}

function limitsSource(runtime: Partial<LimitsRuntime> = {}): {
  source: LimitsSettingsSource;
  setRuntime: (next: Partial<LimitsRuntime>) => void;
} {
  let current: LimitsRuntime = { ...DEFAULT_LIMITS_RUNTIME, ...runtime };
  return {
    source: { resolve: async () => current },
    setRuntime: (next) => {
      current = { ...current, ...next };
    },
  };
}

function build(options: { limits?: LimitsSettingsSource } = {}) {
  const storage = storageDouble();
  const rows: Record<string, unknown>[] = [];
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({}));
  const repository = {
    transaction,
    createMedia: vi.fn(async (data: Record<string, unknown>) => {
      rows.push(data);
      return { ...data, status: "pending" };
    }),
  };
  const activities = { record: vi.fn(async () => ({ id: "activity" })) };
  const service = new MediaService(
    repository as never,
    {} as never,
    storage as never,
    { enqueue: vi.fn() } as never,
    new PermissionService(),
    activities as never,
    undefined,
    undefined,
    createLogger(),
    options.limits,
  );
  return { service, storage, repository, activities, rows, transaction };
}

function file(overrides: Record<string, unknown> = {}) {
  return {
    fileName: "IMG_0001.jpg",
    mimeType: "image/jpeg",
    size: 2048,
    ...overrides,
  };
}

async function codeOf(promise: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      const response = error.getResponse() as { code?: string };
      return { status: error.getStatus(), code: response.code ?? "" };
    }
    throw error;
  }
  throw new Error("Expected the promise to reject, but it resolved.");
}

describe("presign enforces the configured per-file ceiling", () => {
  it("accepts a file exactly at the ceiling and rejects one byte more with 422", async () => {
    const { service } = build({ limits: limitsSource({ uploadMaxFileBytes: 1_048_576 }).source });

    await expect(
      service.presign(actor, membership(), file({ size: 1_048_576 })),
    ).resolves.toMatchObject({ method: "PUT" });

    const rejected = await codeOf(
      service.presign(actor, membership(), file({ size: 1_048_577 })),
    );
    expect(rejected).toEqual({ status: 422, code: "MEDIA_FILE_TOO_LARGE" });
  });

  it("proves the setting is live: 2 MiB passes at the default and fails once it is set to 1 MiB", async () => {
    const { source, setRuntime } = limitsSource();
    const { service, repository } = build({ limits: source });

    // Default ceiling (25 MiB) accepts a 2 MiB upload...
    await expect(service.presign(actor, membership(), file({ size: 2 * MiB }))).resolves.toBeTruthy();
    expect(repository.createMedia).toHaveBeenCalledTimes(1);

    // ...then the operator lowers `limits.uploadMaxFileBytes` to 1 MiB.
    setRuntime({ uploadMaxFileBytes: 1 * MiB });
    const rejected = await codeOf(service.presign(actor, membership(), file({ size: 2 * MiB })));
    expect(rejected).toEqual({ status: 422, code: "MEDIA_FILE_TOO_LARGE" });
    // No row was created for the refused upload.
    expect(repository.createMedia).toHaveBeenCalledTimes(1);
  });

  it("carries the field and the observed size in errors[], like AI_REWRITE_TEXT_TOO_LONG", async () => {
    const { service } = build({ limits: limitsSource({ uploadMaxFileBytes: 1_000_000 }).source });
    try {
      await service.presign(actor, membership(), file({ size: 1_500_000 }));
      throw new Error("expected rejection");
    } catch (error) {
      const response = (error as HttpException).getResponse() as {
        errors?: Array<{ field?: string; code?: string; message?: string }>;
      };
      expect(response.errors?.[0]).toMatchObject({ field: "size", code: "TOO_LARGE" });
      expect(response.errors?.[0]?.message).toContain("1.5 MB");
    }
  });
});

describe("batch presign enforces count, per-file size and batch total", () => {
  it("presigns every file in one transaction and returns them in request order", async () => {
    const { service, rows, transaction, storage } = build();

    const result = await service.presignBatch(actor, membership(), {
      files: [
        file({ fileName: "a.jpg", size: 1000 }),
        file({ fileName: "b.png", mimeType: "image/png", size: 2000 }),
        file({ fileName: "c.webp", mimeType: "image/webp", size: 3000 }),
      ],
    });

    expect(result.items).toHaveLength(3);
    expect(new Set(result.items.map((item) => item.mediaId)).size).toBe(3);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.size)).toEqual([1000, 2000, 3000]);
    expect(storage.createPresignedUpload).toHaveBeenCalledTimes(3);
    // All three rows commit together: one `$transaction`, not three.
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("refuses more files than `limits.uploadMaxFilesPerBatch` with 422", async () => {
    const { service, repository } = build({ limits: limitsSource({ uploadMaxFilesPerBatch: 20 }).source });

    const rejected = await codeOf(
      service.presignBatch(actor, membership(), {
        files: Array.from({ length: 21 }, () => file()),
      }),
    );

    expect(rejected).toEqual({ status: 422, code: "MEDIA_BATCH_TOO_MANY_FILES" });
    expect(repository.createMedia).not.toHaveBeenCalled();
  });

  it("accepts exactly the configured count of files", async () => {
    const { service } = build({ limits: limitsSource({ uploadMaxFilesPerBatch: 3 }).source });
    const result = await service.presignBatch(actor, membership(), {
      files: Array.from({ length: 3 }, () => file()),
    });
    expect(result.items).toHaveLength(3);
  });

  it("refuses a batch whose total exceeds `limits.uploadMaxBatchBytes` with 422", async () => {
    const { service, repository } = build({
      limits: limitsSource({ uploadMaxBatchBytes: 10 * MiB, uploadMaxFileBytes: 5 * MiB }).source,
    });

    const rejected = await codeOf(
      service.presignBatch(actor, membership(), {
        // Each file is legal on its own; together they exceed the batch total.
        files: [file({ size: 4 * MiB }), file({ size: 4 * MiB }), file({ size: 4 * MiB })],
      }),
    );

    expect(rejected).toEqual({ status: 422, code: "MEDIA_BATCH_TOO_LARGE" });
    expect(repository.createMedia).not.toHaveBeenCalled();
  });

  it("refuses one oversized file inside an otherwise legal batch with 422", async () => {
    const { service } = build({
      limits: limitsSource({ uploadMaxFileBytes: 1 * MiB, uploadMaxBatchBytes: 150 * MiB }).source,
    });

    const rejected = await codeOf(
      service.presignBatch(actor, membership(), {
        files: [file({ size: 1000 }), file({ size: 1 * MiB + 1 })],
      }),
    );

    expect(rejected).toEqual({ status: 422, code: "MEDIA_FILE_TOO_LARGE" });
  });

  it("rejects a batch the wire cap cannot even represent", async () => {
    const { service } = build();
    const rejected = await codeOf(
      service.presignBatch(actor, membership(), {
        files: Array.from({ length: 101 }, () => file()),
      }),
    );
    // 101 > the contract's absolute cap, so it never reaches the business rules.
    expect(rejected).toEqual({ status: 400, code: "VALIDATION_ERROR" });
  });
});

describe("GET /media/limits answers the configured values", () => {
  it("returns the four ceilings from the settings source", async () => {
    const { service } = build({
      limits: limitsSource({
        uploadMaxFilesPerBatch: 15,
        uploadMaxFileBytes: 4 * MiB,
        uploadMaxBatchBytes: 80 * MiB,
        uploadPerMinute: 12,
      }).source,
    });

    await expect(service.uploadLimits(actor, membership())).resolves.toEqual({
      maxFilesPerBatch: 15,
      maxFileBytes: 4 * MiB,
      maxBatchBytes: 80 * MiB,
      presignPerMinute: 12,
    });
  });

  it("reflects an admin change instead of a constant", async () => {
    const { source, setRuntime } = limitsSource();
    const { service } = build({ limits: source });

    await expect(service.uploadLimits(actor, membership())).resolves.toEqual(
      toEffectiveUploadLimits(DEFAULT_LIMITS_RUNTIME),
    );

    setRuntime({ uploadMaxFilesPerBatch: 5, uploadMaxFileBytes: 1 * MiB, uploadPerMinute: 3 });
    await expect(service.uploadLimits(actor, membership())).resolves.toEqual({
      maxFilesPerBatch: 5,
      maxFileBytes: 1 * MiB,
      maxBatchBytes: DEFAULT_LIMITS_RUNTIME.uploadMaxBatchBytes,
      presignPerMinute: 3,
    });
  });

  it("falls back to the code defaults when no settings source is wired", async () => {
    const { service } = build();
    await expect(service.uploadLimits(actor, membership())).resolves.toEqual({
      maxFilesPerBatch: 20,
      maxFileBytes: 26_214_400,
      maxBatchBytes: 157_286_400,
      presignPerMinute: 20,
    });
  });
});

describe("per-account presign allowance", () => {
  function makeGuard(limits: LimitsRuntime, state = { count: 0 }) {
    const redis = {
      client: {
        incrby: vi.fn(async (_key: string, by: number) => {
          state.count += by;
          return state.count;
        }),
        ttl: vi.fn(async () => 42),
        expire: vi.fn(async () => 1),
      },
    };
    const service = new MediaUploadLimitsService(
      { resolve: async () => limits },
      { rateLimitWindowSeconds: 60 } as never,
      redis as never,
      createLogger(),
    );
    const guard = new MediaUploadRateLimitGuard(service);
    const headers = new Map<string, string>();
    const context = (body: unknown) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            body,
            user: { id: USER_ID },
            workspaceMembership: membership(),
          }),
          getResponse: () => ({
            setHeader: (name: string, value: string) => headers.set(name, value),
          }),
        }),
      }) as never;
    return { guard, context, headers, state, redis };
  }

  it("charges N links for an N-file batch and rejects the batch that crosses the allowance", async () => {
    const limits: LimitsRuntime = { ...DEFAULT_LIMITS_RUNTIME, uploadPerMinute: 20 };
    const { guard, context, headers, state } = makeGuard(limits);

    await expect(
      guard.canActivate(context({ files: Array.from({ length: 18 }, () => file()) })),
    ).resolves.toBe(true);
    expect(state.count).toBe(18);
    expect(headers.get("RateLimit-Remaining")).toBe("2");

    // 18 + 3 > 20: the whole batch is refused, nothing is partially issued.
    const rejected = await codeOf(
      guard.canActivate(context({ files: Array.from({ length: 3 }, () => file()) })),
    );
    expect(rejected).toEqual({ status: 429, code: "RATE_LIMITED" });
    expect(headers.get("Retry-After")).toBe("42");
  });

  it("charges one token for the single-file presign route", async () => {
    const { guard, context, state } = makeGuard({ ...DEFAULT_LIMITS_RUNTIME, uploadPerMinute: 20 });

    await guard.canActivate(context(file()));
    await guard.canActivate(context(file()));
    expect(state.count).toBe(2);
  });

  it("uses the configured allowance, not the deployment default", async () => {
    const { guard, context } = makeGuard({ ...DEFAULT_LIMITS_RUNTIME, uploadPerMinute: 2 });

    await expect(guard.canActivate(context(file()))).resolves.toBe(true);
    await expect(guard.canActivate(context(file()))).resolves.toBe(true);
    const rejected = await codeOf(guard.canActivate(context(file())));
    expect(rejected).toEqual({ status: 429, code: "RATE_LIMITED" });
  });

  it("falls back to a process-local window when Redis is unavailable", async () => {
    const redis = {
      client: {
        incrby: vi.fn(async () => {
          throw new Error("redis down");
        }),
        ttl: vi.fn(async () => 42),
        expire: vi.fn(async () => 1),
      },
    };
    const service = new MediaUploadLimitsService(
      { resolve: async () => ({ ...DEFAULT_LIMITS_RUNTIME, uploadPerMinute: 1 }) },
      { rateLimitWindowSeconds: 60 } as never,
      redis as never,
      createLogger(),
    );
    const guard = new MediaUploadRateLimitGuard(service);
    const headers = new Map<string, string>();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ body: file(), user: { id: USER_ID }, workspaceMembership: membership() }),
        getResponse: () => ({
          setHeader: (name: string, value: string) => headers.set(name, value),
        }),
      }),
    } as never;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(headers.get("X-RateLimit-Degraded")).toBe("true");
    const rejected = await codeOf(guard.canActivate(context));
    expect(rejected).toEqual({ status: 429, code: "RATE_LIMITED" });
  });
});