import { describe, expect, it } from "vitest";

import type { AppConfigService } from "../../../config/app-config.service.js";
import type { PermissionService } from "../../../common/services/permission.service.js";
import { SanitizeService } from "../../../common/services/sanitize.service.js";
import type { ActivitiesService } from "../../activities/activities.service.js";
import { MediaUrlService } from "../../media/media-url.service.js";
import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import type { SignedReadUrl, StorageService } from "../../storage/storage.service.js";
import type {
  PublicTripBundle,
  ShareLinkRecord,
  ShareLinksRepository,
} from "../share-links.repository.js";
import { ShareLinksService } from "../share-links.service.js";

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000001";
const USER_ID = "01942f30-1200-7000-8000-000000000002";
const TRIP_ID = "01942f30-1200-7000-8000-000000000003";
const SHARE_LINK_ID = "01942f30-1200-7000-8000-000000000004";
const MEDIA_READY_ID = "01942f30-1200-7000-8000-000000000010";
const SHARE_TOKEN = "t".repeat(43);
const EXPIRES_AT = "2026-11-18T12:00:00.000Z";
const ORIGINAL_KEY = "ws/2026/11/media/original.jpg";
const LARGE_KEY = "ws/2026/11/media/large.webp";
const THUMB_KEY = "ws/2026/11/media/thumb.webp";
const MOTION_KEY = "ws/2026/11/media/motion.mov";

/** Bucket written on the row; the share was created while A was configured. */
const ROW_BUCKET = "roamlog-bucket-a";
/** Bucket an operator switched the storage configuration to afterwards. */
const CURRENT_BUCKET = "roamlog-bucket-b";

/**
 * Storage stub whose signed URL embeds the bucket it was asked to sign for —
 * exactly like a path-style S3 URL does in production. `current` is mutable so a
 * test can reproduce an operator changing the configured bucket between the
 * upload and the public read.
 */
function bucketAwareStorage(initialCurrentBucket: string) {
  const current = { bucket: initialCurrentBucket };
  const calls: Array<{ key: string; bucket: string | null }> = [];
  const storage = {
    createSignedReadUrl: async (
      key: string,
      _expiresInSeconds?: number,
      bucket?: string,
    ): Promise<SignedReadUrl> => {
      const signBucket = bucket ?? current.bucket;
      calls.push({ key, bucket: bucket ?? null });
      return {
        url: `https://cdn.example.test/${signBucket}/${key}?X-Amz-Signature=stub`,
        key,
        expiresAt: EXPIRES_AT,
      };
    },
  };
  return { storage: storage as unknown as StorageService, calls, current };
}

function shareLinkRecord(): ShareLinkRecord {
  return {
    id: SHARE_LINK_ID,
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
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
  };
}

function mediaRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MEDIA_READY_ID,
    workspaceId: WORKSPACE_ID,
    tripId: TRIP_ID,
    uploaderId: USER_ID,
    bucket: ROW_BUCKET,
    key: ORIGINAL_KEY,
    mimeType: "image/jpeg",
    size: 4096,
    width: 1200,
    height: 800,
    blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
    variants: {
      original: { key: ORIGINAL_KEY },
      large: { key: LARGE_KEY },
      thumb: { key: THUMB_KEY },
    },
    status: "ready",
    error: null,
    caption: "Euljiro at dusk",
    location: "Seoul",
    date: new Date("2026-11-11T00:00:00.000Z"),
    createdAt: new Date("2026-11-11T00:00:00.000Z"),
    updatedAt: new Date("2026-11-11T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function tripRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TRIP_ID,
    workspaceId: WORKSPACE_ID,
    title: "Seoul, slowly",
    summary: "A week of food, trains, and rain.",
    status: "active",
    startDate: new Date("2026-11-10T00:00:00.000Z"),
    endDate: new Date("2026-11-18T00:00:00.000Z"),
    coverMediaId: null,
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
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    updatedAt: new Date("2026-11-02T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function bundleWith(
  media: Array<Record<string, unknown>>,
  tripOverrides: Record<string, unknown> = {},
  coverMedia: Record<string, unknown> | null = null,
): PublicTripBundle {
  return {
    trip: tripRow(tripOverrides),
    stops: [],
    entries: [],
    media,
    coverMedia,
    budget: null,
  };
}

function buildService(
  bundle: PublicTripBundle,
  storage: StorageService,
  logger?: PinoLoggerService,
): ShareLinksService {
  const repository = {
    findShareLinkByHash: async () => shareLinkRecord(),
    loadPublicTrip: async () => bundle,
    recordAccess: async () => true,
  };
  return new ShareLinksService(
    repository as unknown as ShareLinksRepository,
    {} as unknown as PermissionService,
    {} as unknown as ActivitiesService,
    new SanitizeService(),
    {} as unknown as AppConfigService,
    new MediaUrlService(storage, logger),
  );
}

describe("ShareLinksService public media bucket propagation", () => {
  it("signs gallery media against the row's own bucket, not the configured one", async () => {
    const { storage } = bucketAwareStorage(CURRENT_BUCKET);
    const service = buildService(bundleWith([mediaRow()]), storage);

    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.media).toHaveLength(1);
    const [media] = payload.media;
    expect(new URL(media!.url).pathname).toContain(`/${ROW_BUCKET}/`);
    expect(new URL(media!.thumbUrl!).pathname).toContain(`/${ROW_BUCKET}/`);
    expect(media!.url).not.toContain(`/${CURRENT_BUCKET}/`);
  });

  it("signs live-motion playback against the row's own bucket", async () => {
    const { storage } = bucketAwareStorage(CURRENT_BUCKET);
    const service = buildService(
      bundleWith([
        mediaRow({
          motion: {
            storageKey: MOTION_KEY,
            mimeType: "video/quicktime",
            durationMs: 3200,
            deletedAt: null,
          },
        }),
      ]),
      storage,
    );

    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.media[0]?.livePhoto).toBe(true);
    expect(payload.media[0]?.motion?.url).toBeTruthy();
    expect(new URL(payload.media[0]!.motion!.url!).pathname).toContain(`/${ROW_BUCKET}/`);
    expect(payload.media[0]!.motion!.url).not.toContain(`/${CURRENT_BUCKET}/`);
  });

  it("signs the public cover against the cover row's own bucket", async () => {
    const { storage } = bucketAwareStorage(CURRENT_BUCKET);
    const service = buildService(
      bundleWith(
        [],
        { coverMediaId: MEDIA_READY_ID },
        mediaRow({ tripId: null }),
      ),
      storage,
    );

    const payload = await service.readPublic(SHARE_TOKEN, {});

    expect(payload.trip.cover?.mediaId).toBe(MEDIA_READY_ID);
    expect(new URL(payload.trip.cover!.url!).pathname).toContain(`/${ROW_BUCKET}/`);
    expect(new URL(payload.trip.cover!.thumbUrl!).pathname).toContain(`/${ROW_BUCKET}/`);
    expect(payload.trip.cover!.url).not.toContain(`/${CURRENT_BUCKET}/`);
  });

  it("falls back to the configured bucket for a row with no recorded bucket", async () => {
    const warnings: unknown[] = [];
    const logger = {
      warn: (message: unknown) => warnings.push(message),
    } as unknown as PinoLoggerService;
    const { storage } = bucketAwareStorage(CURRENT_BUCKET);
    const service = buildService(bundleWith([mediaRow({ bucket: null })]), storage, logger);

    const payload = await service.readPublic(SHARE_TOKEN, {});

    // No throw, a usable URL, signed against the current configuration.
    expect(payload.media[0]?.url).toContain(`/${CURRENT_BUCKET}/`);
    expect(warnings[0]).toMatchObject({
      code: "MEDIA_BUCKET_MISSING",
      sampleMediaId: MEDIA_READY_ID,
    });
  });

  it.each([null, "", "   "])(
    "treats an empty bucket (%j) as 'use the current bucket'",
    async (bucket) => {
      const { storage } = bucketAwareStorage(CURRENT_BUCKET);
      const service = buildService(bundleWith([mediaRow({ bucket })]), storage);

      const payload = await service.readPublic(SHARE_TOKEN, {});

      expect(payload.media[0]?.url).toContain(`/${CURRENT_BUCKET}/`);
      expect(payload.media[0]?.url).toBeTruthy();
    },
  );

  /**
   * The regression the whole change exists for: row bucket A, configured bucket
   * B. Drop `bucket:` from `publicMediaList()` or `coverMediaSources()` and this
   * test goes red because the signer falls back to the current bucket B.
   */
  it("keeps signing with bucket A after the configured bucket changed to B", async () => {
    const { storage, current } = bucketAwareStorage(ROW_BUCKET);
    const service = buildService(
      bundleWith([mediaRow()], { coverMediaId: MEDIA_READY_ID }),
      storage,
    );

    // Operator flips the storage configuration after the share was created.
    current.bucket = CURRENT_BUCKET;

    const payload = await service.readPublic(SHARE_TOKEN, {});

    const galleryUrl = payload.media[0]!.url;
    const galleryThumbUrl = payload.media[0]!.thumbUrl!;
    const coverUrl = payload.trip.cover!.url!;

    expect(new URL(galleryUrl).pathname).toContain(`/${ROW_BUCKET}/`);
    expect(new URL(galleryThumbUrl).pathname).toContain(`/${ROW_BUCKET}/`);
    expect(new URL(coverUrl).pathname).toContain(`/${ROW_BUCKET}/`);

    // The decisive assertion: not even a fallback signature may point at B.
    expect(JSON.stringify(payload)).not.toContain(`/${CURRENT_BUCKET}/`);
  });

  it("keeps bucket, storage key and variants out of the public payload shape", async () => {
    const { storage } = bucketAwareStorage(CURRENT_BUCKET);
    const service = buildService(
      bundleWith(
        [
          mediaRow({
            bucket: ROW_BUCKET,
            storageKey: "ws/2026/11/media/private-storage-key.jpg",
            moderatedAt: new Date("2026-11-19T10:00:00.000Z"),
          }),
        ],
        { coverMediaId: MEDIA_READY_ID },
      ),
      storage,
    );

    const payload = await service.readPublic(SHARE_TOKEN, {});
    const media = payload.media[0]!;

    expect(Object.keys(media).sort()).toEqual(
      [
        "id",
        "url",
        "thumbUrl",
        "expiresAt",
        "width",
        "height",
        "blurhash",
        "caption",
        "date",
        "location",
        "livePhoto",
        "motion",
      ].sort(),
    );
    for (const leaked of ["bucket", "storageKey", "variants", "moderatedAt", "workspaceId", "key"]) {
      expect(media).not.toHaveProperty(leaked);
      expect(payload.trip.cover).not.toHaveProperty(leaked);
    }

    const serializedMedia = JSON.stringify(media);
    // The signed URL necessarily contains the object key (that is what it points
    // at); what must never leak is the row's stored `storageKey`, or a field.
    expect(serializedMedia).not.toContain("private-storage-key");
    expect(serializedMedia).not.toMatch(/"(bucket|storageKey|variants|moderatedAt)"/);
  });
});