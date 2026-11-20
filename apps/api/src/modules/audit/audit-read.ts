import { AuditLogSchema, type AuditLog } from "@roamlog/contracts";

/**
 * Read-side schema for `AuditLog` rows coming out of PostgreSQL.
 *
 * This file used to hold a second copy of the audit shape with a local
 * `PostgresUuidSchema`: a PostgreSQL `uuid` column stores any 128-bit value and
 * normalises the hyphenless 32-hex form to `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
 * **without** rewriting the version or variant nibbles. Audit rows are
 * immutable, so a row written that way can never be repaired, and one
 * unparseable row used to turn the whole `GET /v1/admin/audit` page (and the
 * CSV export) into a 500 `ZodError`.
 *
 * `AuditLogSchema`'s `AuditRecordUuidSchema` now encodes exactly that PostgreSQL
 * rule, so the local duplicate is gone: this alias re-exports the single
 * contract definition (same fields, same `.strict()`), leaving one rule to
 * maintain. Kept as a named export so `AuditService` and `admin.presenters` do
 * not change.
 */
export const AuditLogReadSchema = AuditLogSchema;

export type AuditLogRead = AuditLog;