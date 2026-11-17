import type { QueueName } from "../queues.js";
import type { JobProcessor } from "../processor.js";
import type { WorkerDependencies } from "./types.js";
import { createEmailProcessor } from "./email.js";
import { createExportProcessor } from "./export.js";
import { createMaintenanceProcessor } from "./maintenance.js";
import { createMediaProcessor } from "./media.js";
import { createReminderProcessor } from "./reminders.js";

export function createDefaultProcessors(
  deps: WorkerDependencies,
): Record<QueueName, JobProcessor> {
  return {
    media: createMediaProcessor(deps),
    email: createEmailProcessor(deps),
    export: createExportProcessor(deps),
    reminders: createReminderProcessor(deps),
    maintenance: createMaintenanceProcessor(deps),
  };
}
