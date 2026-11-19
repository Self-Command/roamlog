import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  CreateShareLinkRequestSchema,
  PublicShareQuerySchema,
  PublicShareTokenSchema,
  PublicTripResponseSchema,
  ShareLinkCreatedSchema,
  ShareLinkSchema,
  tripDurationDays,
  type PublicMedia,
  type PublicTripResponse,
  type ShareLink,
  type ShareLinkCreated,
  type ShareLinkListResponse,
  type TripCover,
} from "@roamlog/contracts";
import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

import { AppConfigService } from "../../config/app-config.service.js";
import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { SanitizeService } from "../../common/services/sanitize.service.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { ActivitiesService } from "../activities/activities.service.js";
import {
  MediaUrlService,
  type MediaUrlSource,
  type SignedMediaUrls,
} from "../media/media-url.service.js";
import {
  TripCoverService,
  type CoverMediaSource,
} from "../media/trip-cover.service.js";
import { canonicalTripOrigin } from "../trips/content-values.js";
import {
  ShareLinksRepository,
  type PublicTripBundle,
  type ShareLinkRecord,
} from "./share-links.repository.js";

@Injectable()
export class ShareLinksService {
  constructor(
    @Inject(ShareLinksRepository) private readonly repository: ShareLinksRepository,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(ActivitiesService) private readonly activities: ActivitiesService,
    @Inject(SanitizeService) private readonly sanitizer: SanitizeService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    // Optional at the type level only: `apps/api/test/collab-share.e2e-spec.ts`
    // builds this service with the five pre-existing arguments and is owned by a
    // different task. Nest still injects the provider by token, so a missing
    // MediaModule registration fails at bootstrap rather than at request time.
    @Inject(MediaUrlService) private readonly mediaUrls?: MediaUrlService,
    // Same optionality rule as `mediaUrls`: `apps/api/test/collab-share.e2e-spec.ts`
    // builds this service by hand with the five original arguments. Nest injects
    // the provider from `MediaModule`, which re-exports `MediaUrlModule`.
    @Inject(TripCoverService) private readonly covers?: TripCoverService,
  ) {}

  async create(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
    rawInput: unknown,
  ): Promise<ShareLinkCreated> {
    this.permissions.assertCan(membership.role, "share-link:create", "share_link");
    const input = parseRequest(CreateShareLinkRequestSchema, rawInput);
    const trip = await this.repository.findTrip(membership.workspaceId, tripId);
    if (!trip) {
      throw this.tripNotFound();
    }
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: "SHARE_EXPIRY_INVALID",
        message: "A share link expiry must be in the future.",
      });
    }
    const token = createShareToken();
    const passwordHash = input.password ? hashSharePassword(input.password) : null;

    const record = await this.repository.transaction(async (tx) => {
      const created = await this.repository.createShareLink(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        tokenHash: hashShareToken(token),
        createdById: actor.user.id,
        expiresAt,
        passwordHash,
        allowIndex: input.allowIndex ?? false,
        showBudget: input.showBudget ?? false,
      });
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId,
        actorId: actor.user.id,
        verb: "share_link.created",
        entityType: "share_link",
        entityId: created.id,
        metadata: {
          expiresAt: created.expiresAt?.toISOString() ?? null,
          hasPassword: created.passwordHash !== null,
          allowIndex: created.allowIndex,
          showBudget: created.showBudget,
        },
      });
      return created;
    });

    return ShareLinkCreatedSchema.parse({
      ...this.present(record),
      token,
      url: `${this.config.appUrl.replace(/\/$/, "")}/share/${token}`,
    });
  }

  async list(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    tripId: string,
  ): Promise<ShareLinkListResponse> {
    this.permissions.assertCan(membership.role, "share-link:read", "share_link");
    const trip = await this.repository.findTrip(membership.workspaceId, tripId);
    if (!trip) {
      throw this.tripNotFound();
    }
    const links = await this.repository.listShareLinks(membership.workspaceId, tripId);
    return links.map((link) => this.present(link));
  }

  async revoke(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    shareLinkId: string,
  ): Promise<{ message: string }> {
    this.permissions.assertCan(membership.role, "share-link:revoke", "share_link");
    const link = await this.repository.findShareLinkById(shareLinkId);
    if (!link || link.workspaceId !== membership.workspaceId) {
      throw this.linkNotFound();
    }
    await this.repository.transaction(async (tx) => {
      await this.repository.revokeShareLink(tx, {
        workspaceId: membership.workspaceId,
        shareLinkId,
      });
      await this.activities.record(tx, {
        workspaceId: membership.workspaceId,
        tripId: link.tripId,
        actorId: actor.user.id,
        verb: "share_link.revoked",
        entityType: "share_link",
        entityId: shareLinkId,
        metadata: {},
      });
    });
    return { message: "Share link revoked." };
  }

  async readPublic(token: string, rawQuery: unknown): Promise<PublicTripResponse> {
    if (!PublicShareTokenSchema.safeParse(token).success) {
      throw this.linkNotFound();
    }
    const query = parseRequest(PublicShareQuerySchema, rawQuery);
    const link = await this.repository.findShareLinkByHash(hashShareToken(token));
    if (!link || link.revokedAt !== null) {
      throw this.linkNotFound();
    }
    if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
      throw this.linkNotFound();
    }
    if (link.passwordHash) {
      if (!query.password) {
        throw new UnauthorizedException({
          code: "SHARE_PASSWORD_REQUIRED",
          message: "This share link requires a password.",
        });
      }
      if (!verifySharePassword(query.password, link.passwordHash)) {
        throw new UnauthorizedException({
          code: "SHARE_PASSWORD_INVALID",
          message: "The share link password is invalid.",
        });
      }
    }

    const bundle = await this.repository.loadPublicTrip(link);
    if (!bundle) {
      throw this.linkNotFound();
    }
    const payload = await this.publicPayload(bundle);
    const accessed = await this.repository.recordAccess(link.id, new Date());
    if (!accessed) {
      throw this.linkNotFound();
    }
    return payload;
  }

  private async publicPayload(bundle: PublicTripBundle): Promise<PublicTripResponse> {
    const trip = bundle.trip;
    const startDate = dateOnly(trip.startDate);
    const endDate = dateOnly(trip.endDate);
    const media = await this.publicMediaList(bundle.media);
    const mediaById = new Map(media.map((item) => [item.id, item]));
    const cover = await this.resolveCover(trip, bundle);
    return PublicTripResponseSchema.parse({
      trip: {
        id: trip.id,
        title: trip.title,
        summary: trip.summary,
        status: trip.status,
        startDate,
        endDate,
        durationDays: tripDurationDays(startDate, endDate),
        coverMediaId: trip.coverMediaId ?? null,
        cover,
        origin: canonicalTripOrigin(trip.origin),
        destinations: trip.destinations ?? [],
        countryCodes: trip.countryCodes ?? [],
        tags: trip.tags ?? [],
      },
      stops: bundle.stops.map((stop) => ({
        id: stop.id,
        city: stop.city,
        country: stop.country,
        countryCode: stop.countryCode,
        lat: stop.lat ?? null,
        lng: stop.lng ?? null,
        // The formatted address is shown on the public page so a visitor can see
        // the place; the bbox stays private (it is never read here at all).
        address: typeof stop.address === "string" ? stop.address : null,
        startDate: dateOnly(stop.startDate),
        endDate: dateOnly(stop.endDate),
        notes: stop.notes ?? "",
        order: stop.order ?? 0,
      })),
      entries: bundle.entries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        date: dateOnly(entry.date),
        location: entry.location,
        lat: entry.lat ?? null,
        lng: entry.lng ?? null,
        mood: entry.mood ?? null,
        weather: entry.weather ?? null,
        contentHtml: this.sanitizer.sanitizeHtml(String(entry.contentHtml ?? "")),
        excerpt: entry.excerpt ?? "",
        tags: entry.tags ?? [],
        media: entryMediaViews(entry.media, mediaById),
      })),
      media,
      budget: bundle.budget ?? null,
    });
  }

  /**
   * Signs and projects public media rows into the strict `PublicMedia` shape.
   *
   * Rows that are not `ready`, or for which no signed URL could be produced, are
   * dropped: a public share response must never contain an empty string, a
   * placeholder link, or storage coordinates.
   */
  private async publicMediaList(
    records: ReadonlyArray<Record<string, unknown>>,
  ): Promise<PublicMedia[]> {
    const sources: MediaUrlSource[] = [];
    const rowsById = new Map<string, Record<string, unknown>>();
    for (const record of records) {
      const id = typeof record.id === "string" ? record.id : null;
      const key = typeof record.key === "string" ? record.key : null;
      const status = record.status;
      if (!id || !key || typeof status !== "string" || rowsById.has(id)) {
        continue;
      }
      rowsById.set(id, record);
      sources.push({ id, key, status, variants: record.variants });
    }

    const signed: ReadonlyMap<string, SignedMediaUrls> =
      sources.length > 0
        ? await this.mediaUrlSigner().signMany(sources)
        : new Map<string, SignedMediaUrls>();
    const views: PublicMedia[] = [];
    for (const source of sources) {
      const row = rowsById.get(source.id);
      const urls = signed.get(source.id);
      if (!row || !urls || urls.url === null || urls.expiresAt === null) {
        continue;
      }
      views.push({
        id: source.id,
        url: urls.url,
        thumbUrl: urls.thumbUrl,
        expiresAt: urls.expiresAt,
        width: numberOrNull(row.width),
        height: numberOrNull(row.height),
        blurhash: stringOrNull(row.blurhash),
        caption: stringOrNull(row.caption),
        date: row.date ? dateOnly(row.date) : null,
        location: stringOrNull(row.location),
      });
    }
    return views;
  }

  /**
   * Public cover projection, delegated to the projector the authenticated trip
   * reads use ({@link TripCoverService.resolve}).
   *
   * Sharing the projector is the point: the login path and the share path must
   * answer the same question the same way. A cover exists only when the media
   * referenced by `coverMediaId` lives in this Workspace, is `ready`, and is
   * either Workspace-level (`tripId = null`) or attached to this very trip.
   *
   * The loader below only exposes rows the repository already loaded — the
   * Workspace-scoped `bundle.media` plus the separately loaded
   * `bundle.coverMedia` — so the projector can never reach a row outside the
   * tenant. When nothing qualifies the share reports `cover: null`; it never
   * falls back to an unsigned, borrowed or placeholder URL.
   */
  private async resolveCover(
    trip: Record<string, unknown>,
    bundle: PublicTripBundle,
  ): Promise<TripCover | null> {
    const tripId = typeof trip.id === "string" ? trip.id : null;
    const workspaceId = typeof trip.workspaceId === "string" ? trip.workspaceId : null;
    const coverMediaId =
      typeof trip.coverMediaId === "string" && trip.coverMediaId.length > 0
        ? trip.coverMediaId
        : null;
    if (!tripId || !workspaceId || !coverMediaId) {
      return null;
    }
    const candidates = coverCandidates(bundle);
    const covers = await this.coverProjector().resolve(
      [{ id: tripId, coverMediaId }],
      async (mediaIds) => coverMediaSources(candidates, mediaIds, workspaceId),
    );
    return covers.get(tripId) ?? null;
  }

  private coverProjector(): TripCoverService {
    return this.covers ?? new TripCoverService(this.mediaUrlSigner());
  }

  private mediaUrlSigner(): MediaUrlService {
    if (!this.mediaUrls) {
      throw new Error(
        "MediaUrlService is not wired into ShareLinksModule; public media cannot be signed.",
      );
    }
    return this.mediaUrls;
  }

  private present(record: ShareLinkRecord): ShareLink {
    return ShareLinkSchema.parse({
      id: record.id,
      workspaceId: record.workspaceId,
      tripId: record.tripId,
      createdById: record.createdById,
      expiresAt: record.expiresAt?.toISOString() ?? null,
      revokedAt: record.revokedAt?.toISOString() ?? null,
      hasPassword: record.passwordHash !== null,
      allowIndex: record.allowIndex,
      showBudget: record.showBudget,
      lastAccessedAt: record.lastAccessedAt?.toISOString() ?? null,
      accessCount: record.accessCount,
      createdAt: record.createdAt.toISOString(),
    });
  }

  private tripNotFound(): NotFoundException {
    return new NotFoundException({
      code: "TRIP_NOT_FOUND",
      message: "The requested trip was not found.",
    });
  }

  private linkNotFound(): NotFoundException {
    return new NotFoundException({
      code: "SHARE_LINK_NOT_FOUND",
      message: "The requested share link was not found.",
    });
  }
}

export function createShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function hashSharePassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifySharePassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) {
    return false;
  }
  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime())
    ? String(value).slice(0, 10)
    : parsed.toISOString().slice(0, 10);
}

function entryMediaViews(
  records: ReadonlyArray<Record<string, unknown>> | undefined,
  mediaById: ReadonlyMap<string, PublicMedia>,
): PublicMedia[] {
  const views: PublicMedia[] = [];
  for (const record of records ?? []) {
    const view = typeof record.id === "string" ? mediaById.get(record.id) : undefined;
    if (view) {
      views.push(view);
    }
  }
  return views;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Rows the public cover projector may look at: the separately loaded cover row
 * (a Workspace-level photo, usually) followed by the trip gallery.
 */
function coverCandidates(
  bundle: PublicTripBundle,
): ReadonlyArray<Record<string, unknown>> {
  return bundle.coverMedia ? [bundle.coverMedia, ...bundle.media] : bundle.media;
}

/**
 * Narrows already-loaded bundle rows to {@link CoverMediaSource} for the ids the
 * projector asked for.
 *
 * The rows come from the repository's Workspace-scoped query, so this only drops
 * rows the projector did not request. It never fetches or adds media: the public
 * read stays at one media query and cannot widen the tenant boundary here.
 */
function coverMediaSources(
  rows: ReadonlyArray<Record<string, unknown>>,
  mediaIds: readonly string[],
  workspaceId: string,
): CoverMediaSource[] {
  const requested = new Set(mediaIds);
  const seen = new Set<string>();
  const sources: CoverMediaSource[] = [];
  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id || !requested.has(id) || seen.has(id)) {
      continue;
    }
    // Defence in depth: the repository already scopes its media query by
    // Workspace, and this second check makes a cross-tenant cover impossible even
    // if a future caller hands over a foreign row.
    if (row.workspaceId !== workspaceId) {
      continue;
    }
    seen.add(id);
    sources.push({
      id,
      key: typeof row.key === "string" ? row.key : "",
      status: typeof row.status === "string" ? row.status : "",
      variants: row.variants,
      tripId: typeof row.tripId === "string" ? row.tripId : null,
      width: numberOrNull(row.width),
      height: numberOrNull(row.height),
      blurhash: stringOrNull(row.blurhash),
    });
  }
  return sources;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
