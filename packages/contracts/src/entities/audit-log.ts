import { z } from "zod";

import { IsoTimestampSchema, JsonObjectSchema } from "../common/ids";
import { AuditActorTypeSchema } from "./enums";

/**
 * Audit records are immutable, so their UUID references must remain readable
 * even when a historical row predates UUIDv7 adoption. New audit IDs are still
 * generated as UUIDv7 by the database; this compatibility applies to reads only.
 */
const AuditRecordUuidSchema = z
  .uuid()
  .describe("Opaque audit-record UUID; accepts legacy UUIDv4 and current UUIDv7 values.");

export const AuditLogSchema = z
  .object({
    id: AuditRecordUuidSchema,
    actorId: AuditRecordUuidSchema.nullable(),
    actorType: AuditActorTypeSchema,
    action: z.string().min(1).max(120),
    targetType: z.string().min(1).max(60),
    targetId: AuditRecordUuidSchema,
    workspaceId: AuditRecordUuidSchema.nullable(),
    ip: z.string().max(64).nullable(),
    userAgent: z.string().max(500).nullable(),
    metadata: JsonObjectSchema,
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type AuditLog = z.infer<typeof AuditLogSchema>;
