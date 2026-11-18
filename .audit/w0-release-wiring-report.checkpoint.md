# W0_RELEASE_WIRING — Checkpoint

- 状态：DONE（待根 Agent 验收）
- 任务 ID：`W0_RELEASE_WIRING`
- 时间：2026-11-18
- 仓库：`C:\Users\BY9700\Desktop\UI\roamlog`（Windows Git Bash）
- CodeGraph：`[OK] Index is up to date`（1,388 文件；本轮 sync 1 个新增文件）

## 已完成

1. **缺陷 1（P0）**：`.github/workflows/ci.yml:106-125` 新增 step，在 production compose 校验前把
   `docker/production.env.example` 落到 `/opt/roamlog/config/.env.production`（CI-only 占位，无真实密钥，
   文件 0600、属主 runner，目录 0700、属主 runner）。选择方案 A，未引入 override 文件。
2. **缺陷 2（P1）**：`.github/workflows/release.yml:154` 的 `build-args` 追加
   `NEXT_PUBLIC_APP_ENV=...`（仅此一行，其余 7 个 build-arg 未动）。
3. **缺陷 3（P2）**：`tooling/scripts/staging-validate.py` 新增 production compose 覆盖：
   YAML 加载、service/healthcheck/network/security/ports/env_file/loopback、`${VAR:?}` 模板覆盖、
   text 扫描（privileged / host network / docker.sock / `:latest`），并新增 CI/Release 回归断言。
   未放宽任何 `:?` 守卫。

## 验证快照

- `pnpm staging:validate` → exit 0（脚本输出 `Staging static checks passed...`）。
- `python -m py_compile tooling/scripts/staging-validate.py` → exit 0。
- `ci.yml` / `release.yml` `yaml.safe_load` → 均 OK；quality job 20 steps，
  step 8 = placeholder、step 9 = production compose；`build-args` 共 8 行且末行为新键。
- 临时副本正/负样例：正样例 exit 0；5 个负样例（production read_only、S3 guard、
  模板缺 `ROAMLOG_IMAGE_TAG`、CI placeholder step、release build-arg）全部 exit 1 且命中预期断言。
- `docker: command not found`：compose config 与镜像构建**未实跑**。

## 待根 Agent

- 合并后在 GitHub Actions 首跑 `Production compose config validation`，确认 sudo/install 与
  `docker compose config` 的 env_file 解析行为符合预期。
- 决策 `v*-rc.*` tag push 是否也应使用 `APP_ENV=staging`（当前表达式按任务要求只覆盖
  workflow_dispatch + image_tag=staging）。

## 文件

- `.audit/w0-release-wiring-report.md`（正式报告）
- `.audit/w0-release-wiring-report.checkpoint.md`（本文件）