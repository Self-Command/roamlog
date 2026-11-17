import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  AuditLogSchema,
  WorkspaceAuditQuerySchema,
  type AuditLog,
  type WorkspaceAuditPage,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId, toCursorPage } from "../../common/services/cursor-page.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { WorkspaceAccessService } from "../../common/services/workspace-access.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

export type AuditActorType = "user" | "admin" | "system";
export type AuditMetadataValue = string | number | boolean | null | string[];

export interface AuditRecordInput {
  actorId?: string;
  actorType: AuditActorType;
  action: string;
  targetType: string;
  targetId: string;
  workspaceId?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, AuditMetadataValue>;
}

type AuditClient = Pick<PrismaService["client"], "auditLog">;

@Injectable()
export class AuditService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Inject(PermissionService)
    private readonly permissions: PermissionService = new PermissionService(),
  ) {}

  async record(input: AuditRecordInput, client?: AuditClient): Promise<{ id: string }> {
    if (!input.action.trim() || !input.targetType.trim() || !input.targetId.trim()) {
      throw new BadRequestException("Audit action, targetType, and targetId are required");
    }

    const writer = client ?? this.prisma.client;
    const record = await writer.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        actorType: input.actorType,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        workspaceId: input.workspaceId ?? null,
        ip: input.ip?.slice(0, 128) ?? null,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
        metadata: input.metadata ?? {},
      },
      select: {
        id: true,
      },
    });

    return record;
  }

  async listWorkspace(
    actor: AuthenticatedActor,
    workspaceId: string,
    rawQuery: unknown,
  ): Promise<WorkspaceAuditPage> {
    const membership = await this.access.requireMembership(actor.user.id, workspaceId);
    this.permissions.assertCan(membership.role, "workspace:view-audit", "audit");
    const query = parseRequest(WorkspaceAuditQuerySchema, rawQuery);
    const cursor = cursorId(query.cursor);
    const direction = query.sort?.endsWith(":asc") ? "asc" : "desc";

    const records = await this.prisma.client.auditLog.findMany({
      where: {
        workspaceId,
        ...(query.action ? { action: query.action } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
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
    });

    return toCursorPage(records, query.limit, presentAuditLog) as WorkspaceAuditPage;
  }
}

function iso(value: Date): string {
  return value.toISOString();
}

function presentAuditLog(record: {
  id: string;
  actorId: string | null;
  actorType: string;
  action: string;
  targetType: string;
  targetId: string;
  workspaceId: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: Date;
}): AuditLog {
  return AuditLogSchema.parse({
    id: record.id,
    actorId: record.actorId,
    actorType: record.actorType,
    action: record.action,
    targetType: record.targetType,
    targetId: record.targetId,
    workspaceId: record.workspaceId,
    ip: record.ip,
    userAgent: record.userAgent,
    metadata:
      typeof record.metadata === "object" &&
      record.metadata !== null &&
      !Array.isArray(record.metadata)
        ? record.metadata
        : {},
    createdAt: iso(record.createdAt),
  });
}
