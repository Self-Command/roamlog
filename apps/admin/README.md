# Roamlog Admin

Independent platform operations console for Roamlog. This Wave 0 shell runs on
`http://localhost:3001` and uses local fixture data only.

## Routes

- `/login` — mock credentials + 2FA placeholder; no session is created.
- `/admin` — platform metrics, trend, queue and email health.
- `/admin/users` — user table, filters, bulk selection, detail sheet and guarded actions.
- `/admin/workspaces` — Workspace table, filters, detail sheet and guarded actions.
- `/admin/audit` — append-only timeline, filters and fixture CSV export.
- `/admin/login` — compatibility redirect to `/login`.

## Data boundary

Shared `@roamlog/api-mocks` now exists, but its current fixture set only covers
initial Web identity, Workspace and trip data; it does not yet expose Admin
metrics, users, Workspaces or audit fixtures. All views consume the single
`AdminDataSource` interface in `lib/admin-data-source.ts`; it currently resolves
to `lib/fixtures.ts`. Replace that implementation with an MSW-backed source when
Admin fixtures/handlers land. Pages and tables must not import fixtures directly.

Destructive operations update local state and write a local mock audit event.
They never call a real API. Mock audit events are visible on `/admin/audit` and
are stored under `roamlog.admin.mockAudit.v1`.

## Platform permissions

The shell uses `canPlatform()` from `@roamlog/contracts` rather than duplicating
the permission matrix. The sidebar exposes a clearly labelled role preview so
support, analyst, admin and super admin states can be inspected locally.

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

The current task intentionally did not run `pnpm install`, so Web/Admin Next.js
dependencies are not linked yet. See `W0_ADMIN_REPORT.md` at the repository root
for the verification evidence and remaining risks.
