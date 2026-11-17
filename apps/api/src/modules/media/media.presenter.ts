import { MediaSchema, type Media } from "@roamlog/contracts";

import { iso, nullableIso, presentDate } from "../trips/content-values.js";
import type { MediaRecord } from "./media-records.js";

export interface MediaVariantView {
  key: string;
  url: string;
  expiresAt: string;
}

export function presentMedia(
  record: MediaRecord,
  variantUrls: Record<string, MediaVariantView> = {},
): Media {
  const storedVariants = jsonObject(record.variants);
  const variants: Record<string, unknown> = { ...storedVariants };
  for (const [name, view] of Object.entries(variantUrls)) {
    variants[name] = view;
  }
  if (record.status === "ready" && Object.keys(variants).length === 0) {
    variants.original = { key: record.key };
  }

  return MediaSchema.parse({
    ...record,
    date: record.date ? presentDate(record.date) : null,
    variants,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: nullableIso(record.deletedAt),
  });
}

export function variantKeys(record: MediaRecord): string[] {
  const stored = jsonObject(record.variants);
  const keys = new Set<string>([record.key]);
  for (const value of Object.values(stored)) {
    if (isRecord(value) && typeof value.key === "string") {
      keys.add(value.key);
    }
  }
  return [...keys];
}

export function jsonObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
