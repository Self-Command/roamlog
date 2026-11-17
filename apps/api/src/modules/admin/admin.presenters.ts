import {
  AuditLogSchema,
  CommentSchema,
  EmailLogSchema,
  FeatureFlagSchema,
  MediaSchema,
  type AuditLog,
  type Comment,
  type EmailLog,
  type FeatureFlag,
  type Media,
} from "@roamlog/contracts";

import { iso, nullableIso, presentDate } from "../trips/content-values.js";

function jsonObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function presentAdminAuditLog(record: {
  id: string;
  actorId: string | null;
  actorType: string;
  action: string;
  targetType: string;
  targetId: string;
  workspaceId: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: Date | string;
}): AuditLog {
  return AuditLogSchema.parse({
    ...record,
    metadata: jsonObject(record.metadata),
    createdAt: iso(record.createdAt),
  });
}

export function presentEmailLog(record: {
  id: string;
  userId: string | null;
  to: string;
  template: string;
  subject: string;
  providerId: string | null;
  status: string;
  error: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}): EmailLog {
  return EmailLogSchema.parse({
    ...record,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  });
}

export function presentFeatureFlag(record: {
  key: string;
  description: string;
  enabled: boolean;
  rolloutPercentage: number;
  rules: unknown;
  updatedById: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}): FeatureFlag {
  return FeatureFlagSchema.parse({
    ...record,
    rules: jsonObject(record.rules),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  });
}

export function presentMedia(record: {
  id: string;
  workspaceId: string;
  tripId: string | null;
  uploaderId: string;
  bucket: string;
  key: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  variants: unknown;
  status: string;
  error: string | null;
  caption: string | null;
  date: Date | string | null;
  location: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}): Media {
  return MediaSchema.parse({
    ...record,
    variants: jsonObject(record.variants),
    date: record.date === null ? null : presentDate(record.date),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: nullableIso(record.deletedAt),
  });
}

export function presentComment(record: {
  id: string;
  workspaceId: string;
  tripId: string;
  targetType: string;
  targetId: string;
  parentId: string | null;
  authorId: string;
  body: string;
  resolvedAt: Date | string | null;
  resolvedById: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
}): Comment {
  return CommentSchema.parse({
    ...record,
    resolvedAt: nullableIso(record.resolvedAt),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: nullableIso(record.deletedAt),
  });
}
