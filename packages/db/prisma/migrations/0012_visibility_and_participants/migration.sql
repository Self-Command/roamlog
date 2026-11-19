-- Trip visibility `custom` and the participant lifecycle/role (0012).
--
-- P1 of docs/superpowers/specs/2026-11-19-trip-visibility-and-participants-design.md.
--
-- Additive by design:
--   * one new enum value on `TripVisibility` (`custom`);
--   * two brand-new enum types for the participant columns;
--   * `TripParticipant` gains four columns, all with a default or nullable;
--   * one new table (`TripAccessGrant`) plus its indexes and CHECKs.
-- No column is retyped, no row is deleted, and no existing `visibility` value
-- changes: a trip only becomes `custom` when a person explicitly selects it.
--
-- Enum value placement: PostgreSQL 12+ allows `ALTER TYPE ... ADD VALUE` inside
-- a transaction block as long as the freshly added value is not *used* before
-- the transaction commits. `custom` is added here and is never referenced later
-- in this file (no backfill sets it), so the single-statement form is safe on
-- every PostgreSQL version Prisma 7 supports (>= 13) — including the PG 17
-- used by CI and by the shared local database. This was verified with a real
-- `prisma migrate deploy` against a throwaway schema (see
-- `packages/db/src/__tests__/migration.0012.integration.test.ts`); the
-- "create a new enum and retype the column" fallback was not needed.
--
-- CHECK constraints on the enum columns are deliberately kept: the enum types
-- already reject unknown values, and the CHECKs make that domain explicit in
-- the catalog so a future raw-SQL write (or an enum value added without a
-- migration) fails loudly instead of silently widening the domain. Adding a
-- new status/role later therefore means touching the enum, this CHECK, and the
-- contracts schema together.

-- AlterEnum
ALTER TYPE "TripVisibility" ADD VALUE 'custom';

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('invited', 'joined', 'declined');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('viewer', 'editor');

-- AlterTable
ALTER TABLE "TripParticipant" ADD COLUMN "status" "ParticipantStatus" NOT NULL DEFAULT 'invited';
ALTER TABLE "TripParticipant" ADD COLUMN "role" "ParticipantRole" NOT NULL DEFAULT 'viewer';
ALTER TABLE "TripParticipant" ADD COLUMN "invitedById" UUID;
ALTER TABLE "TripParticipant" ADD COLUMN "respondedAt" TIMESTAMPTZ(3);

-- Existing participant rows were people already inside the trip (the old model
-- had no invitation state; the API added them directly), so they are joined
-- members with the previous effective role: read access only.
UPDATE "TripParticipant" SET "status" = 'joined', "role" = 'viewer';

-- CreateTable
CREATE TABLE "TripAccessGrant" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "workspaceId" UUID,
    "userId" UUID,
    "grantedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TripAccessGrant_tripId_workspaceId_key" ON "TripAccessGrant"("tripId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "TripAccessGrant_tripId_userId_key" ON "TripAccessGrant"("tripId", "userId");

-- CreateIndex
CREATE INDEX "TripAccessGrant_tripId_idx" ON "TripAccessGrant"("tripId");

-- AddForeignKey
ALTER TABLE "TripAccessGrant" ADD CONSTRAINT "TripAccessGrant_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A grant targets exactly one principal: a workspace OR a user, never both and
-- never neither. The two unique indexes above only bite on non-NULL values, so
-- a trip may hold many workspace grants and many user grants at the same time.
ALTER TABLE "TripAccessGrant"
ADD CONSTRAINT "TripAccessGrant_target_exclusive_check"
CHECK ((("workspaceId" IS NOT NULL)::int + ("userId" IS NOT NULL)::int) = 1);

-- The participant domain, restated in the catalog: invited | joined | declined.
ALTER TABLE "TripParticipant"
ADD CONSTRAINT "TripParticipant_status_check"
CHECK ("status"::text IN ('invited', 'joined', 'declined'));

-- ... and viewer | editor.
ALTER TABLE "TripParticipant"
ADD CONSTRAINT "TripParticipant_role_check"
CHECK ("role"::text IN ('viewer', 'editor'));