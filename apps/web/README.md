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

- TanStack Query owns server state; every read and write goes through the typed adapter in `lib/api`.
- Production builds call the real same-origin `/v1` boundary. `API_URL` selects the rewrite target; it defaults to `http://localhost:4000`.
- Authentication, registration, password recovery, email verification, and invitation acceptance are handled by the real API.
- There is no alternate data source: the app renders live API data only, with explicit loading, empty, and error states.

## Route map

- `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`
- `/invite/[token]`, `/invite-accept`
- `/w/[workspaceSlug]`
- `/w/[workspaceSlug]/trips`
- `/w/[workspaceSlug]/trips/new`
- `/w/[workspaceSlug]/trips/[tripId]`
- `/w/[workspaceSlug]/journal`, `/map`, `/insights`, `/members`, `/activity`, `/notifications`

The root route redirects to the signed-in user's first Workspace.