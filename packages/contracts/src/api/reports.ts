import { z } from "zod";

import { DateOnlySchema, IsoTimestampSchema, UuidV7Schema } from "../common/ids";
import { createSortSchema, CursorPageSchema, CursorQuerySchema } from "../common/pagination";

/**
 * Content moderation contracts (workflow B4).
 *
 * A report is polymorphic over the four reportable content kinds. The admin
 * side embeds a read-only content snapshot so the queue can be triaged without
 * opening each trip / entry / comment / media, and aggregates the number of
 * reports pointing at the same target.
 */
export const ReportTargetTypeSchema = z.enum(["trip", "entry", "comment", "media"]);
export type ReportTargetType = z.infer<typeof ReportTargetTypeSchema>;

export const ReportReasonSchema = z.enum([
  "spam",
  "harassment",
  "private_info",
  "illegal",
  "other",
]);
export type ReportReason = z.infer<typeof ReportReasonSchema>;

export const ReportStatusSchema = z.enum(["open", "in_review", "resolved", "dismissed"]);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

/** `remove`/`restore` change the target; `warn`/`dismiss` only close the report. */
export const ModerationActionKindSchema = z.enum(["remove", "restore", "warn", "dismiss"]);
export type ModerationActionKind = z.infer<typeof ModerationActionKindSchema>;

export const REPORT_ERROR_CODES = {
  duplicate: "REPORT_DUPLICATE",
  targetNotFound: "REPORT_TARGET_NOT_FOUND",
  alreadyResolved: "REPORT_ALREADY_RESOLVED",
  reasonInvalid: "REPORT_REASON_INVALID",
} as const;

export const ReportErrorCodeSchema = z.enum([
  REPORT_ERROR_CODES.duplicate,
  REPORT_ERROR_CODES.targetNotFound,
  REPORT_ERROR_CODES.alreadyResolved,
  REPORT_ERROR_CODES.reasonInvalid,
]);
export type ReportErrorCode = z.infer<typeof ReportErrorCodeSchema>;

export const CreateReportRequestSchema = z
  .object({
    targetType: ReportTargetTypeSchema,
    targetId: UuidV7Schema,
    reason: ReportReasonSchema,
    detail: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export type CreateReportRequest = z.infer<typeof CreateReportRequestSchema>;

export const CreateReportResponseSchema = z
  .object({
    id: UuidV7Schema,
    status: ReportStatusSchema,
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type CreateReportResponse = z.infer<typeof CreateReportResponseSchema>;

/**
 * Read-only copy of the reported content at queue time. `title` is a summary:
 * trip/entry title, comment body excerpt, or media caption/file name.
 */
export const ReportTargetSnapshotSchema = z
  .object({
    type: ReportTargetTypeSchema,
    id: UuidV7Schema,
    title: z.string().min(1).max(1000),
    authorId: UuidV7Schema,
    authorName: z.string().min(1).max(120),
    workspaceId: UuidV7Schema,
    workspaceName: z.string().min(1).max(120),
    deletedAt: IsoTimestampSchema.nullable(),
    moderatedAt: IsoTimestampSchema.nullable(),
  })
  .strict();
export type ReportTargetSnapshot = z.infer<typeof ReportTargetSnapshotSchema>;

export const AdminReportItemSchema = z
  .object({
    id: UuidV7Schema,
    workspaceId: UuidV7Schema,
    targetType: ReportTargetTypeSchema,
    targetId: UuidV7Schema,
    reason: ReportReasonSchema,
    detail: z.string().max(1000).nullable(),
    reporterId: UuidV7Schema,
    status: ReportStatusSchema,
    resolvedById: UuidV7Schema.nullable(),
    resolvedAt: IsoTimestampSchema.nullable(),
    resolutionNote: z.string().max(1000).nullable(),
    createdAt: IsoTimestampSchema,
    /** Same content can be reported by several members; this is the queue count. */
    target: ReportTargetSnapshotSchema,
    reportCount: z.number().int().positive(),
    lastReportedAt: IsoTimestampSchema,
  })
  .strict();
export type AdminReportItem = z.infer<typeof AdminReportItemSchema>;

export const AdminReportQuerySchema = CursorQuerySchema.extend({
  status: ReportStatusSchema.optional(),
  targetType: ReportTargetTypeSchema.optional(),
  reason: ReportReasonSchema.optional(),
  workspaceId: UuidV7Schema.optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  q: z.string().max(200).optional(),
  sort: createSortSchema(["createdAt"]).optional(),
});
export type AdminReportQuery = z.infer<typeof AdminReportQuerySchema>;

export const AdminReportPageSchema = CursorPageSchema(AdminReportItemSchema);
export type AdminReportPage = z.infer<typeof AdminReportPageSchema>;

export const ModerationActionSchema = z
  .object({
    id: UuidV7Schema,
    reportId: UuidV7Schema,
    actorId: UuidV7Schema,
    action: ModerationActionKindSchema,
    note: z.string().max(1000).nullable(),
    createdAt: IsoTimestampSchema,
  })
  .strict();
export type ModerationAction = z.infer<typeof ModerationActionSchema>;

export const AdminReportDetailSchema = z
  .object({
    /** The report addressed by the URL. */
    report: AdminReportItemSchema,
    /** Every report filed against the same target, oldest first. */
    reports: z.array(AdminReportItemSchema),
    actions: z.array(ModerationActionSchema),
  })
  .strict();
export type AdminReportDetail = z.infer<typeof AdminReportDetailSchema>;

export const ResolveReportRequestSchema = z
  .object({
    action: ModerationActionKindSchema,
    note: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export type ResolveReportRequest = z.infer<typeof ResolveReportRequestSchema>;

/** The updated queue row plus the decision that was just appended. */
export const ResolveReportResponseSchema = z
  .object({
    report: AdminReportItemSchema,
    action: ModerationActionSchema,
  })
  .strict();
export type ResolveReportResponse = z.infer<typeof ResolveReportResponseSchema>;