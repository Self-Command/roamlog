import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { AppConfigService } from "../src/config/app-config.service.js";
import { EmailDeliveryService } from "../src/modules/auth/email-delivery.service.js";
import type { PinoLoggerService } from "../src/modules/observability/pino-logger.service.js";
import type { PrismaService } from "../src/modules/prisma/prisma.service.js";

const enabled = process.env.ROAMLOG_STAGING_SERVICES === "1";
const mailpitUrl = (
  process.env.ROAMLOG_STAGING_MAILPIT_URL ??
  process.env.MAILPIT_URL ??
  "http://127.0.0.1:8025"
).replace(/\/+$/, "");

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: Array<{ Address: string; Name?: string }>;
}

interface MailpitMessages {
  messages?: MailpitMessage[];
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForMessage(recipient: string, subject: string): Promise<MailpitMessage> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${mailpitUrl}/api/v1/messages`);
    if (!response.ok) {
      throw new Error(`Mailpit message list failed with HTTP ${response.status}`);
    }
    const payload = (await response.json()) as MailpitMessages;
    const match = payload.messages?.find(
      (message) =>
        message.Subject === subject && message.To.some((address) => address.Address === recipient),
    );
    if (match) {
      return match;
    }
    await sleep(200);
  }
  throw new Error(`Mailpit did not receive "${subject}" for ${recipient}`);
}

describe.skipIf(!enabled)("staging API email delivery through Mailpit SMTP", () => {
  it("delivers verification and invitation email through the real SMTP adapter", async () => {
    const runId = randomUUID().slice(0, 8);
    const verificationRecipient = `verify-${runId}@roamlog.test`;
    const invitationRecipient = `invite-${runId}@roamlog.test`;
    const records = new Map<string, Record<string, unknown>>();
    let sequence = 0;

    const prisma = {
      client: {
        emailLog: {
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            sequence += 1;
            const id = `staging-email-${runId}-${sequence}`;
            records.set(id, { id, ...data });
            return { id };
          }),
          update: vi.fn(
            async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
              const record = records.get(where.id);
              if (!record) {
                throw new Error(`Unknown email log ${where.id}`);
              }
              Object.assign(record, data);
              return record;
            },
          ),
        },
      },
    } as unknown as PrismaService;

    const config = {
      smtpHost: process.env.ROAMLOG_STAGING_SMTP_HOST ?? "127.0.0.1",
      smtpPort: Number(process.env.ROAMLOG_STAGING_SMTP_PORT ?? 1025),
      smtpUser: undefined,
      smtpPassword: undefined,
      resendApiKey: undefined,
      emailFrom: "Roamlog <hello@roamlog.local>",
    } as unknown as AppConfigService;

    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as PinoLoggerService;

    const service = new EmailDeliveryService(config, prisma, logger);
    await service.sendVerificationEmail(
      { id: `user-${runId}-verify`, email: verificationRecipient, name: "Staging Verifier" },
      `https://app.roamlog.local/verify-email?token=${runId}`,
    );
    await service.sendInvitation({
      to: invitationRecipient,
      workspaceName: "Staging Atelier",
      inviterName: "Mei Lin",
      url: `https://app.roamlog.local/invite/${runId}`,
    });

    const verification = await waitForMessage(verificationRecipient, "验证你的 Roamlog 邮箱");
    const invitation = await waitForMessage(
      invitationRecipient,
      "加入 Staging Atelier 的 Roamlog Workspace",
    );

    expect(verification.ID).toBeTruthy();
    expect(invitation.ID).toBeTruthy();
    expect([...records.values()].filter((record) => record.status === "sent")).toHaveLength(2);
  });
});
