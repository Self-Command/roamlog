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
  type PublicTripResponse,
  type ShareLink,
  type ShareLinkCreated,
  type ShareLinkListResponse,
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
    const payload = this.publicPayload(bundle);
    const accessed = await this.repository.recordAccess(link.id, new Date());
    if (!accessed) {
      throw this.linkNotFound();
    }
    return payload;
  }

  private publicPayload(bundle: PublicTripBundle): PublicTripResponse {
    const trip = bundle.trip;
    return PublicTripResponseSchema.parse({
      trip: {
        id: trip.id,
        title: trip.title,
        summary: trip.summary,
        status: trip.status,
        startDate: dateOnly(trip.startDate),
        endDate: dateOnly(trip.endDate),
        coverMediaId: trip.coverMediaId ?? null,
        origin: trip.origin,
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
        media: (entry.media ?? []).map((media) => this.publicMedia(media)),
      })),
      media: bundle.media.map((media) => this.publicMedia(media)),
      budget: bundle.budget ?? null,
    });
  }

  private publicMedia(media: Record<string, unknown>) {
    return {
      id: media.id,
      width: media.width ?? null,
      height: media.height ?? null,
      blurhash: media.blurhash ?? null,
      variants: isJsonObject(media.variants) ? media.variants : {},
      caption: media.caption ?? null,
      date: media.date ? dateOnly(media.date) : null,
      location: media.location ?? null,
    };
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

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
