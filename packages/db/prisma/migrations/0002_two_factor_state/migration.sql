-- Add Better Auth two-factor state required by the Better Auth 1.7 twoFactor plugin.
ALTER TABLE "User"
ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "TwoFactor"
ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lockedUntil" TIMESTAMPTZ(3);
