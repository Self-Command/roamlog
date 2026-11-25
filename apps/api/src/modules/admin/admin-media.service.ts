import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  AdminMediaQuerySchema,
  type AdminMediaPage,
  type Media,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId, toCursorPage } from "../../common/services/cursor-page.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { AuditService } from "../audit/audit.service.js";
import type { MediaVariantView } from "../media/media.presenter.js";
import { MediaUrlService } from "../media/media-url.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { assertAdminAction } from "./admin-access.js";
import { presentMedia, type AdminMediaRecord } from "./admin.presenters.js";
import { mediaSelect } from "./admin-selects.js";

const MEDIA_STATUSES = ["pending", "processing", "ready", "failed"] as const;

@Injectable()
export class AdminMediaService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MediaUrlService) private readonly mediaUrls: MediaUrlService,
  ) {}

  async list(actor: AuthenticatedActor, rawQuery: unknown): Promise<AdminMediaPage> {
    assertAdminAction(actor, "admin:media:read");
    const query = parseRequest(AdminMediaQuerySchema, rawQuery);
    const cursor = cursorId(query.cursor);
    const status =
      query.status && MEDIA_STATUSES.includes(query.status as (typeof MEDIA_STATUSES)[number])
        ? { status: query.status as (typeof MEDIA_STATUSES)[number] }
        : query.status === "deleted"
          ? { deletedAt: { not: null } }
          : query.status === "active"
            ? { deletedAt: null }
            : { deletedAt: null };

    const rows = await this.prisma.client.media.findMany({
      where: {
        ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
        ...status,
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: mediaSelect,
    });

    const presented = await Promise.all(rows.map((record) => this.presentWithUrls(record)));
    const byId = new Map(presented.map((record) => [record.id, record]));
    return toCursorPage(rows, query.limit, (record) => byId.get(record.id) as Media) as AdminMediaPage;
  }

  async remove(actor: AuthenticatedActor, id: string): Promise<{ message: string }> {
    assertAdminAction(actor, "admin:media:delete");
    const record = await this.prisma.client.media.findUnique({
      where: { id },
      select: { id: true, workspaceId: true, key: true },
    });
    if (!record) {
      throw new NotFoundException({
        code: "MEDIA_NOT_FOUND",
        message: "The media object was not found.",
      });
    }

    await this.prisma.client.media.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.record({
      actorId: actor.user.id,
      actorType: "admin",
      action: "admin.media.deleted",
      targetType: "media",
      targetId: id,
      workspaceId: record.workspaceId,
      ip: actor.ip ?? undefined,
      userAgent: actor.userAgent ?? undefined,
      metadata: { key: record.key },
    });
    return { message: "Media deleted." };
  }

  /**
   * Admin moderation needs to see the uploaded object even before processing
   * finishes, so every stored key is signed instead of only the ready display
   * variants. The signing algorithm mirrors `MediaService.presentWithUrls`.
   */
  private async presentWithUrls(record: AdminMediaRecord): Promise<Media> {
    const keys = [...new Set([record.key, ...mediaVariantKeys(record.variants)])];
    const signed = await this.mediaUrls.signKeys(record, keys);
    const byKey = new Map(
      [...signed.values()].map((value) => [
        value.key,
        {
          key: value.key,
          url: value.url,
          expiresAt: value.expiresAt,
        } satisfies MediaVariantView,
      ]),
    );

    const views: Record<string, MediaVariantView> = {};
    const original = byKey.get(record.key);
    if (original) {
      views.original = original;
    }
    for (const [name, value] of Object.entries(jsonObject(record.variants))) {
      if (isRecord(value) && typeof value.key === "string") {
        const view = byKey.get(value.key);
        if (view) {
          views[name] = view;
        }
      }
    }

    return presentMedia(record, views);
  }
}

function mediaVariantKeys(value: unknown): string[] {
  const keys = new Set<string>();
  for (const variant of Object.values(jsonObject(value))) {
    if (isRecord(variant) && typeof variant.key === "string" && variant.key.length > 0) {
      keys.add(variant.key);
    }
  }
  return [...keys];
}

function jsonObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
