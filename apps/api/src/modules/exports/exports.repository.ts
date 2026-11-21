import { Inject, Injectable } from "@nestjs/common";
import type {
  ExportFormat,
  ExportScope,
  WorkspaceRole,
} from "@roamlog/contracts";

import { PrismaService } from "../prisma/prisma.service.js";
import type { ExportRecord } from "./export-records.js";

export interface ExportCreateData {
  workspaceId: string;
  tripId: string | null;
  requestedById: string;
  scope: ExportScope;
  format: ExportFormat;
  includeComments: boolean;
  includeExpenses: boolean;
  includeMedia: boolean;
  /**
   * Bucket the worker will upload the artifact to, captured from
   * `StorageService.currentBucket()` at request time. NULL is only valid for
   * rows created before 0011_export_bucket.
   */
  bucket: string;
}

@Injectable()
export class ExportsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createExport(data: ExportCreateData): Promise<ExportRecord> {
    return (await this.prisma.client.export.create({
      data: { ...data, status: "queued" },
    })) as ExportRecord;
  }

  async findExport(exportId: string): Promise<ExportRecord | null> {
    return (await this.prisma.client.export.findUnique({
      where: { id: exportId },
    })) as ExportRecord | null;
  }

  async findTrip(tripId: string): Promise<{
    id: string;
    workspaceId: string;
    visibility: string;
    createdById: string;
    participants?: Array<{ userId: string; status: string }>;
    accessGrants?: Array<{ workspaceId: string | null; userId: string | null }>;
  } | null> {
    return this.prisma.client.trip.findFirst({
      where: { id: tripId, deletedAt: null },
      select: {
        id: true,
        workspaceId: true,
        visibility: true,
        createdById: true,
        participants: { select: { userId: true, status: true } },
        accessGrants: { select: { workspaceId: true, userId: true } },
      },
    });
  }

  async listExports(args: {
    where: Record<string, unknown>;
    orderBy: Array<Record<string, "asc" | "desc">>;
    cursor?: string;
    take: number;
  }): Promise<ExportRecord[]> {
    return (await this.prisma.client.export.findMany({
      where: args.where as never,
      orderBy: args.orderBy as never,
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    })) as ExportRecord[];
  }

  async memberships(
    userId: string,
  ): Promise<Array<{ workspaceId: string; role: WorkspaceRole }>> {
    return this.prisma.client.workspaceMember.findMany({
      where: {
        userId,
        status: "active",
        workspace: { status: "active", deletedAt: null },
      },
      select: { workspaceId: true, role: true },
      orderBy: { joinedAt: "asc" },
    });
  }

  async firstMembership(userId: string): Promise<{ workspaceId: string; role: WorkspaceRole } | null> {
    return this.prisma.client.workspaceMember.findFirst({
      where: {
        userId,
        status: "active",
        workspace: { status: "active", deletedAt: null },
      },
      select: { workspaceId: true, role: true },
      orderBy: { joinedAt: "asc" },
    });
  }

  async markExpired(exportId: string): Promise<void> {
    await this.prisma.client.export.updateMany({
      where: { id: exportId, status: { in: ["ready", "processing", "queued"] } },
      data: { status: "expired", error: "Export expired." },
    });
  }

  async markFailed(exportId: string, error: string): Promise<void> {
    await this.prisma.client.export.updateMany({
      where: { id: exportId },
      data: { status: "failed", error: error.slice(0, 1000) },
    });
  }

  async deleteExport(exportId: string): Promise<void> {
    await this.prisma.client.export.deleteMany({ where: { id: exportId } });
  }
}
