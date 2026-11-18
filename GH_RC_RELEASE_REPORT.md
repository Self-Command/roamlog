# GH-RC-RELEASE Execution Report

**Status:** DONE  
**Task ID:** GH-RC-RELEASE  
**Repository:** https://github.com/Self-Command/roamlog  
**Executed:** 2026-11-18 (Asia/Shanghai); GitHub timestamps below are UTC.  
**Release SHA:** `f1ae9035bfa483de74944adc47f00fa5d37edd22`

## Scope and safety

- No product code was changed.
- No commit was created.
- No non-tag `main` change was pushed.
- No server deployment was performed.
- No remote resource was deleted.
- Only the annotated release tag and the repository's own tag-triggered Release gate workflow were used.

## Runs

| Stage | Run | Result | Window (UTC) | Evidence |
| --- | --- | --- | --- | --- |
| Pre-release CI | [44231611255](https://github.com/Self-Command/roamlog/actions/runs/44231611255) | success | 03:36:29-03:39:26 | Job `134557747144` |
| Release gate | [44232022817](https://github.com/Self-Command/roamlog/actions/runs/44232022817) | success | 03:40:07-03:48:31 | All 8 jobs succeeded |

Pre-release CI job:

- `Install, verify, and build` - `134557747144` - success
- URL: https://github.com/Self-Command/roamlog/actions/runs/44231611255/job/134557747144

Release gate jobs:

| Job | Job ID | Result |
| --- | ---: | --- |
| Validate release inputs | `134559110802` | success |
| Reuse CI quality gate / Install, verify, and build | `134559152950` | success |
| Build worker image | `134560531997` | success |
| Build api image | `134560532056` | success |
| Build migrate image | `134560532061` | success |
| Build admin image | `134560532097` | success |
| Build web image | `134560532230` | success |
| Create GitHub Release | `134562174002` | success |

## Tag

- Tag: `v0.1.0-rc.1`
- Type: annotated tag
- Local tag object: `d072ce0e9bf810fc7b2bd91bb7b64072dbd5d335`
- Target commit: `f1ae9035bfa483de74944adc47f00fa5d37edd22`
- Remote ref: `refs/tags/v0.1.0-rc.1` -> `d072ce0e9bf810fc7b2bd91bb7b64072dbd5d335`
- Tag push: success

## GitHub Release

- URL: https://github.com/Self-Command/roamlog/releases/tag/v0.1.0-rc.1
- Title: `Roamlog v0.1.0-rc.1`
- State: published
- Draft: `false`
- Prerelease: `true`
- Published at: `2026-11-18T03:48:27Z`
- Release body includes the five image tags, digests, source SHA, quality-gate URL, SBOM/provenance notes, and pull instructions.

## GHCR images

All images were built for `linux/amd64` from `f1ae9035bfa483de74944adc47f00fa5d37edd22`. Digests below match both the downloaded Release-gate manifest artifacts and anonymous GHCR manifest HEAD responses.

| Component | Image and release tag | Digest | Anonymous manifest HEAD |
| --- | --- | --- | --- |
| api | `ghcr.io/self-command/roamlog/api:v0.1.0-rc.1` | `sha256:fc002bc15c01f04a54ed6b41ba2b0fbe2053a72bf3c74dee15dd22f790c2bd0b` | HTTP 200 |
| migrate | `ghcr.io/self-command/roamlog/migrate:v0.1.0-rc.1` | `sha256:0df21392b0525e6e9d7b8129a7286e10d422b8a2bfedd28bcbbad0e6d76fd371` | HTTP 200 |
| worker | `ghcr.io/self-command/roamlog/worker:v0.1.0-rc.1` | `sha256:fc0963d423a8e25ab6e81eda5fd3d7101d2a503939b6e9c7fb4f1bb4d1c24821` | HTTP 200 |
| web | `ghcr.io/self-command/roamlog/web:v0.1.0-rc.1` | `sha256:cc9ec539e61ac9ca3425664fb03de8d730c6c504960f366d10db108e617a96da` | HTTP 200 |
| admin | `ghcr.io/self-command/roamlog/admin:v0.1.0-rc.1` | `sha256:400f82d9c4ef31ba4c5c77f28e5c2f7432c6b8c26f75ab3db8b114576717d887` | HTTP 200 |

Every image also has `sha-f1ae903` and `latest` tags.

## GHCR visibility

GitHub Packages API reports all five packages as `public`:

| Package | Visibility | Package URL |
| --- | --- | --- |
| `roamlog/api` | public | https://github.com/users/Self-Command/packages/container/package/roamlog%2Fapi |
| `roamlog/migrate` | public | https://github.com/users/Self-Command/packages/container/package/roamlog%2Fmigrate |
| `roamlog/worker` | public | https://github.com/users/Self-Command/packages/container/package/roamlog%2Fworker |
| `roamlog/web` | public | https://github.com/users/Self-Command/packages/container/package/roamlog%2Fweb |
| `roamlog/admin` | public | https://github.com/users/Self-Command/packages/container/package/roamlog%2Fadmin |

No visibility mutation was required because all five packages were already public. A speculative PATCH to `/user/packages/container/roamlog%2Fapi/visibility` returned HTTP 404; GitHub's Packages REST API documents read/list/version operations but does not expose that visibility mutation route. This is not a permission blocker, and no remote state was changed by the failed probe.

## Failures and warnings

- CI/release failures: none.
- Non-blocking GitHub Actions warnings:
  - Node.js 20 is deprecated for several Actions and is being forced to Node.js 24.
  - `ubuntu-latest` will migrate to Ubuntu 26 in October 2026.
  - Existing ESLint `Unexpected any` warnings in `apps/worker/src/jobs/export.ts` and `apps/worker/src/dependencies.ts`.
- Docker CLI is not installed on this workstation. Image verification used Release-gate manifest artifacts and the anonymous GHCR Registry API instead of local `docker` commands.

## Final verification

- Pre-release CI: success.
- Release gate: success.
- Annotated tag: created and present on origin.
- GitHub Release: exists, published, and marked prerelease.
- Five GHCR images: present, anonymously pullable, and digest-verified.
- Five GHCR packages: public.

**Blockers:** none.  
**Deployment:** not performed, by task scope.
