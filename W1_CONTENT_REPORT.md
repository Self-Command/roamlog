# W1-API-CONTENT Delivery Report

状态: DONE
任务 ID: W1-API-CONTENT

## 变更文件

### API wiring

- `apps/api/src/app.module.ts`

### Shared sanitization

- `apps/api/src/common/services/sanitize.module.ts`
- `apps/api/src/common/services/sanitize.service.ts`

### Trips, stops, shared content infrastructure

- `apps/api/src/modules/trips/content-presenters.ts`
- `apps/api/src/modules/trips/content-records.ts`
- `apps/api/src/modules/trips/content-tenant.decorator.ts`
- `apps/api/src/modules/trips/content-tenant.guard.ts`
- `apps/api/src/modules/trips/content-transaction.ts`
- `apps/api/src/modules/trips/content-values.ts`
- `apps/api/src/modules/trips/stops.repository.ts`
- `apps/api/src/modules/trips/stops.service.ts`
- `apps/api/src/modules/trips/trips.controller.ts`
- `apps/api/src/modules/trips/trips.module.ts`
- `apps/api/src/modules/trips/trips.repository.ts`
- `apps/api/src/modules/trips/trips.service.ts`
- `apps/api/src/modules/trips/version-conflict.exception.ts`
- `apps/api/src/modules/trips/version-conflict.filter.ts`

### Entries and revisions

- `apps/api/src/modules/entries/entries.controller.ts`
- `apps/api/src/modules/entries/entries.module.ts`
- `apps/api/src/modules/entries/entries.repository.ts`
- `apps/api/src/modules/entries/entries.service.ts`

### Itinerary

- `apps/api/src/modules/itinerary/itinerary.controller.ts`
- `apps/api/src/modules/itinerary/itinerary.module.ts`
- `apps/api/src/modules/itinerary/itinerary.repository.ts`
- `apps/api/src/modules/itinerary/itinerary.service.ts`

### Activities

- `apps/api/src/modules/activities/activities.controller.ts`
- `apps/api/src/modules/activities/activities.module.ts`
- `apps/api/src/modules/activities/activities.repository.ts`
- `apps/api/src/modules/activities/activities.service.ts`

### Tests

- `apps/api/test/content-entries.e2e-spec.ts`
- `apps/api/test/content-fixtures.ts`
- `apps/api/test/content-itinerary.e2e-spec.ts`
- `apps/api/test/content-stops.e2e-spec.ts`
- `apps/api/test/content-trips.e2e-spec.ts`
- `apps/api/test/content-xss.e2e-spec.ts`

未修改 `packages/**`、Web、Admin、Worker、root 配置、lockfile、迁移、Docker、CI、原型或设计文档。

## 实现摘要

- Implemented all Task 8 content routes:
  - Workspace trips list/create; trip get/patch/delete/duplicate.
  - Trip participants list/add/remove.
  - Trip activity and Workspace activity feeds.
  - Stops CRUD and reorder.
  - Itinerary CRUD and reorder.
  - Entries list by Workspace/trip, create/get/patch/delete/favorite.
  - Entry revision list and restore.
- All mutable content entities expose and increment `version`.
- Versioned updates use atomic `updateMany` predicates scoped by Workspace, id, version, and `deletedAt: null`.
- Stale writes throw `VERSION_CONFLICT`; a controller-level conflict filter emits RFC 7807 Problem Details plus the current entity.
- All content reads and writes are Workspace-scoped. Direct trip/stop/entry/itinerary routes resolve the tenant through a guard that delegates membership enforcement to `TenantGuard`.
- Private trip visibility is enforced for Owners/Admins, creators, Editors, and Viewers.
- RBAC uses `PermissionService`; Viewer writes are rejected before mutation.
- Trip, stop, entry, and itinerary dates are validated against legal ranges and parent trip bounds.
- Budget amount/currency pairing, cover media ownership, participant membership, and assignee membership are validated.
- Business writes and `Activity` inserts run in one Prisma `$transaction`.
- Entry create, update, favorite, and revision restore update activity in the same transaction.
- Every entry save creates a revision snapshot; stale snapshots are trimmed to the latest 50 versions.
- Trips, stops, entries, itinerary items, and activities are soft-delete filtered.
- Cursor pagination and whitelisted sorting are implemented for trip, entry, and activity lists.
- Added a shared `SanitizeService` backed by `sanitize-html` with a strict Tiptap-oriented allowlist.
- Journal `contentHtml` is sanitized before create, update, trip duplication, and revision restore writes.
- Entry reads, list responses, revision lists, conflict payloads, and restored entries sanitize legacy HTML before returning it.
- The sanitizer removes script/style/iframe and other executable tags, all `on*` and style attributes, unsafe URL schemes, protocol-relative links, images, and non-allowlisted markup. Safe headings, paragraphs, bold/emphasis, lists, tables, code blocks, and HTTP/HTTPS/mailto links remain.
- `contentJson` is preserved as data and explicitly is not treated as renderable HTML.

## 新增依赖

- `apps/api/package.json` runtime: `sanitize-html@2.18.2`
- `apps/api/package.json` development: `@types/sanitize-html@2.16.2`

Root agent must run the normal workspace install so `pnpm-lock.yaml` records the dependency. The lockfile was intentionally left unchanged by this task.

## 验证命令与结果

```text
pnpm --config.verify-deps-before-run=false --filter @roamlog/api test
Test Files  21 passed (21)
Tests       112 passed (112)
```

```text
pnpm --config.verify-deps-before-run=false --filter @roamlog/api typecheck
tsc --noEmit: passed
```

```text
pnpm --config.verify-deps-before-run=false --filter @roamlog/api build
tsc -p tsconfig.build.json: passed
```

```text
pnpm --config.verify-deps-before-run=false --filter @roamlog/api lint
eslint .: passed
```

Content-focused tests cover:

- Invalid trip and stop date ranges.
- Entry and itinerary dates outside the trip.
- Cross-Workspace UUID lookup denial.
- Viewer write denial.
- Private trip visibility for non-creator Editors.
- `409 VERSION_CONFLICT` with current trip/stop/entry entities.
- Revision creation, 50-version trimming, and restore-as-new-version.
- Stops and itinerary reorder scoping.
- Activity writes in the same transaction as content writes.
- XSS regression coverage for `onerror`, `<script>`, `javascript:` links, iframe/style removal, and preserved headings/paragraphs/bold/safe links.
- Journal create/update/restore sanitization before persistence and sanitized legacy-row responses.

## 未覆盖/风险

- Content tests use mocked Prisma transactions; no separate live-Postgres content integration run was added in this task. The complete API suite and production build pass.
- Dependency installation is deferred to the root agent. Verification used `--config.verify-deps-before-run=false` to prevent pnpm v12 from rewriting the protected lockfile; the API package manifest contains the required dependencies.
- `contentJson` remains application data. It must never be inserted directly into HTML or passed to `dangerouslySetInnerHTML`.
- `EntryRevision` can snapshot only the contract-defined title, JSON, and HTML fields. Date/location/tags edits still generate a new content version and activity, but those non-content fields are not present in the revision schema.
- Revision restore has no request body in the current contract, so it cannot receive a client-supplied expected version. It still performs an atomic version-checked update and returns `409` if the entry changes between read and write.
- Entry favorite is an unversioned action in the frozen contract. It increments `version` so subsequent stale PATCH requests conflict, but it does not require an expected version itself.
- Import, media, comments, notifications, realtime, search, share links, and exports remain intentionally unimplemented for later waves.

## 建议下一步

1. Root agent acceptance: install the declared dependency, inspect the content/sanitizer diff, run the four verification commands, and exercise authenticated seeded routes against local PostgreSQL.
2. Continue Wave 1 integration by switching Web/Admin fixtures to the live content endpoints for one seeded flow.
3. Keep HTML rendering paths limited to API-sanitized `contentHtml`; never render `contentJson` directly.
