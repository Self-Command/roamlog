import { z } from "zod";

import { IsoTimestampSchema, JsonObjectSchema, UuidV7Schema } from "../common/ids";
import { AuditActorTypeSchema } from "./enums";

export const AuditLogSchema = z
  .object({
    id: UuidV7Schema,
    actorId: UuidV7Schema.nullable(),
    actorType: AuditActorTypeSchema,
    action: z.string().min(1).max(120),
    targetType: z.string().min(1).max(60),
    targetId: UuidV7Schema,
    workspaceId: UuidV7Schema.nullable(),
    ip: z.string().max(64).nullable(),
    userAgent: z.string().max(500).nullable(),
    metadata: JsonObjectSchema,
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type AuditLog = z.infer<typeof AuditLogSchema>;
