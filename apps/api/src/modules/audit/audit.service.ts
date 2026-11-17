import { BadRequestException, Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";

export type AuditActorType = "user" | "admin" | "system";
export type AuditMetadataValue = string | number | boolean | null;

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

@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput): Promise<{ id: string }> {
    if (!input.action.trim() || !input.targetType.trim() || !input.targetId.trim()) {
      throw new BadRequestException("Audit action, targetType, and targetId are required");
    }

    const record = await this.prisma.client.auditLog.create({
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
}
