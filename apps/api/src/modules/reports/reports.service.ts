import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  CreateReportRequestSchema,
  CreateReportResponseSchema,
  REPORT_ERROR_CODES,
  type CreateReportResponse,
  type ReportReason,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { isVisibleReportTarget } from "./report-targets.js";

/** Per-user, per-hour report budget. */
export const REPORT_HOURLY_LIMIT = 10;

@Injectable()
export class ReportsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(
    actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    rawBody: unknown,
  ): Promise<CreateReportResponse> {
    const body = parseCreateReport(rawBody);

    const visible = await isVisibleReportTarget(
      this.prisma.client,
      body.targetType,
      body.targetId,
      membership.workspaceId,
      actor.user.id,
      actor.user.platformRole,
    );
    if (!visible) {
      throw new NotFoundException({
        code: REPORT_ERROR_CODES.targetNotFound,
        message: "The reported content was not found in this Workspace.",
      });
    }

    const duplicate = await this.prisma.client.report.findFirst({
      where: {
        reporterId: actor.user.id,
        targetType: body.targetType,
        targetId: body.targetId,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException({
        code: REPORT_ERROR_CODES.duplicate,
        message: "You already reported this content.",
      });
    }

    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await this.prisma.client.report.count({
      where: { reporterId: actor.user.id, createdAt: { gte: since } },
    });
    if (recent >= REPORT_HOURLY_LIMIT) {
      throw new HttpException(
        {
          code: "RATE_LIMITED",
          message: `At most ${REPORT_HOURLY_LIMIT} reports per user per hour.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const report = await this.prisma.client.report.create({
      data: {
        workspaceId: membership.workspaceId,
        targetType: body.targetType,
        targetId: body.targetId,
        reason: body.reason,
        detail: body.detail ?? null,
        reporterId: actor.user.id,
      },
      select: { id: true, status: true, createdAt: true },
    });

    return CreateReportResponseSchema.parse({
      id: report.id,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
    });
  }
}

function parseCreateReport(value: unknown): {
  targetType: ReturnType<typeof CreateReportRequestSchema.parse>["targetType"];
  targetId: string;
  reason: ReportReason;
  detail?: string;
} {
  const result = CreateReportRequestSchema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  // An unknown reason gets its own 422 code so the client can explain it;
  // every other shape error stays a generic validation failure.
  if (result.error.issues.some((issue) => issue.path[0] === "reason")) {
    throw new UnprocessableEntityException({
      code: REPORT_ERROR_CODES.reasonInvalid,
      message: "The report reason is not recognised.",
      ...(value && typeof value === "object" && "reason" in value
        ? { detail: `Unsupported reason: ${String((value as { reason: unknown }).reason)}` }
        : {}),
    });
  }

  throw new UnprocessableEntityException({
    code: "VALIDATION_ERROR",
    message: "The request did not pass validation.",
    errors: result.error.issues.map((issue) => ({
      field: issue.path.map(String).join(".") || undefined,
      code: "INVALID_INPUT",
      message: issue.message,
    })),
  });
}