# @roamlog/web

Roamlog Web runtime shell on Next.js App Router. The app runs on port `3000`.

## Commands

```bash
pnpm --filter @roamlog/web dev
pnpm --filter @roamlog/web test
pnpm --filter @roamlog/web typecheck
pnpm --filter @roamlog/web build
```

## Runtime boundaries

- TanStack Query owns server state.
- MSW starts only when `NODE_ENV` is `development` or `test`.
- Production builds call the real same-origin `/v1` boundary. `API_URL` selects the rewrite target; it defaults to `http://localhost:4000`.
- Authentication, registration, password recovery, email verification, and invitation acceptance are form skeletons. They do not send credentials or create sessions.
- Dashboard, trip library, trip detail, and itinerary content use the frozen contracts and development fixtures. They are not backed by PostgreSQL yet.
- Wave 1 and Wave 2 pages that are not implemented expose explicit scope placeholders instead of dead links.

## Route map

- `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`
- `/invite/[token]`, `/invite-accept`
- `/w/[workspaceSlug]`
- `/w/[workspaceSlug]/trips`
- `/w/[workspaceSlug]/trips/new`
- `/w/[workspaceSlug]/trips/[tripId]`
- `/w/[workspaceSlug]/journal`, `/map`, `/insights`, `/members`, `/activity`, `/notifications`

The root route redirects to the local `roamlog-crew` demo Workspace so the shell is immediately inspectable during Wave 0.
