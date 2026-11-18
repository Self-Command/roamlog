# Media delivery in production

Status: implemented by `W0_STORAGE_INFRA`. Covers the public media host, the
two-endpoint signing model, MinIO bucket CORS, signed-URL lifetimes and the
`403 SignatureDoesNotMatch` failure mode that this design exists to prevent.

Related files:

- `apps/api/src/config/{storage-settings,environment,app-config.service}.ts` — configuration surface
- `apps/api/src/modules/storage/storage.service.ts` — the two S3 clients
- `docker/minio-init/01-create-bucket.sh` — private bucket + CORS
- `docker/compose.production.yml`, `docker/production.env.example`
- `deploy/nginx/media.conf.example` — the public media server block

## 1. The problem this solves

Workspace media is private, so the API hands the browser **presigned** URLs.
SigV4 presigned URLs are not bearer tokens that can be rewritten: the signature
covers the canonical request, and for S3 that canonical request includes the
`Host` header. A URL signed for `http://minio:9000/...` therefore only validates
when the request actually arrives with `Host: minio:9000`.

In the old single-endpoint setup the API signed against the internal Docker name,
so every browser request failed: DNS does not resolve `minio` outside the compose
network, and a proxy that forwards a different `Host` gets
`403 SignatureDoesNotMatch` from MinIO.

You cannot fix this by rewriting `/media/...` to the internal endpoint either:
the canonical request (host + path + query) is part of the signature.

## 2. Architecture

```
                       sign with S3_PUBLIC_ENDPOINT        request with Host: media.example.com
  API / worker  ───────────────────────────────────────▶  browser
  (container)        GET  https://media.example.com/bucket/key?X-Amz-...
                     PUT  https://media.example.com/bucket/key?X-Amz-...
        │                                                        │
        │ server-side S3 calls only                              │ HTTPS (valid cert for media host)
        ▼                                                        ▼
  S3_ENDPOINT = http://minio:9000                        nginx media server block
  HEAD / DELETE / healthcheck                            proxy_pass http://127.0.0.1:19000
        │                                                proxy_set_header Host $host   ◀── critical
        └────────────────────▶ MinIO ◀───────────────────────────┘
                                  verifies SigV4 over Host: media.example.com
```

Two clients, one configuration object:

| Client          | Endpoint                                   | Used for                                                                 |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| `client`        | `S3_ENDPOINT` (internal, `http://minio:9000`) | `HeadObjectCommand` (complete upload), `DeleteObjectCommand`, `HeadBucketCommand` (readiness) |
| `signingClient` | `S3_PUBLIC_ENDPOINT` (public TLS origin)    | `getSignedUrl` for presigned GET (reads) and presigned PUT (uploads)       |

Both share bucket, region, credentials and `S3_FORCE_PATH_STYLE`. The signing
client is created from the same settings with only the endpoint swapped, so the
signature, expiry handling and key validation stay identical.

If `S3_PUBLIC_ENDPOINT` is empty the signing client falls back to `S3_ENDPOINT`.
That keeps local development and staging working exactly as before (media is then
only reachable from inside the network — acceptable for API tests, not for a
browser).

`S3_PUBLIC_BASE_URL` is optional and **currently unused**: it exists for a future
unsigned CDN origin. Private workspace media must keep going through presigned
URLs, so nothing in the API builds URLs from it.

### Path-style vs virtual-host style

`S3_FORCE_PATH_STYLE=true` (the production default) makes signed URLs look like
`https://media.example.com/<bucket>/<key>`, so **one** hostname, one certificate
and one nginx server block are enough. If you ever turn path-style off, URLs
become `https://<bucket>.media.example.com/<key>` and you need a wildcard DNS
record plus a wildcard certificate (or per-bucket server blocks). Keep path-style.

## 3. Configuration reference

| Variable                         | Required in production | Default | Meaning |
| -------------------------------- | ---------------------- | ------- | ------- |
| `S3_ENDPOINT`                     | yes                    | —       | Internal S3 API endpoint used by the API/worker. `http://minio:9000`. |
| `S3_PUBLIC_ENDPOINT`              | **yes**                | falls back to `S3_ENDPOINT` | Browser-facing origin used only for presigning. Must be `https:`, a public host, and an origin without a path or credentials. `https://media.example.com`. |
| `S3_PUBLIC_BASE_URL`              | no                     | empty   | Reserved unsigned-CDN origin. Validated with the same rules when set. Currently unused. |
| `MEDIA_SIGNED_URL_TTL_SECONDS`    | no                     | `900`   | Lifetime of media read/upload URLs. Range `60`–`604800`. |
| `MEDIA_CORS_ORIGINS`              | yes (for browser uploads) | `http://localhost:3000` | Comma-separated browser origins for the bucket CORS policy. Production: `https://we.example.com`. |

Production refusals (API does not boot, `APP_ENV=production`):

- `S3_PUBLIC_ENDPOINT` missing;
- not `https:`;
- host is `minio`, `localhost`, `127.0.0.1`, a private IPv4 (`10/8`, `172.16/12`,
  `192.168/16`, `169.254/16`), an IPv6 literal, `*.local` / `*.internal`, or a
  single-label hostname;
- URL embeds credentials, or has a path;
- value still contains a placeholder fragment (`CHANGE_ME`, `your-`, ...).

Validation messages name the variable and never echo the S3 keys or the rejected
URL. `docker compose config` also fails early because the API service declares
`S3_PUBLIC_ENDPOINT` as `${S3_PUBLIC_ENDPOINT:?...}`.

Staging (`APP_ENV=staging`) is deliberately exempt: it keeps `NODE_ENV=production`
for Node runtime reasons but still signs against the internal endpoint.

## 4. DNS and TLS

1. DNS: add `A`/`AAAA` records for the media host (`media.example.com`) pointing at
   the production host. If Cloudflare proxies it, keep the origin restricted to
   Cloudflare ranges — see §8.
2. Certificate: issue a cert for the media host (do not reuse the app cert; a
   hostname mismatch breaks image loads immediately):

   ```bash
   certbot certonly --webroot -w /var/www/certbot -d media.example.com
   ```

   The HTTP server block already serves `/.well-known/acme-challenge/` from
   `/var/www/certbot`, so renewal keeps working.
3. Install the server block:

   ```bash
   install -m 644 deploy/nginx/media.conf.example /etc/nginx/sites-available/roamlog-media
   ln -sf /etc/nginx/sites-available/roamlog-media /etc/nginx/sites-enabled/roamlog-media
   nginx -t && systemctl reload nginx
   ```

   Replace `media.spacedo.org` with the real host in the four places listed at the
   top of the file.
4. Point the API at the same host and restart it:

   ```bash
   # /opt/roamlog/config/.env.production (mode 0600)
   S3_PUBLIC_ENDPOINT=https://media.example.com
   MEDIA_SIGNED_URL_TTL_SECONDS=900
   MEDIA_CORS_ORIGINS=https://we.example.com
   ```

   ```bash
   docker compose --env-file /opt/roamlog/config/.env.production \
     -f docker/compose.production.yml up -d api
   ```

5. Smoke test from outside the host:

   ```bash
   # 1) presign through the API (member session cookie required)
   curl -s -X POST "https://api.example.com/v1/workspaces/$WS/media/presign" \
     -H "Content-Type: application/json" -H "Cookie: $SESSION" \
     -d '{"fileName":"a.jpg","mimeType":"image/jpeg","size":1234}'
   # -> { "uploadUrl": "https://media.example.com/roamlog-production/...", ... }

   # 2) the URL host must be the public one, and the signature must validate
   curl -s -o /dev/null -w '%{http_code}\n' -X PUT "$UPLOAD_URL" \
     -H 'Content-Type: image/jpeg' --data-binary @a.jpg        # 200
   curl -s -o /dev/null -w '%{http_code}\n' "$SIGNED_READ_URL" # 200
   ```

   A `200` on both proves DNS + TLS + `Host` forwarding + signature. A `403` with
   `<Code>SignatureDoesNotMatch</Code>` means §9 row 1.

## 5. Bucket CORS

`docker/minio-init/01-create-bucket.sh` keeps the bucket private (`mc anonymous set
none`) and applies a CORS policy derived from `MEDIA_CORS_ORIGINS`:

| Field             | Value                        |
| ----------------- | ---------------------------- |
| `AllowedOrigins`  | one rule per configured origin |
| `AllowedMethods`  | `GET`, `PUT`, `HEAD`         |
| `AllowedHeaders`  | `*`                          |
| `ExposeHeaders`   | `ETag`                       |
| `MaxAgeSeconds`   | `3000`                       |

Behaviour:

- origins are bare `http(s)` origins; paths, queries, spaces and XML metacharacters
  are rejected with a non-zero exit;
- `mc cors set` replaces the policy, so re-running the init job converges
  (idempotent);
- the script reads the policy back and fails (non-zero exit) if `mc cors set`
  fails or the read-back does not contain the configured origin — a silent
  partial apply would only surface later as browser CORS errors;
- `MEDIA_CORS_ORIGINS` must list at least one origin.

Apply manually after an origin change:

```bash
docker compose --env-file /opt/roamlog/config/.env.production \
  -f docker/compose.production.yml run --rm minio-init
```

Why nginx forwards `OPTIONS`: cross-origin `PUT` (and any request with
`Content-Type`) is preflighted. nginx allows `OPTIONS` through to MinIO, which
answers from this bucket policy. The `Access-Control-Allow-Origin` header must
come from **one** place only — adding CORS headers in nginx *as well* would
duplicate them and break preflight. That is why the media server block restricts
methods but does not set CORS headers.

## 6. Signed-URL lifetime

- default `MEDIA_SIGNED_URL_TTL_SECONDS=900` (15 minutes), range `60`–`604800`;
- `StorageService` also clamps any explicit per-call TTL to at most 604800 s
  (the SigV4 ceiling) and at least 1 s;
- API responses carry `expiresAt`, so clients can refresh before expiry;
- media rows that are not `ready` return `url: null` instead of a URL that would
  404;
- **coupling to note:** `MEDIA_SIGNED_URL_TTL_SECONDS` is the default for every
  signed URL produced by `StorageService`, including export download links. If
  the two need different lifetimes, exports must pass an explicit TTL (not done
  here; `EXPORT_SIGNED_URL_TTL` remains the fallback when the media variable is
  unset).

Rotating `S3_SECRET_KEY` invalidates outstanding URLs; clients simply re-request.

## 7. Rollback

If the public media host has to be withdrawn:

1. Set `S3_PUBLIC_ENDPOINT` back to the internal endpoint **only** for staging — in
   production the API refuses to boot without a public endpoint, by design. The
   real rollback is to change the host, not to remove it:

   ```bash
   # keep the API bootable, point at a temporary host
   S3_PUBLIC_ENDPOINT=https://media2.example.com
   ```

2. Revert the nginx media block:
   ```bash
   rm /etc/nginx/sites-enabled/roamlog-media && nginx -t && systemctl reload nginx
   ```
3. Restart the API so new URLs are signed for the new origin. Old URLs remain
   signature-valid against the host they were signed for only until they expire
   (≤ 7 days, 15 minutes by default).
4. No data migration is involved: object keys, bucket layout and the export
   pipeline are unchanged.

## 8. Cloudflare (only if the media host is proxied)

- **Host**: Cloudflare keeps the original `Host` at the origin, so signatures stay
  valid. No transform rule may rewrite `Host`.
- **Real IP**: install the published Cloudflare ranges into
  `/etc/nginx/snippets/cloudflare-realip.conf` and keep
  `real_ip_header CF-Connecting-IP`. Restrict origin TCP 80/443 to those ranges.
- **TLS**: Full (strict) with a valid origin certificate.
- **Caching**: bypass cache for requests whose query string contains
  `X-Amz-Signature` / `X-Amz-Credential`; a cached response would outlive the
  signature. Never enable image resizing / hotlink protection on this host: both
  rewrite or re-fetch signed URLs.
- The media server block itself also sends `Cache-Control: private, no-store`.

## 9. Troubleshooting 403s

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `403 SignatureDoesNotMatch` right after deploy | nginx forwards a different `Host` (default `proxy_set_header Host $proxy_host` becomes `127.0.0.1:19000`), or the URL host differs from `S3_PUBLIC_ENDPOINT` | keep `proxy_set_header Host $host;` (the file has it), and make `S3_PUBLIC_ENDPOINT` byte-identical to the host in the browser URL (no trailing slash, no default-port suffix like `:443` unless it is in the URL too) |
| `403 SignatureDoesNotMatch` only for some objects | a path rewrite/prefix (`/media/ -> /`) or URL-decoding difference between client and proxy | never rewrite the path; forward the URI untouched |
| `403 RequestTimeTooSkewed` | origin clock drift (>15 min) | enable `chrony`/`systemd-timesyncd` on the host and MinIO container |
| `403 AccessDenied` after ~15 min | URL expired | re-request media (client refreshes using `expiresAt`) |
| `403 AuthorizationQueryParametersError` | `X-Amz-Expires` above 604800 (SMTP-style `EXPORT_SIGNED_URL_TTL`/`MEDIA_SIGNED_URL_TTL_SECONDS` set too high, or a caller passed a huge TTL) | keep TTL within 60–604800; the service clamps per-call values |
| Browser blocks the request with a CORS message, HTTP status 403 on `OPTIONS` | bucket CORS missing or origin not listed | set `MEDIA_CORS_ORIGINS` and re-run `minio-init`; confirm `mc cors get local/$S3_BUCKET` lists the origin |
| `405 Not Allowed` from nginx | request method outside GET/HEAD/PUT/OPTIONS (e.g. a `DELETE` sent straight to the media host) | expected: deletes go through the API, never the browser |
| Images fine, uploads fail | presigned `PUT` `Content-Type` header was not sent exactly as signed | send `headers["Content-Type"]` from the presign response verbatim |
| `404` for a valid URL | object key does not exist (upload never completed) or bucket mismatch between `S3_BUCKET` and the key | check `completeUpload` succeeded and the bucket name in the URL |
| Works on the host, 403 from the internet | mixed endpoints: the API signed for the internal host | check boot logs for `storage.clients_ready` and `signingEndpoint` |

Diagnostics:

```bash
# what the API is actually signing for
docker compose --env-file /opt/roamlog/config/.env.production \
  -f docker/compose.production.yml logs api | grep storage.clients_ready

# does nginx forward the right Host?
curl -sI https://media.example.com/roamlog-production/health-probe | grep -i '^server:'
```

## 10. Known gaps / follow-ups

- Exports share the media TTL default (see §6).
- Presigned `PUT` cannot enforce `Content-Length`; the 25 MB cap is only verified
  when `complete` HEADs the object, so an oversized upload can be stored and left
  orphaned (`pending` rows are not garbage-collected).
- `presign` is not idempotent (only `complete` honours `Idempotency-Key`).
- Staging has no public media host yet, so browser media only works against
  production or a local MinIO on a single endpoint.