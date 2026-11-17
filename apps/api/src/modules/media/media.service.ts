import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  CompleteMediaRequestSchema,
  encodeCursor,
  MediaListQuerySchema,
  MediaPresignRequestSchema,
  SetTripCoverRequestSchema,
  TripMediaListQuerySchema,
  UpdateMediaRequestSchema,
  type Media,
  type MediaPage,
  type MediaPresignResponse,
  type Trip,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId } from "../../common/services/cursor-page.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { AppConfigService } from "../../config/app-config.service.js";
import { ActivitiesService } from "../activities/activities.service.js";
import { generateUuidV7 } from "../auth/uuid.js";
import { JobQueueService, deterministicJobId } from "../exports/job-queue.service.js";
import { StorageService } from "../storage/storage.service.js";
import {
  assertSafeMediaKey,
  assertSupportedImage,
  buildMediaKey,
  sanitizeFileName,
} from "./media-rules.js";
import type { MediaRecord } from "./media-records.js";
import { MediaRepository } from "./media.repository.js";
import { presentMedia, variantKeys, type MediaVariantView } from "./media.presenter.js";
import {
  assertTripVisible,
  sortParts,
} from "../trips/content-values.js";
import { presentTrip } from "../trips/content-presenters.js";
import { TripsRepository } from "../trips/trips.repository.js";

const DELETE_DELAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class MediaService {
  constructor(
    @Inject(MediaRepository) private readonly repository: MediaRepository,
    @Inject(TripsRepository) private readonly trips: TripsRepository,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(JobQueueService) private readonly queue: JobQueueService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(ActivitiesService) private readonly activities: ActivitiesService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

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
    const bucket = this.config.storageSettings.bucket;

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

    const upload = await this.storage.createPresignedUpload(key, mime);
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
    if (media.tripId) {
      const trip = await this.trips.findTrip(membership.workspaceId, media.tripId);
      if (trip) {
        assertTripVisible(membership, trip);
      }
    }
    if (media.status === "processing" || media.status === "ready") {
      return this.presentWithUrls(media);
    }
    if (media.status === "failed") {
      // Allow an explicit retry from a failed upload.
    }

    const uploaded = await this.storage.completeUpload(media.key);
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

  async listWorkspace(
    _actor: AuthenticatedActor,
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
          : this.visibilityFilter(membership)),
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

  async update(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    mediaId: string,
    rawInput: unknown,
  ): Promise<Media> {
    this.permissions.assertCan(membership.role, "media:update", "media");
    const input = parseRequest(UpdateMediaRequestSchema, rawInput);
    await this.requireMedia(membership.workspaceId, mediaId);
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
        keys: variantKeys(current),
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
      throw new BadRequestException({
        code: "MEDIA_NOT_READY",
        message: "Only processed media can be used as a trip cover.",
      });
    }
    if (media.tripId && media.tripId !== tripId) {
      throw new BadRequestException({
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
    return presentTrip(updated as never);
  }

  private async requireMedia(workspaceId: string, mediaId: string): Promise<MediaRecord> {
    const media = await this.repository.findMedia(workspaceId, mediaId);
    if (!media) {
      throw this.notFound();
    }
    assertSafeMediaKey(media.key);
    return media;
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
    const keys = [...new Set([record.key, ...variantKeys(record)])];
    const signed = await Promise.all(
      keys.map((key) => this.storage.createSignedReadUrl(assertStorageKey(key))),
    );
    const byKey = new Map(
      signed.map((value) => [
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
    return presentMedia(record, views);
  }

  private visibilityFilter(membership: WorkspaceMembershipAccess): Record<string, unknown> {
    if (membership.role === "owner" || membership.role === "admin") {
      return {};
    }
    return {
      OR: [
        { tripId: null },
        {
          trip: {
            deletedAt: null,
            OR: [
              { visibility: { in: ["workspace", "public_link"] } },
              { createdById: membership.userId },
            ],
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

function assertStorageKey(key: string): string {
  assertSafeMediaKey(key);
  return key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
