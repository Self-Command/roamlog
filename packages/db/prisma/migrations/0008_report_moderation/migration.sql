-- Content moderation: user reports, moderator decisions, and the admin
-- takedown marker that is kept separate from the author's `deletedAt`.
--
-- Additive only: two new tables and two nullable columns on each moderated
-- content table. No existing column, row or constraint is touched, so the
-- 0007 dataset survives the migration unchanged and every pre-existing row
-- reads as "not moderated".

-- CreateTable
CREATE TABLE "Report" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" VARCHAR(1000),
    "reporterId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolutionNote" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_workspaceId_targetType_targetId_idx" ON "Report"("workspaceId", "targetType", "targetId");

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "note" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModerationAction_reportId_idx" ON "ModerationAction"("reportId");

-- AlterTable (admin takedown marker; `deletedAt` stays the author's delete)
ALTER TABLE "Trip" ADD COLUMN "moderatedAt" TIMESTAMPTZ(3);
ALTER TABLE "Trip" ADD COLUMN "moderatedById" UUID;

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN "moderatedAt" TIMESTAMPTZ(3);
ALTER TABLE "JournalEntry" ADD COLUMN "moderatedById" UUID;

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN "moderatedAt" TIMESTAMPTZ(3);
ALTER TABLE "Comment" ADD COLUMN "moderatedById" UUID;

-- AlterTable
ALTER TABLE "Media" ADD COLUMN "moderatedAt" TIMESTAMPTZ(3);
ALTER TABLE "Media" ADD COLUMN "moderatedById" UUID;

-- Allow-lists. The API validates the same sets through Zod enums, but the
-- database has to reject a bad value too: moderation decisions are evidence.
ALTER TABLE "Report" ADD CONSTRAINT "Report_targetType_check"
  CHECK ("targetType" IN ('trip', 'entry', 'comment', 'media'));

ALTER TABLE "Report" ADD CONSTRAINT "Report_reason_check"
  CHECK ("reason" IN ('spam', 'harassment', 'private_info', 'illegal', 'other'));

ALTER TABLE "Report" ADD CONSTRAINT "Report_status_check"
  CHECK ("status" IN ('open', 'in_review', 'resolved', 'dismissed'));

ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_action_check"
  CHECK ("action" IN ('remove', 'restore', 'warn', 'dismiss'));