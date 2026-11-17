import { Inject, Injectable } from "@nestjs/common";
import type {
  AdminJobPage,
  AdminJobQuery,
  RetryJobResponse,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { AuditService } from "../audit/audit.service.js";
import { assertAdminAction } from "./admin-access.js";
import { uuidV7FromString } from "./admin-ids.js";
import { AdminQueueService } from "./admin-queue.service.js";

@Injectable()
export class AdminJobsService {
  constructor(
    @Inject(AdminQueueService) private readonly queue: AdminQueueService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedActor, query: AdminJobQuery): Promise<AdminJobPage> {
    assertAdminAction(actor, "admin:jobs:read");
    return this.queue.listJobs(query);
  }

  async retry(
    actor: AuthenticatedActor,
    queueName: string,
    jobId: string,
  ): Promise<RetryJobResponse> {
    assertAdminAction(actor, "admin:jobs:retry");
    const result = await this.queue.retryJob(queueName, jobId);
    await this.audit.record({
      actorId: actor.user.id,
      actorType: "admin",
      action: "admin.job.retried",
      targetType: "job",
      targetId: uuidV7FromString(`job:${queueName}:${jobId}`),
      ip: actor.ip ?? undefined,
      userAgent: actor.userAgent ?? undefined,
      metadata: { queue: queueName, jobId },
    });
    return { jobId: result.jobId, queued: true };
  }
}
