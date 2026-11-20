import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  AdminContentQuerySchema,
  AdminContentParamsSchema,
  type AdminCommentPage,
  type AdminEntryPage,
  type AdminTripPage,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId, toCursorPage } from "../../common/services/cursor-page.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { presentEntry, presentTrip } from "../trips/content-presenters.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { assertAdminAction } from "./admin-access.js";
import { presentComment } from "./admin.presenters.js";
import { commentSelect, entrySelect, tripSelect } from "./admin-selects.js";

type ContentType = "trip" | "entry" | "comment";

const TRIP_STATUSES = ["wishlist", "planning", "upcoming", "active", "completed"] as const;

function deletedFilter(status: string | undefined): Record<string, unknown> {
  if (status === "deleted") {
    return { deletedAt: { not: null } };
  }
  if (status === "active") {
    return { deletedAt: null };
  }
  return {};
}

@Injectable()
export class AdminContentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async listTrips(actor: AuthenticatedActor, rawQuery: unknown): Promise<AdminTripPage> {
    assertAdminAction(actor, "admin:content:read");
    const query = parseRequest(AdminContentQuerySchema, rawQuery);
    const cursor = cursorId(query.cursor);
    const status =
      query.status && TRIP_STATUSES.includes(query.status as (typeof TRIP_STATUSES)[number])
        ? { status: query.status as (typeof TRIP_STATUSES)[number] }
        : deletedFilter(query.status);

    const rows = await this.prisma.client.trip.findMany({
      where: {
        ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
        ...(query.q ? { title: { contains: query.q, mode: "insensitive" } } : {}),
        ...status,
      },
      orderBy: contentOrderBy(query.sort),
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: tripSelect,
    });

    // `presentTrip` takes an optional second argument (the resolved cover), so it
    // must not be handed to `toCursorPage` directly: the page mapper calls it as
    // `Array.prototype.map`'s callback and every row would receive its numeric
    // array index as `cover`, failing `TripSchema.parse` ("expected object,
    // received number") for every non-empty trip list.
    return toCursorPage(rows, query.limit, (row) => presentTrip(row)) as AdminTripPage;
  }

  async listEntries(actor: AuthenticatedActor, rawQuery: unknown): Promise<AdminEntryPage> {
    assertAdminAction(actor, "admin:content:read");
    const query = parseRequest(AdminContentQuerySchema, rawQuery);
    const cursor = cursorId(query.cursor);

    const rows = await this.prisma.client.journalEntry.findMany({
      where: {
        ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
        ...(query.q ? { title: { contains: query.q, mode: "insensitive" } } : {}),
        ...deletedFilter(query.status),
      },
      orderBy: contentOrderBy(query.sort),
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: entrySelect,
    });

    return toCursorPage(rows, query.limit, presentEntry) as AdminEntryPage;
  }

  async listComments(actor: AuthenticatedActor, rawQuery: unknown): Promise<AdminCommentPage> {
    assertAdminAction(actor, "admin:content:read");
    const query = parseRequest(AdminContentQuerySchema, rawQuery);
    const cursor = cursorId(query.cursor);

    const rows = await this.prisma.client.comment.findMany({
      where: {
        ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
        ...(query.q ? { body: { contains: query.q, mode: "insensitive" } } : {}),
        ...deletedFilter(query.status),
      },
      orderBy: contentOrderBy(query.sort),
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: commentSelect,
    });

    return toCursorPage(rows, query.limit, presentComment) as AdminCommentPage;
  }

  async remove(
    actor: AuthenticatedActor,
    rawType: string,
    id: string,
  ): Promise<{ message: string }> {
    assertAdminAction(actor, "admin:content:delete");
    const { type } = parseRequest(AdminContentParamsSchema, { type: rawType, id });
    const record = await this.requireContent(type, id);
    await this.updateDeletedAt(type, id, new Date());
    await this.audit.record({
      actorId: actor.user.id,
      actorType: "admin",
      action: "admin.content.deleted",
      targetType: type,
      targetId: id,
      workspaceId: record.workspaceId,
      ip: actor.ip ?? undefined,
      userAgent: actor.userAgent ?? undefined,
      metadata: { contentType: type },
    });
    return { message: "Content deleted." };
  }

  async restore(
    actor: AuthenticatedActor,
    rawType: string,
    id: string,
  ): Promise<{ message: string }> {
    assertAdminAction(actor, "admin:content:restore");
    const { type } = parseRequest(AdminContentParamsSchema, { type: rawType, id });
    const record = await this.requireContent(type, id);
    await this.updateDeletedAt(type, id, null);
    await this.audit.record({
      actorId: actor.user.id,
      actorType: "admin",
      action: "admin.content.restored",
      targetType: type,
      targetId: id,
      workspaceId: record.workspaceId,
      ip: actor.ip ?? undefined,
      userAgent: actor.userAgent ?? undefined,
      metadata: { contentType: type },
    });
    return { message: "Content restored." };
  }

  private async requireContent(
    type: ContentType,
    id: string,
  ): Promise<{ id: string; workspaceId: string }> {
    const select = { id: true, workspaceId: true } as const;
    const record =
      type === "trip"
        ? await this.prisma.client.trip.findUnique({ where: { id }, select })
        : type === "entry"
          ? await this.prisma.client.journalEntry.findUnique({ where: { id }, select })
          : await this.prisma.client.comment.findUnique({ where: { id }, select });

    if (!record) {
      throw new NotFoundException({
        code: "CONTENT_NOT_FOUND",
        message: "The requested content was not found.",
      });
    }
    return record;
  }

  private async updateDeletedAt(
    type: ContentType,
    id: string,
    deletedAt: Date | null,
  ): Promise<void> {
    if (type === "trip") {
      await this.prisma.client.trip.update({ where: { id }, data: { deletedAt } });
    } else if (type === "entry") {
      await this.prisma.client.journalEntry.update({ where: { id }, data: { deletedAt } });
    } else {
      await this.prisma.client.comment.update({ where: { id }, data: { deletedAt } });
    }
  }
}

function contentOrderBy(
  sort: string | undefined,
): Array<{ createdAt: "asc" | "desc" } | { updatedAt: "asc" | "desc" } | { id: "asc" }> {
  if (!sort) {
    return [{ createdAt: "desc" }, { id: "asc" }];
  }
  const [field, direction] = sort.split(":");
  if (field === "updatedAt") {
    return [{ updatedAt: direction === "asc" ? "asc" : "desc" }, { id: "asc" }];
  }
  return [{ createdAt: direction === "asc" ? "asc" : "desc" }, { id: "asc" }];
}
