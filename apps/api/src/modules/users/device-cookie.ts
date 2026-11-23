import { UuidV7Schema } from "@roamlog/contracts";

export const DEVICE_ID_COOKIE_NAME = "roamlog.device_id";
export const DEVICE_ID_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1_000;

/** Only a UUIDv7-shaped value is accepted back from the client. */
export function normalizeDeviceId(value: unknown): string | null {
  return typeof value === "string" && UuidV7Schema.safeParse(value).success ? value : null;
}
