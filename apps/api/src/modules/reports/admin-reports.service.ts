import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AdminIdParamsSchema,
  AdminReportDetailSchema,
  AdminReportQuerySchema,
  REPORT_ERROR_CODES,
  ResolveReportRequestSchema,
  ResolveReportResponseSchema,
  encodeCursor,
  type AdminAction,
  type AdminReportDetail,
  type AdminReportPage,
  type ModerationAction,
  type ModerationActionKind,
  type ReportTargetType,
  type ResolveReportResponse,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId } from "../../common/services/cursor-page.js";
import { assertAdminAction } from "../admin/admin-access.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import {
  applyModerationToTarget,
  buildAdminReportItems,
  type ReportRow,
} from "./report-targets.js";

const reportSelect = {
  id: true,
  workspaceId: true,
  targetType: true,
  targetId: true,
  reason: true,
  detail: true,
  reporterId: true,
  status: true,
  resolvedById: true,
  resolvedAt: true,
  resolutionNote: true,
  createdAt: true,
} as const;

const actionSelect = {
  id: true,
  reportId: true,
  actorId: true,
  action: true,
  note: true,
  createdAt: true,
} as const;

const CLOSED_STATUSES = new Set(["resolved", "dismissed"]);

@Injectable()
export class AdminReportsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedActor, rawQuery: unknown): Promise<AdminReportPage> {
    assertAdminAction(actor, "admin:content:read");
    const query = parseRequest(AdminReportQuerySchema, rawQuery);
    const where = await this.where(query);
    const direction = query.sort?.endsWith(":asc") ? "asc" : "desc";
    const cursor = cursorId(query.cursor);

    const rows = (await this.prisma.client.report.findMany({
      where,
      orderBy: [{ createdAt: direction }, { id: "asc" }],
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: reportSelect,
    })) as ReportRow[];

    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    const items = await buildAdminReportItems(this.prisma.client, visible);
    const last = visible.at(-1);

    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeCursor({ id: last.id, createdAt: last.createdAt })
          : null,
      hasMore,
    };
  }

  async detail(actor: AuthenticatedActor, rawId: string): Promise<AdminReportDetail> {
    assertAdminAction(actor, "admin:content:read");
    const { id } = parseRequest(AdminIdParamsSchema, { id: rawId });
    const report = (await this.prisma.client.report.findUnique({
      where: { id },
      select: reportSelect,
    })) as ReportRow | null;
    if (!report) {
      throw new NotFoundException({
        code: "REPORT_NOT_FOUND",
        message: "The requested report was not found.",
      });
    }

    const [reports, actions] = await Promise.all([
      this.prisma.client.report.findMany({
        where: { targetType: report.targetType, targetId: report.targetId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: reportSelect,
      }),
      this.prisma.client.moderationAction.findMany({
        where: { reportId: id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: actionSelect,
      }),
    ]);

    const items = await buildAdminReportItems(this.prisma.client, reports as ReportRow[]);
    const current = items.find((item) => item.id === id);
    if (!current) {
      // Defensive: the report was read a moment ago, so this cannot normally
      // happen, but a deleted row must not crash the detail route.
      throw new NotFoundException({
        code: "REPORT_NOT_FOUND",
        message: "The requested report was not found.",
      });
    }

    return AdminReportDetailSchema.parse({
      report: current,
      reports: items,
      actions: actions.map(presentAction),
    });
  }

  async resolve(
    actor: AuthenticatedActor,
    rawId: string,
    rawBody: unknown,
  ): Promise<ResolveReportResponse> {
    const { id } = parseRequest(AdminIdParamsSchema, { id: rawId });
    const body = parseRequest(ResolveReportRequestSchema, rawBody);
    assertAdminAction(actor, resolveAction(body.action));

    const report = (await this.prisma.client.report.findUnique({
      where: { id },
      select: reportSelect,
    })) as ReportRow | null;
    if (!report) {
      throw new NotFoundException({
        code: "REPORT_NOT_FOUND",
        message: "The requested report was not found.",
      });
    }
    if (CLOSED_STATUSES.has(report.status)) {
      throw new ConflictException({
        code: REPORT_ERROR_CODES.alreadyResolved,
        message: "This report has already been resolved.",
      });
    }

    const now = new Date();
    const nextStatus = body.action === "dismiss" ? "dismissed" : "resolved";
    const targetType = report.targetType as ReportTargetType;

    const outcome = await this.prisma.client.$transaction(async (tx) => {
      if (body.action === "remove" || body.action === "restore") {
        await applyModerationToTarget(
          tx as unknown as PrismaService["client"],
          targetType,
          report.targetId,
          actor.user.id,
          body.action,
        );
      }

      const action = await tx.moderationAction.create({
        data: {
          reportId: id,
          actorId: actor.user.id,
          action: body.action,
          note: body.note ?? null,
        },
        select: actionSelect,
      });

      const updated = (await tx.report.update({
        where: { id },
        data: {
          status: nextStatus,
          resolvedById: actor.user.id,
          resolvedAt: now,
          resolutionNote: body.note ?? null,
        },
        select: reportSelect,
      })) as ReportRow;

      // Audit metadata deliberately excludes the reported content: the log is
      // queryable by many operators, while the content may be sensitive.
      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "admin",
          action: "admin.report.resolved",
          targetType: "report",
          targetId: id,
          workspaceId: report.workspaceId,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
          metadata: {
            reportId: id,
            action: body.action,
            targetType: report.targetType,
          },
        },
        tx,
      );

      return { report: updated, action };
    });

    const items = await buildAdminReportItems(this.prisma.client, [outcome.report]);
    const item = items[0];
    if (!item) {
      throw new NotFoundException({
        code: "REPORT_NOT_FOUND",
        message: "The requested report was not found.",
      });
    }

    return ResolveReportResponseSchema.parse({
      report: item,
      action: presentAction(outcome.action),
    });
  }

  /**
   * The queue filter. `q` is a real content search: it resolves matching
   * workspaces and matching target titles / comment bodies, then filters the
   * report rows by those ids. `detail` free text stays searchable too.
   */
  private async where(query: {
    status?: string;
    targetType?: ReportTargetType;
    reason?: string;
    workspaceId?: string;
    from?: string;
    to?: string;
    q?: string;
  }): Promise<Record<string, unknown>> {
    const where: Record<string, unknown> = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
      ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };

    const q = query.q?.trim();
    if (q) {
      const contains = { contains: q, mode: "insensitive" as const };
      const [workspaces, trips, entries, comments, media] = await Promise.all([
        this.prisma.client.workspace.findMany({
          where: { name: contains },
          select: { id: true },
          take: 50,
        }),
        this.prisma.client.trip.findMany({
          where: { title: contains },
          select: { id: true },
          take: 50,
        }),
        this.prisma.client.journalEntry.findMany({
          where: { title: contains },
          select: { id: true },
          take: 50,
        }),
        this.prisma.client.comment.findMany({
          where: { body: contains },
          select: { id: true },
          take: 50,
        }),
        this.prisma.client.media.findMany({
          where: { OR: [{ caption: contains }, { key: contains }] },
          select: { id: true },
          take: 50,
        }),
      ]);

      where.OR = [
        { detail: contains },
        ...(workspaces.length === 0
          ? []
          : [{ workspaceId: { in: workspaces.map((row) => row.id) } }]),
      ];
      const targetIds = [
        ...trips.map((row) => row.id),
        ...entries.map((row) => row.id),
        ...comments.map((row) => row.id),
        ...media.map((row) => row.id),
      ];
      if (targetIds.length > 0) {
        where.OR = [...(where.OR as unknown[]), { targetId: { in: targetIds } }];
      }
    }

    return where;
  }
}

function resolveAction(action: ModerationActionKind): AdminAction {
  // The admin action set predates moderation and has no separate write verb.
  // Takedown / warn / dismiss all mutate content, so they use the existing
  // `admin:content:delete` capability; restore uses `admin:content:restore`.
  if (action === "restore") {
    return "admin:content:restore";
  }
  return "admin:content:delete";
}

function presentAction(action: {
  id: string;
  reportId: string;
  actorId: string;
  action: string;
  note: string | null;
  createdAt: Date;
}): ModerationAction {
  return {
    id: action.id,
    reportId: action.reportId,
    actorId: action.actorId,
    action: action.action as ModerationActionKind,
    note: action.note,
    createdAt: action.createdAt.toISOString(),
  };
}