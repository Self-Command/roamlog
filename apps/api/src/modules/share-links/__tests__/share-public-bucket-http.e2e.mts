/**
 * Bucket-switch HTTP proof for the public (anonymous) share page.
 *
 * Boots the real `PublicShareController` + `ShareLinksService` on
 * 127.0.0.1:4330 with a real `StorageService` (real SigV4 presigning). The only
 * test doubles are the Workspace-scoped repository (no PostgreSQL on this host)
 * and the storage client provider, whose `bucket` is switched exactly the way an
 * admin save of `storage.bucket` reaches the storage stack.
 *
 * Run:
 *   node --import tsx src/modules/share-links/__tests__/share-public-bucket-http.e2e.mts
 *
 * Steps:
 *  1. media row recorded bucket A, configured bucket A → GET the share, URLs hit A
 *  2. operator switches the configured bucket to B
 *  3. GET the same share → media and cover URLs still hit A, never B
 *  4. a legacy row without a bucket → falls back to the current bucket B
 */
import assert from "node:assert/strict";

import { S3Client } from "@aws-sdk/client-s3";
import { Test } from "@nestjs/testing";

import { PublicShareRateLimitGuard } from "../../../common/security/public-share-rate-limit.guard.js";
import { PermissionService } from "../../../common/services/permission.service.js";
import { SanitizeService } from "../../../common/services/sanitize.service.js";
import type { StorageSettings } from "../../../config/storage-settings.js";
import { AppConfigService } from "../../../config/app-config.service.js";
import { ActivitiesService } from "../../activities/activities.service.js";
import { MediaUrlService } from "../../media/media-url.service.js";
import { TripCoverService } from "../../media/trip-cover.service.js";
import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import { StorageService } from "../../storage/storage.service.js";
import { PublicShareController } from "../share-links.controller.js";
import type { PublicTripBundle, ShareLinkRecord } from "../share-links.repository.js";
import { ShareLinksRepository } from "../share-links.repository.js";
import { ShareLinksService } from "../share-links.service.js";

const PORT = 4330;
const API = `http://127.0.0.1:${PORT}`;
const PUBLIC_ENDPOINT = "https://media.example.test";
const SHARE_TOKEN = "t".repeat(43);
const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const USER_ID = "01942f30-1200-7000-8000-000000000002";
const TRIP_ID = "01942f30-1200-7000-8000-000000000003";
const MEDIA_ID = "01942f30-1200-7000-8000-000000000010";
const NOW = new Date("2026-11-19T08:00:00.000Z");
const LARGE_KEY = "ws/2026/11/media/large.webp";
const THUMB_KEY = "ws/2026/11/media/thumb.webp";

function logger(): PinoLoggerService {
  return {
    log: () => undefined,
    error: (...args: unknown[]) => console.error(...args),
    warn: () => undefined,
    debug: () => undefined,
    verbose: () => undefined,
    fatal: (...args: unknown[]) => console.error(...args),
  } as unknown as PinoLoggerService;
}

/** Real SigV4 storage stack with a bucket the harness can switch mid-run. */
function createStorage() {
  let bucket = "roamlog-bucket-a";
  const headObject = { send: async () => ({}) };
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
  const storage = new StorageService(settings(), logger(), undefined, undefined, provider);
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

/** The media row the share was created for; mutated by the harness only. */
const mediaRow: Record<string, unknown> = {
  id: MEDIA_ID,
  workspaceId: WORKSPACE_ID,
  tripId: TRIP_ID,
  uploaderId: USER_ID,
  bucket: "roamlog-bucket-a",
  key: LARGE_KEY,
  mimeType: "image/jpeg",
  size: 4096,
  width: 1200,
  height: 800,
  blurhash: null,
  variants: { large: { key: LARGE_KEY }, thumb: { key: THUMB_KEY } },
  status: "ready",
  error: null,
  caption: "Euljiro at dusk",
  location: "Seoul",
  date: new Date("2026-11-11T00:00:00.000Z"),
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
  motion: null,
};

function shareLink(): ShareLinkRecord {
  return {
    id: "01942f30-1200-7000-8000-000000000004",
    workspaceId: WORKSPACE_ID,
    tripId: TRIP_ID,
    tokenHash: "hash",
    createdById: USER_ID,
    expiresAt: null,
    revokedAt: null,
    passwordHash: null,
    allowIndex: false,
    showBudget: false,
    lastAccessedAt: null,
    accessCount: 0,
    createdAt: NOW,
  };
}

function bundle(): PublicTripBundle {
  return {
    trip: {
      id: TRIP_ID,
      workspaceId: WORKSPACE_ID,
      title: "Seoul, slowly",
      summary: "A week of food, trains, and rain.",
      status: "active",
      startDate: new Date("2026-11-10T00:00:00.000Z"),
      endDate: new Date("2026-11-18T00:00:00.000Z"),
      coverMediaId: MEDIA_ID,
      origin: "Shanghai",
      destinations: ["Seoul"],
      countryCodes: ["KR"],
      tags: [],
      guestNames: [],
      budgetAmountMinor: null,
      budgetCurrency: null,
      visibility: "public_link",
      favorite: false,
      version: 1,
      createdById: USER_ID,
      updatedById: USER_ID,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    },
    stops: [],
    entries: [],
    media: [mediaRow],
    coverMedia: null,
    budget: null,
  };
}

function log(step: string, payload: unknown): void {
  console.log(`\n## ${step}\n${JSON.stringify(payload, null, 2)}`);
}

function assertBucket(url: unknown, expected: string, step: string): void {
  const parsed = new URL(String(url));
  assert.equal(parsed.host, "media.example.test", `${step}: unexpected host ${parsed.host}`);
  assert.ok(
    parsed.pathname.startsWith(`/${expected}/`),
    `${step}: expected path prefix /${expected}/ but got ${parsed.pathname}`,
  );
  console.log(`  path prefix OK: /${expected}/`);
}

interface PublicShareBody {
  media: Array<{ url: string; thumbUrl: string | null }>;
  trip: { cover: { url: string | null } };
}

async function getPublicShare(): Promise<PublicShareBody> {
  const response = await fetch(`${API}/v1/public/trips/${SHARE_TOKEN}`);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(response.status, 200, `GET failed: ${JSON.stringify(body)}`);
  return body as unknown as PublicShareBody;
}

async function main(): Promise<void> {
  const storage = createStorage();
  const urls = new MediaUrlService(storage.storage, logger());
  const repository = {
    findShareLinkByHash: async () => shareLink(),
    loadPublicTrip: async () => bundle(),
    recordAccess: async () => true,
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [PublicShareController],
    providers: [
      ShareLinksService,
      SanitizeService,
      { provide: ShareLinksRepository, useValue: repository },
      { provide: MediaUrlService, useValue: urls },
      { provide: TripCoverService, useValue: new TripCoverService(urls) },
      { provide: PermissionService, useValue: {} },
      { provide: ActivitiesService, useValue: {} },
      { provide: AppConfigService, useValue: {} },
    ],
  })
    .overrideGuard(PublicShareRateLimitGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix("v1");
  await app.listen(PORT, "127.0.0.1");
  console.log(`Public-share bucket harness listening on ${API}`);

  try {
    // 1) The row and the configured bucket are both A.
    const before = await getPublicShare();
    log("step 1 — public share while the configured bucket is A", {
      mediaUrl: before.media?.[0]?.url,
      coverUrl: before.trip?.cover?.url,
    });
    assertBucket(before.media[0].url, "roamlog-bucket-a", "step 1 media");
    assertBucket(before.trip.cover.url, "roamlog-bucket-a", "step 1 cover");

    // 2) Operator switches the storage configuration to B.
    storage.setBucket("roamlog-bucket-b");
    log("step 2 — switch the configured bucket", { bucket: storage.bucket });
    assert.equal(storage.bucket, "roamlog-bucket-b");

    // 3) The old share keeps resolving to A, for the gallery and the cover.
    const after = await getPublicShare();
    log("step 3 — public share after the switch", {
      mediaUrl: after.media?.[0]?.url,
      coverUrl: after.trip?.cover?.url,
      quotedBucketField: JSON.stringify(after).includes('"bucket"'),
    });
    assertBucket(after.media[0].url, "roamlog-bucket-a", "step 3 media");
    assertBucket(after.media[0].thumbUrl, "roamlog-bucket-a", "step 3 thumb");
    assertBucket(after.trip.cover.url, "roamlog-bucket-a", "step 3 cover");
    assert.ok(
      !JSON.stringify(after).includes("/roamlog-bucket-b/"),
      "step 3: no URL may fall back to B",
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(after.media[0], "bucket"),
      false,
      "step 3: bucket field must not leak",
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(after.trip.cover, "bucket"),
      false,
      "step 3: cover bucket field must not leak",
    );
    console.log("  no URL falls back to /roamlog-bucket-b/");

    // 4) A row created before the bucket column falls back to the current bucket.
    mediaRow.bucket = null;
    const legacy = await getPublicShare();
    log("step 4 — legacy row without a bucket falls back to B", {
      mediaUrl: legacy.media?.[0]?.url,
    });
    assertBucket(legacy.media[0].url, "roamlog-bucket-b", "step 4 legacy media");
    assertBucket(legacy.trip.cover.url, "roamlog-bucket-b", "step 4 legacy cover");
    mediaRow.bucket = "roamlog-bucket-a";

    console.log("\nALL FOUR PUBLIC-SHARE BUCKET STEPS PASSED");
  } finally {
    await app.close();
    storage.publicClient.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});