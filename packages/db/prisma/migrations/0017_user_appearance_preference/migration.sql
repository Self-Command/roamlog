-- Per-user appearance overrides (0017).
--
-- Additive by design: one new table, its primary key, foreign key and
-- allow-list CHECK constraints. No existing table or row is altered. Nullable
-- columns mean "inherit the platform default"; no rows are backfilled.

-- CreateTable
CREATE TABLE "UserAppearancePreference" (
    "userId" UUID NOT NULL,
    "mode" VARCHAR(16),
    "skin" VARCHAR(40),
    "fontPairing" VARCHAR(40),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserAppearancePreference_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "UserAppearancePreference_mode_check"
        CHECK ("mode" IS NULL OR "mode" IN ('system', 'light', 'dark')),
    CONSTRAINT "UserAppearancePreference_skin_check"
        CHECK (
            "skin" IS NULL OR "skin" IN (
                'editorial-noir',
                'catppuccin',
                'tokyo-night',
                'rose-pine',
                'kanagawa',
                'everforest'
            )
        ),
    CONSTRAINT "UserAppearancePreference_font_pairing_check"
        CHECK (
            "fontPairing" IS NULL OR "fontPairing" IN (
                'editorial-classic',
                'literary-warm',
                'modern-editorial',
                'expressive-serif',
                'cjk-editorial',
                'swiss-modern'
            )
        )
);

-- AddForeignKey
ALTER TABLE "UserAppearancePreference"
    ADD CONSTRAINT "UserAppearancePreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
