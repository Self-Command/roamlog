import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AdminEmailsService } from "../admin-emails.service.js";
import { AdminJobsService } from "../admin-jobs.service.js";
import { deterministicJobId } from "../../exports/job-queue.service.js";
import {
  NOW,
  USER_ADMIN_ID,
  USER_VIEWER_ID,
  makeActor,
} from "../../../../test/identity-fixtures.js";

function emailRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "01942f30-1200-7000-8000-000000000901",
    userId: USER_VIEWER_ID,
    to: "viewer@roamlog.test",
    template: "auth.verify-email",
    subject: "Verify your email",
    providerId: "provider-1",
    // Only failed/bounced messages are resendable, so the default record models
    // a failed delivery.
    status: "failed",
    error: "smtp timeout",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("AdminEmailsService", () => {
  function setup() {
    const prisma = {
      client: {
        emailLog: {
          findMany: vi.fn(),
          findUnique: vi.fn(),
          create: vi.fn(),
        },
      },
    };
    const audit = { record: vi.fn().mockResolvedValue({ id: "audit" }) };
    const queue = { enqueue: vi.fn().mockResolvedValue({ jobId: "email-job" }) };
    const service = new AdminEmailsService(prisma as never, audit as never, queue as never);
    return { prisma, audit, queue, service };
  }

  it("creates a new queued email log, enqueues it, and audits it", async () => {
    const { prisma, audit, queue, service } = setup();
    prisma.client.emailLog.findUnique.mockResolvedValue(emailRecord());
    const created = emailRecord({
      id: "01942f30-1200-7000-8000-000000000902",
      status: "queued",
    });
    prisma.client.emailLog.create.mockResolvedValue(created);
    queue.enqueue.mockResolvedValue({ jobId: deterministicJobId("email-resend", created.id) });

    const result = await service.resend(
      makeActor(USER_ADMIN_ID, { platformRole: "support" }),
      emailRecord().id,
    );

    expect(result.status).toBe("queued");
    expect(prisma.client.emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          to: "viewer@roamlog.test",
          template: "auth.verify-email",
          status: "queued",
        }),
      }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith({
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
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.email.resent",
        targetType: "email",
        metadata: expect.objectContaining({
          originalEmailId: emailRecord().id,
          queuedJobId: deterministicJobId("email-resend", created.id),
        }),
      }),
    );
  });

  it("returns 404 when the original email does not exist", async () => {
    const { prisma, service } = setup();
    prisma.client.emailLog.findUnique.mockResolvedValue(null);

    await expect(
      service.resend(makeActor(USER_ADMIN_ID, { platformRole: "support" }), emailRecord().id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("refuses to resend an email that is not failed or bounced", async () => {
    const { prisma, queue, service } = setup();
    prisma.client.emailLog.findUnique.mockResolvedValue(emailRecord({ status: "sent" }));

    await expect(
      service.resend(makeActor(USER_ADMIN_ID, { platformRole: "support" }), emailRecord().id),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.client.emailLog.create).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("allows retrying a bounced email", async () => {
    const { prisma, service } = setup();
    prisma.client.emailLog.findUnique.mockResolvedValue(
      emailRecord({ status: "bounced", error: "mailbox unavailable" }),
    );
    prisma.client.emailLog.create.mockResolvedValue(emailRecord({ status: "queued" }));

    const result = await service.resend(
      makeActor(USER_ADMIN_ID, { platformRole: "support" }),
      emailRecord().id,
    );

    expect(result.status).toBe("queued");
  });
});

describe("AdminJobsService", () => {
  function setup() {
    const queue = {
      listJobs: vi.fn(),
      retryJob: vi.fn(),
      stats: vi.fn(),
      pauseQueue: vi.fn(),
      resumeQueue: vi.fn(),
      clearFailed: vi.fn(),
    };
    const audit = { record: vi.fn().mockResolvedValue({ id: "audit" }) };
    const service = new AdminJobsService(queue as never, audit as never);
    return { queue, audit, service };
  }

  it("retries a failed job and writes an audit entry", async () => {
    const { queue, audit, service } = setup();
    queue.retryJob.mockResolvedValue({ queue: "email", jobId: "abc123", queued: true });

    const result = await service.retry(
      makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
      "email",
      "abc123",
    );

    expect(result).toEqual({ jobId: "abc123", queued: true });
    expect(queue.retryJob).toHaveBeenCalledWith("email", "abc123");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.job.retried",
        targetType: "job",
        metadata: expect.objectContaining({ queue: "email", jobId: "abc123" }),
      }),
    );
  });

  it("propagates a not-found or conflict from the queue adapter", async () => {
    const { queue, service } = setup();
    queue.retryJob.mockRejectedValueOnce(new NotFoundException("missing"));
    await expect(
      service.retry(makeActor(USER_ADMIN_ID, { platformRole: "admin" }), "email", "missing"),
    ).rejects.toBeInstanceOf(NotFoundException);

    queue.retryJob.mockRejectedValueOnce(new ConflictException("not failed"));
    await expect(
      service.retry(makeActor(USER_ADMIN_ID, { platformRole: "admin" }), "email", "done"),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("allows super_admin queue lifecycle operations and audits each one", async () => {
    const { queue, audit, service } = setup();
    queue.pauseQueue.mockResolvedValue(undefined);
    queue.resumeQueue.mockResolvedValue(undefined);
    queue.clearFailed.mockResolvedValue(3);
    const actor = makeActor(USER_ADMIN_ID, { platformRole: "super_admin" });

    await expect(service.pause(actor, "email")).resolves.toEqual({
      queue: "email",
      paused: true,
    });
    await expect(service.resume(actor, "email")).resolves.toEqual({
      queue: "email",
      paused: false,
    });
    await expect(service.clear(actor, "email")).resolves.toEqual({
      queue: "email",
      cleared: true,
      removedJobs: 3,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.queue.paused", targetType: "queue" }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.queue.resumed", targetType: "queue" }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.queue.cleared",
        targetType: "queue",
        metadata: expect.objectContaining({ removedJobs: 3 }),
      }),
    );
  });

  it.each(["admin", "support", "analyst"] as const)(
    "rejects %s platform roles from queue lifecycle operations",
    async (platformRole) => {
      const { queue, service } = setup();
      const actor = makeActor(USER_ADMIN_ID, { platformRole });

      await expect(service.pause(actor, "email")).rejects.toMatchObject({
        response: { code: "ADMIN_ACTION_FORBIDDEN" },
      });
      await expect(service.resume(actor, "email")).rejects.toMatchObject({
        response: { code: "ADMIN_ACTION_FORBIDDEN" },
      });
      await expect(service.clear(actor, "email")).rejects.toMatchObject({
        response: { code: "ADMIN_ACTION_FORBIDDEN" },
      });
      expect(queue.pauseQueue).not.toHaveBeenCalled();
      expect(queue.resumeQueue).not.toHaveBeenCalled();
      expect(queue.clearFailed).not.toHaveBeenCalled();
    },
  );
});
