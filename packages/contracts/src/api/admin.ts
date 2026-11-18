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
import {
  AccountStatusSchema,
  AuditActorTypeSchema,
  EmailStatusSchema,
  ExportStatusSchema,
  MemberStatusSchema,
  WorkspacePlanSchema,
} from "../entities/enums";
import { EmailLogSchema } from "../entities/email-log";
import { ExportSchema } from "../entities/export";
import { FeatureFlagSchema } from "../entities/feature-flag";
import { InvitationSchema } from "../entities/invitation";
import { JournalEntrySchema } from "../entities/journal";
import { MediaSchema } from "../entities/media";
import { TripSchema } from "../entities/trip";
import { UserSchema } from "../entities/user";
import { WorkspaceSchema } from "../entities/workspace";
import { PlatformRoleSchema, WorkspaceRoleSchema } from "../permissions";
import { MessageResponseSchema } from "./common";

/**
 * Real BullMQ queue counters read from Redis. `throughputPerMinute` is derived
 * from the timestamps BullMQ writes into the `completed` sorted set inside a
 * fixed sliding window; it is `null` when Redis cannot provide the window, so
 * clients must render an explicit "not wired" state instead of a number.
 *
 * The operational extras stay optional so snapshots captured before this
 * expansion (dashboard fixtures, cached responses) remain valid and are
 * rendered as "not wired" rather than as fabricated zeros.
 */
export const AdminQueueMetricsSchema = z
  .object({
    name: z.string().min(1).max(80),
    waiting: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    delayed: z.number().int().nonnegative().optional(),
    paused: z.boolean(),
    throughputPerMinute: z.number().nonnegative().nullable().optional(),
    throughputWindowSeconds: z.number().int().positive().nullable().optional(),
    lastCompletedAt: IsoTimestampSchema.nullable().optional(),
    lastFailedAt: IsoTimestampSchema.nullable().optional(),
  })
  .strict();
export type AdminQueueMetrics = z.infer<typeof AdminQueueMetricsSchema>;

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
    emails: z.record(EmailStatusSchema, z.number().int().nonnegative()).optional(),
    queues: z.array(AdminQueueMetricsSchema),
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

export const AdminUserListItemSchema = UserSchema.extend({
  activeSessionCount: z.number().int().nonnegative().optional(),
});
export type AdminUserListItem = z.infer<typeof AdminUserListItemSchema>;

export const AdminUserPageSchema = CursorPageSchema(AdminUserListItemSchema);
export type AdminUserPage = z.infer<typeof AdminUserPageSchema>;

export const AdminUserMembershipSchema = z
  .object({
    workspaceId: UuidV7Schema,
    workspaceName: z.string().min(1).max(120),
    workspaceSlug: z.string().min(1).max(120),
    role: WorkspaceRoleSchema,
    status: MemberStatusSchema,
    joinedAt: IsoTimestampSchema,
  })
  .strict();
export type AdminUserMembership = z.infer<typeof AdminUserMembershipSchema>;

export const AdminUserSessionSchema = z
  .object({
    id: UuidV7Schema,
    ipAddress: z.string().max(64).nullable(),
    userAgent: z.string().max(2048).nullable(),
    createdAt: IsoTimestampSchema,
    expiresAt: IsoTimestampSchema,
  })
  .strict();
export type AdminUserSession = z.infer<typeof AdminUserSessionSchema>;

export const AdminUserDetailSchema = UserSchema.extend({
  workspaceCount: z.number().int().nonnegative(),
  tripCount: z.number().int().nonnegative(),
  entryCount: z.number().int().nonnegative(),
  activeSessionCount: z.number().int().nonnegative(),
  // Optional so fixtures written before the operational detail expansion remain valid.
  twoFactorEnabled: z.boolean().optional(),
  commentCount: z.number().int().nonnegative().optional(),
  mediaCount: z.number().int().nonnegative().optional(),
  workspaces: z.array(AdminUserMembershipSchema).optional(),
  sessions: z.array(AdminUserSessionSchema).optional(),
});
export type AdminUserDetail = z.infer<typeof AdminUserDetailSchema>;

export const AdminUserExportQuerySchema = AdminUserQuerySchema.omit({
  cursor: true,
  limit: true,
});
export type AdminUserExportQuery = z.infer<typeof AdminUserExportQuerySchema>;

export const AdminUserCsvResponseSchema = z
  .string()
  .describe(
    "UTF-8 CSV attachment. Columns: id, email, emailVerified, name, platformRole, status, createdAt, lastActiveAt, deletedAt.",
  );
export type AdminUserCsvResponse = z.infer<typeof AdminUserCsvResponseSchema>;

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

export const AdminWorkspaceOwnerSchema = UserSchema.pick({
  id: true,
  name: true,
  email: true,
  image: true,
});
export type AdminWorkspaceOwner = z.infer<typeof AdminWorkspaceOwnerSchema>;

export const AdminWorkspaceMemberSchema = z
  .object({
    userId: UuidV7Schema,
    name: z.string().min(1).max(120),
    email: EmailSchema,
    image: z.url().nullable(),
    role: WorkspaceRoleSchema,
    status: MemberStatusSchema,
    joinedAt: IsoTimestampSchema,
  })
  .strict();
export type AdminWorkspaceMember = z.infer<typeof AdminWorkspaceMemberSchema>;

export const AdminWorkspaceListItemSchema = WorkspaceSchema.extend({
  owner: AdminWorkspaceOwnerSchema.optional(),
  memberCount: z.number().int().nonnegative().optional(),
  tripCount: z.number().int().nonnegative().optional(),
  entryCount: z.number().int().nonnegative().optional(),
  mediaCount: z.number().int().nonnegative().optional(),
  mediaBytes: z.number().int().nonnegative().optional(),
});
export type AdminWorkspaceListItem = z.infer<typeof AdminWorkspaceListItemSchema>;

export const AdminWorkspacePageSchema = CursorPageSchema(AdminWorkspaceListItemSchema);
export type AdminWorkspacePage = z.infer<typeof AdminWorkspacePageSchema>;

export const AdminWorkspaceDetailSchema = WorkspaceSchema.extend({
  memberCount: z.number().int().nonnegative(),
  tripCount: z.number().int().nonnegative(),
  entryCount: z.number().int().nonnegative(),
  owner: AdminWorkspaceOwnerSchema,
  // Optional so fixtures written before the operational detail expansion remain valid.
  mediaCount: z.number().int().nonnegative().optional(),
  mediaBytes: z.number().int().nonnegative().optional(),
  members: z.array(AdminWorkspaceMemberSchema).optional(),
  invitations: z.array(InvitationSchema).optional(),
});
export type AdminWorkspaceDetail = z.infer<typeof AdminWorkspaceDetailSchema>;

export const AdminWorkspaceExportQuerySchema = AdminWorkspaceQuerySchema.omit({
  cursor: true,
  limit: true,
});
export type AdminWorkspaceExportQuery = z.infer<typeof AdminWorkspaceExportQuerySchema>;

export const AdminWorkspaceCsvResponseSchema = z
  .string()
  .describe(
    "UTF-8 CSV attachment. Columns: id, name, slug, ownerId, plan, status, defaultCurrency, timezone, memberCount, tripCount, entryCount, mediaBytes, createdAt, updatedAt, deletedAt.",
  );
export type AdminWorkspaceCsvResponse = z.infer<typeof AdminWorkspaceCsvResponseSchema>;

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

export const FeatureFlagKeySchema = z
  .string()
  .min(2)
  .max(80)
  .regex(
    /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/,
    "Feature flag keys use lowercase segments separated by '.', '_' or '-'.",
  );
export type FeatureFlagKey = z.infer<typeof FeatureFlagKeySchema>;

export const CreateFeatureFlagRequestSchema = z
  .object({
    key: FeatureFlagKeySchema,
    description: z.string().trim().min(1).max(500),
    enabled: z.boolean().default(false),
    rolloutPercentage: z.number().int().min(0).max(100).default(0),
    rules: JsonObjectSchema.optional(),
  })
  .strict();
export type CreateFeatureFlagRequest = z.infer<typeof CreateFeatureFlagRequestSchema>;

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

/**
 * Worker health as far as it can actually be proven without a worker heartbeat.
 *
 * - `consumer-clients`: counted from Redis `CLIENT LIST` entries blocked inside a
 *   BullMQ blocking call (`BZPOPMIN` on the queue marker). This is a direct
 *   observation of live consumers.
 * - `activity-derived`: no blocked consumer was observed, so the status is
 *   inferred from the newest job completion/failure timestamp plus the queue
 *   counters. Clients must show the derivation.
 * - `unavailable`: neither signal could be obtained; clients must render
 *   "not wired" instead of a fabricated `down`.
 */
export const AdminWorkerSignalSchema = z.enum([
  "consumer-clients",
  "activity-derived",
  "unavailable",
]);
export type AdminWorkerSignal = z.infer<typeof AdminWorkerSignalSchema>;

export const AdminSystemWorkerSchema = z
  .object({
    status: z.enum(["up", "degraded", "down"]),
    version: z.string().min(1).max(40),
    consumers: z.number().int().nonnegative(),
    signal: AdminWorkerSignalSchema,
    blockedConsumers: z.number().int().nonnegative(),
    lastJobAt: IsoTimestampSchema.nullable(),
    lastJobStatus: z.enum(["completed", "failed"]).nullable(),
    lastJobQueue: z.string().min(1).max(80).nullable(),
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
    // Null when the deployment does not inject a build timestamp; clients must
    // render "not wired" instead of substituting the container start time.
    buildTime: IsoTimestampSchema.nullable(),
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
