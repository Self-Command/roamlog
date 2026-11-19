import { describe, expect, it, vi } from "vitest";

import type { AppConfigService } from "../../../config/app-config.service.js";
import type { PinoLoggerService } from "../../observability/pino-logger.service.js";
import type { PrismaService } from "../../prisma/prisma.service.js";
import type { MailService } from "../../email/mail.service.js";
import { MailDeliveryError } from "../../email/mail.service.js";
import { EmailDeliveryService } from "../email-delivery.service.js";

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
});