-- The trendy enterprise catalog adds four new skins while keeping every
-- previously stored ID legal. Existing user preferences are never rewritten.

ALTER TABLE "UserAppearancePreference"
    DROP CONSTRAINT IF EXISTS "UserAppearancePreference_skin_check";

ALTER TABLE "UserAppearancePreference"
    ADD CONSTRAINT "UserAppearancePreference_skin_check"
    CHECK (
        "skin" IS NULL OR "skin" IN (
            'mist',
            'geist',
            'iris',
            'sandstone',
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

-- Move only the old code-owned default. An operator who explicitly chose
-- Porcelain, Fluent, Carbon, Carbon Soft, or a legacy skin keeps that choice.
UPDATE "SystemSetting"
SET "value" = to_jsonb('mist'::text),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'theme.defaultSkin'
  AND "value" = to_jsonb('porcelain'::text);
