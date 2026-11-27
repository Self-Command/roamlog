import {
  AdminMediaSchema,
  CommentSchema,
  EmailLogSchema,
  FeatureFlagSchema,
  MediaSchema,
  type AdminMedia,
  type AuditLog,
  type Comment,
  type EmailLog,
  type FeatureFlag,
} from "@roamlog/contracts";

import { AuditLogReadSchema } from "../audit/audit-read.js";
import type { MediaVariantView } from "../media/media.presenter.js";
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
  // Audit rows are immutable and PostgreSQL stores uuids that RFC 4122 would
  // reject, so the read shape must accept what the database accepted; otherwise
  // one historical row 500s the whole page. See `audit-read.ts`.
  return AuditLogReadSchema.parse({
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

export interface AdminMediaRecord {
  id: string;
  workspaceId: string;
  tripId: string | null;
  uploaderId: string;
  bucket: string;
  key: string;
  originalFileName?: string | null;
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
  moderatedAt?: Date | string | null;
  moderatedById?: string | null;
}

export function presentMedia(
  record: AdminMediaRecord,
  variantUrls: Record<string, MediaVariantView> = {},
): AdminMedia {
  const variants = { ...jsonObject(record.variants), ...variantUrls };
  const media = MediaSchema.parse({
    id: record.id,
    workspaceId: record.workspaceId,
    tripId: record.tripId,
    uploaderId: record.uploaderId,
    bucket: record.bucket,
    key: record.key,
    mimeType: record.mimeType,
    size: record.size,
    width: record.width,
    height: record.height,
    blurhash: record.blurhash,
    variants,
    status: record.status,
    error: record.error,
    caption: record.caption,
    date: record.date === null ? null : presentDate(record.date),
    location: record.location,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: nullableIso(record.deletedAt),
    moderatedAt: record.moderatedAt === undefined ? null : nullableIso(record.moderatedAt),
    moderatedById: record.moderatedById ?? null,
  });
  return AdminMediaSchema.parse({
    ...media,
    originalFileName:
      record.originalFileName?.trim() || record.key.split("/").at(-1) || record.key,
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
  moderatedAt?: Date | string | null;
  moderatedById?: string | null;
}): Comment {
  return CommentSchema.parse({
    id: record.id,
    workspaceId: record.workspaceId,
    tripId: record.tripId,
    targetType: record.targetType,
    targetId: record.targetId,
    parentId: record.parentId,
    authorId: record.authorId,
    body: record.body,
    resolvedAt: nullableIso(record.resolvedAt),
    resolvedById: record.resolvedById,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    deletedAt: nullableIso(record.deletedAt),
    moderatedAt: record.moderatedAt === undefined ? null : nullableIso(record.moderatedAt),
    moderatedById: record.moderatedById ?? null,
  });
}
