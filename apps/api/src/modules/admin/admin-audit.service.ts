import { Inject, Injectable } from "@nestjs/common";
import {
  AdminAuditQuerySchema,
  type AdminAuditPage,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId, toCursorPage } from "../../common/services/cursor-page.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { assertAdminAction } from "./admin-access.js";
import { presentAdminAuditLog } from "./admin.presenters.js";
import { auditSelect } from "./admin-selects.js";

@Injectable()
export class AdminAuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(actor: AuthenticatedActor, rawQuery: unknown): Promise<AdminAuditPage> {
    assertAdminAction(actor, "admin:audit:read");
    const query = parseRequest(AdminAuditQuerySchema, rawQuery);
    const cursor = cursorId(query.cursor);
    const direction = query.sort?.endsWith(":asc") ? "asc" : "desc";

    const rows = await this.prisma.client.auditLog.findMany({
      where: {
        ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
                ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: direction }, { id: "asc" }],
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: auditSelect,
    });

    return toCursorPage(rows, query.limit, presentAdminAuditLog) as AdminAuditPage;
  }
}
