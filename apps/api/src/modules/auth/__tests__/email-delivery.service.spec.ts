import { describe, expect, it, vi } from "vitest";

import type { AppConfigService } from "../../../config/app-config.service.js";
import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import type { PrismaService } from "../../prisma/prisma.service.js";
import type { MailService } from "../../email/mail.service.js";
import { MailDeliveryError } from "../../email/mail.service.js";
import { EmailDeliveryService, trackEmailDelivery } from "../email-delivery.service.js";

function logger(): PinoLoggerService {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as PinoLoggerService;
}

function prisma() {
  return {
    client: {
      emailLog: {
        create: vi.fn().mockResolvedValue({ id: "log-1" }),
        update: vi.fn().mockResolvedValue({}),
      },
    },
  } as unknown as PrismaService;
}

function service(mail: Partial<MailService>, prismaClient: PrismaService) {
  return new EmailDeliveryService(
    { apiUrl: "http://localhost:4000" } as unknown as AppConfigService,
    prismaClient,
    logger(),
    mail as MailService,
  );
}

describe("EmailDeliveryService delivery outcome", () => {
  it("marks the EmailLog failed and surfaces NOT_CONFIGURED instead of pretending success", async () => {
    const prismaClient = prisma();
    const mailer = {
      send: vi.fn().mockRejectedValue(new MailDeliveryError("NOT_CONFIGURED", "not configured")),
    };
    const delivery = service(mailer, prismaClient);

    const error = await delivery
      .sendInvitation({
        to: "invitee@roamlog.test",
        workspaceName: "Trip",
        inviterName: "Owner",
        url: "http://localhost:3000/invite/token",
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MailDeliveryError);
    expect(prismaClient.client.emailLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { status: "failed", error: "mail_not_configured" },
    });
  });

  it("records the provider id when the transport accepted the message", async () => {
    const prismaClient = prisma();
    const mailer = {
      send: vi.fn().mockResolvedValue({ provider: "smtp", providerId: "<msg@roamlog.test>", latencyMs: 5 }),
    };
    const delivery = service(mailer, prismaClient);

    await delivery.sendVerificationEmail({ email: "new@roamlog.test", name: "New" }, "http://x/verify");

    expect(prismaClient.client.emailLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { status: "sent", providerId: "<msg@roamlog.test>" },
    });
    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "new@roamlog.test", idempotencyKey: "log-1" }),
    );
  });

  it("sends the email-change confirmation to the current address and logs the template", async () => {
    const prismaClient = prisma();
    const mailer = {
      send: vi.fn().mockResolvedValue({ provider: "smtp", providerId: "<m@roamlog.test>", latencyMs: 4 }),
    };
    const delivery = service(mailer, prismaClient);

    await delivery.sendChangeEmailConfirmation(
      { id: "user-1", email: "old@roamlog.test", name: "Old" },
      "new@roamlog.test",
      "http://x/verify?token=abc",
    );

    // Better Auth's sendChangeEmailConfirmation goes to the CURRENT address.
    expect(prismaClient.client.emailLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        to: "old@roamlog.test",
        template: "auth.change-email",
        userId: "user-1",
      }),
      select: { id: true },
    });
    const payload = mailer.send.mock.calls[0]?.[0] as { html: string; text: string };
    expect(payload.text).toContain("new@roamlog.test");
    expect(payload.html).toContain("new@roamlog.test");
    expect(payload.html).toContain("http://x/verify?token=abc");
    expect(payload.html).not.toContain("old@roamlog.test");
  });
});

describe("trackEmailDelivery", () => {
  it("reports failed when the transport rejects inside the tracked run", async () => {
    const delivery = service(
      { send: vi.fn().mockRejectedValue(new MailDeliveryError("CONNECTION_FAILED", "down")) },
      prisma(),
    );

    const { outcome } = await trackEmailDelivery(async () => {
      // better-auth swallows exactly this rejection, so the gateway must see it.
      await delivery
        .sendPasswordResetEmail({ email: "verify@roamlog.test", name: "Verify" }, "http://x/reset")
        .catch(() => undefined);
      return "handled";
    });

    expect(outcome).toBe("failed");
  });

  it("reports sent when the transport accepted the message", async () => {
    const delivery = service(
      {
        send: vi.fn().mockResolvedValue({ provider: "smtp", providerId: "<m@roamlog.test>", latencyMs: 3 }),
      },
      prisma(),
    );

    const { outcome, value } = await trackEmailDelivery(async () => {
      await delivery.sendPasswordResetEmail(
        { email: "verify@roamlog.test", name: "Verify" },
        "http://x/reset",
      );
      return "handled";
    });

    expect(value).toBe("handled");
    expect(outcome).toBe("sent");
  });

  it("reports no outcome when nothing was sent, so an unknown address cannot be probed", async () => {
    const { outcome } = await trackEmailDelivery(() => Promise.resolve("short-circuited"));

    expect(outcome).toBeUndefined();
  });
});