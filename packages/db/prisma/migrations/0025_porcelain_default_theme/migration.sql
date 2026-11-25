-- Porcelain becomes the platform default while every previously stored skin
-- remains a legal value for cookies, preferences and audit history.
--
-- This migration is intentionally additive: it never rewrites a user's
-- explicit appearance choice and never removes a legacy skin ID.

ALTER TABLE "UserAppearancePreference"
    DROP CONSTRAINT IF EXISTS "UserAppearancePreference_skin_check";

ALTER TABLE "UserAppearancePreference"
    ADD CONSTRAINT "UserAppearancePreference_skin_check"
    CHECK (
        "skin" IS NULL OR "skin" IN (
            'porcelain',
            'primer',
            'fluent',
            'carbon',
            'carbon-soft',
            'editorial-noir',
            'catppuccin',
            'tokyo-night',
            'rose-pine',
            'kanagawa',
            'everforest'
        )
    );

-- Only rewrite the old code-owned default. An operator who explicitly chose
-- Fluent, Carbon, Carbon Soft, or any legacy skin keeps that choice.
UPDATE "SystemSetting"
SET "value" = to_jsonb('porcelain'::text),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'theme.defaultSkin'
  AND "value" = to_jsonb('fluent'::text);
