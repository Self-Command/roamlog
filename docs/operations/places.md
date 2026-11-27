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

Advanced knobs are documented in the templates (commented where the default is
right) and only need changing during an incident or capacity change:

| Variable                           | Default                                                | Allowed range |
| ---------------------------------- | ------------------------------------------------------ | ------------- |
| `GEOAPIFY_URL`                     | `https://api.geoapify.com/v1/geocode/autocomplete`     | http(s) URL   |
| `GEOAPIFY_TIMEOUT_MS`              | `5000` (real Han-query latency is commonly ~2.8 s)     | 1–30000       |
| `PHOTON_URL`                       | `https://photon.komoot.io/api`                         | http(s) URL   |
| `PHOTON_TIMEOUT_MS`                | `2500`                                                 | 1–30000       |
| `PLACES_CACHE_TTL_SECONDS`         | `900` (15 minutes)                                     | 1–86400       |
| `PLACES_EMPTY_CACHE_TTL_SECONDS`   | `30` (empty/degraded results, to protect the upstream) | 1–3600        |
| `PLACES_RATE_LIMIT_MAX`            | `30` per user+IP per window                            | 1–100000      |
| `PLACES_RATE_LIMIT_WINDOW_SECONDS` | `60`                                                   | 1–86400       |
| `PLACES_RATE_LIMIT_TIMEOUT_MS`     | `750`                                                  | 1–5000        |
| `PLACES_REDIS_TIMEOUT_MS`          | `500`                                                  | 1–5000        |
| `PLACES_LANG`                      | `zh`                                                   | `zh` or `en`  |
| `PLACES_LIMIT`                     | `6`                                                    | 1–10          |

`PLACES_LANG` / `PLACES_LIMIT` are defaults for requests that omit the query
parameter; an explicit `lang`/`limit` from the client wins.

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

7. **No key, no backends, no results.** With `GEOAPIFY_API_KEY` empty and
   Photon unreachable, search answers `200 { items: [], degraded: true,
   provider: "geoapify" }`. Search never turns an upstream outage into a 5xx.
   The UI must render an explicit “search unavailable / try later” state, not
   an empty success list.

### Settings vs environment

`PlacesSettingsResolver` resolves the six `places.*` Admin keys per request and
falls back to the environment, then to code defaults. Because no `places.*` key
is env-locked, a value saved in the Admin console **wins over** `GEOAPIFY_*` /
`PLACES_*`; changing only the env file after a save has no effect until the
stored value is cleared/reset. `places.apiKey` is stored encrypted with
`CONFIG_ENCRYPTION_KEY` and is decrypted only inside the resolver. The provider
switch therefore exists in two places: env (for first boot) and Admin
(`places.provider`, for day-2 operations). Keep them in sync when you roll
back.

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

- `apps/web/lib/places-attribution.ts` is the single source of truth:
  - `geoapify` → `Powered by Geoapify · © OpenStreetMap contributors`
    (links to geoapify.com);
  - `photon` → `Search by Photon · © OpenStreetMap contributors`
    (links to photon.komoot.io);
  - `local` (manually typed place) → `手动录入`, **no third-party credit**;
  - `null`/unknown (map-only) → conservative `© OpenStreetMap contributors`.
- Attribution must stay visible on mobile and in reduced-motion layouts; the
  copy object also carries a short variant (`Geoapify · © OSM contributors`) for
  narrow surfaces. Do not hide it behind a tooltip or hover state.
- A deployment that turns Geoapify on must keep the Geoapify credit in the
  search UI. Removing `GEOAPIFY_API_KEY` (or `PLACES_PROVIDER=photon`) changes
  the credit to the Photon variant — do not keep stale Geoapify branding.

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

## 6. Verify it took effect

```bash
# 1. one search through the API
curl -s "$API/v1/places/search?q=kyoto&limit=3" -H "authorization: Bearer $TOKEN" | jq

# expected shape: { items: [...], provider: "geoapify"|"photon", degraded: false, cached: false }
# "degraded": true means the primary failed/over quota; "provider" names who served it.

# 2. cache + quota are visible in Redis
redis-cli KEYS 'places:v3:*' | head
redis-cli GET "places:quota:geoapify:$(date -u +%F)"     # consumed today
redis-cli TTL "places:quota:geoapify:$(date -u +%F)"     # seconds to UTC midnight

# 3. logs
# places.search_completed  {provider, resultCount, degraded:false, durationMs}
# places.upstream_failed   {provider, reason, fallback:"photon"}
# places.cache_bypassed / places.quota_fail_open  -> Redis problem, still serving
```

The UI check is the attribution line: after a successful search the panel must
show `Powered by Geoapify · © OpenStreetMap contributors` (or the Photon
variant). If the credits are missing, treat it as a provider-terms blocker.

## 7. Troubleshooting

| Symptom                                   | Check                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Search always returns Photon results      | `GEOAPIFY_API_KEY` empty, `PLACES_PROVIDER=photon`, or the preflight warning was ignored       |
| Empty list with `degraded: true`    | No usable provider: empty `GEOAPIFY_API_KEY`, Photon down, and/or `PLACES_FALLBACK_TO_PHOTON=false`; this is a 200-by-design, not a crash |
| Credit shows the wrong provider     | `provider` in the response vs `places-attribution.ts`; a saved `places.provider` overrides env |
| Stale results after switching provider | Cache keys are provider-scoped; a saved `places.*` value wins over env, so update the Admin value (or clear it) and restart if the process still holds old settings |
| Quota exhausted early                     | `GEOAPIFY_DAILY_LIMIT` at/below 3000, other deployments sharing the key, UTC rollover time     |
| `places.quota_fail_open` in logs          | Redis unavailable; the cap is not enforced. Restore Redis before relying on the quota          |
| Geoapify results with no credit          | Attribution is code, not config: check the deployed web bundle and `places-attribution.ts`; a release blocker for Geoapify mode |
| Upstream 401/403                          | Key revoked or scoped wrong; rotate in the provider console and update the secret store        |
