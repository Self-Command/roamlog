# SHARE_COVER_FIX — checkpoint

Task ID: SHARE_COVER_FIX (backend_api)
Repo: C:\Users\BY9700\Desktop\UI\roamlog (branch main, shared worktree)

## CodeGraph gate (passed)

- `codegraph status` → pending changes (5 added / 26 modified) → `codegraph sync` (31 files, 1,097 nodes, 4.2s)
- `codegraph status` → `[OK] Index is up to date`
- `codegraph explore "ShareLinksRepository loadPublicTrip PublicTripBundle ShareLinksService publicPayload TripCoverService resolve"` → 70 symbols / 6 files.
  Blast radius: `publicPayload` (1 caller), `loadPublicTrip` (1 caller: `readPublic`),
  `TripCoverService` (12 callers: media-url.module, media.service, trips.service),
  tested via `share-links/__tests__/public-cover.spec.ts`, `public-payload.spec.ts`, `test/collab-share.e2e-spec.ts`.

## Root cause (confirmed by reading source, not from the previous report alone)

`apps/api/src/modules/share-links/share-links.repository.ts:136` — the only media query in
`loadPublicTrip` is `where: { tripId: trip.id, workspaceId, status: "ready", deletedAt: null }`.
A Workspace-level cover (`media.tripId = null`, referenced by `trip.coverMediaId`) therefore never
enters `PublicTripBundle.media`.

`share-links.service.ts:314 publicCover` already implements the login-state rule
(`mediaTripId === null || mediaTripId === trip.id`), so the service logic itself was not the bug —
it just never received the row. Two consequences:

1. `cover` is `null` for every Workspace-level cover on the public share page (user-visible bug).
2. Nothing else in the public payload is affected: `stops`/`entries`/`media`/`budget` are correct.

Login-state comparison: `TripsService.resolveCovers` → `TripCoverService.resolve(records, ids =>
repository.findMediaForCover(workspaceId, ids))`; `findMediaForCover` selects by
`{ id: { in: ids }, workspaceId, deletedAt: null }` and lets the projector reject non-`ready` /
other-trip rows. Both paths therefore agree on the rule; only the repository fetch differed.

## Design chosen (no contract / Prisma schema change needed)

1. **Repository** — keep ONE media query and widen it with an `OR`:
   `where: { workspaceId, status: "ready", deletedAt: null, OR: [{ tripId: trip.id }, { id: coverMediaId }] }`
   (`coverMediaId` branch added only when `trip.coverMediaId` is set).
   `workspaceId` / `status` / `deletedAt` stay top-level so they constrain *both* branches
   (no cross-tenant, non-ready or soft-deleted cover can load). Rows are then split:
   - `media` = rows with `tripId === trip.id` → byte-identical to today's gallery content
   - `coverMedia` = the row referenced by `coverMediaId` when it is not already gallery media (`tripId !== trip.id`)

   → still exactly one `media.findMany` per public read (no N+1, no second round-trip).

2. **Service** — `publicPayload` resolves the cover with the *same* `TripCoverService.resolve`
   used by authenticated trip reads (injected like the existing optional `MediaUrlService`,
   `MediaModule` already re-exports `MediaUrlModule`). The loader only exposes the rows the
   repository already loaded (`bundle.coverMedia` + `bundle.media`), filtered by the requested ids;
   it cannot widen the tenant boundary. The inline `publicCover` copy of the rule is deleted so the
   two paths cannot drift again.

3. `PublicTripBundle` gains `coverMedia: Record<string, unknown> | null` (internal repository type,
   not a wire contract). `PublicTripSchema.cover` is unchanged.

## Not changing

- `trip-cover.service.ts` — no parameter change needed (existing semantics are exactly what we want).
- Contracts, Prisma schema, share-link password/expiry/revoke logic, `apps/web`, admin, other audit files.

## Next steps

1. Apply repository + service edits.
2. Add `__tests__/public-trip-bundle.spec.ts` (repository, fake Prisma matcher) and extend
   `__tests__/public-cover.spec.ts` (service).
3. `pnpm --filter @roamlog/api typecheck`; `pnpm --filter @roamlog/api exec vitest run src/modules/share-links src/modules/media`.
4. Write `.audit/share-cover-fix-report.md`, report to parent agent.

## STATUS: COMPLETE

All steps applied and verified: typecheck 0 errors, 8 test files / 59 tests green, plus
`test/collab-share.e2e-spec.ts` (4 tests) green. Final report:
`.audit/share-cover-fix-report.md`. Remaining cross-agent gap: `apps/web`'s `ShareArticle`
still renders a gradient instead of `trip.cover.url`, so the user-visible symptom needs a
web task (outside this task's writable scope).