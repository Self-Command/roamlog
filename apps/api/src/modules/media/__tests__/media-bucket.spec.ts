import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { PermissionService } from "../../../common/services/permission.service.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import type { StorageSettings } from "../../../config/storage-settings.js";
import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import { StorageService } from "../../storage/storage.service.js";
import type { MediaRecord } from "../media-records.js";
import { MediaUrlService } from "../media-url.service.js";
import { MediaService } from "../media.service.js";
import { TripCoverService } from "../trip-cover.service.js";

/**
 * Bucket-switch proof (the P0 fix).
 *
 * StorageService is the real implementation (real SigV4 presigning, real
 * internal/public client split); only its `StorageClientProvider` is a test
 * double whose `bucket` changes between steps, which is exactly what an admin
 * save of `storage.bucket` does through `StorageSettingsConsumer` /
 * `StorageClientFactory`. The media service, the URL service and the cover
 * projector are all real; repository/queue/activities are in-memory.
 *
 * Four steps:
 *  1. bucket=A → presign a still; the row records A and the PUT URL targets A
 *  2. switch the configured bucket to B
 *  3. the old row's signed URL still targets A (not B) → no 404
 *  4. a new presign records B and signs against B
 */

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const USER_ID = "01942f30-1200-7000-8000-000000000002";
const MEDIA_ID = "01942f30-1200-7000-8000-000000000010";
const NOW = new Date("2026-11-19T00:00:00.000Z");
const PUBLIC_ENDPOINT = "https://media.example.test";
const BUCKET_A = "roamlog-bucket-a";
const BUCKET_B = "roamlog-bucket-b";

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

/** Real StorageService over a provider whose bucket can be switched at will. */
function switchableStorage() {
  let bucket = BUCKET_A;
  const internalSend = vi.fn(async () => ({
    ContentLength: 2048,
    ContentType: "image/jpeg",
    ETag: '"etag"',
  }));
  const internal = { send: internalSend } as unknown as S3Client;
  const publicClient = new S3Client({
    region: "us-east-1",
    endpoint: PUBLIC_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: "access", secretAccessKey: "secret" },
  });
  const settings = (): StorageSettings => ({
    endpoint: "http://minio:9000",
    publicEndpoint: PUBLIC_ENDPOINT,
    bucket,
    accessKey: "access",
    secretKey: "secret",
    region: "us-east-1",
    forcePathStyle: true,
    signedUrlTtlSeconds: 900,
    mediaSignedUrlTtlSeconds: 900,
  });
  const provider = {
    signingEndpoint: PUBLIC_ENDPOINT,
    get: vi.fn(async () => ({
      version: bucket,
      internal,
      public: publicClient,
      bucket,
      forcePathStyle: true,
      signingEndpoint: PUBLIC_ENDPOINT,
      settings: settings(),
    })),
  };
  const storage = new StorageService(
    settings(),
    createLogger(),
    undefined,
    undefined,
    provider,
  );
  return {
    storage,
    internalSend,
    setBucket: (next: string) => {
      bucket = next;
    },
  };
}

function mediaRow(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: MEDIA_ID,
    workspaceId: WORKSPACE_ID,
    tripId: null,
    uploaderId: USER_ID,
    bucket: BUCKET_A,
    key: `${WORKSPACE_ID}/2026/11/${MEDIA_ID}/original.jpg`,
    mimeType: "image/jpeg",
    size: 2048,
    width: 1200,
    height: 800,
    blurhash: null,
    variants: {},
    status: "ready",
    error: null,
    caption: null,
    date: null,
    location: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    motion: null,
    ...overrides,
  };
}

function membership(): WorkspaceMembershipAccess {
  return {
    id: "01942f30-1200-7000-8000-0000000000aa",
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    role: "editor",
    status: "active",
    joinedAt: NOW,
    invitedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    workspaceName: "Bucket Switch",
  };
}

const actor = { user: { id: USER_ID } } as never;

function build(storage: StorageService) {
  const rows: MediaRecord[] = [];
  const repository = {
    transaction: async (callback: (tx: unknown) => unknown) => callback({}),
    createMedia: vi.fn(async (data: Record<string, unknown>) => {
      const row = mediaRow({ ...(data as Partial<MediaRecord>), status: "pending" });
      rows.push(row);
      return row;
    }),
    findMedia: vi.fn(async (workspaceId: string, mediaId: string) => {
      const row = rows.find((entry) => entry.id === mediaId && entry.workspaceId === workspaceId);
      return row ?? null;
    }),
    updateMedia: vi.fn(async (_workspaceId: string, mediaId: string, data: Record<string, unknown>) => {
      const row = rows.find((entry) => entry.id === mediaId);
      if (!row) {
        throw new Error("missing media row");
      }
      Object.assign(row, data);
      return row;
    }),
  };
  const queue = { enqueue: vi.fn(async () => ({ jobId: "job" })) };
  const activities = { record: vi.fn(async () => ({ id: "activity" })) };
  const logger = createLogger();
  const mediaUrls = new MediaUrlService(storage, logger);
  const service = new MediaService(
    repository as never,
    {} as never,
    storage,
    queue as never,
    new PermissionService(),
    activities as never,
    mediaUrls,
    new TripCoverService(mediaUrls),
    logger,
  );
  return { service, repository, rows, queue };
}

describe("changing the storage bucket keeps old media alive", () => {
  it("presigns old rows against their own bucket and new uploads against the current one", async () => {
    const { storage, setBucket } = switchableStorage();
    const { service, rows } = build(storage);

    // 1) bucket=A → upload #1 is recorded and signed against A.
    const first = await service.presign(actor, membership(), {
      fileName: "IMG_0001.jpg",
      mimeType: "image/jpeg",
      size: 2048,
    });
    expect(rows[0]?.bucket).toBe(BUCKET_A);
    const firstUrl = new URL(first.uploadUrl);
    expect(firstUrl.host).toBe("media.example.test");
    expect(firstUrl.pathname.startsWith(`/${BUCKET_A}/`)).toBe(true);

    // The worker would mark it ready; do the minimum the read path needs.
    const oldRow = rows[0]!;
    oldRow.status = "ready";
    oldRow.variants = { original: { key: oldRow.key } };

    // 2) an admin switches the configured bucket to B.
    setBucket(BUCKET_B);

    // 3) the old row is still signed against A — the whole point of the fix.
    const read = await service.getOne(actor, membership(), oldRow.id);
    expect(read.url).toBeTruthy();
    expect(new URL(read.url!).pathname.startsWith(`/${BUCKET_A}/`)).toBe(true);
    expect(new URL(read.url!).pathname.startsWith(`/${BUCKET_B}/`)).toBe(false);
    expect(new URL(read.url!).host).toBe("media.example.test");
    // Storage coordinates stay out of the response *fields* (the URL path
    // necessarily contains the bucket, which is how path-style S3 works).
    expect("bucket" in (read as unknown as Record<string, unknown>)).toBe(false);
    expect("storageKey" in (read as unknown as Record<string, unknown>)).toBe(false);

    // `presentWithUrls` (list/update/complete projections) must use the same
    // per-row bucket, not just the single-read path.
    const updated = await service.update(actor, membership(), oldRow.id, { caption: "old" });
    const originalView = updated.variants.original as { url?: string } | undefined;
    expect(originalView?.url).toBeTruthy();
    expect(new URL(originalView!.url!).pathname.startsWith(`/${BUCKET_A}/`)).toBe(true);

    // 4) a new upload lands in B.
    const second = await service.presign(actor, membership(), {
      fileName: "IMG_0002.jpg",
      mimeType: "image/jpeg",
      size: 2048,
    });
    expect(rows[1]?.bucket).toBe(BUCKET_B);
    const secondUrl = new URL(second.uploadUrl);
    expect(secondUrl.host).toBe("media.example.test");
    expect(secondUrl.pathname.startsWith(`/${BUCKET_B}/`)).toBe(true);
  });

  it("HEADs a pending object in the bucket its row recorded, even after a switch", async () => {
    const { storage, setBucket, internalSend } = switchableStorage();
    const { service, rows } = build(storage);

    const presigned = await service.presign(actor, membership(), {
      fileName: "IMG_0003.jpg",
      mimeType: "image/jpeg",
      size: 2048,
    });
    expect(rows[0]?.bucket).toBe(BUCKET_A);

    setBucket(BUCKET_B);
    await service.complete(actor, membership(), presigned.mediaId, { size: 2048 });

    const head = (internalSend.mock.calls.at(-1) as unknown[] | undefined)?.[0] as
      | { input?: { Bucket?: string } }
      | undefined;
    expect(head?.input?.Bucket).toBe(BUCKET_A);
  });
});