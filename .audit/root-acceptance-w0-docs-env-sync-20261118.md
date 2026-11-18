# 根 Agent 验收记录 — W0_DOCS_ENV_SYNC

任务 ID: W0_DOCS_ENV_SYNC
验收结论: **ACCEPT（条件：2 项遗留已转派 W0_RELEASE_WIRING）**
时间: 2026-11-18 21:50
交付: `.audit/w0-docs-env-sync-report.md`、`docs/operations/release-checklist.md`

## 通过

- `tooling/scripts/check-env.ts` 重写：6 个受管变量 + `APP_ENV=production` 严格只读预检，**复用** `validateEnvironment()` 而非重复实现规则；不回显值；退出码 0/1。
  - 正样例（合成 production 值）exit 0；负样例（删 `S3_PUBLIC_ENDPOINT` + `EMAIL_PROVIDER=mailpit`）exit 1，3 条错误只含变量名/规则；**未填模板 exit 1（23 条）→ 证明模板不可直接投产**（这是很好的负向证据）。
- 变量集合核对：两个 env 示例 **100% 覆盖** `EnvironmentSchema` 45 键，missing = none；compose 的 11 个 `${VAR:?}` 全部被 production 模板覆盖。
- Dockerfile 已补 `ARG NEXT_PUBLIC_APP_ENV`（web + admin）。
- CI 追加 "Production compose config validation" 步骤（原有步骤零改动）；`isn't` 放宽守卫。
- 文档：README 变量表 + 加载规则 + staging legacy 标注；`deploy/README.md` 删除过时的 "Known integration gap" 改为双 endpoint 说明；`docs/operations/README.md` 索引补 3 篇；新建 `release-checklist.md`（13 节）。
- `python yaml.safe_load(compose.production.yml)` 通过；`pnpm staging:validate` 通过；prettier/eslint 对触碰文件全绿。

## 已转派的 2 项遗留（`W0_RELEASE_WIRING`）

1. **P0**：`compose.production.yml` 的 `env_file` 是绝对路径 `/opt/roamlog/config/.env.production`，GitHub runner 上不存在 → 新加的 `docker compose config` 步骤会失败 → quality gate 挂 → **零镜像**。必须在该步骤前落地占位 env（或用 override），且不得放宽 `:?` 守卫。
2. **P1**：`release.yml` 的 `build-push-action` 未传 `NEXT_PUBLIC_APP_ENV` → `image_tag=staging` 的镜像仍显示 `PRODUCTION`。
3. **P2**：`staging-validate.py` 不覆盖 `compose.production.yml`。

## 未覆盖

本机无 docker：`docker compose config` 与 CI 新步骤未实跑（已如实说明）。G5 必须在有 Docker 的主机复验。