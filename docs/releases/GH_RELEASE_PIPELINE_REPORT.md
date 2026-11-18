# GH-RELEASE-PIPELINE Report

- 状态: DONE
- 任务 ID: GH-RELEASE-PIPELINE
- 工作目录: `C:\Users\BY9700\Desktop\UI\roamlog`
- 日期: 2026-11-18

## 变更文件

- `.github/workflows/release.yml`
- `.github/release.yml`
- `tooling/scripts/release-manifest.mjs`
- `tooling/scripts/release-notes.mjs`
- `docs/releases/release-runbook.md`
- `docs/releases/GH_RELEASE_PIPELINE_REPORT.md`

未修改产品代码、contracts/db、Dockerfile/Compose、根 README、lockfile、CI
工作流或运行中的预览进程。未 commit、未 push、未创建 tag、未推送 GHCR。

验证期间工作区出现了其他协作者对 `README.md`、`CONTRIBUTING.md`、
`SECURITY.md` 和 `docs/architecture.md` 等文件的新增或修改；本任务未触碰这些
文件。`docs/releases/**` 和 release workflow 之外的 diff 不属于本次交付。

## 实现摘要

- 保留 `workflow_call` CI quality gate；tag 发布在质量门通过后才构建五个镜像。
- `v*` tag 自动构建并发布 `api`、`migrate`、`worker`、`web`、`admin` 至 GHCR，
  使用 `sha-*` 和 tag 名双标签。
- tag 发布在五个镜像全部成功、registry manifest 可读取、manifest artifact
  可汇总后创建 GitHub Release；release body 包含镜像名、tag、digest、
  pull 命令、SBOM/provenance 说明和质量门链接。
- `.github/release.yml` 提供发布说明分类。
- `workflow_dispatch` 默认 `dry_run=true`，只 build/load 五个镜像，不登录 GHCR、
  不 push、不创建 Release。
- 手动非 dry-run 发布仅用于 staging：始终推送 `staging` 和不可变 SHA tag；
  `image_tag` 可追加一个安全 tag；`latest` 被拒绝，真实发布只允许从 `main`
  运行。
- 发布镜像固定为 `linux/amd64`。发布时启用 BuildKit
  `provenance: mode=max` 与 `sbom: true`。
- 镜像构建 job 使用 `packages: write`；Release job 使用
  `contents: write` 与 `actions: read`；顶层仅 `contents: read`。
- 增加 tag/image-tag 格式预检、镜像推送后 manifest 检查、digest artifact
  传递和 release 幂等更新保护。
- 增加 GHCR package 可见性、token 权限、发布/验证/回退说明。

## 所需 repo secrets / vars

### Secrets

不需要新增 repository secret 或 PAT。全部使用 GitHub 自动注入的
`secrets.GITHUB_TOKEN`。

### Repository variables（可选）

- `NEXT_PUBLIC_MAP_STYLE_URL`
- `NEXT_PUBLIC_GEOCODER_URL`

缺失时使用 workflow 内默认值：

- `https://demotiles.maplibre.org/style.json`
- `https://nominatim.openstreetmap.org`

### Repository / organization settings

- 允许 GitHub Actions 使用 job-level 的 `packages: write` 与
  `contents: write`。
- 允许该仓库创建 GHCR packages。
- 首次发布后，由 owner/admin 在 GitHub Packages 设置中确认每个 package 的
  可见性。需要匿名 pull 时必须手动设为 public；workflow 不会猜测或修改
  package visibility。
- `.github/release.yml` 必须先位于默认分支，GitHub 才会在生成发布说明时使用
  其分类规则。

## 发布命令

### 静态验证

```bash
actionlint -no-color -oneline .github/workflows/ci.yml .github/workflows/release.yml
python tooling/scripts/staging-validate.py
node --check tooling/scripts/release-manifest.mjs
node --check tooling/scripts/release-notes.mjs
pnpm exec prettier --check .github/workflows/release.yml .github/release.yml \
  tooling/scripts/release-manifest.mjs tooling/scripts/release-notes.mjs
```

### Dry run

```bash
gh workflow run release.yml --ref main -f dry_run=true -f image_tag=staging
gh run watch
```

### Manual staging publish

```bash
gh workflow run release.yml --ref main \
  -f dry_run=false \
  -f image_tag=staging

# Optional extra tag; `staging` and `sha-*` are still pushed.
gh workflow run release.yml --ref main \
  -f dry_run=false \
  -f image_tag=staging-2026-11-18
```

### Version release

```bash
git tag -a v1.2.3 -m "Roamlog v1.2.3"
git push origin v1.2.3
```

### Verify published output

```bash
gh run list --workflow release.yml --limit 5
gh release view v1.2.3 --json url,isPrerelease,body
docker buildx imagetools inspect ghcr.io/self-command/roamlog/api:v1.2.3
docker buildx imagetools inspect ghcr.io/self-command/roamlog/api:v1.2.3 \
  --format '{{json .Provenance}}'
docker buildx imagetools inspect ghcr.io/self-command/roamlog/api:v1.2.3 \
  --format '{{json .SBOM}}'
```

## 验证命令与结果

| 检查                                                                               | 结果                                                                  |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `actionlint v1.7.12` on `ci.yml` + `release.yml`                                   | PASS，零告警                                                          |
| `python tooling/scripts/staging-validate.py`                                       | PASS                                                                  |
| `node --check` on both release helpers                                             | PASS                                                                  |
| `pnpm exec prettier --check` on workflow/release config/helpers                    | PASS                                                                  |
| YAML parse of `.github/workflows/release.yml` and `.github/release.yml`            | PASS                                                                  |
| Workflow semantic assertions for triggers, jobs, permissions, and build inputs     | PASS                                                                  |
| Bash input-guard cases for tag, staging, dry-run, `latest`, and non-`main` publish | PASS                                                                  |
| 合成五个镜像 manifest，执行 `release-notes.mjs`                                    | PASS，生成完整镜像表、digest、pull 命令、SBOM/provenance 与质量门链接 |
| 推送后 manifest 检查                                                               | 已写入 workflow；本机无 Docker CLI，未执行                            |
| GHCR push / package visibility / GitHub Release                                    | 未执行；未推送、未创建远端对象                                        |

本机验证环境没有 Docker CLI，且任务明确禁止 push，因此没有声称镜像已发布。
`actionlint` 安装在仓库外的 Go bin 目录，没有改变项目依赖或 lockfile。

## 已知风险与未覆盖项

- `.github/release.yml` 的分类只有 PR 打上对应 label 时才生效；当前仓库的
  label 使用习惯尚未审计。
- GHCR package 新包默认通常为 private；匿名 pull 需要 owner/admin 手动调整
  visibility。GITHUB_TOKEN 发布成功不等于 package 已公开。
- 组织级 Actions/package 策略可能覆盖 job-level permission；需要在真实仓库
  设置中确认。
- workflow 沿用仓库现有约定，以 major tag（例如 `actions/checkout@v4`）引用
  第三方 action，没有做 commit-SHA pinning；应作为独立的供应链加固任务处理。
- Linux `amd64` 是唯一支持平台；未实现 arm64、多架构 manifest 或 QEMU 构建。
- workflow 尚未在 GitHub-hosted runner 上真实执行，五个 Docker target 的
  runner 构建和 GHCR 拉取/推送仍需在首次 release 演练中验证。
- 版本 tag 重跑会重新推送同名 tag。成功发布后应视为不可变；本任务未增加
  registry preflight 来阻止覆盖。需要强制不可变策略时应单独设计。
- `provenance: mode=max` 和 `sbom: true` 是 BuildKit attestation，不是 Cosign
  独立签名；release body 已说明检查方式。
- 未实现 host rollout、GitHub Environment 审批、DNS/TLS 或 staging smoke。
- 受任务文件边界限制，未更新 `docs/operations/release-gate.md`。新流程文档位于
  `docs/releases/release-runbook.md`；建议根 Agent 后续把 operations 文档改为
  指向该 runbook。

## 建议的下一步

1. 在合并前由 reviewer 审阅 workflow 的权限、release body 和失败恢复语义。
2. 合并后在 `main` 运行一次 `dry_run=true`，保存五个 build job 的证据。
3. 用 `dry_run=false` 发布一次 staging，记录 digest，并在 GHCR package 设置页
   确认预期可见性。
4. 创建第一个预发布 tag（例如 `v0.1.0-rc.1`），验证 GitHub Release、
   attestation 和 package 链接。
5. 由仓库/组织管理员决定是否启用 release environment approval 与 package
   不可变策略。
