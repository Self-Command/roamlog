# Release and GHCR runbook

This runbook describes the GitHub Actions release workflow in
`.github/workflows/release.yml`. It covers dry runs, manual staging publication,
version-tag releases, and package visibility.

The workflow has been statically validated, but it has not yet published images
from a GitHub-hosted runner from this workstation. Do not report a release as
published until the workflow run and GHCR package pages provide evidence.

## Published artifacts

Every publish operation builds the same five Linux `amd64` images:

| Component | Dockerfile                 | Target    | GHCR image                |
| --------- | -------------------------- | --------- | ------------------------- |
| API       | `docker/api.Dockerfile`    | `runtime` | `<owner>/roamlog/api`     |
| Migrate   | `docker/api.Dockerfile`    | `migrate` | `<owner>/roamlog/migrate` |
| Worker    | `docker/worker.Dockerfile` | `runtime` | `<owner>/roamlog/worker`  |
| Web       | `docker/web.Dockerfile`    | `runtime` | `<owner>/roamlog/web`     |
| Admin     | `docker/admin.Dockerfile`  | `runtime` | `<owner>/roamlog/admin`   |

GHCR paths are lowercased and prefixed with `ghcr.io/`. Only `linux/amd64` is
qualified by this pipeline; arm64 and multi-architecture manifests are not
produced.

## Required repository configuration

No long-lived registry token or repository secret is required. The workflow uses
the automatic `GITHUB_TOKEN`:

- top level: `contents: read`;
- image matrix: `contents: read`, `packages: write`;
- release job: `actions: read`, `contents: write`.

The repository or organization must permit Actions to publish packages. If an
organization policy restricts package creation or write access, a repository or
organization administrator must resolve that policy before publishing.

Optional repository variables configure public build inputs:

- `NEXT_PUBLIC_MAP_STYLE_URL`
- `NEXT_PUBLIC_GEOCODER_URL`

The workflow uses safe defaults when either variable is absent.

### Package visibility

New GHCR packages are normally private. The workflow labels each image with
`org.opencontainers.image.source` so GitHub can link the package to this
repository. Linking does not make the package public.

If anonymous pulls are required, an owner or administrator must open each
package's settings after its first publication and change the visibility to
public. A package-scoped access setting or organization policy may be used
instead. The release workflow deliberately does not change package visibility
with an unverified API call.

Until that settings change is made, pulls require an authenticated token with
`read:packages`.

## Prerequisites in GitHub

1. Merge the workflow and `.github/release.yml` to the default branch before
   creating a release tag. GitHub reads release-note categories from the default
   branch.
2. Confirm Actions workflow permissions allow the job-level permissions declared
   above.
3. Confirm the repository can create GHCR packages.
4. Record the quality-gate run URL, image digests, and package visibilities as
   release evidence.

## Static validation

Run these checks before changing the workflow:

```bash
actionlint -no-color -oneline .github/workflows/ci.yml .github/workflows/release.yml
python tooling/scripts/staging-validate.py
node --check tooling/scripts/release-manifest.mjs
node --check tooling/scripts/release-notes.mjs
pnpm exec prettier --check .github/workflows/release.yml .github/release.yml \
  tooling/scripts/release-manifest.mjs tooling/scripts/release-notes.mjs
```

Static checks prove syntax, workflow context, and helper-script shape. They do
not prove that a runner can build every Docker target, that GHCR accepts the
push, or that package visibility is configured as required.

## Dry run

From **Actions → Release gate → Run workflow**, keep `dry_run=true`. The default
`image_tag=staging` is ignored while the run is a dry run.

Equivalent command:

```bash
gh workflow run release.yml --ref main -f dry_run=true -f image_tag=staging
gh run watch
```

Expected result:

- the reused CI quality gate passes;
- all five matrix entries build for `linux/amd64`;
- each image is loaded into the disposable runner;
- no GHCR login, push, artifact upload, or GitHub Release occurs;
- the job summary says nothing was pushed.

The loaded images disappear with the runner. A dry run is build evidence, not a
deployable artifact.

## Manual staging publication

From **Actions → Release gate → Run workflow**:

1. Set `dry_run=false`.
2. Keep `image_tag=staging`, or enter an additional safe tag such as
   `staging-2026-11-18`.
3. Run from the `main` branch. Dry runs may use another branch, but a real
   staging publication is rejected outside `refs/heads/main`.

Equivalent command:

```bash
gh workflow run release.yml --ref main \
  -f dry_run=false \
  -f image_tag=staging-2026-11-18
```

Manual publication always pushes the `staging` tag and the immutable SHA tag.
If `image_tag` is non-empty and differs from `staging`, that extra tag is pushed
as well. `latest` is rejected. Manual publication never creates a GitHub
Release.

Use fully qualified image references when recording deployment evidence:

```text
ghcr.io/<owner>/roamlog/api:staging
ghcr.io/<owner>/roamlog/migrate:staging
ghcr.io/<owner>/roamlog/worker:staging
ghcr.io/<owner>/roamlog/web:staging
ghcr.io/<owner>/roamlog/admin:staging
```

## Version-tag release

Create an annotated tag whose name is a valid GHCR tag. Slashes and `+` are
rejected because they cannot be used as Docker tags.

```bash
git tag -a v1.2.3 -m "Roamlog v1.2.3"
git push origin v1.2.3
```

The tag push runs:

1. release-input validation;
2. the reusable CI quality gate;
3. all five Linux `amd64` image builds;
4. GHCR pushes with `sha-<short>` and `v...` tags;
5. registry manifest verification for every pushed tag;
6. a JSON manifest artifact containing each image digest;
7. GitHub Release creation after all image jobs succeed.

`provenance: mode=max` and `sbom: true` are enabled for published builds. BuildKit
attaches the provenance and SBOM attestations to the OCI image manifests;
they are not duplicated as GitHub Release assets.

The generated release notes use `.github/release.yml`. The release body appends:

- all five image names and tags;
- the digest of every image;
- ready-to-run pull commands;
- attestation inspection commands;
- the GHCR visibility note;
- quality-gate and source links.

Tags matching `v<major>.<minor>.<patch>-<prerelease>` create a GitHub prerelease.
Other `v*` tags create a normal release.

## Verify a release

```bash
gh run list --workflow release.yml --limit 5
gh release view v1.2.3 --json url,isPrerelease,body
gh api "repos/<owner>/<repo>/releases/tags/v1.2.3"
```

On a machine logged in to GHCR:

```bash
ghcr=ghcr.io/<lowercase-owner>/<lowercase-repo>
docker buildx imagetools inspect "$ghcr/api:v1.2.3"
docker buildx imagetools inspect "$ghcr/api:v1.2.3" --format '{{json .Provenance}}'
docker buildx imagetools inspect "$ghcr/api:v1.2.3" --format '{{json .SBOM}}'
```

Repeat the inspection for `migrate`, `worker`, `web`, and `admin`.

## Failure and recovery

- A validation or quality-gate failure stops before any image build.
- A failed matrix entry fails the matrix; the release job is skipped.
- If GHCR publication succeeds but the release job fails, rerun the failed
  release job. It recreates or updates a non-draft release from the retained
  seven-day image-manifest artifacts.
- If a draft release already exists for the tag, the automation refuses to
  publish or overwrite it. Publish or delete that draft explicitly first.
- Rerunning a version-tag workflow republishes the version tag. Treat a
  successfully published version tag as immutable: update the release through a
  new patch tag unless an incident commander explicitly approves a rebuild.

## Out of scope

- Automatic host rollout, DNS, TLS, database migration execution, and smoke
  checks on staging.
- Signing with Cosign or changing package visibility.
- Restricting deployment by a GitHub Environment or manual release approver.
- Linux arm64 or multi-architecture images.
