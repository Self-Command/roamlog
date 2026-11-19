/**
 * Bucket-switch HTTP proof for the media P0 fix.
 *
 * Boots an isolated HTTP harness on 127.0.0.1:4280 (not part of the unit suite)
 * and exercises the real `MediaService` + `MediaUrlService` + `StorageService`
 * stack with real SigV4 presigning. The only test double is the storage client
 * provider, whose `bucket` is switched exactly the way an admin save of
 * `storage.bucket` flows through `StorageSettingsConsumer` /
 * `StorageClientFactory`. There is no PostgreSQL/Redis/MinIO on this host, so
 * the media repository is in memory and the S3 endpoint is never dialled; the
 * signatures and URL paths are the real ones.
 *
 * Run:
 *   node --import tsx src/modules/media/__tests__/media-bucket-http.e2e.mts
 *
 * Four steps:
 *  1. bucket=A → presign a still; the row records A and the PUT URL targets A
 *  2. switch the configured bucket to B
 *  3. GET the old media → its signed URL still targets A
 *  4. presign a new still → the row records B and the PUT URL targets B
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { S3Client } from "@aws-sdk/client-s3";

import { PermissionService } from "../../../common/services/permission.service.js";
import type { WorkspaceMembershipAccess } from "../../../common/services/workspace-access.service.js";
import type { StorageSettings } from "../../../config/storage-settings.js";
import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import { StorageService } from "../../storage/storage.service.js";
import type { MediaRecord } from "../media-records.js";
import { MediaUrlService } from "../media-url.service.js";
import { MediaService } from "../media.service.js";
import { TripCoverService } from "../trip-cover.service.js";

const PORT = 4280;
const API = `http://127.0.0.1:${PORT}`;
const PUBLIC_ENDPOINT = "https://media.example.test";
const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const USER_ID = "01942f30-1200-7000-8000-000000000002";
const NOW = new Date("2026-11-19T08:00:00.000Z");

function logger(): PinoLoggerService {
  return {
    log: () => undefined,
    error: (...args: unknown[]) => console.error(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    debug: () => undefined,
    verbose: () => undefined,
    fatal: (...args: unknown[]) => console.error(...args),
  } as unknown as PinoLoggerService;
}

/* ------------------------------------------------------------------ */
/* Real storage stack with a switchable bucket provider                */
/* ------------------------------------------------------------------ */
function createStorage() {
  let bucket = "roamlog-bucket-a";
  const headObject = {
    send: async () => ({ ContentLength: 2048, ContentType: "image/jpeg", ETag: '"etag"' }),
  };
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
    get: async () => ({
      version: bucket,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      internal: headObject as any,
      public: publicClient,
      bucket,
      forcePathStyle: true,
      signingEndpoint: PUBLIC_ENDPOINT,
      settings: settings(),
    }),
  };
  const storage = new StorageService(
    settings(),
    logger(),
    undefined,
    undefined,
    provider,
  );
  return {
    storage,
    publicClient,
    get bucket() {
      return bucket;
    },
    setBucket(next: string) {
      bucket = next;
    },
  };
}

/* ------------------------------------------------------------------ */
/* In-memory media repository (no PostgreSQL on this host)             */
/* ------------------------------------------------------------------ */
function createRepository() {
  const rows: MediaRecord[] = [];
  return {
    rows,
    transaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> =>
      callback({}),
    createMedia: async (data: Record<string, unknown>): Promise<MediaRecord> => {
      const row: MediaRecord = {
        id: String(data.id),
        workspaceId: String(data.workspaceId),
        tripId: null,
        uploaderId: String(data.uploaderId),
        bucket: String(data.bucket),
        key: String(data.key),
        mimeType: String(data.mimeType),
        size: Number(data.size),
        width: null,
        height: null,
        blurhash: null,
        variants: {},
        status: "pending",
        error: null,
        caption: null,
        date: null,
        location: null,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
        motion: null,
      };
      rows.push(row);
      return row;
    },
    findMedia: async (workspaceId: string, mediaId: string): Promise<MediaRecord | null> =>
      rows.find((row) => row.id === mediaId && row.workspaceId === workspaceId) ?? null,
  };
}

function membership(): WorkspaceMembershipAccess {
  return {
    id: "01942f30-1200-7000-8000-0000000000aa",
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    role: "owner",
    status: "active",
    joinedAt: NOW,
    invitedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    workspaceName: "Bucket Proof",
  };
}

function log(step: string, payload: unknown): void {
  console.log(`\n## ${step}\n${JSON.stringify(payload, null, 2)}`);
}

function assertBucket(url: string, expected: string, step: string): void {
  const parsed = new URL(url);
  assert.equal(parsed.host, "media.example.test", `${step}: unexpected host ${parsed.host}`);
  assert.ok(
    parsed.pathname.startsWith(`/${expected}/`),
    `${step}: expected path prefix /${expected}/ but got ${parsed.pathname}`,
  );
  console.log(`  path prefix OK: /${expected}/`);
}

async function readJson(request: AsyncIterable<Uint8Array>): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of request) {
    body += Buffer.from(chunk).toString("utf8");
  }
  return body ? (JSON.parse(body) as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  const storage = createStorage();
  const repository = createRepository();
  const urls = new MediaUrlService(storage.storage, logger());
  const media = new MediaService(
    repository as never,
    {} as never,
    storage.storage,
    { enqueue: async () => ({ jobId: "job" }) } as never,
    new PermissionService(),
    { record: async () => ({ id: "activity" }) } as never,
    urls,
    new TripCoverService(urls),
    logger(),
  );
  const actor = { user: { id: USER_ID } } as never;

  const server = createServer(async (request, response) => {
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    try {
      const url = new URL(request.url ?? "/", API);
      if (request.method === "POST" && url.pathname === "/bucket") {
        const body = await readJson(request);
        storage.setBucket(String(body.bucket));
        return reply(200, { bucket: storage.bucket });
      }
      if (request.method === "POST" && url.pathname === "/presign") {
        const body = await readJson(request);
        const result = await media.presign(actor, membership(), body);
        return reply(201, result);
      }
      const mediaMatch = /^\/media\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && mediaMatch) {
        const result = await media.getOne(actor, membership(), mediaMatch[1]!);
        return reply(200, result);
      }
      const readyMatch = /^\/ready\/([^/]+)$/.exec(url.pathname);
      if (request.method === "POST" && readyMatch) {
        const row = repository.rows.find((entry) => entry.id === readyMatch[1]);
        if (!row) return reply(404, { error: "media not found" });
        row.status = "ready";
        row.variants = { original: { key: row.key } };
        return reply(200, { id: row.id, status: row.status, bucket: row.bucket });
      }
      return reply(404, { error: "not found" });
    } catch (error) {
      return reply(500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  console.log(`Bucket-switch media harness listening on ${API}`);

  try {
    // 1) bucket=A → presign.
    const first = await (
      await fetch(`${API}/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: "IMG_0001.jpg", mimeType: "image/jpeg", size: 2048 }),
      })
    ).json() as Record<string, string>;
    const firstRow = repository.rows[0]!;
    log("step 1 — presign with bucket=A", {
      storedBucket: firstRow.bucket,
      uploadUrlPrefix: new URL(first.uploadUrl).pathname.split("/").slice(0, 2).join("/"),
      uploadUrl: first.uploadUrl,
    });
    assert.equal(firstRow.bucket, "roamlog-bucket-a", "step 1: row bucket");
    assertBucket(first.uploadUrl, "roamlog-bucket-a", "step 1");

    // The worker would flip the row to ready; the read path needs that.
    await fetch(`${API}/ready/${first.mediaId}`, { method: "POST" });

    // 2) admin switches the configured bucket to B.
    const switched = await (
      await fetch(`${API}/bucket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket: "roamlog-bucket-b" }),
      })
    ).json();
    log("step 2 — switch configured bucket", switched);
    assert.deepEqual(switched, { bucket: "roamlog-bucket-b" });

    // 3) old media is still signed against A.
    const oldRead = await (await fetch(`${API}/media/${first.mediaId}`)).json() as Record<
      string,
      unknown
    >;
    log("step 3 — GET old media after the switch", {
      mediaId: oldRead.id,
      url: oldRead.url,
      quotedBucketField: JSON.stringify(oldRead).includes('"bucket"'),
    });
    assert.equal(typeof oldRead.url, "string");
    assertBucket(String(oldRead.url), "roamlog-bucket-a", "step 3");
    assert.ok(!String(oldRead.url).includes("/roamlog-bucket-b/"), "step 3: must not use B");
    assert.equal("bucket" in oldRead, false, "step 3: bucket field must not leak");

    // 4) a new upload lands in B.
    const second = await (
      await fetch(`${API}/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: "IMG_0002.jpg", mimeType: "image/jpeg", size: 2048 }),
      })
    ).json() as Record<string, string>;
    const secondRow = repository.rows[1]!;
    log("step 4 — presign after the switch", {
      storedBucket: secondRow.bucket,
      uploadUrlPrefix: new URL(second.uploadUrl).pathname.split("/").slice(0, 2).join("/"),
      uploadUrl: second.uploadUrl,
    });
    assert.equal(secondRow.bucket, "roamlog-bucket-b", "step 4: row bucket");
    assertBucket(second.uploadUrl, "roamlog-bucket-b", "step 4");

    console.log("\nALL FOUR STEPS PASSED");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    storage.publicClient.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});