import { Inject, Injectable } from "@nestjs/common";
import type { TripCover } from "@roamlog/contracts";

import { MediaUrlService, type MediaUrlSource } from "./media-url.service.js";

/** Media row fields the cover projection needs; `bucket` comes from `MediaUrlSource`. */
export interface CoverMediaSource extends MediaUrlSource {
  tripId?: string | null;
  width?: number | null;
  height?: number | null;
  blurhash?: string | null;
}

/** A trip as far as cover projection is concerned. */
export interface CoverTripRef {
  id: string;
  coverMediaId: string | null;
}

/**
 * Loads the candidate cover media rows for a Workspace.
 *
 * Implementations must scope the query by Workspace: the projector never trusts a
 * `coverMediaId` on its own, so a Workspace cannot borrow another Workspace's
 * media through a stale or forged reference.
 */
export type CoverMediaLoader = (mediaIds: readonly string[]) => Promise<CoverMediaSource[]>;

@Injectable()
export class TripCoverService {
  constructor(@Inject(MediaUrlService) private readonly mediaUrls: MediaUrlService) {}

  /**
   * Projects `TripCover` values for a page of trips.
   *
   * A cover is produced only when the referenced media row exists inside the same
   * Workspace, is `ready`, and — when it is attached to a trip at all — belongs to
   * the trip being projected. Every other case resolves to `null`: no placeholder
   * URL, no borrowed media, no cross-trip cover.
   */
  async resolve(
    trips: readonly CoverTripRef[],
    loadMedia: CoverMediaLoader,
  ): Promise<Map<string, TripCover | null>> {
    const covers = new Map<string, TripCover | null>();
    const mediaIds = [
      ...new Set(
        trips
          .map((trip) => trip.coverMediaId)
          .filter((mediaId): mediaId is string => typeof mediaId === "string" && mediaId.length > 0),
      ),
    ];

    if (mediaIds.length === 0) {
      for (const trip of trips) {
        covers.set(trip.id, null);
      }
      return covers;
    }

    const rows = await loadMedia(mediaIds);
    const byId = new Map<string, CoverMediaSource>();
    for (const row of rows) {
      if (row && typeof row.id === "string") {
        byId.set(row.id, row);
      }
    }

    const candidates: Array<{ trip: CoverTripRef; media: CoverMediaSource }> = [];
    for (const trip of trips) {
      const media = trip.coverMediaId ? byId.get(trip.coverMediaId) : undefined;
      if (!media || media.status !== "ready") {
        covers.set(trip.id, null);
        continue;
      }
      const mediaTripId = media.tripId ?? null;
      if (mediaTripId !== null && mediaTripId !== trip.id) {
        covers.set(trip.id, null);
        continue;
      }
      candidates.push({ trip, media });
    }

    if (candidates.length === 0) {
      return covers;
    }

    const signed = await this.mediaUrls.signMany(candidates.map(({ media }) => media));
    for (const { trip, media } of candidates) {
      const urls = signed.get(media.id);
      if (!urls || urls.url === null || urls.expiresAt === null) {
        // `TripCoverSchema` rejects a `ready` cover without a signed URL, and a
        // placeholder is never acceptable: report "no cover" instead.
        covers.set(trip.id, null);
        continue;
      }
      covers.set(trip.id, {
        mediaId: media.id,
        status: "ready",
        url: urls.url,
        thumbUrl: urls.thumbUrl,
        width: media.width ?? null,
        height: media.height ?? null,
        blurhash: media.blurhash ?? null,
        expiresAt: urls.expiresAt,
      });
    }
    return covers;
  }
}
