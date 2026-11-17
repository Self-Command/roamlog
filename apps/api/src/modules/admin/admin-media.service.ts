import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  AdminMediaQuerySchema,
  type AdminMediaPage,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId, toCursorPage } from "../../common/services/cursor-page.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { assertAdminAction } from "./admin-access.js";
import { presentMedia } from "./admin.presenters.js";
import { mediaSelect } from "./admin-selects.js";

const MEDIA_STATUSES = ["pending", "processing", "ready", "failed"] as const;

@Injectable()
export class AdminMediaService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
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
            : {};

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

    return toCursorPage(rows, query.limit, presentMedia) as AdminMediaPage;
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
}
