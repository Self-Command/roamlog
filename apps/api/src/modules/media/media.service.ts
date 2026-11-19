import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  CompleteMediaMotionRequestSchema,
  CompleteMediaRequestSchema,
  encodeCursor,
  MediaListQuerySchema,
  MediaMotionPresignRequestSchema,
  MediaPresignRequestSchema,
  SetTripCoverRequestSchema,
  TripMediaListQuerySchema,
  UpdateMediaRequestSchema,
  type Media,
  type MediaMotionPresignResponse,
  type MediaPage,
  type MediaPresignResponse,
  type MediaRead,
  type Trip,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId } from "../../common/services/cursor-page.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { ActivitiesService } from "../activities/activities.service.js";
import { generateUuidV7 } from "../auth/uuid.js";
import { JobQueueService, deterministicJobId } from "../exports/job-queue.service.js";
import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { StorageService } from "../storage/storage.service.js";
import {
  assertSafeMediaKey,
  assertSupportedImage,
  assertSupportedMotion,
  buildMediaKey,
  buildMotionKey,
  sanitizeFileName,
} from "./media-rules.js";
import type { MediaMotionRecord, MediaRecord } from "./media-records.js";
import { MediaRepository } from "./media.repository.js";
import { MediaUrlService } from "./media-url.service.js";
import {
  liveMotion,
  presentMedia,
  presentMediaRead,
  variantKeys,
  type MediaVariantView,
} from "./media.presenter.js";
import { TripCoverService } from "./trip-cover.service.js";
import {
  assertTripVisible,
  sortParts,
} from "../trips/content-values.js";
import { tripVisibilityWhere } from "../trips/trip-access.js";
import { presentTrip } from "../trips/content-presenters.js";
import { TripsRepository } from "../trips/trips.repository.js";

const DELETE_DELAY_MS = 24 * 60 * 60 * 1000;
/** At most one `media.bucket_missing` warning per process per window. */
const BUCKET_MISSING_WARN_INTERVAL_MS = 60_000;

@Injectable()
export class MediaService {
  constructor(
    @Inject(MediaRepository) private readonly repository: MediaRepository,
    @Inject(TripsRepository) private readonly trips: TripsRepository,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(JobQueueService) private readonly queue: JobQueueService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(ActivitiesService) private readonly activities: ActivitiesService,
    // Optional for hand-built instances only; `MediaModule` always injects both.
    @Inject(MediaUrlService) private readonly mediaUrls?: MediaUrlService,
    @Inject(TripCoverService) private readonly covers?: TripCoverService,
    @Optional() @Inject(PinoLoggerService) private readonly logger?: PinoLoggerService,
  ) {}

  private lastMissingBucketWarningAt = 0;

  async presign(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    rawInput: unknown,
  ): Promise<MediaPresignResponse> {
    this.permissions.assertCan(membership.role, "media:presign", "media");
    const input = parseRequest(MediaPresignRequestSchema, rawInput);
    const mime = assertSupportedImage(input.mimeType, input.size);
    sanitizeFileName(input.fileName);

    if (input.tripId) {
      const trip = await this.trips.findTrip(membership.workspaceId, input.tripId);
      if (!trip) {
        throw new NotFoundException({
          code: "TRIP_NOT_FOUND",
          message: "The requested trip was not found.",
        });
      }
      assertTripVisible(membership, trip);
    }

    const mediaId = generateUuidV7();
    const capturedAt = input.date ? new Date(`${input.date}T00:00:00.000Z`) : undefined;
    const key = buildMediaKey({
      workspaceId: membership.workspaceId,
      mediaId,
      mimeType: mime,
      variant: "original",
      ...(capturedAt ? { capturedAt } : {}),
    });
    // The row records where the object is *actually* put. The bucket is read
    // from the resolved storage settings (not `process.env.S3_BUCKET`) and then
    // passed to the signer explicitly, so a settings change between the two
    // calls cannot make the row and the signed PUT disagree.
    const bucket = await this.storage.currentBucket();

    await this.repository.transaction(async (tx) => {
      await this.repository.createMedia({
        id: mediaId,
        workspaceId: membership.workspaceId,
        tripId: input.tripId ?? null,
        uploaderId: actor.user.id,
        bucket,
        key,
        mimeType: mime,
        size: input.size,
        width: input.width ?? null,
        height: input.height ?? null,
        caption: input.caption ?? null,
        date: capturedAt ?? null,
        location: input.location ?? null,
        status: "pending",
        variants: {},
      });
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: input.tripId ?? null,
        actorId: actor.user.id,
        verb: "media.presigned",
        entityType: "media",
        entityId: mediaId,
        metadata: { mimeType: mime, size: input.size },
      });
    });

    const upload = await this.storage.createPresignedUpload(key, mime, undefined, bucket);
    return {
      mediaId,
      uploadUrl: upload.url,
      method: upload.method,
      headers: upload.headers,
      expiresAt: upload.expiresAt,
    };
  }

  async complete(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    mediaId: string,
    rawInput: unknown,
  ): Promise<Media> {
    this.permissions.assertCan(membership.role, "media:complete", "media");
    const completion = parseOptionalCompletion(rawInput);
    const media = await this.requireMedia(membership.workspaceId, mediaId);
    await this.assertMediaVisible(membership, media);
    if (media.status === "processing" || media.status === "ready") {
      return this.presentWithUrls(media);
    }
    if (media.status === "failed") {
      // Allow an explicit retry from a failed upload.
    }

    const uploaded = await this.storage.completeUpload(media.key, this.bucketOf(media));
    const mime = assertSupportedImage(
      uploaded.contentType || media.mimeType,
      uploaded.size || media.size,
    );
    if (uploaded.size <= 0) {
      throw new BadRequestException({
        code: "MEDIA_EMPTY_UPLOAD",
        message: "The uploaded object is empty.",
      });
    }

    const retryToken = media.status === "failed" ? String(Date.now()) : "v1";
    const updated = await this.repository.updateMedia(membership.workspaceId, mediaId, {
      status: "processing",
      error: null,
      mimeType: mime,
      size: uploaded.size,
      ...(completion.width !== undefined ? { width: completion.width } : {}),
      ...(completion.height !== undefined ? { height: completion.height } : {}),
      ...(completion.blurhash !== undefined ? { blurhash: completion.blurhash } : {}),
      variants: {
        original: {
          key: media.key,
          mimeType: mime,
          size: uploaded.size,
        },
      },
    });

    await this.queue.enqueue({
      queue: "media",
      name: "media.process",
      jobId: deterministicJobId("media-process", mediaId, retryToken),
      data: { mediaId, workspaceId: membership.workspaceId },
    });
    await this.repository.transaction(async (tx) => {
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: media.tripId,
        actorId: actor.user.id,
        verb: "media.uploaded",
        entityType: "media",
        entityId: mediaId,
        metadata: { size: uploaded.size, mimeType: mime },
      });
    });

    return this.presentWithUrls(updated);
  }

  /**
   * Presigns the PUT for the paired motion asset of an existing still.
   *
   * Same pipeline as {@link presign} — one `StorageService.createPresignedUpload`
   * call, one signed URL, one `Content-Type` header — with the video content type
   * and the tighter motion limits (≤50 MB, ≤30 s). The object key is derived from
   * the media folder on the server; the returned `storageKey` is an echo for the
   * completion callback, not a client-controlled path.
   */
  async presignMotion(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    mediaId: string,
    rawInput: unknown,
  ): Promise<MediaMotionPresignResponse> {
    this.permissions.assertCan(membership.role, "media:presign", "media");
    const input = parseRequest(MediaMotionPresignRequestSchema, rawInput);
    const media = await this.requireMedia(membership.workspaceId, mediaId);
    await this.assertMediaVisible(membership, media);
    const mime = assertSupportedMotion({
      mimeType: input.mimeType,
      sizeBytes: input.size,
      durationMs: input.durationMs ?? null,
    });
    sanitizeFileName(input.fileName);
    assertSafeMediaKey(media.key);

    const storageKey = buildMotionKey({ mediaKey: media.key, mimeType: mime });
    // The motion asset is part of the same still: it must live in the bucket the
    // still row recorded, even if the configured bucket changed since then.
    const upload = await this.storage.createPresignedUpload(
      storageKey,
      mime,
      undefined,
      this.bucketOf(media),
    );
    await this.repository.transaction(async (tx) => {
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: media.tripId,
        actorId: actor.user.id,
        verb: "media.motion_presigned",
        entityType: "media",
        entityId: mediaId,
        metadata: { mimeType: mime, size: input.size },
      });
    });

    return {
      mediaId,
      storageKey,
      uploadUrl: upload.url,
      method: upload.method,
      headers: upload.headers,
      expiresAt: upload.expiresAt,
    };
  }

  /**
   * Completion callback for the motion upload.
   *
   * The object is HEADed before the row is written, exactly like a still: the
   * callback cannot register a motion row that points at nothing, and the stored
   * size/type come from the object store rather than from the client. The row is
   * upserted, so retrying a completed upload does not violate the 1:1 unique
   * constraint.
   */
  async completeMotion(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    mediaId: string,
    rawInput: unknown,
  ): Promise<MediaRead> {
    this.permissions.assertCan(membership.role, "media:complete", "media");
    const input = parseRequest(CompleteMediaMotionRequestSchema, rawInput);
    const media = await this.requireMedia(membership.workspaceId, mediaId);
    await this.assertMediaVisible(membership, media);
    const mime = assertSupportedMotion({
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      durationMs: input.durationMs,
    });

    // The completion callback may only complete the key this media owns.
    const expectedKey = buildMotionKey({ mediaKey: media.key, mimeType: mime });
    if (input.storageKey !== expectedKey) {
      throw new BadRequestException({
        code: "MEDIA_MOTION_KEY_MISMATCH",
        message: "The motion object key does not belong to this media.",
      });
    }

    const uploaded = await this.storage.completeUpload(expectedKey, this.bucketOf(media));
    if (uploaded.size <= 0) {
      throw new BadRequestException({
        code: "MEDIA_MOTION_EMPTY_UPLOAD",
        message: "The uploaded motion object is empty.",
      });
    }
    // The store's view wins: a client that under-reports its size cannot smuggle
    // an oversized movie past the 50 MB ceiling.
    assertSupportedMotion({
      mimeType: mime,
      sizeBytes: uploaded.size,
      durationMs: input.durationMs,
    });

    const motion = await this.repository.upsertMotion({
      id: generateUuidV7(),
      mediaId,
      storageKey: expectedKey,
      thumbKey: media.motion?.thumbKey ?? null,
      mimeType: mime,
      sizeBytes: uploaded.size,
      durationMs: input.durationMs,
      width: null,
      height: null,
    });

    await this.repository.transaction(async (tx) => {
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: media.tripId,
        actorId: actor.user.id,
        verb: "media.motion_uploaded",
        entityType: "media",
        entityId: mediaId,
        metadata: { size: uploaded.size, mimeType: mime },
      });
    });

    return this.presentReadWithMotion(media, motion);
  }

  async listWorkspace(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    rawQuery: unknown,
  ): Promise<MediaPage> {
    this.permissions.assertCan(membership.role, "media:read", "media");
    const query = parseRequest(MediaListQuerySchema, rawQuery);
    if (query.tripId) {
      const trip = await this.trips.findTrip(membership.workspaceId, query.tripId);
      if (!trip) {
        throw this.tripNotFound();
      }
      assertTripVisible(membership, trip);
    }
    const { field, direction } = sortParts(query.sort, ["createdAt"], "createdAt");
    const records = await this.repository.listMedia({
      where: {
        workspaceId: membership.workspaceId,
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.tripId
          ? { tripId: query.tripId }
          : this.visibilityFilter(membership, actor)),
      },
      orderBy: [{ [field]: direction }, { id: "asc" }],
      ...(cursorId(query.cursor) ? { cursor: cursorId(query.cursor) } : {}),
      take: query.limit + 1,
    });
    return (await this.presentPage(records, query.limit)) as MediaPage;
  }

  async listTrip(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    rawQuery: unknown,
  ): Promise<MediaPage> {
    this.permissions.assertCan(membership.role, "media:read", "media");
    const trip = await this.trips.findTrip(membership.workspaceId, tripId);
    if (!trip) {
      throw this.tripNotFound();
    }
    assertTripVisible(membership, trip);
    const query = parseRequest(TripMediaListQuerySchema, rawQuery);
    const { field, direction } = sortParts(query.sort, ["createdAt"], "createdAt");
    const records = await this.repository.listMedia({
      where: {
        workspaceId: membership.workspaceId,
        tripId,
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ [field]: direction }, { id: "asc" }],
      ...(cursorId(query.cursor) ? { cursor: cursorId(query.cursor) } : {}),
      take: query.limit + 1,
    });
    return (await this.presentPage(records, query.limit)) as MediaPage;
  }

  /**
   * Single media read (`GET /v1/media/{mediaId}`).
   *
   * Visibility follows the workspace media list: media attached to a private trip
   * is only readable by members who can see that trip. The response never carries
   * bucket, object key or the raw variant map, and unprocessed media reports
   * `url: null` with its real status instead of a placeholder link.
   */
  async getOne(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    mediaId: string,
  ): Promise<MediaRead> {
    this.permissions.assertCan(membership.role, "media:read", "media");
    const media = await this.requireMedia(membership.workspaceId, mediaId);
    await this.assertMediaVisible(membership, media);
    const urls = await this.signer().sign(media);
    return presentMediaRead(media, urls);
  }

  async update(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    mediaId: string,
    rawInput: unknown,
  ): Promise<Media> {
    this.permissions.assertCan(membership.role, "media:update", "media");
    const input = parseRequest(UpdateMediaRequestSchema, rawInput);
    const current = await this.requireMedia(membership.workspaceId, mediaId);
    await this.assertMediaVisible(membership, current);
    if (input.tripId) {
      const trip = await this.trips.findTrip(membership.workspaceId, input.tripId);
      if (!trip) {
        throw this.tripNotFound();
      }
      assertTripVisible(membership, trip);
    }

    const data: Record<string, unknown> = {
      ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(input.date !== undefined
        ? { date: input.date ? new Date(`${input.date}T00:00:00.000Z`) : null }
        : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      ...(input.tripId !== undefined ? { tripId: input.tripId } : {}),
    };
    const updated = await this.repository.updateMedia(membership.workspaceId, mediaId, data);
    await this.repository.transaction(async (tx) => {
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: updated.tripId,
        actorId: actor.user.id,
        verb: "media.updated",
        entityType: "media",
        entityId: mediaId,
        metadata: { fields: Object.keys(input).sort() },
      });
    });
    return this.presentWithUrls(updated);
  }

  async remove(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    mediaId: string,
  ): Promise<{ message: string }> {
    this.permissions.assertCan(membership.role, "media:delete", "media");
    const current = await this.requireMedia(membership.workspaceId, mediaId);
    await this.assertMediaVisible(membership, current);
    await this.repository.transaction(async (tx) => {
      const count = await this.repository.softDelete(tx, membership.workspaceId, mediaId);
      if (count === 0) {
        throw this.notFound();
      }
      await this.repository.detachFromContent(tx, membership.workspaceId, mediaId);
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: current.tripId,
        actorId: actor.user.id,
        verb: "media.deleted",
        entityType: "media",
        entityId: mediaId,
        metadata: {},
      });
    });
    await this.queue.enqueue({
      queue: "media",
      name: "media.cleanup",
      jobId: deterministicJobId("media-cleanup", mediaId),
      data: {
        mediaId,
        workspaceId: membership.workspaceId,
        keys: [...variantKeys(current), ...motionObjectKeys(current)],
      },
      delayMs: DELETE_DELAY_MS,
    });
    return { message: "Media deleted." };
  }

  async setCover(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    rawInput: unknown,
  ): Promise<Trip> {
    this.permissions.assertCan(membership.role, "trip:set-cover", "media");
    const input = parseRequest(SetTripCoverRequestSchema, rawInput);
    const trip = await this.trips.findTrip(membership.workspaceId, tripId);
    if (!trip) {
      throw this.tripNotFound();
    }
    assertTripVisible(membership, trip);
    const media = await this.requireMedia(membership.workspaceId, input.mediaId);
    if (media.status !== "ready") {
      // The request is well formed; the asset simply is not processed yet.
      throw new ConflictException({
        code: "MEDIA_NOT_READY",
        message: "Only processed media can be used as a trip cover.",
      });
    }
    if (media.tripId && media.tripId !== tripId) {
      throw new UnprocessableEntityException({
        code: "MEDIA_TRIP_MISMATCH",
        message: "The media belongs to another trip.",
      });
    }

    const updated = await this.repository.transaction(async (tx) => {
      const record = await this.repository.setTripCover(
        tx,
        membership.workspaceId,
        tripId,
        input.mediaId,
        actor.user.id,
      );
      if (!record) {
        throw this.tripNotFound();
      }
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        actorId: actor.user.id,
        verb: "trip.cover_changed",
        entityType: "trip",
        entityId: tripId,
        metadata: { mediaId: input.mediaId },
      });
      return record;
    });
    const covers = await this.coverProjector().resolve(
      [{ id: tripId, coverMediaId: input.mediaId }],
      async () => [media],
    );
    return presentTrip(updated as never, covers.get(tripId) ?? null);
  }

  /**
   * Bucket recorded on the row, if any.
   *
   * A legacy row without a bucket is completed/read against the current
   * configuration and emits one throttled warning, mirroring
   * `MediaUrlService`'s read-side fallback.
   */
  private bucketOf(media: MediaRecord): string | undefined {
    const bucket = typeof media.bucket === "string" ? media.bucket.trim() : "";
    if (bucket) {
      return bucket;
    }
    const now = Date.now();
    if (now - this.lastMissingBucketWarningAt >= BUCKET_MISSING_WARN_INTERVAL_MS) {
      this.lastMissingBucketWarningAt = now;
      this.logger?.warn(
        { code: "MEDIA_BUCKET_MISSING", mediaId: media.id },
        "media.bucket_missing",
      );
    }
    return undefined;
  }

  private signer(): MediaUrlService {
    return this.mediaUrls ?? new MediaUrlService(this.storage);
  }

  private coverProjector(): TripCoverService {
    return this.covers ?? new TripCoverService(this.signer());
  }

  private async requireMedia(workspaceId: string, mediaId: string): Promise<MediaRecord> {
    const media = await this.repository.findMedia(workspaceId, mediaId);
    if (!media) {
      throw this.notFound();
    }
    assertSafeMediaKey(media.key);
    return media;
  }

  /**
   * Media attached to a private trip is invisible to members who cannot see
   * that trip, so mutations addressed by id must apply the same rule the list
   * endpoints filter on. Without this, an editor was excluded from private-trip
   * media listings but could still PATCH/DELETE a row whose id they knew.
   */
  private async assertMediaVisible(
    membership: WorkspaceMembershipAccess,
    media: MediaRecord,
  ): Promise<void> {
    if (!media.tripId) {
      return;
    }
    const trip = await this.trips.findTrip(membership.workspaceId, media.tripId);
    if (trip) {
      assertTripVisible(membership, trip);
    }
  }

  private async presentPage(records: MediaRecord[], limit: number) {
    const visible = records.slice(0, limit);
    const items = await Promise.all(visible.map((record) => this.presentWithUrls(record)));
    const hasMore = records.length > limit;
    const lastRecord = visible.at(-1);
    return {
      items,
      nextCursor:
        hasMore && lastRecord
          ? encodeCursor({ id: lastRecord.id, createdAt: lastRecord.createdAt })
          : null,
      hasMore,
    };
  }

  private async presentWithUrls(record: MediaRecord): Promise<Media> {
    const motion = liveMotion(record);
    const keys = [...new Set([record.key, ...variantKeys(record)])];
    if (motion) {
      keys.push(motion.storageKey);
    }
    // Every key is signed against this row's own bucket, so old objects stay
    // reachable after the configured bucket changes.
    const signed = await this.signer().signKeys(record, keys);
    const byKey = new Map(
      [...signed.values()].map((value) => [
        value.key,
        { key: value.key, url: value.url, expiresAt: value.expiresAt } satisfies MediaVariantView,
      ]),
    );

    const views: Record<string, MediaVariantView> = {};
    const original = byKey.get(record.key);
    if (original) {
      views.original = original;
    }
    const stored = isRecord(record.variants) ? record.variants : {};
    for (const [name, value] of Object.entries(stored)) {
      if (isRecord(value) && typeof value.key === "string") {
        const view = byKey.get(value.key);
        if (view) {
          views[name] = view;
        }
      }
    }
    const motionView = motion
      ? {
          url: byKey.get(motion.storageKey)?.url ?? null,
        }
      : null;
    return presentMedia(record, views, motionView);
  }

  /**
   * Read projection right after a motion write: sign the still and the video
   * together so the client gets `livePhoto: true` and a playable `motion.url` in
   * the same response instead of asking again.
   */
  private async presentReadWithMotion(
    record: MediaRecord,
    motion: MediaMotionRecord,
  ): Promise<MediaRead> {
    const withMotion: MediaRecord = { ...record, motion };
    const urls = await this.signer().sign(withMotion);
    return presentMediaRead(withMotion, urls);
  }

  /**
   * The workspace media list cannot call `resolveTripAccess` per row, so its
   * trip predicate is generated by the one shared rule (`tripVisibilityWhere`)
   * instead of a second hand-written `where`.
   *
   * Media that is not attached to a trip (`tripId: null`) is workspace-level and
   * stays readable by every member.
   *
   * Removed on purpose: workspace `owner`/`admin` used to receive `{}` here and
   * saw every media row in the workspace, including media of other people's
   * `private` trips. That bypass contradicted the rule the rest of the API now
   * uses, so it is gone: this list and `getOne` (which goes through
   * `assertTripVisible`) must agree, or a card in the list 404s when opened.
   */
  private visibilityFilter(
    membership: WorkspaceMembershipAccess,
    actor: AuthenticatedActor,
  ): Record<string, unknown> {
    return {
      OR: [
        { tripId: null },
        {
          trip: {
            deletedAt: null,
            ...tripVisibilityWhere({
              userId: membership.userId,
              workspaceId: membership.workspaceId,
              platformRole: actor.user.platformRole,
            }),
          },
        },
      ],
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: "MEDIA_NOT_FOUND",
      message: "The requested media was not found.",
    });
  }

  private tripNotFound(): NotFoundException {
    return new NotFoundException({
      code: "TRIP_NOT_FOUND",
      message: "The requested trip was not found.",
    });
  }
}

function parseOptionalCompletion(rawInput: unknown): {
  size?: number;
  width?: number;
  height?: number;
  blurhash?: string;
} {
  if (rawInput === undefined || rawInput === null) {
    return {};
  }
  const result = parseRequest(CompleteMediaRequestSchema, rawInput);
  return result;
}

/** Object keys the delayed cleanup job must purge for a deleted Live Photo. */
function motionObjectKeys(record: MediaRecord): string[] {
  const motion = liveMotion(record);
  if (!motion) {
    return [];
  }
  return motion.thumbKey ? [motion.storageKey, motion.thumbKey] : [motion.storageKey];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
