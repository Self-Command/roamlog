import type { Job } from "bullmq";
import { defineProcessor, type JobProcessor, type ProcessorContext } from "../processor.js";
import type { WorkerDependencies } from "./types.js";

export interface ReminderJobData {
  daysUntilDeparture?: 7 | 1;
  date?: string;
}

export async function handleReminderJob(
  data: ReminderJobData,
  context: ProcessorContext,
  deps: WorkerDependencies,
): Promise<{ sent: number }> {
  const days = data.daysUntilDeparture ?? 7;
  const target = data.date
    ? new Date(`${data.date}T00:00:00.000Z`)
    : new Date(deps.now().getTime() + days * 24 * 60 * 60 * 1000);
  const dayStart = startOfUtcDay(target);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const trips = await deps.db.trip.findMany({
    where: {
      startDate: { gte: dayStart, lt: dayEnd },
      deletedAt: null,
      status: { in: ["upcoming", "planning", "active"] },
    },
  });
  let sent = 0;
  for (const trip of trips) {
    const members = await deps.db.workspaceMember.findMany({
      where: { workspaceId: trip.workspaceId, status: "active" },
      include: { user: { select: { id: true, email: true, name: true, status: true } } },
    });
    for (const membership of members) {
      const user = membership.user;
      if (!user?.email || user.status !== "active") {
        continue;
      }
      const existing = await deps.db.notification.findFirst({
        where: {
          userId: user.id,
          type: "trip_reminder",
          entityId: trip.id,
          createdAt: { gte: dayStart },
        },
      });
      if (existing) {
        continue;
      }

      const subject = `${trip.title} 还有 ${days} 天出发`;
      await deps.db.notification.create({
        data: {
          userId: user.id,
          workspaceId: trip.workspaceId,
          tripId: trip.id,
          type: "trip_reminder",
          title: subject,
          body: `${trip.origin ? `${trip.origin} → ` : ""}${trip.destinations.join(" · ")}`,
          entityType: "trip",
          entityId: trip.id,
        },
      });
      try {
        const provider = await deps.email.send({
          to: user.email,
          subject,
          text: `${trip.title} 还有 ${days} 天出发。`,
          html: `<p><strong>${escapeHtml(trip.title)}</strong> 还有 ${days} 天出发。</p>`,
          idempotencyKey: `reminder-${days}-${trip.id}-${user.id}`,
        });
        await deps.db.emailLog.create({
          data: {
            userId: user.id,
            to: user.email,
            template: "trip-reminder",
            subject,
            providerId: provider.providerId,
            status: "sent",
          },
        });
        sent += 1;
      } catch (error) {
        context.logger.error(
          {
            jobId: context.jobId,
            tripId: trip.id,
            userId: user.id,
            error: error instanceof Error ? error.message : String(error),
          },
          "trip reminder email failed",
        );
      }
    }
  }
  context.logger.info({ jobId: context.jobId, days, trips: trips.length, sent }, "reminders sent");
  return { sent };
}

function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function createReminderProcessor(
  deps: WorkerDependencies,
): JobProcessor<ReminderJobData> {
  return defineProcessor<ReminderJobData>({
    name: "reminders",
    handle(job: Job<ReminderJobData>, context: ProcessorContext) {
      return handleReminderJob(job.data ?? {}, context, deps);
    },
  });
}
