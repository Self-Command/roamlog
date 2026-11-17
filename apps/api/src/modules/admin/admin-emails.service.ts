import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  AdminEmailQuerySchema,
  type AdminEmailPage,
  type EmailLog,
  type ResendEmailResponse,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId, toCursorPage } from "../../common/services/cursor-page.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { AuditService } from "../audit/audit.service.js";
import { JobQueueService, deterministicJobId } from "../exports/job-queue.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { assertAdminAction } from "./admin-access.js";
import { presentEmailLog } from "./admin.presenters.js";
import { emailSelect } from "./admin-selects.js";

@Injectable()
export class AdminEmailsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(JobQueueService) private readonly queue: JobQueueService,
  ) {}

  async list(actor: AuthenticatedActor, rawQuery: unknown): Promise<AdminEmailPage> {
    assertAdminAction(actor, "admin:emails:read");
    const query = parseRequest(AdminEmailQuerySchema, rawQuery);
    const cursor = cursorId(query.cursor);

    const rows = await this.prisma.client.emailLog.findMany({
      where: {
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.template ? { template: query.template } : {}),
        ...(query.to ? { to: query.to } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: emailSelect,
    });

    return toCursorPage(rows, query.limit, presentEmailLog) as AdminEmailPage;
  }

  async resend(actor: AuthenticatedActor, id: string): Promise<ResendEmailResponse> {
    assertAdminAction(actor, "admin:emails:resend");
    const original = await this.prisma.client.emailLog.findUnique({
      where: { id },
      select: emailSelect,
    });
    if (!original) {
      throw new NotFoundException({
        code: "EMAIL_NOT_FOUND",
        message: "The email log was not found.",
      });
    }

    const created = await this.prisma.client.emailLog.create({
      data: {
        userId: original.userId,
        to: original.to,
        template: original.template,
        subject: original.subject,
        status: "queued",
      },
      select: emailSelect,
    });
    let queuedJobId: string;
    try {
      const queued = await this.queue.enqueue({
        queue: "email",
        name: "email.send",
        jobId: deterministicJobId("email-resend", created.id),
        data: {
          emailLogId: created.id,
          to: created.to,
          template: created.template,
          subject: created.subject,
        },
      });
      queuedJobId = queued.jobId;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The resend job could not be enqueued.";
      await this.prisma.client.emailLog.update({
        where: { id: created.id },
        data: { status: "failed", error: message.slice(0, 1000) },
      });
      throw error;
    }
    await this.audit.record({
      actorId: actor.user.id,
      actorType: "admin",
      action: "admin.email.resent",
      targetType: "email",
      targetId: created.id,
      ip: actor.ip ?? undefined,
      userAgent: actor.userAgent ?? undefined,
      metadata: {
        originalEmailId: original.id,
        template: original.template,
        to: original.to,
        queuedJobId,
      },
    });

    return presentEmailLog(created) as EmailLog;
  }
}
