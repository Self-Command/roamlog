import { z } from "zod";

import { AuditLogSchema } from "@roamlog/contracts";

/**
 * Read-side schema for `AuditLog` rows coming out of PostgreSQL.
 *
 * `z.uuid()` (used by `AuditLogSchema`) validates the RFC 4122 version/variant
 * nibbles, but a PostgreSQL `uuid` column stores any 128-bit value: the database
 * and the driver accept the hyphenless 32-hex-digit form and normalise it to
 * `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` **without** rewriting the version or
 * variant bits. Audit rows are immutable, so such a row can never be repaired
 * after the fact, and one unparseable row used to turn the whole
 * `GET /v1/admin/audit` page (and the CSV export) into a 500 `ZodError`.
 *
 * This schema therefore accepts exactly what PostgreSQL accepts (eight-four-
 * four-four-twelve hex digits) for the uuid columns, instead of what RFC 4122
 * would accept. All other fields — and unknown-key rejection — still come from
 * `AuditLogSchema`.
 *
 * Writers are expected to emit real UUIDv7 values; the widened read shape only
 * guarantees that historical rows stay readable.
 */
const PostgresUuidSchema = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u,
    "Invalid UUID",
  )
  .describe("Opaque PostgreSQL uuid; accepts historical non-RFC 4122 values.");

export const AuditLogReadSchema = AuditLogSchema.extend({
  id: PostgresUuidSchema,
  actorId: PostgresUuidSchema.nullable(),
  targetId: PostgresUuidSchema,
  workspaceId: PostgresUuidSchema.nullable(),
}).strict();

export type AuditLogRead = z.infer<typeof AuditLogReadSchema>;