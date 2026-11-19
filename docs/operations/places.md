# Place search (Geoapify + Photon)

Status: implemented by the `C` places slice. Geoapify is the primary
autocomplete source; Photon is the fallback and the rollback switch. The
module is server-side only — the Geoapify key must never reach the browser.

Related files:

- `apps/api/src/modules/places/places.settings.ts` — environment parsing and defaults
- `apps/api/src/modules/places/geoapify.client.ts`, `photon.client.ts`
- `apps/api/src/modules/places/places-cache.service.ts`, `places-quota.service.ts`
- `apps/api/src/modules/places/places-rate-limiter.service.ts`
- `apps/web/components/map/map-canvas.tsx` — current OpenStreetMap credit
- `docker/production.env.example`, `.env.example`

## 1. Variables

| Variable                    | Required | Default            | Notes                                                                 |
| --------------------------- | -------- | ------------------ | --------------------------------------------------------------------- |
| `PLACES_PROVIDER`           | no       | `geoapify`         | `geoapify` or `photon`; `photon` is the rollback switch               |
| `GEOAPIFY_API_KEY`          | no       | empty              | Server-side key. Empty means Geoapify is skipped and fallback applies |
| `PLACES_FALLBACK_TO_PHOTON` | no       | `true`             | Serve results from Photon when Geoapify is missing/failing/over quota |
| `GEOAPIFY_DAILY_LIMIT`      | no       | `3000` (free plan) | Redis counter per UTC day; `0` disables the cap                       |

Advanced knobs keep their code defaults and are normally not set in the
templates:

| Variable                           | Default                                                |
| ---------------------------------- | ------------------------------------------------------ |
| `GEOAPIFY_URL`                     | `https://api.geoapify.com/v1/geocode/autocomplete`     |
| `GEOAPIFY_TIMEOUT_MS`              | `1200` (the 1.2 s budget for the primary source)       |
| `PHOTON_URL`                       | `https://photon.komoot.io/api`                         |
| `PHOTON_TIMEOUT_MS`                | `2500`                                                 |
| `PLACES_CACHE_TTL_SECONDS`         | `900` (15 minutes)                                     |
| `PLACES_EMPTY_CACHE_TTL_SECONDS`   | `30` (empty/degraded results, to protect the upstream) |
| `PLACES_RATE_LIMIT_MAX`            | `30` per user+IP per window                            |
| `PLACES_RATE_LIMIT_WINDOW_SECONDS` | `60`                                                   |
| `PLACES_RATE_LIMIT_TIMEOUT_MS`     | `750`                                                  |
| `PLACES_REDIS_TIMEOUT_MS`          | `500`                                                  |

`pnpm check:env` validates the provider enum, the fallback flag, the daily cap
and warns when `PLACES_PROVIDER=geoapify` has no key but still has the fallback.
It errors if the fallback is disabled on top of a missing key (no provider left).

## 2. Behavior

1. The API tries Geoapify first unless `PLACES_PROVIDER=photon`.
2. Results are normalized to the strict `PlaceSearchResponse` contract.
3. A Redis cache answers repeated queries before any upstream call. The key is
   `places:v3:{provider}:{sha256(trim+lowercase(q)|limit|lang)}`, so raw query
   text never appears in Redis and switching provider cannot serve the other
   provider's cached payload.
4. A Redis daily counter (`places:quota:geoapify:<UTC date>`) is consumed
   **before** the Geoapify call. At the cap, Geoapify is skipped; Photon serves
   when the fallback is enabled. The counter expires at the next UTC midnight.
5. Cache and quota accesses are best-effort: Redis failures log
   `places.cache_bypassed` / `places.quota_fail_open` and never make search
   unavailable.
6. Photon is used when Geoapify has no key, times out, errors, or is over quota.
   With `PLACES_FALLBACK_TO_PHOTON=false` those cases surface as a degraded
   search instead.

The Admin settings registry also exposes `places.provider`, `places.apiKey`,
`places.cacheTtlSeconds` and `places.dailyQuota`. In this slice the Places
module resolves `process.env` only (`places.settings.ts`); environment is the
source of truth for deployment. A key saved as an encrypted Admin setting uses
`CONFIG_ENCRYPTION_KEY` and must not be assumed to reach this module until the
wiring lands.

## 3. Quota and caching strategy

- Geoapify's free plan allows **3,000 requests per day**. One autocomplete
  request consumes one request. Above the cap the provider returns errors;
  the module avoids that by stopping at `GEOAPIFY_DAILY_LIMIT` and falling back.
- The default cap equals the free plan. Raise it only with a paid plan and a
  note in the change record; lower it to leave headroom for retries.
- The counter resets at UTC midnight (`secondsUntilUtcMidnight`). A burst just
  before midnight can split across two days; that is expected.
- The cache is short-lived by design: 15 minutes for good results, 30 seconds
  for empty/degraded results, so a typo does not hammer the upstream.
- Do not raise the TTL to days/weeks to save quota without checking the
  provider terms (see below). The cache is an interactive latency/upstream
  guard, not a geo database.

## 4. Attribution and terms

**Required attribution.** Geoapify requires attribution for displayed results,
and the map tiles/data require OpenStreetMap credit. The product must show:

> © OpenStreetMap contributors / Powered by Geoapify

- The map already renders a `© OpenStreetMap` credit
  (`apps/web/components/map/map-canvas.tsx`).
- A **`Powered by Geoapify`** credit next to place-search results is not
  present yet. Add it in the search panel before enabling Geoapify results in a
  public deployment; removing the `GEOAPIFY_API_KEY` falls back to Photon and
  only the OpenStreetMap credit is required.
- Attribution must stay visible on mobile and in reduced-motion layouts; do not
  hide it behind a tooltip or hover state.

**Terms and caching boundaries.** Verify the current terms before a public
launch: <https://www.geoapify.com/> and
<https://www.openstreetmap.org/copyright>. In particular:

- Do not redistribute, resell, or export a bulk Geoapify/OSM dataset from the
  cached responses; the Redis cache must stay short-lived.
- Do not build a long-term place database by mirroring provider responses.
  Persisting a **user-selected** place (name, address, lat/lng, time zone, bbox,
  provider) as trip content is user data; it is not a provider export.
- If the product needs long-term storage of provider results, a search archive,
  or offline bundles, confirm the plan's storage/redistribution rights first.
- Keep queries bounded (the API validates input and rate-limits per user+IP).

## 5. Switching provider

To roll back to Photon during a Geoapify incident:

```dotenv
PLACES_PROVIDER=photon
```

Restart the API. Cache entries are provider-scoped, so no stale Geoapify payload
is served as Photon data. Geoapify-specific variables can stay set; they are
simply unused while the provider is `photon`.

To go back to Geoapify:

```dotenv
PLACES_PROVIDER=geoapify
GEOAPIFY_API_KEY=<from the secret store>
PLACES_FALLBACK_TO_PHOTON=true
```

Verify one search end to end, the attribution credit, and the quota counter
(`places:quota:geoapify:<date>` in Redis) before declaring recovery.

## 6. Troubleshooting

| Symptom                                   | Check                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Search always returns Photon results      | `GEOAPIFY_API_KEY` empty, `PLACES_PROVIDER=photon`, or the preflight warning was ignored       |
| No results at all                         | Both providers down or `PLACES_FALLBACK_TO_PHOTON=false`; inspect API logs and upstream status |
| Quota exhausted early                     | `GEOAPIFY_DAILY_LIMIT` at/below 3000, other deployments sharing the key, UTC rollover time     |
| `places.quota_fail_open` in logs          | Redis unavailable; the cap is not enforced. Restore Redis before relying on the quota          |
| Stale results after switching provider    | Cache keys are provider-scoped; restart the API if the process still holds old settings        |
| Map shows Geoapify results without credit | Add `Powered by Geoapify` next to the results; this is a release blocker for Geoapify mode     |
| Upstream 401/403                          | Key revoked or scoped wrong; rotate in the provider console and update the secret store        |
