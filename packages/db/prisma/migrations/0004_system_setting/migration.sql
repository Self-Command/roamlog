-- Runtime platform settings. Additive only: no existing table or row is read,
-- rewritten, or dropped. Defaults live in code (`DEFAULT_SETTINGS`), so this
-- migration deliberately seeds zero rows and a fresh/current database behaves
-- identically until an operator saves a value.

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" VARCHAR(120) NOT NULL,
    "group" VARCHAR(40) NOT NULL,
    "valueType" VARCHAR(16) NOT NULL,
    "value" JSONB,
    "secretCipher" TEXT,
    "secretLast4" VARCHAR(8),
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "envLocked" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key"),
    -- The registry owns the typing rules; this constraint keeps a hand-written
    -- SQL insert from creating a row no service can ever read.
    CONSTRAINT "SystemSetting_valueType_check" CHECK ("valueType" IN ('string', 'number', 'boolean', 'json', 'secret')),
    -- A secret row must carry ciphertext and must not carry a plaintext value.
    CONSTRAINT "SystemSetting_secret_shape_check" CHECK (
        ("valueType" = 'secret' AND "secretCipher" IS NOT NULL AND "value" IS NULL)
        OR ("valueType" <> 'secret' AND "secretCipher" IS NULL)
    )
);

-- CreateIndex
CREATE INDEX "SystemSetting_group_idx" ON "SystemSetting"("group");