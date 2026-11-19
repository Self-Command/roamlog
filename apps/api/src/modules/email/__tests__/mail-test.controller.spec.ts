import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";

import type { AuthenticatedActor } from "../../../common/guards/actor-context.js";
import type { AuditService } from "../../audit/audit.service.js";
import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import type { MailRuntime } from "../../settings/mail-settings.consumer.js";
import { MailDeliveryError, type MailSendResult, MailService } from "../mail.service.js";
import { MailTestController } from "../mail-test.controller.js";

type Fn = ReturnType<typeof vi.fn>;

interface FakeLogger {
  log: Fn;
  warn: Fn;
  error: Fn;
  debug: Fn;
}

function logger(): FakeLogger & PinoLoggerService {
  const fake = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return fake as unknown as FakeLogger & PinoLoggerService;
}

function actor() {
  return {
    user: { id: "01942f30-1200-7000-8000-000000000001", platformRole: "super_admin" },
    ip: "127.0.0.1",
    userAgent: "vitest",
  } as unknown as AuthenticatedActor;
}

function expressResponse() {
  const res = {
    statusCode: 200,
    status: vi.fn(),
    json: vi.fn(),
    end: vi.fn(),
    setHeader: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response & { status: ReturnType<typeof vi.fn> };
}

function mailService(runtime: MailRuntime, send: () => Promise<MailSendResult>) {
  return {
    resolveRuntime: vi.fn().mockResolvedValue(runtime),
    send: vi.fn().mockImplementation(send),
  } as unknown as MailService;
}

interface FakeAudit {
  record: Fn;
}

function auditService(): FakeAudit & AuditService {
  const fake = { record: vi.fn().mockResolvedValue({ id: "audit-1" }) };
  return fake as unknown as FakeAudit & AuditService;
}

const CONFIGURED_SMTP: MailRuntime = {
  configured: true,
  provider: "smtp",
  host: "127.0.0.1",
  port: 1025,
  secure: false,
  from: "Roamlog <verify@roamlog.test>",
  source: "db",
};

describe("MailTestController", () => {
  it("returns 200 only after the transport accepted a real send", async () => {
    const audit = auditService();
    const mail = mailService(CONFIGURED_SMTP, async () => ({
      provider: "smtp",
      providerId: "<id>",
      latencyMs: 12,
    }));
    const controller = new MailTestController(mail, audit, logger());

    const result = await controller.test(actor(), { to: "verify@roamlog.test" }, expressResponse());

    expect(result).toEqual({ ok: true, provider: "smtp", latencyMs: 12 });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.mail.probe",
        metadata: { ok: true, provider: "smtp" },
      }),
    );
  });

  it("returns 422 NOT_CONFIGURED when the runtime has no usable transport", async () => {
    const audit = auditService();
    const mail = mailService(
      { configured: false, provider: "smtp", missing: ["mail.smtpHost"], source: "default" },
      async () => {
        throw new MailDeliveryError("NOT_CONFIGURED", "Mail delivery is not configured.");
      },
    );
    const controller = new MailTestController(mail, audit, logger());
    const response = expressResponse();

    const result = await controller.test(actor(), { to: "verify@roamlog.test" }, response);

    expect(response.status).toHaveBeenCalledWith(422);
    expect(result).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
  });

  it("returns 422 AUTH_FAILED with an actionable hint", async () => {
    const audit = auditService();
    const mail = mailService(CONFIGURED_SMTP, async () => {
      throw new MailDeliveryError(
        "AUTH_FAILED",
        "SMTP authentication was rejected. Check the SMTP username and app password.",
        { provider: "smtp", retryable: false },
      );
    });
    const controller = new MailTestController(mail, audit, logger());
    const response = expressResponse();

    const result = await controller.test(actor(), { to: "verify@roamlog.test" }, response);

    expect(response.status).toHaveBeenCalledWith(422);
    expect(result).toMatchObject({ ok: false, code: "AUTH_FAILED" });
    expect((result as { message: string }).message).toContain("app password");
  });

  it("returns 422 CONNECTION_FAILED for an unreachable relay", async () => {
    const audit = auditService();
    const mail = mailService(CONFIGURED_SMTP, async () => {
      throw new MailDeliveryError("CONNECTION_FAILED", "Could not reach the mail relay.", {
        provider: "smtp",
        retryable: true,
      });
    });
    const controller = new MailTestController(mail, audit, logger());
    const response = expressResponse();

    const result = await controller.test(actor(), { to: "verify@roamlog.test" }, response);

    expect(response.status).toHaveBeenCalledWith(422);
    expect(result).toMatchObject({ ok: false, code: "CONNECTION_FAILED" });
  });

  it("never puts the recipient or a credential into the audit metadata or the logs", async () => {
    const audit = auditService();
    const log = logger();
    const password = "smtp-sentinel-password";
    const mail = mailService(
      { ...CONFIGURED_SMTP, user: "roamlog", password },
      async () => {
        throw new MailDeliveryError("REJECTED", "The mail relay rejected the message.", {
          provider: "smtp",
          retryable: false,
        });
      },
    );
    const controller = new MailTestController(mail, audit, log);

    await controller.test(actor(), { to: "private.person@roamlog.test" }, expressResponse());

    const auditPayload = JSON.stringify(audit.record.mock.calls);
    const logs = JSON.stringify([...log.log.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls]);
    for (const payload of [auditPayload, logs]) {
      expect(payload).not.toContain("private.person@roamlog.test");
      expect(payload).not.toContain(password);
    }
  });

  it("rejects a malformed recipient with 422 INVALID_REQUEST", async () => {
    const audit = auditService();
    const mail = mailService(CONFIGURED_SMTP, async () => {
      throw new Error("should not send");
    });
    const controller = new MailTestController(mail, audit, logger());
    const response = expressResponse();

    const result = await controller.test(actor(), { to: "not-an-email" }, response);

    expect(response.status).toHaveBeenCalledWith(422);
    expect(result).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
    expect(mail.send).not.toHaveBeenCalled();
  });
});