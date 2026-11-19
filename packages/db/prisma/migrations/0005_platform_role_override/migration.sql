-- Admin permission-matrix overrides. Additive only: one new table, no existing
-- table, row, enum or index is read, rewritten or dropped. Rows store only the
-- diff against the code-owned matrix in `packages/contracts/src/permissions.ts`,
-- so a fresh database behaves exactly like the compiled defaults.

-- CreateTable
CREATE TABLE "PlatformRoleOverride" (
    "role" "PlatformRole" NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformRoleOverride_pkey" PRIMARY KEY ("role", "action")
);

-- CreateIndex
CREATE INDEX "PlatformRoleOverride_updatedById_idx" ON "PlatformRoleOverride"("updatedById");