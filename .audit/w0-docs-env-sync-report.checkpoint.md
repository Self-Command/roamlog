# W0_DOCS_ENV_SYNC — checkpoint

- 状态：**DONE**（报告：`.audit/w0-docs-env-sync-report.md`）
- 任务 ID：`W0_DOCS_ENV_SYNC`
- 完成时间：2026-11-18

## 完成项

- [x] 门禁：`codegraph status` 初检 stale → `codegraph sync`（6 files / 116 nodes）→ `[OK] Index is up to date`；两次 `codegraph_explore`（CLI + MCP）。
- [x] A：`tooling/scripts/check-env.ts` 同步六变量 + `APP_ENV=production` 严格预检（复用 `validateEnvironment()`，无值回显，0/1 退出码）。
- [x] B：`.env.example` / `docker/production.env.example` 补齐六变量，逐键注释，与 `environment.ts` 45 键 100% 对齐（0 missing）。
- [x] C：`README.md` 变量表/加载规则/production 小节；`deploy/README.md` 删除 "Known integration gap" → 双 endpoint 说明；`docs/operations/README.md` 索引 + boundary 修正。
- [x] D：`docker/{web,admin}.Dockerfile` build 阶段 `ARG NEXT_PUBLIC_APP_ENV=production` + `ENV`。
- [x] E：`.github/workflows/ci.yml` 追加 production compose `config --quiet` 步骤（`ROAMLOG_IMAGE_TAG=ci-validate`，`:?` 守卫未放宽）。
- [x] F：新建 `docs/operations/release-checklist.md`（13 节，命令 + 通过标准，无真实凭据）。
- [x] 验证：正样例 exit 0 / 负样例 exit 1（3 条精确错误）；模板 exit 1；`printer --check` 干净；`staging:validate` 通过；compose YAML OK；`${VAR:?}` 11/11 覆盖。

## 阻塞/风险快照

- `release.yml`、`compose.staging.yml` 不在可写范围 → staging 镜像 `NEXT_PUBLIC_APP_ENV` 仍需上游补一行（报告 §5.1、§7.1）。
- `staging:validate` 不覆盖 production compose（只报未改，报告 §6.1）。
- 本机无 Docker：CI 新步骤与 `docker compose config` 未实跑（报告 §5.4）。
- `pnpm --filter @roamlog/api typecheck` 两条错误来自并行 Agent 在途的 `media/trips` 测试文件，与本任务无关。

## 若需继续

1. 上游补 `release.yml` 构建参数（staging → `staging`）。
2. 视需要给 `staging-validate.py` 加 production compose 覆盖。
3. 按 `docs/operations/release-checklist.md` 执行 rc.4 发版。