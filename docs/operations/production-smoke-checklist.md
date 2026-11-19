# Production smoke checklist

Use this checklist after deploying a release to `https://we.spacedo.org`.
Record the release tag, image digests, operator, timestamp, and command output.
Do not mark the deployment successful if a check is skipped without a named
reason.

## Release identity

- [ ] The GitHub Actions quality gate and all five image jobs passed.
- [ ] The GitHub Release matches the intended tag and is marked prerelease for
      an `rc` tag.
- [ ] `api`, `migrate`, `worker`, `web`, and `admin` digests match
      `/opt/roamlog/config/image-digests.txt`.
- [ ] The one-shot `migrate` container exited `0` before API and worker started.
- [ ] The previous known-good image tag and backup identifier are recorded.

## Edge and routing

- [ ] DNS resolves `we.spacedo.org` to the intended Cloudflare/ingress path.
- [ ] Cloudflare SSL/TLS mode is **Full (strict)**; no Flexible mode is used.
- [ ] HTTP port 80 redirects to HTTPS; the redirect does not loop.
- [ ] TLS chain, hostname, and certificate expiry are valid.
- [ ] Origin ports 13000, 13001, 14000, 19000, 19001, and 18025 are not
      reachable from the public internet.
- [ ] Host Nginx is the only trusted proxy in front of the API; no second app
      ingress or direct loopback bypass exists.
- [ ] `GET /` returns the Web app.
- [ ] `GET /login` returns the Web login page.
- [ ] `GET /admin` and `/admin/login` return the Admin app.
- [ ] An Admin static asset under `/admin-assets/_next/...` returns `200` with
      the expected CSS/JS content type.
- [ ] `GET /v1/health` returns `200` with
      `{"status":"ok","version":"<semver>","uptimeSeconds":<int>}`. It must
      parse as `HealthResponseSchema` (`.strict()`, all three fields required);
      a bare `{"status":"ok"}` means the deployed build is older than the
      contract.
- [ ] `GET /v1/ready` returns `200` with database, Redis, and storage `up`.
- [ ] `GET /v1/metrics` returns `404` at the public ingress.
- [ ] `/v1/ws` completes an authenticated Socket.IO/WebSocket upgrade; a
      non-upgrade request does not receive a false success.

Example route check:

```bash
base=https://we.spacedo.org
for path in / /login /admin /admin/login /v1/health /v1/ready; do
  printf '%s ' "$path"
  curl -fsS -o /dev/null -w '%{http_code}\n' "$base$path"
done
printf '/v1/metrics '
curl -sS -o /dev/null -w '%{http_code}\n' "$base/v1/metrics"
```

## Authentication and authorization

- [ ] A normal user can sign in and receives a `Secure`, `HttpOnly`,
      `SameSite=Lax` session cookie on the HTTPS origin.
- [ ] Email verification and password reset links use the production origin.
- [ ] An unauthenticated `/v1/admin/metrics` request returns `401`.
- [ ] A platform account without verified TOTP receives `403` with
      `ADMIN_2FA_REQUIRED`; disabling 2FA is not used as a workaround.
- [ ] A verified `super_admin` can reach the Admin console after TOTP.
- [ ] Viewer can read and comment but cannot edit trip or workspace data.
- [ ] Editor cannot invite, remove, or change member roles.
- [ ] Cross-workspace access returns `403`/`404` without leaking existence.
- [ ] A write with a stale version returns `409` and does not silently overwrite.

## Core journeys

- [ ] Create and open a workspace, trip, stop, journal entry, packing item, and
      expense.
- [ ] Refresh the page and confirm the data persists.
- [ ] Create and revoke a public share link; password/expiry behavior is
      correct and noindex is present.
- [ ] Export a trip and verify the downloaded archive and expiry.
- [ ] The map has a usable list fallback when tiles or geocoding are unavailable.

## Media, email, and queues

- [ ] Upload a private image; the object is not publicly readable.
- [ ] A signed read URL works and a thumbnail/variant is generated.
- [ ] The signed URL does **not** contain the internal `http://minio:9000`
      endpoint; if it does, record the known media-origin gap as a blocker.
- [ ] Verification/reset/invite mail arrives from the approved sender and
      `EmailLog` records delivery.
- [ ] One queue-backed job completes; failed and retried jobs are visible in
      Admin and logs contain no unresolved worker errors.
- [ ] Admin audit entries exist for the smoke-test operational actions.

## Observability and response

- [ ] API, worker, web, and admin containers are healthy; Postgres, Redis, and
      MinIO health checks are healthy.
- [ ] Nginx access/error logs contain no unexpected 5xx burst.
- [ ] API logs are structured and redact passwords, cookies, reset tokens, and
      object-store credentials.
- [ ] A current backup exists and its checksum verification passed.
- [ ] The rollback image tag and rollback procedure are available to the
      operator.
- [ ] The final evidence includes the release URL, digests, smoke output,
      backup identifier, and any remaining risk.

## Immediate rollback triggers

Roll back or disable traffic when any of the following occurs:

- authentication or tenant-isolation bypass;
- sustained `/v1/ready` failure or database corruption;
- public media exposure or S3 credential leakage;
- a migration that prevents the previous application image from reading data;
- sustained 5xx, queue loss, or an uncontrolled security regression.

Follow [rollback.md](./rollback.md). Do not improvise a destructive database
repair during an active incident.
