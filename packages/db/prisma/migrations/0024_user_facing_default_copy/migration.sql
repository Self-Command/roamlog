-- Replace the remaining English platform copy that shipped as a code default
-- before the enterprise localization pass. Only rows that still equal the old
-- default are rewritten; an operator's own copy is preserved.
UPDATE "SystemSetting"
SET "value" = to_jsonb('和同行者一起规划行程、记录旅途，把每一次出发留存下来。'::text),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'site.description'
  AND "value" = to_jsonb('A collaborative travel journal for the trips you take together.'::text);

UPDATE "SystemSetting"
SET "value" = to_jsonb('规划行程、记录日志，和同行者一起收藏每一段旅途。'::text),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'seo.descriptionTemplate'
  AND "value" = to_jsonb('Plan trips, keep a journal, and remember every stop together.'::text);

UPDATE "SystemSetting"
SET "value" = to_jsonb('把每次旅行留下来。'::text),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'theme.loginTagline'
  AND "value" = to_jsonb('Every trip deserves a memory.'::text);
