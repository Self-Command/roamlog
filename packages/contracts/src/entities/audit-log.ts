import { z } from "zod";

import { IsoTimestampSchema, JsonObjectSchema } from "../common/ids";
import { AuditActorTypeSchema } from "./enums";

/**
 * Audit records are immutable, so their UUID references must remain readable
 * even when a historical row predates UUIDv7 adoption. New audit IDs are still
 * generated as UUIDv7 by the database; this compatibility applies to reads only.
 *
 * The rule below is PostgreSQL's `uuid` rule, not RFC 4122's. A PostgreSQL
 * `uuid` column accepts any 128-bit value and canonicalises it to 8-4-4-4-12
 * hex **without** rewriting the version or variant nibbles. Audit rows are
 * immutable, so a value written in the legacy 32-hex form (the defect
 * `newRunId()` used to have) reads back as e.g.
 * `726d652a-fcfc-877c-f34f-593a6ec94c59` — variant `f`, which RFC 4122 forbids
 * and `z.uuid()` therefore rejected, turning the whole audit page into a 500.
 * Accepting exactly what the column accepts keeps those rows readable while
 * new rows keep being written as UUIDv7.
 */
const AuditRecordUuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID",
  )
  .describe("PostgreSQL uuid: 8-4-4-4-12 hex, any version/variant (legacy rows included).");

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
