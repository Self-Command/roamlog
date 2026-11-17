# Rollback

## Decision rule

Roll back when the new release causes an availability, security, data-integrity,
or tenant-isolation regression that cannot be fixed safely within the incident
window. Do not roll back a database migration by deleting files or running
`db push`.

## Application rollback

Keep the previous immutable image tag available. Stop traffic at the ingress or
compose profile, pin the previous tag, start without rebuilding, and verify:

```bash
export PREVIOUS_SHA=sha-<previous>
export ROAMLOG_IMAGE_TAG="$PREVIOUS_SHA"

docker compose --env-file docker/.env.staging -f docker/compose.staging.yml \
  --profile app up -d --no-build

curl -fsS https://api.staging.roamlog.app/v1/ready
```

If the previous images are in GHCR, pull and retag them exactly as in
[release-gate.md](./release-gate.md) before `up --no-build`.

## Migration compatibility

The safe pattern is expand/contract:

1. Expand schema with backward-compatible additions.
2. Deploy code that can read old and new shapes.
3. Backfill in a bounded worker.
4. Remove old fields only in a later release after confirmation.

If a release contains a destructive migration:

- stop writes;
- restore the pre-migration backup if the application rollback cannot read the
  new schema;
- do not attempt a hand-written down migration in staging;
- record the data loss window and affected objects;
- re-run migrations and the full smoke suite after restore.

## Rollback evidence

Record:

- incident/change ID;
- failing release tag and digest;
- previous release tag and digest;
- migration versions before/after;
- backup identifier and checksum;
- readiness and smoke outputs;
- affected users/workspaces and notification status;
- remaining data loss or cleanup.

## When not to roll back

- A forward fix is smaller and safer than reversing a compatible migration.
- The previous image cannot validate the current schema and no restore is
  available.
- Rolling back would reintroduce a known auth, authorization, or tenant
  isolation vulnerability.

In those cases, disable the affected feature, keep the new schema, and ship a
forward fix.
