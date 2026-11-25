-- The platform default is the native Fluent 2 enterprise theme.
-- Only rewrite values that still hold the previous platform default; a user
-- or operator choice of Primer remains untouched.
UPDATE "SystemSetting"
SET "value" = to_jsonb('fluent'::text),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'theme.defaultSkin'
  AND "value" = to_jsonb('primer'::text);

UPDATE "SystemSetting"
SET "value" = to_jsonb('fluent-native'::text),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'theme.defaultFont'
  AND "value" = to_jsonb('primer-system'::text);
