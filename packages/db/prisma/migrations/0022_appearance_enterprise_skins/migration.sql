-- Enterprise appearance catalog (0022).
--
-- Existing stored IDs remain valid so an old cookie or preference row cannot
-- turn into a 500. New writes are normalized by the shared contract resolver
-- before they reach the UI. Platform defaults are rewritten only when they
-- still hold one of the values they are replacing.

ALTER TABLE "UserAppearancePreference"
    DROP CONSTRAINT IF EXISTS "UserAppearancePreference_skin_check";

ALTER TABLE "UserAppearancePreference"
    ADD CONSTRAINT "UserAppearancePreference_skin_check"
    CHECK (
        "skin" IS NULL OR "skin" IN (
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

ALTER TABLE "UserAppearancePreference"
    DROP CONSTRAINT IF EXISTS "UserAppearancePreference_font_pairing_check";

ALTER TABLE "UserAppearancePreference"
    ADD CONSTRAINT "UserAppearancePreference_font_pairing_check"
    CHECK (
        "fontPairing" IS NULL OR "fontPairing" IN (
            'primer-system',
            'primer-cjk',
            'fluent-native',
            'carbon-plex',
            'editorial-classic',
            'literary-warm',
            'modern-editorial',
            'expressive-serif',
            'cjk-editorial',
            'swiss-modern'
        )
    );

-- Skin mapping: editorial-noir -> primer, catppuccin/rose-pine -> fluent,
-- tokyo-night -> carbon, kanagawa/everforest -> carbon-soft.
UPDATE "SystemSetting"
SET "value" = to_jsonb('primer'::text),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'theme.defaultSkin'
  AND "value" = to_jsonb('editorial-noir'::text);

UPDATE "SystemSetting"
SET "value" = to_jsonb('fluent'::text),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'theme.defaultSkin'
  AND "value" IN (
      to_jsonb('catppuccin'::text),
      to_jsonb('rose-pine'::text)
  );

UPDATE "SystemSetting"
SET "value" = to_jsonb('carbon'::text),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'theme.defaultSkin'
  AND "value" = to_jsonb('tokyo-night'::text);

UPDATE "SystemSetting"
SET "value" = to_jsonb('carbon-soft'::text),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'theme.defaultSkin'
  AND "value" IN (
      to_jsonb('kanagawa'::text),
      to_jsonb('everforest'::text)
  );

-- Font mapping: cjk-editorial -> primer-cjk; every other legacy pairing is
-- replaced by the Primer system stack.
UPDATE "SystemSetting"
SET "value" = to_jsonb('primer-cjk'::text),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'theme.defaultFont'
  AND "value" = to_jsonb('cjk-editorial'::text);

UPDATE "SystemSetting"
SET "value" = to_jsonb('primer-system'::text),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'theme.defaultFont'
  AND "value" IN (
      to_jsonb('editorial-classic'::text),
      to_jsonb('literary-warm'::text),
      to_jsonb('modern-editorial'::text),
      to_jsonb('expressive-serif'::text),
      to_jsonb('swiss-modern'::text)
  );
