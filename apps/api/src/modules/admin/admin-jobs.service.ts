import { Inject, Injectable } from "@nestjs/common";
import type {
  ClearAdminQueueResponse,
  AdminJobPage,
  AdminJobQuery,
  PauseAdminQueueResponse,
  ResumeAdminQueueResponse,
  RetryJobResponse,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { AuditService } from "../audit/audit.service.js";
import type { AuditMetadataValue } from "../audit/audit.service.js";
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

  async pause(actor: AuthenticatedActor, queueName: string): Promise<PauseAdminQueueResponse> {
    assertAdminAction(actor, "admin:jobs:manage");
    await this.queue.pauseQueue(queueName);
    await this.recordQueueAction(actor, queueName, "admin.queue.paused", {
      queue: queueName,
      paused: true,
    });
    return { queue: queueName, paused: true };
  }

  async resume(actor: AuthenticatedActor, queueName: string): Promise<ResumeAdminQueueResponse> {
    assertAdminAction(actor, "admin:jobs:manage");
    await this.queue.resumeQueue(queueName);
    await this.recordQueueAction(actor, queueName, "admin.queue.resumed", {
      queue: queueName,
      paused: false,
    });
    return { queue: queueName, paused: false };
  }

  async clear(actor: AuthenticatedActor, queueName: string): Promise<ClearAdminQueueResponse> {
    assertAdminAction(actor, "admin:jobs:manage");
    const removedJobs = await this.queue.clearFailed(queueName);
    await this.recordQueueAction(actor, queueName, "admin.queue.cleared", {
      queue: queueName,
      removedJobs,
    });
    return { queue: queueName, cleared: true, removedJobs };
  }

  private async recordQueueAction(
    actor: AuthenticatedActor,
    queueName: string,
    action: string,
    metadata: Record<string, AuditMetadataValue>,
  ): Promise<void> {
    await this.audit.record({
      actorId: actor.user.id,
      actorType: "admin",
      action,
      targetType: "queue",
      targetId: uuidV7FromString(`queue:${queueName}`),
      ip: actor.ip ?? undefined,
      userAgent: actor.userAgent ?? undefined,
      metadata,
    });
  }
}
