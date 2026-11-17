import { Inject, Injectable } from "@nestjs/common";
import {
  AdminAuditExportQuerySchema,
  AdminAuditQuerySchema,
  type AdminAuditExportQuery,
  type AdminAuditPage,
  type AdminAuditQuery,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId, toCursorPage } from "../../common/services/cursor-page.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { assertAdminAction } from "./admin-access.js";
import { presentAdminAuditLog } from "./admin.presenters.js";
import { auditSelect } from "./admin-selects.js";

const CSV_MAX_ROWS = 50_000;
const CSV_COLUMNS = [
  "id",
  "createdAt",
  "actorType",
  "actorId",
  "action",
  "targetType",
  "targetId",
  "workspaceId",
  "ip",
  "userAgent",
  "metadata",
] as const;

function csvValue(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

@Injectable()
export class AdminAuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(actor: AuthenticatedActor, rawQuery: unknown): Promise<AdminAuditPage> {
    assertAdminAction(actor, "admin:audit:read");
    const query = parseRequest(AdminAuditQuerySchema, rawQuery);
    const cursor = cursorId(query.cursor);
    const direction = query.sort?.endsWith(":asc") ? "asc" : "desc";

    const rows = await this.prisma.client.auditLog.findMany({
      where: this.where(query),
      orderBy: [{ createdAt: direction }, { id: "asc" }],
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: auditSelect,
    });

    return toCursorPage(rows, query.limit, presentAdminAuditLog) as AdminAuditPage;
  }

  async exportCsv(actor: AuthenticatedActor, rawQuery: unknown): Promise<string> {
    assertAdminAction(actor, "admin:audit:export");
    const query = parseRequest(AdminAuditExportQuerySchema, rawQuery);
    const direction = query.sort?.endsWith(":asc") ? "asc" : "desc";
    const rows = await this.prisma.client.auditLog.findMany({
      where: this.where(query),
      orderBy: [{ createdAt: direction }, { id: "asc" }],
      take: CSV_MAX_ROWS,
      select: auditSelect,
    });
    const lines = [
      CSV_COLUMNS.join(","),
      ...rows.map((row) => {
        const record = presentAdminAuditLog(row);
        return CSV_COLUMNS.map((column) => csvValue(record[column])).join(",");
      }),
    ];
    return `\uFEFF${lines.join("\r\n")}\r\n`;
  }

  private where(query: AdminAuditQuery | AdminAuditExportQuery): Record<string, unknown> {
    return {
      ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.actorType ? { actorType: query.actorType } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.ip ? { ip: { contains: query.ip } } : {}),
      ...(query.q
        ? {
            OR: [
              { action: { contains: query.q } },
              { targetType: { contains: query.q } },
              { actorId: { contains: query.q } },
              { targetId: { contains: query.q } },
            ],
          }
        : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };
  }
}
