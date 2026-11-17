import type { QueueName } from "../queues.js";
import type { JobProcessor } from "../processor.js";
import { emailProcessor } from "./email.js";
import { exportProcessor } from "./export.js";
import { maintenanceProcessor } from "./maintenance.js";
import { mediaProcessor } from "./media.js";
import { reminderProcessor } from "./reminders.js";

export const defaultProcessors: Record<QueueName, JobProcessor> = {
  media: mediaProcessor,
  email: emailProcessor,
  export: exportProcessor,
  reminders: reminderProcessor,
  maintenance: maintenanceProcessor,
};
