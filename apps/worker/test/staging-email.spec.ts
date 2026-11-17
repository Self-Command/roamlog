import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { createEmailRenderer, createEmailSender } from "../src/dependencies.js";
import { handleEmailJob } from "../src/jobs/email.js";
import type { WorkerDependencies } from "../src/jobs/types.js";
import { sleep, stagingContext, stagingEnabled, stagingMailpitUrl } from "./staging-helpers.js";

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
}

async function waitForMailpitMessage(recipient: string, subject: string): Promise<MailpitMessage> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${stagingMailpitUrl}/api/v1/messages`);
    if (!response.ok) {
      throw new Error(`Mailpit message list failed with HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { messages?: MailpitMessage[] };
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

function emailDatabase(runId: string) {
  let sequence = 0;
  const records = new Map<string, Record<string, unknown>>();
  const emailLog = {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      sequence += 1;
      const id = `worker-email-${runId}-${sequence}`;
      const row = { id, ...data };
      records.set(id, row);
      return row;
    }),
    updateMany: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const record = records.get(where.id);
        if (!record) {
          throw new Error(`Unknown email log ${where.id}`);
        }
        Object.assign(record, data);
        return { count: 1 };
      },
    ),
  };
  return { db: { emailLog }, records };
}

describe.skipIf(!stagingEnabled)("staging worker email: real Mailpit", () => {
  it("renders and delivers invitation, verification, and mention templates", async () => {
    const previousProvider = process.env.EMAIL_PROVIDER;
    const previousMailpit = process.env.MAILPIT_URL;
    const previousFrom = process.env.EMAIL_FROM;
    process.env.EMAIL_PROVIDER = "mailpit";
    process.env.MAILPIT_URL = stagingMailpitUrl;
    process.env.EMAIL_FROM = "Roamlog <hello@roamlog.local>";

    try {
      const runId = randomUUID().slice(0, 8);
      const { db, records } = emailDatabase(runId);
      const deps = {
        db,
        storage: {
          getObject: vi.fn(),
          putObject: vi.fn(),
          deleteObject: vi.fn(),
        },
        images: { process: vi.fn() },
        email: {
          send: createEmailSender(),
          render: createEmailRenderer(),
        },
        now: () => new Date(),
        logger: stagingContext("staging-email").logger,
      } satisfies WorkerDependencies;

      const fixtures = [
        {
          template: "workspace-invite",
          to: `worker-invite-${runId}@roamlog.test`,
          subject: "Mei Lin 邀请你加入 Staging Atelier · Roamlog",
          data: {
            workspaceName: "Staging Atelier",
            inviterName: "Mei Lin",
            role: "editor",
            inviteUrl: `https://app.roamlog.local/invite/${runId}`,
          },
        },
        {
          template: "verify-email",
          to: `worker-verify-${runId}@roamlog.test`,
          subject: "验证你的 Roamlog 邮箱",
          data: {
            recipientName: "Staging Verifier",
            verificationUrl: `https://app.roamlog.local/verify-email?token=${runId}`,
          },
        },
        {
          template: "mention",
          to: `worker-mention-${runId}@roamlog.test`,
          subject: "Mei Lin 在 首尔，慢一点 中提到了你 · Roamlog",
          data: {
            recipientName: "Staging Mention",
            actorName: "Mei Lin",
            workspaceName: "Staging Atelier",
            tripTitle: "首尔，慢一点",
            entryTitle: "雨后的北村与一杯热茶",
            excerpt: "你上次说的那家茶室，我补进第三天的行程了。",
            commentUrl: `https://app.roamlog.local/trips/${runId}#comment`,
          },
        },
      ] as const;

      for (const [index, fixture] of fixtures.entries()) {
        await handleEmailJob(
          {
            to: fixture.to,
            template: fixture.template,
            data: fixture.data,
          },
          stagingContext(`worker-email-${runId}-${index}`),
          deps,
        );
        const captured = await waitForMailpitMessage(fixture.to, fixture.subject);
        expect(captured.ID).toBeTruthy();
      }

      expect([...records.values()]).toHaveLength(3);
      expect([...records.values()].every((record) => record.status === "sent")).toBe(true);
      expect(
        [...records.values()].every(
          (record) => typeof record.providerId === "string" && record.providerId.length > 0,
        ),
      ).toBe(true);
    } finally {
      process.env.EMAIL_PROVIDER = previousProvider;
      process.env.MAILPIT_URL = previousMailpit;
      process.env.EMAIL_FROM = previousFrom;
    }
  });
});
