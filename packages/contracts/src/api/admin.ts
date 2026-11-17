import { z } from "zod";

import {
  DateOnlySchema,
  EmailSchema,
  IsoTimestampSchema,
  JsonObjectSchema,
  UuidV7Schema,
} from "../common/ids";
import { createSortSchema, CursorPageSchema, CursorQuerySchema } from "../common/pagination";
import { ActivitySchema } from "../entities/activity";
import { AuditLogSchema } from "../entities/audit-log";
import { CommentSchema } from "../entities/comment";
import { AuditActorTypeSchema, EmailStatusSchema, ExportStatusSchema } from "../entities/enums";
import { EmailLogSchema } from "../entities/email-log";
import { ExportSchema } from "../entities/export";
import { FeatureFlagSchema } from "../entities/feature-flag";
import { JournalEntrySchema } from "../entities/journal";
import { MediaSchema } from "../entities/media";
import { TripSchema } from "../entities/trip";
import { UserSchema } from "../entities/user";
import { WorkspaceSchema } from "../entities/workspace";
import { AccountStatusSchema, WorkspacePlanSchema } from "../entities/enums";
import { PlatformRoleSchema } from "../permissions";
import { MessageResponseSchema } from "./common";

export const AdminMetricsSchema = z
  .object({
    users: z
      .object({
        total: z.number().int().nonnegative(),
        active: z.number().int().nonnegative(),
        suspended: z.number().int().nonnegative(),
        new24h: z.number().int().nonnegative(),
      })
      .strict(),
    workspaces: z
      .object({
        total: z.number().int().nonnegative(),
        active: z.number().int().nonnegative(),
        suspended: z.number().int().nonnegative(),
        new24h: z.number().int().nonnegative(),
      })
      .strict(),
    trips: z.number().int().nonnegative(),
    entries: z.number().int().nonnegative(),
    comments: z.number().int().nonnegative(),
    media: z
      .object({
        count: z.number().int().nonnegative(),
        bytes: z.number().int().nonnegative(),
      })
      .strict(),
    exports: z.record(ExportStatusSchema, z.number().int().nonnegative()),
    queues: z.array(
      z
        .object({
          name: z.string().min(1).max(80),
          waiting: z.number().int().nonnegative(),
          active: z.number().int().nonnegative(),
          failed: z.number().int().nonnegative(),
          completed: z.number().int().nonnegative(),
          paused: z.boolean(),
        })
        .strict(),
    ),
    generatedAt: IsoTimestampSchema,
  })
  .strict();
export type AdminMetrics = z.infer<typeof AdminMetricsSchema>;

export const AdminUserQuerySchema = CursorQuerySchema.extend({
  q: z.string().max(200).optional(),
  status: AccountStatusSchema.optional(),
  platformRole: PlatformRoleSchema.optional(),
  sort: createSortSchema(["createdAt", "lastActiveAt", "name"]).optional(),
});
export type AdminUserQuery = z.infer<typeof AdminUserQuerySchema>;

export const AdminUserPageSchema = CursorPageSchema(UserSchema);
export type AdminUserPage = z.infer<typeof AdminUserPageSchema>;

export const AdminUserDetailSchema = UserSchema.extend({
  workspaceCount: z.number().int().nonnegative(),
  tripCount: z.number().int().nonnegative(),
  entryCount: z.number().int().nonnegative(),
  activeSessionCount: z.number().int().nonnegative(),
});
export type AdminUserDetail = z.infer<typeof AdminUserDetailSchema>;

export const UpdateAdminUserRequestSchema = z
  .object({
    status: AccountStatusSchema.optional(),
    platformRole: PlatformRoleSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one admin user field is required.",
  });
export type UpdateAdminUserRequest = z.infer<typeof UpdateAdminUserRequestSchema>;

export const ForceLogoutResponseSchema = z
  .object({ revokedSessions: z.number().int().nonnegative() })
  .strict();
export type ForceLogoutResponse = z.infer<typeof ForceLogoutResponseSchema>;

export const ResetTwoFactorResponseSchema = z
  .object({
    message: z.string().min(1),
    totpReset: z.literal(true),
  })
  .strict();
export type ResetTwoFactorResponse = z.infer<typeof ResetTwoFactorResponseSchema>;

export const AdminWorkspaceQuerySchema = CursorQuerySchema.extend({
  q: z.string().max(200).optional(),
  status: AccountStatusSchema.optional(),
  plan: WorkspacePlanSchema.optional(),
  sort: createSortSchema(["createdAt", "name"]).optional(),
});
export type AdminWorkspaceQuery = z.infer<typeof AdminWorkspaceQuerySchema>;

export const AdminWorkspacePageSchema = CursorPageSchema(WorkspaceSchema);
export type AdminWorkspacePage = z.infer<typeof AdminWorkspacePageSchema>;

export const AdminWorkspaceDetailSchema = WorkspaceSchema.extend({
  memberCount: z.number().int().nonnegative(),
  tripCount: z.number().int().nonnegative(),
  entryCount: z.number().int().nonnegative(),
  owner: UserSchema.pick({ id: true, name: true, email: true, image: true }),
});
export type AdminWorkspaceDetail = z.infer<typeof AdminWorkspaceDetailSchema>;

export const UpdateAdminWorkspaceRequestSchema = z
  .object({
    status: AccountStatusSchema.optional(),
    plan: WorkspacePlanSchema.optional(),
    ownerId: UuidV7Schema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one admin workspace field is required.",
  });
export type UpdateAdminWorkspaceRequest = z.infer<typeof UpdateAdminWorkspaceRequestSchema>;

export const AdminContentQuerySchema = CursorQuerySchema.extend({
  workspaceId: UuidV7Schema.optional(),
  q: z.string().max(200).optional(),
  status: z.string().max(40).optional(),
  sort: createSortSchema(["createdAt", "updatedAt"]).optional(),
});
export type AdminContentQuery = z.infer<typeof AdminContentQuerySchema>;

export const AdminTripPageSchema = CursorPageSchema(TripSchema);
export type AdminTripPage = z.infer<typeof AdminTripPageSchema>;

export const AdminEntryPageSchema = CursorPageSchema(JournalEntrySchema);
export type AdminEntryPage = z.infer<typeof AdminEntryPageSchema>;

export const AdminCommentPageSchema = CursorPageSchema(CommentSchema);
export type AdminCommentPage = z.infer<typeof AdminCommentPageSchema>;

export const AdminMediaQuerySchema = CursorQuerySchema.extend({
  workspaceId: UuidV7Schema.optional(),
  status: z.string().max(40).optional(),
  sort: createSortSchema(["createdAt"]).optional(),
});
export type AdminMediaQuery = z.infer<typeof AdminMediaQuerySchema>;

export const AdminMediaPageSchema = CursorPageSchema(MediaSchema);
export type AdminMediaPage = z.infer<typeof AdminMediaPageSchema>;

export const AdminAuditQuerySchema = CursorQuerySchema.extend({
  workspaceId: UuidV7Schema.optional(),
  actorId: UuidV7Schema.optional(),
  actorType: AuditActorTypeSchema.optional(),
  action: z.string().max(120).optional(),
  targetType: z.string().max(60).optional(),
  ip: z.string().max(64).optional(),
  q: z.string().max(200).optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  sort: createSortSchema(["createdAt"]).optional(),
});
export type AdminAuditQuery = z.infer<typeof AdminAuditQuerySchema>;

export const AdminAuditExportQuerySchema = AdminAuditQuerySchema.omit({
  cursor: true,
  limit: true,
});
export type AdminAuditExportQuery = z.infer<typeof AdminAuditExportQuerySchema>;

export const AdminAuditCsvResponseSchema = z
  .string()
  .describe(
    "UTF-8 CSV attachment. Columns: id, createdAt, actorType, actorId, action, targetType, targetId, workspaceId, ip, userAgent, metadata.",
  );
export type AdminAuditCsvResponse = z.infer<typeof AdminAuditCsvResponseSchema>;

export const AdminAuditPageSchema = CursorPageSchema(AuditLogSchema);
export type AdminAuditPage = z.infer<typeof AdminAuditPageSchema>;

export const AdminFlagListResponseSchema = z.array(FeatureFlagSchema);
export type AdminFlagListResponse = z.infer<typeof AdminFlagListResponseSchema>;

export const UpdateFeatureFlagRequestSchema = z
  .object({
    description: z.string().max(500).optional(),
    enabled: z.boolean().optional(),
    rolloutPercentage: z.number().int().min(0).max(100).optional(),
    rules: JsonObjectSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one feature flag field is required.",
  });
export type UpdateFeatureFlagRequest = z.infer<typeof UpdateFeatureFlagRequestSchema>;

export const AdminEmailQuerySchema = CursorQuerySchema.extend({
  userId: UuidV7Schema.optional(),
  status: EmailStatusSchema.optional(),
  template: z.string().max(120).optional(),
  to: EmailSchema.optional(),
  sort: createSortSchema(["createdAt"]).optional(),
});
export type AdminEmailQuery = z.infer<typeof AdminEmailQuerySchema>;

export const AdminEmailPageSchema = CursorPageSchema(EmailLogSchema);
export type AdminEmailPage = z.infer<typeof AdminEmailPageSchema>;

export const ResendEmailResponseSchema = EmailLogSchema;
export type ResendEmailResponse = z.infer<typeof ResendEmailResponseSchema>;

export const AdminJobStatusSchema = z.enum([
  "waiting",
  "active",
  "completed",
  "failed",
  "delayed",
  "paused",
]);
export type AdminJobStatus = z.infer<typeof AdminJobStatusSchema>;

export const AdminJobSchema = z
  .object({
    id: z.string().min(1).max(120),
    queue: z.string().min(1).max(80),
    name: z.string().min(1).max(120),
    status: AdminJobStatusSchema,
    attempts: z.number().int().nonnegative(),
    data: JsonObjectSchema,
    failedReason: z.string().max(2000).nullable(),
    createdAt: IsoTimestampSchema,
    processedAt: IsoTimestampSchema.nullable(),
    finishedAt: IsoTimestampSchema.nullable(),
  })
  .strict();
export type AdminJob = z.infer<typeof AdminJobSchema>;

export const AdminJobQuerySchema = CursorQuerySchema.extend({
  queue: z.string().max(80).optional(),
  status: AdminJobStatusSchema.optional(),
});
export type AdminJobQuery = z.infer<typeof AdminJobQuerySchema>;

export const AdminJobPageSchema = CursorPageSchema(AdminJobSchema);
export type AdminJobPage = z.infer<typeof AdminJobPageSchema>;

export const RetryJobResponseSchema = z
  .object({
    jobId: z.string().min(1).max(120),
    queued: z.literal(true),
  })
  .strict();
export type RetryJobResponse = z.infer<typeof RetryJobResponseSchema>;

export const PauseAdminQueueResponseSchema = z
  .object({
    queue: z.string().min(1).max(80),
    paused: z.literal(true),
  })
  .strict();
export type PauseAdminQueueResponse = z.infer<typeof PauseAdminQueueResponseSchema>;

export const ResumeAdminQueueResponseSchema = z
  .object({
    queue: z.string().min(1).max(80),
    paused: z.literal(false),
  })
  .strict();
export type ResumeAdminQueueResponse = z.infer<typeof ResumeAdminQueueResponseSchema>;

export const ClearAdminQueueResponseSchema = z
  .object({
    queue: z.string().min(1).max(80),
    cleared: z.literal(true),
    removedJobs: z.number().int().nonnegative(),
  })
  .strict();
export type ClearAdminQueueResponse = z.infer<typeof ClearAdminQueueResponseSchema>;

export const AdminSystemWorkerSchema = z
  .object({
    status: z.enum(["up", "degraded", "down"]),
    version: z.string().min(1).max(40),
    consumers: z.number().int().nonnegative(),
  })
  .strict();
export type AdminSystemWorker = z.infer<typeof AdminSystemWorkerSchema>;

export const AdminSystemMigrationSchema = z
  .object({
    version: z.string().min(1).max(160).nullable(),
    appliedAt: IsoTimestampSchema.nullable(),
  })
  .strict();
export type AdminSystemMigration = z.infer<typeof AdminSystemMigrationSchema>;

export const AdminSystemSchema = z
  .object({
    version: z.string().min(1).max(40),
    environment: z.enum(["development", "test", "staging", "production"]),
    nodeVersion: z.string().min(1).max(40),
    buildTime: IsoTimestampSchema,
    startedAt: IsoTimestampSchema,
    uptimeSeconds: z.number().int().nonnegative(),
    migration: AdminSystemMigrationSchema,
    worker: AdminSystemWorkerSchema,
    checks: z
      .object({
        database: z
          .object({
            status: z.enum(["up", "down"]),
            latencyMs: z.number().int().nonnegative().nullable(),
          })
          .strict(),
        redis: z
          .object({
            status: z.enum(["up", "down"]),
            latencyMs: z.number().int().nonnegative().nullable(),
          })
          .strict(),
        storage: z
          .object({
            status: z.enum(["up", "down"]),
            latencyMs: z.number().int().nonnegative().nullable(),
          })
          .strict(),
      })
      .strict(),
    queues: z.array(
      z
        .object({
          name: z.string().min(1).max(80),
          waiting: z.number().int().nonnegative(),
          active: z.number().int().nonnegative(),
          failed: z.number().int().nonnegative(),
          delayed: z.number().int().nonnegative(),
          paused: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
export type AdminSystem = z.infer<typeof AdminSystemSchema>;

export const AdminDeleteResponseSchema = MessageResponseSchema;
export type AdminDeleteResponse = z.infer<typeof AdminDeleteResponseSchema>;

export const AdminContentRestoreResponseSchema = MessageResponseSchema;
export type AdminContentRestoreResponse = z.infer<typeof AdminContentRestoreResponseSchema>;

export const AdminActivityPageSchema = CursorPageSchema(ActivitySchema);
export type AdminActivityPage = z.infer<typeof AdminActivityPageSchema>;

export const AdminExportPageSchema = CursorPageSchema(ExportSchema);
export type AdminExportPage = z.infer<typeof AdminExportPageSchema>;
