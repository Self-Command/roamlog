-- Provider platform configuration (0016).
--
-- Additive by design: five brand-new tables, their indexes and foreign keys.
-- No existing table, column or row is altered. SystemSetting remains the
-- scalar settings store and is deliberately not touched here.
--
-- Provider credentials are split into ProviderSecret (one active credential
-- per provider field) and ProviderSecretHistory (encrypted rollback history,
-- retained for a short operator-controlled window). Plaintext never has a
-- database column. The application encrypts through the existing key ring.

-- CreateTable
CREATE TABLE "ProviderGroupPolicy" (
    "group" VARCHAR(40) NOT NULL,
    "routingMode" VARCHAR(32) NOT NULL DEFAULT 'priority',
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 30,
    "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderGroupPolicy_pkey" PRIMARY KEY ("group")
);

-- CreateTable
CREATE TABLE "ProviderConnection" (
    "id" UUID NOT NULL,
    "group" VARCHAR(40) NOT NULL,
    "adapter" VARCHAR(40) NOT NULL,
    "preset" VARCHAR(40),
    "label" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "config" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "healthStatus" VARCHAR(20) NOT NULL DEFAULT 'unknown',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "cooldownUntil" TIMESTAMPTZ(3),
    "lastCheckedAt" TIMESTAMPTZ(3),
    "lastErrorCode" VARCHAR(80),
    "legacyKey" VARCHAR(120),
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderSecret" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "field" VARCHAR(80) NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "last4" VARCHAR(8),
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProviderSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderSecretHistory" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "field" VARCHAR(80) NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "last4" VARCHAR(8),
    "keyVersion" INTEGER NOT NULL,
    "replacedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProviderSecretHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderModel" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "modelId" VARCHAR(200) NOT NULL,
    "displayName" VARCHAR(160) NOT NULL,
    "ownedBy" VARCHAR(80),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "capabilities" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "discoveredAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProviderModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConnection_group_legacyKey_key" ON "ProviderConnection"("group", "legacyKey");

-- CreateIndex
CREATE INDEX "ProviderConnection_group_deletedAt_enabled_priority_idx" ON "ProviderConnection"("group", "deletedAt", "enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderSecret_providerId_field_key" ON "ProviderSecret"("providerId", "field");

-- CreateIndex
CREATE INDEX "ProviderSecretHistory_providerId_field_expiresAt_idx" ON "ProviderSecretHistory"("providerId", "field", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderModel_providerId_modelId_key" ON "ProviderModel"("providerId", "modelId");

-- CreateIndex
CREATE INDEX "ProviderModel_providerId_enabled_idx" ON "ProviderModel"("providerId", "enabled");

-- AddForeignKey
ALTER TABLE "ProviderSecret" ADD CONSTRAINT "ProviderSecret_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "ProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderSecretHistory" ADD CONSTRAINT "ProviderSecretHistory_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "ProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderModel" ADD CONSTRAINT "ProviderModel_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "ProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Allow-lists and range checks. The API repeats these through Zod because the
-- database must reject hand-written or older-client writes too.
ALTER TABLE "ProviderGroupPolicy" ADD CONSTRAINT "ProviderGroupPolicy_group_check"
  CHECK ("group" IN ('ai', 'places', 'mail', 'storage'));

ALTER TABLE "ProviderGroupPolicy" ADD CONSTRAINT "ProviderGroupPolicy_routingMode_check"
  CHECK (
    ("group" = 'ai' AND "routingMode" = 'priority')
    OR ("group" = 'places' AND "routingMode" IN ('merge', 'priority_failover'))
    OR ("group" IN ('mail', 'storage') AND "routingMode" = 'single')
  );

ALTER TABLE "ProviderGroupPolicy" ADD CONSTRAINT "ProviderGroupPolicy_attempts_check"
  CHECK ("maxAttempts" >= 0 AND "cooldownSeconds" >= 0);

ALTER TABLE "ProviderGroupPolicy" ADD CONSTRAINT "ProviderGroupPolicy_version_check"
  CHECK ("version" > 0);

ALTER TABLE "ProviderGroupPolicy" ADD CONSTRAINT "ProviderGroupPolicy_config_check"
  CHECK (jsonb_typeof("config") = 'object');

ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_group_check"
  CHECK ("group" IN ('ai', 'places', 'mail', 'storage'));

ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_adapter_check"
  CHECK (length("adapter") BETWEEN 1 AND 40);

ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_priority_check"
  CHECK ("priority" >= 0);

ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_version_check"
  CHECK ("version" > 0);

ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_healthStatus_check"
  CHECK ("healthStatus" IN ('unknown', 'healthy', 'degraded', 'unhealthy'));

ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_failures_check"
  CHECK ("consecutiveFailures" >= 0);

ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_config_check"
  CHECK (jsonb_typeof("config") = 'object');

ALTER TABLE "ProviderSecret" ADD CONSTRAINT "ProviderSecret_field_check"
  CHECK (length("field") BETWEEN 1 AND 80);

ALTER TABLE "ProviderSecret" ADD CONSTRAINT "ProviderSecret_ciphertext_check"
  CHECK (length("ciphertext") > 0);

ALTER TABLE "ProviderSecret" ADD CONSTRAINT "ProviderSecret_last4_check"
  CHECK ("last4" IS NULL OR length("last4") <= 8);

ALTER TABLE "ProviderSecret" ADD CONSTRAINT "ProviderSecret_versions_check"
  CHECK ("keyVersion" > 0 AND "version" > 0);

ALTER TABLE "ProviderSecretHistory" ADD CONSTRAINT "ProviderSecretHistory_field_check"
  CHECK (length("field") BETWEEN 1 AND 80);

ALTER TABLE "ProviderSecretHistory" ADD CONSTRAINT "ProviderSecretHistory_ciphertext_check"
  CHECK (length("ciphertext") > 0);

ALTER TABLE "ProviderSecretHistory" ADD CONSTRAINT "ProviderSecretHistory_expiry_check"
  CHECK ("expiresAt" > "replacedAt");

ALTER TABLE "ProviderModel" ADD CONSTRAINT "ProviderModel_modelId_check"
  CHECK (length("modelId") BETWEEN 1 AND 200);

ALTER TABLE "ProviderModel" ADD CONSTRAINT "ProviderModel_displayName_check"
  CHECK (length("displayName") BETWEEN 1 AND 160);

ALTER TABLE "ProviderModel" ADD CONSTRAINT "ProviderModel_capabilities_check"
  CHECK (jsonb_typeof("capabilities") = 'object');
