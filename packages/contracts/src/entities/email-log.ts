import { z } from "zod";

import { EmailSchema, IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import { EmailStatusSchema } from "./enums";

export const EmailLogSchema = z
  .object({
    id: UuidV7Schema,
    userId: UuidV7Schema.nullable(),
    to: EmailSchema,
    template: z.string().min(1).max(120),
    subject: z.string().min(1).max(240),
    providerId: z.string().max(240).nullable(),
    status: EmailStatusSchema,
    error: z.string().max(1000).nullable(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  })
  .strict();
export type EmailLog = z.infer<typeof EmailLogSchema>;
