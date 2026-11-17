import type { Job } from "bullmq";
import { defineProcessor, type JobProcessor, type ProcessorContext } from "../processor.js";
import type { WorkerDependencies } from "./types.js";

export interface EmailJobData {
  emailLogId?: string;
  to: string;
  template: string;
  data?: Record<string, unknown>;
  subject?: string;
  html?: string;
  text?: string;
}

export async function handleEmailJob(
  data: EmailJobData,
  context: ProcessorContext,
  deps: WorkerDependencies,
): Promise<{ status: string; emailLogId: string }> {
  let log = data.emailLogId
    ? await deps.db.emailLog.findUnique({ where: { id: data.emailLogId } })
    : await deps.db.emailLog.findFirst({
        where: {
          to: data.to,
          template: data.template,
          status: { in: ["queued", "failed"] },
        },
        orderBy: { createdAt: "asc" },
      });

  if (!log) {
    log = await deps.db.emailLog.create({
      data: {
        to: data.to,
        template: data.template,
        subject: data.subject ?? data.template,
        status: "queued",
      },
    });
  }

  if (log.status === "sent" || log.status === "delivered") {
    return { status: log.status, emailLogId: log.id };
  }

  try {
    let rendered: { subject: string; html: string; text: string };
    if (data.subject && data.html && data.text) {
      rendered = { subject: data.subject, html: data.html, text: data.text };
    } else {
      rendered = await deps.email.render(data.template, data.data ?? {});
    }

    const provider = await deps.email.send({
      to: data.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: context.jobId,
    });
    await deps.db.emailLog.updateMany({
      where: { id: log.id },
      data: {
        status: "sent",
        subject: rendered.subject,
        providerId: provider.providerId,
        error: null,
      },
    });
    context.logger.info({ jobId: context.jobId, emailLogId: log.id }, "email sent");
    return { status: "sent", emailLogId: log.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email delivery failed";
    await deps.db.emailLog.updateMany({
      where: { id: log.id },
      data: { status: "failed", error: message.slice(0, 1000) },
    });
    context.logger.error(
      { jobId: context.jobId, emailLogId: log.id, error: message },
      "email failed",
    );
    throw error;
  }
}

export function createEmailProcessor(deps: WorkerDependencies): JobProcessor<EmailJobData> {
  return defineProcessor<EmailJobData>({
    name: "email",
    handle(job: Job<EmailJobData>, context: ProcessorContext) {
      return handleEmailJob(job.data, context, deps);
    },
  });
}
