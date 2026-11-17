import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AdminEmailsService } from "../admin-emails.service.js";
import { AdminJobsService } from "../admin-jobs.service.js";
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
    status: "sent",
    error: null,
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
    const service = new AdminEmailsService(prisma as never, audit as never);
    return { prisma, audit, service };
  }

  it("creates a new queued email log when resending and audits it", async () => {
    const { prisma, audit, service } = setup();
    prisma.client.emailLog.findUnique.mockResolvedValue(emailRecord());
    prisma.client.emailLog.create.mockResolvedValue(
      emailRecord({ id: "01942f30-1200-7000-8000-000000000902", status: "queued" }),
    );

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
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.email.resent",
        targetType: "email",
        metadata: expect.objectContaining({ originalEmailId: emailRecord().id }),
      }),
    );
  });

  it("returns 404 when the original email does not exist", async () => {
    const { prisma, service } = setup();
    prisma.client.emailLog.findUnique.mockResolvedValue(null);

    await expect(
      service.resend(
        makeActor(USER_ADMIN_ID, { platformRole: "support" }),
        emailRecord().id,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("AdminJobsService", () => {
  function setup() {
    const queue = {
      listJobs: vi.fn(),
      retryJob: vi.fn(),
      stats: vi.fn(),
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
      service.retry(
        makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
        "email",
        "missing",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    queue.retryJob.mockRejectedValueOnce(new ConflictException("not failed"));
    await expect(
      service.retry(
        makeActor(USER_ADMIN_ID, { platformRole: "admin" }),
        "email",
        "done",
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
