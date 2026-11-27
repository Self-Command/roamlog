# Roamlog Admin

Independent platform operations console for Roamlog. It runs on
`http://localhost:3001` and reads every view from the real Admin API through the
same-origin `/v1` proxy.

## Routes

- `/login` — Better Auth credentials + TOTP challenge.
- `/admin` — platform metrics, trend, queue and email health.
- `/admin/users` — user table, filters, bulk selection, detail sheet and guarded actions.
- `/admin/workspaces` — Workspace table, filters, detail sheet and guarded actions.
- `/admin/audit` — append-only timeline, filters and server-side CSV export.
- `/admin/login` — same login panel, usable when Admin is mounted under `/admin/*`.

## Same-domain deployment

Local development keeps the standalone `:3001` layout and uses `/login` for
authentication links. A same-domain deployment builds Admin with:

```text
NEXT_PUBLIC_ADMIN_ASSET_PREFIX=/admin-assets
NEXT_PUBLIC_ADMIN_LOGIN_PATH=/admin/login
```

These values must be present during `next build` **and** in the `next start`
runtime environment because `next start` evaluates `next.config.ts` again.
Missing them at runtime makes server-rendered HTML fall back to root
`/_next/*` URLs, which the reverse proxy routes to Web instead of Admin.
`docker/admin.Dockerfile` therefore declares the same defaults in both stages.

The asset prefix keeps Admin's `_next` files out of Web's root asset namespace;
the login path keeps internal login links inside `/admin/*`. The reverse proxy
must route both `/admin/*` and `/admin-assets/*` to the Admin container. No
Next.js `basePath` is configured, so the existing Admin route paths stay
unchanged.

## Data boundary

There is exactly one data path: `/v1/admin/*` through the same-origin proxy.
`lib/admin-data-source.ts` exposes typed React Query resources and the single
`AdminMutationPort`; pages render the resource, they never fabricate rows. A
failed request renders a user-facing retry state with the error code collapsed
into a details panel.

There is no offline or preview data mode: if the API is down the console shows
the failure instead of inventing numbers. Every destructive action goes through
the API, is authorised by the backend, and is written to the audit log there.

## Platform permissions

The shell uses `canPlatform()` from `@roamlog/contracts` rather than duplicating
the permission matrix. The sidebar shows the platform role returned by `/v1/me`
and offers no way to change it locally.

- `support` can read users/Workspaces and suspend, restore or force logout.
- `analyst` is read-only and can export audit CSV.
- `admin` adds deletion, recovery and 2FA reset.
- `super_admin` adds platform role changes and system-level controls.

## Verification

After the workspace dependencies are installed:

```powershell
pnpm --filter @roamlog/admin test
pnpm --filter @roamlog/admin typecheck
pnpm --filter @roamlog/admin build
pnpm --filter @roamlog/admin dev
```

Verify a running production server never emits unprefixed Admin assets:

```powershell
$env:NEXT_PUBLIC_ADMIN_ASSET_PREFIX='/admin-assets'
pnpm admin:verify-assets http://127.0.0.1:3000
```

The same check is the container healthcheck. It fails if the HTML contains any
root `/_next` asset URL or if a sampled Admin JS/CSS asset does not return 2xx.

The Admin console has no fallback data source; run the API (or point the proxy at
it) before opening a page.
