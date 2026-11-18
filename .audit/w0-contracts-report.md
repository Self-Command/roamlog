# W0_CONTRACTS report

## Status

IN_PROGRESS

## Scope and inputs

- Audit: `.audit/2026-11-18-fullstack-gap-audit.md`, sections 5-8 and 11.2.
- Frozen areas: Trip full fields and cover projection, Stop place metadata, Places search, single-media read, public share media URLs.
- Preserved concurrent work: `packages/contracts/src/entities/audit-log.ts`, `packages/contracts/src/api/admin.ts`, and the audit UUID schema in generated OpenAPI/client.
- Generator support approved by root: minimal changes under `packages/contracts/scripts/openapi/**`.

## Decisions

- Reads expose `Trip.cover`; `coverMediaId` remains as the stored reference. Request writes to `coverMediaId` are restricted to `null` so setting a cover must use `POST /v1/trips/{tripId}/cover`.
- `Trip.durationDays` is derived inclusively from dates via a shared `tripDurationDays()` helper and checked by the entity schema.
- Trip collections are bounded and reject duplicate or untrimmed `tags`, `destinations`, and `guestNames`.
- `Stop` supports nullable `provider`, `providerPlaceId`, and IANA `timeZone`; existing Stop CRUD query/reorder shapes are unchanged.
- `PlaceSearchQuery` bounds `q` to 120 characters and `limit` to 1-10 (default 6); a degraded upstream is represented by HTTP 200 plus `degraded=true`.
- Public media drops storage variants/keys and exposes display `url`, `thumbUrl`, and `expiresAt`.
- Single-media read uses a projection without `bucket`, `key`, or raw `variants`.

## Verification

- `pnpm --filter @roamlog/contracts typecheck`: passed.
- `pnpm --filter @roamlog/contracts test`: 52 passed.
- OpenAPI generation: pending final regeneration after coordination.

## Remaining risks

- API presenters/routes must adopt the new read projections in the next wave; this task intentionally does not modify API implementation.
