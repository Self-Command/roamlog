import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { AdminMetricsSchema, type AdminMetrics, type ExportStatus } from "@roamlog/contracts";

import { PrismaService } from "../prisma/prisma.service.js";
import { AdminQueueService } from "./admin-queue.service.js";

const EXPORT_STATUSES: readonly ExportStatus[] = [
  "queued",
  "processing",
  "ready",
  "failed",
  "expired",
];

export interface AdminMetricsResult {
  metrics: AdminMetrics;
  degraded: string[];
}

function since24h(): Date {
  return new Date(Date.now() - 24 * 60 * 60 * 1_000);
}

@Injectable()
export class AdminMetricsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminQueueService) private readonly queue: AdminQueueService,
  ) {}

  async get(): Promise<AdminMetricsResult> {
    const degraded: string[] = [];
    let database: {
      users: { total: number; active: number; suspended: number; new24h: number };
      workspaces: { total: number; active: number; suspended: number; new24h: number };
      trips: number;
      entries: number;
      comments: number;
      media: { count: number; bytes: number };
      exports: Record<string, number>;
    };

    try {
      const cutoff = since24h();
      const [
        usersTotal,
        usersActive,
        usersSuspended,
        usersNew,
        workspacesTotal,
        workspacesActive,
        workspacesSuspended,
        workspacesNew,
        trips,
        entries,
        comments,
        mediaCount,
        mediaBytes,
        exportGroups,
      ] = await Promise.all([
        this.prisma.client.user.count({ where: { deletedAt: null } }),
        this.prisma.client.user.count({ where: { status: "active", deletedAt: null } }),
        this.prisma.client.user.count({ where: { status: "suspended", deletedAt: null } }),
        this.prisma.client.user.count({ where: { createdAt: { gte: cutoff }, deletedAt: null } }),
        this.prisma.client.workspace.count({ where: { deletedAt: null } }),
        this.prisma.client.workspace.count({ where: { status: "active", deletedAt: null } }),
        this.prisma.client.workspace.count({ where: { status: "suspended", deletedAt: null } }),
        this.prisma.client.workspace.count({
          where: { createdAt: { gte: cutoff }, deletedAt: null },
        }),
        this.prisma.client.trip.count({ where: { deletedAt: null } }),
        this.prisma.client.journalEntry.count({ where: { deletedAt: null } }),
        this.prisma.client.comment.count({ where: { deletedAt: null } }),
        this.prisma.client.media.count({ where: { deletedAt: null } }),
        this.prisma.client.media.aggregate({ where: { deletedAt: null }, _sum: { size: true } }),
        this.prisma.client.export.groupBy({ by: ["status"], _count: { _all: true } }),
      ]);

      const exports: Record<string, number> = Object.fromEntries(
        EXPORT_STATUSES.map((status) => [status, 0]),
      );
      for (const group of exportGroups) {
        exports[group.status] = group._count._all;
      }

      database = {
        users: {
          total: usersTotal,
          active: usersActive,
          suspended: usersSuspended,
          new24h: usersNew,
        },
        workspaces: {
          total: workspacesTotal,
          active: workspacesActive,
          suspended: workspacesSuspended,
          new24h: workspacesNew,
        },
        trips,
        entries,
        comments,
        media: { count: mediaCount, bytes: mediaBytes._sum.size ?? 0 },
        exports,
      };
    } catch {
      throw new ServiceUnavailableException({
        code: "METRICS_UNAVAILABLE",
        message: "Platform metrics cannot be calculated while the database is unavailable.",
        dependencies: ["database"],
      });
    }

    let queues: AdminMetrics["queues"] = [];
    try {
      queues = (await this.queue.stats()).map((item) => ({
        name: item.name,
        waiting: item.waiting,
        active: item.active,
        failed: item.failed,
        completed: item.completed,
      }));
    } catch {
      degraded.push("queues");
    }

    const metrics = AdminMetricsSchema.parse({
      ...database,
      queues,
      generatedAt: new Date().toISOString(),
    });

    return { metrics, degraded };
  }
}
