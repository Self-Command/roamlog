import { createHash } from "node:crypto";

/**
 * AuditLog.targetId is a UUIDv7 per contract, while feature flags and BullMQ
 * jobs are keyed by strings. Derive a stable UUIDv7-shaped identifier so the
 * audit entry remains contract-valid and searchable by its metadata key.
 */
export function uuidV7FromString(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
