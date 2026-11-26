-- Mercury becomes the platform default while every previously stored skin
-- remains legal for cookies, preferences and audit history.
--
-- The source palette is pinned to the awesome-design-md Mercury analysis
-- (MIT, upstream fcc70284932276d085f01ef9f83edde90b1258cb). This migration
-- changes identifiers and defaults only; it never changes layout.

ALTER TABLE "UserAppearancePreference"
    DROP CONSTRAINT IF EXISTS "UserAppearancePreference_skin_check";

ALTER TABLE "UserAppearancePreference"
    ADD CONSTRAINT "UserAppearancePreference_skin_check"
    CHECK (
        "skin" IS NULL OR "skin" IN (
            'mercury',
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

-- Only rewrite the old code-owned default. An operator who explicitly chose
-- Mist, Porcelain, Fluent, Carbon, Carbon Soft, or a legacy skin keeps it.
UPDATE "SystemSetting"
SET "value" = to_jsonb('mercury'::text),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'theme.defaultSkin'
  AND "value" = to_jsonb('mist'::text);

-- The product owner explicitly selected Mercury. Keep this update scoped to
-- the exact account and only replace the previous explicit default; never
-- create an account or overwrite a different operator-chosen skin.
UPDATE "UserAppearancePreference" AS preference
SET "skin" = 'mercury',
    "updatedAt" = CURRENT_TIMESTAMP
FROM "User" AS account
WHERE preference."userId" = account."id"
  AND lower(account."email") = lower('by9700@qq.com')
  AND preference."skin" = 'mist';
