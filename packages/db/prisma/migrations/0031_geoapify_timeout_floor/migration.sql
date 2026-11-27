-- Raise persisted Geoapify timeouts that are below the measured production
-- latency envelope.
--
-- The provider default and tenant defaults now use 5 s. Existing provider
-- rows created by the old shared map form still carry 2 s, which aborted real
-- Geoapify searches around 2.0 s before the upstream could answer.
--
-- Only active Geoapify rows with an explicit integer timeout below 5000 ms are
-- changed. Custom values at or above the floor, missing values, soft-deleted
-- rows and malformed values are left untouched. Incrementing `version` makes
-- stale admin editors detect the change instead of silently overwriting it.
-- The changed rows are reset to `unknown` health so the admin console does not
-- keep claiming `healthy` from a probe that predates the new configuration.

UPDATE "ProviderConnection"
SET
  "config" = jsonb_set("config", '{timeoutMs}', to_jsonb(5000), true),
  "version" = "version" + 1,
  "healthStatus" = 'unknown',
  "consecutiveFailures" = 0,
  "cooldownUntil" = NULL,
  "lastCheckedAt" = NULL,
  "lastErrorCode" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "group" = 'places'
  AND "adapter" = 'geoapify'
  AND "deletedAt" IS NULL
  AND "config" ? 'timeoutMs'
  AND jsonb_typeof("config"->'timeoutMs') = 'number'
  AND ("config"->>'timeoutMs')::numeric < 5000;
