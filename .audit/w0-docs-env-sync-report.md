# W0_DOCS_ENV_SYNC — 环境变量与发布文档/CI 同步报告

- 任务 ID：`W0_DOCS_ENV_SYNC`（devops）
- 日期：2026-11-18
- 状态：**DONE**
- 仓库：`C:\Users\BY9700\Desktop\UI\roamlog`（Windows Git Bash）
- 约束遵守：未触碰 `apps/**`（仅读 `environment.ts`）、`packages/**`、`docker/compose.staging.yml`、`docker/compose.server.yml`、lockfile、`.github/workflows/release.yml`、其他 `.audit` 文件；未执行 `git reset/clean/checkout/stash`；未提交；未 `pnpm install`；未连接生产服务器；本机无 Docker，未运行容器。

---

## 1. 变更文件

| 文件 | 变更 |
| --- | --- |
| `tooling/scripts/check-env.ts` | 重写：新增六个变量与 production 严格预检，复用 `validateEnvironment()` |
| `.env.example` | 新增 `APP_ENV`/`NEXT_PUBLIC_APP_ENV`/`EMAIL_PROVIDER`/`S3_PUBLIC_ENDPOINT`/`MEDIA_SIGNED_URL_TTL_SECONDS`/`MEDIA_CORS_ORIGINS` + 5 个限流键，逐键注释；头部模板说明改为 local-only |
| `docker/production.env.example` | 新增 `API_PORT` + 5 个限流键；CORS 占位与 `APP_URL` 对齐并注明预检规则 |
| `docker/web.Dockerfile` | build 阶段 `ARG NEXT_PUBLIC_APP_ENV=production` + `ENV` 传递（仅此一个 ARG） |
| `docker/admin.Dockerfile` | 同上 |
| `.github/workflows/ci.yml` | 追加 "Production compose config validation" 步骤（现有步骤零改动） |
| `README.md` | 变量表新增 APP_ENV/媒体/邮件/限流/`NEXT_PUBLIC_APP_ENV`；加载规则与 `check:env` 用法；`Docker staging` 标注 legacy；新增 `Docker production` 小节 |
| `deploy/README.md` | 删除 "Known integration gap"，改为双 endpoint 说明并指向 `media-delivery.md`；增加 preflight 命令与 staging 构建 ARG 说明 |
| `docs/operations/README.md` | 索引新增 `release-checklist.md`、`media-delivery.md`、`email-production.md`；修正 deployment boundary（production = `compose.production.yml`） |
| `docs/operations/release-checklist.md` | **新建** rc.4 发布前必检清单 |
| `.audit/w0-docs-env-sync-report.md` / `.checkpoint.md` | 本报告与 checkpoint |

未改动：`docker/compose.production.yml`（web/admin 无 `build:` 段，无可追加的 `build.args`；按任务要求改为在文档中说明如何传入，`environment:` 已有 `APP_ENV` 保留）。

> 注：`deploy/README.md`、`docker/production.env.example`、`docs/operations/media-delivery.md` 等在本轮开始前已存在其他 wave 的未提交改动（`git status` 可见）。本任务只做增量编辑，未回退他人内容。

---

## 2. 实现摘要

### A. `check-env.ts` 同步新变量 + production 只读预检

- 新增受管变量：`APP_ENV`、`EMAIL_PROVIDER`、`S3_PUBLIC_ENDPOINT`、`S3_PUBLIC_BASE_URL`、`MEDIA_SIGNED_URL_TTL_SECONDS`、`MEDIA_CORS_ORIGINS`。
- **不重复实现业务逻辑**：production 模式直接 `import { validateEnvironment } from "../../apps/api/src/config/environment.js"`，与 API 启动校验同源（blast radius 显示该函数 4 个调用方 + `environment.spec.ts`）。
- 在复用 schema 之外，只补充 API schema 无法知道的“部署完整性”规则：
  1. `APP_ENV`、`EMAIL_PROVIDER` 必须显式（缺省会静默回落 `development`/`smtp`，从而关闭全部 production 规则）；
  2. 全键 `CHANGE_ME`/`change-me`/`placeholder`/`replace-with`/`xxxx`/`your-`/`*example.com` 残留检测；
  3. `MEDIA_CORS_ORIGINS` 按 `docker/minio-init/01-create-bucket.sh` 的规则校验（bare origin、无 path/query/凭据、至少一条），并要求包含 `APP_URL` origin；
  4. `DEMO_SEED_ENABLED=true` 拒绝。
- 值永不回显：错误只报变量名与规则；对 `validateEnvironment` 抛出的聚合消息额外做敏感值/URL 脱敏（`<redacted>`），并按 `PATH: message` 边界拆分（`environment.ts` 自身消息含 `"; "`，朴素 split 会截断）。
- 退出码：`0` 通过 / `1` 失败（含用法错误）；`--help` 退出 0。
- production 模式**不叠加 `process.env`**，只评判被审 env 文件，避免 shell 导出“修好”坏文件。

### B. 两份 env 示例与 `environment.ts` 对齐

- 两文件均 100% 覆盖 `EnvironmentSchema` 的 45 个键（此前 `.env.example` 缺 9 个、production 模板缺 6 个），六个受管键全部存在。
- `.env.example` 全部为本地安全默认（`APP_ENV=development`、`EMAIL_PROVIDER=mailpit`、`S3_PUBLIC_ENDPOINT=http://localhost:9000`、`MEDIA_CORS_ORIGINS=http://localhost:3000`）。
- production 模板保持 `CHANGE_ME`/`example.com` 占位，零真实密钥（`RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx` 仍为文档占位）。

### C. README / deploy README / operations 索引

- `deploy/README.md` 原 279–285 行 "Known integration gap"（称 API 用 `minio:9000` 签名）已删除，替换为 `## Media delivery: two endpoints, not a gap`，说明 `S3_ENDPOINT`（内部）vs `S3_PUBLIC_ENDPOINT`（浏览器签名）、Nginx 保留 `Host`、`MEDIA_CORS_ORIGINS` 由 `minio-init` 下发，并链接 `docs/operations/media-delivery.md`。
- 明确 production = `docker/compose.production.yml` + `/opt/roamlog/config/.env.production`；staging 双文件（`compose.staging.yml` + `compose.server.yml`）为 legacy（README `Docker staging（legacy）` + 新 `Docker production` 小节；deploy README 顶部 Rules of thumb）。
- `docs/operations/README.md` 补 `media-delivery.md`、`email-production.md`、`release-checklist.md` 索引，并修正 "single-host deployment uses compose.server.yml override" 的过时描述。

### D. Dockerfile 补 `NEXT_PUBLIC_APP_ENV`

- web/admin 均在 `build` 阶段：`ARG NEXT_PUBLIC_APP_ENV=production` → `ENV ... NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV}`；未改其他构建逻辑。
- `compose.production.yml` 的 web/admin **没有 `build:` 段**（仅 `image:`），因此不存在可追加的 `build.args`；按任务要求改为文档说明传入方式（`deploy/README.md` legacy 段、README `Docker production`、发布清单第 5 项）。
- 说明：`NEXT_PUBLIC_APP_ENV` 是**构建期**内联变量，容器 `environment:` 里再设置不会改变徽标——这一点在 README 与发布清单中写明，避免“加了 env 就以为修好”。

### E. CI production compose 静态校验

- 在 quality job 的 `Compose config validation` 之后**追加**一步（原步骤未改）：
  `docker compose --env-file docker/production.env.example -f docker/compose.production.yml config --quiet`
- 该步 `env: ROAMLOG_IMAGE_TAG=ci-validate`（compose 用 `${ROAMLOG_IMAGE_TAG:?}`；模板里是 `CHANGE_ME_release_tag` 虽非空，但显式 pin 更稳），并加注释禁止为通过而放宽 `:?` 守卫。
- `pnpm staging:validate` **不覆盖** `compose.production.yml`：它只 `load_yaml("docker/compose.yml")` 与 `docker/compose.staging.yml`（`staging-validate.py:68-69`），生产栈的 `:?` 变量、YAML、privileged/latest tag 检查均不在其中。按任务要求**报告而未擅自修改 validator**（该文件不在可写白名单内）。

### F. `docs/operations/release-checklist.md`

- 13 节：前置条件、env preflight、`contracts:check`、`typecheck`、`test`、`build`（含 `NEXT_PUBLIC_APP_ENV` 校验）、staging+production compose 校验、镜像 tag/digest、DNS/TLS（含 media 子域与 `Host` 头）、邮件 DNS（`check-email-dns.mjs` 与 0/1/2/64 退出码）、备份、回滚、部署后冒烟（登录、旅行全字段、封面上传、地点搜索、后台操作、邮件、`/v1/metrics` 404）。
- 每项含命令与通过标准；主机/域名一律 `<app-host>`、`<media-host>` 占位，无真实密钥或域名凭据。

---

## 3. 验证命令与结果

### 3.1 脚本可运行与退出码（正/负样例）

```bash
pnpm exec tsx tooling/scripts/check-env.ts --help                      # exit 0，打印用法
pnpm exec tsx tooling/scripts/check-env.ts                             # exit 0（.env.local）
pnpm exec tsx tooling/scripts/check-env.ts --env production            # exit 1（模板含 CHANGE_ME，预期失败）
```

正/负样例（`%TEMP%\roamlog-env-fixtures\{positive,negative}.env`，合成值，无真实凭据）：

| 样例 | 构造 | 结果 |
| --- | --- | --- |
| 正 | 完整 production 值（`APP_ENV=production`、`EMAIL_PROVIDER=resend`、`S3_PUBLIC_ENDPOINT=https://media.roamlog.test`、`MEDIA_CORS_ORIGINS=https://we.roamlog.test`…） | `Environment configuration looks valid.`，**exit 0** |
| 负 | 删除 `S3_PUBLIC_ENDPOINT`，`EMAIL_PROVIDER=mailpit` | **exit 1**，3 条错误，无值回显 |

负样例实际输出（变量名 + 规则，无值）：

```text
ERROR: Missing required environment variable: S3_PUBLIC_ENDPOINT
ERROR: S3_PUBLIC_ENDPOINT: S3_PUBLIC_ENDPOINT is required when APP_ENV=production (presigned URLs are signed for the browser-facing host)
ERROR: EMAIL_PROVIDER: EMAIL_PROVIDER=mailpit is not allowed when APP_ENV=production
Environment configuration is invalid (3 problem(s)).
```

模板（`doc/production.env.example` 未填写）以 23 条错误、exit 1 失败——这是“模板不可直接投产”的证明；`$?` 见上表。

### 3.2 变量集合核对（environment.ts vs 两个 env 示例）

```text
schema keys: 45
missing .env.example: (none)
missing production.env.example: (none)
managed six in both: true
schema coverage: 100% 100%
```

（脚本用正则提取 `EnvironmentSchema` 第 4 级缩进键名，与两侧 env 文件的 `KEY=` 集合求差；`MEDIA_CORS_ORIGINS` 不在 schema 内，按受管六键单独断言。）

### 3.3 Compose / YAML

```bash
python -c "import yaml,sys; yaml.safe_load(open('docker/compose.production.yml'))"
# compose.production.yml: yaml OK
```

`docker compose config --quiet` **未实跑**：本机 `docker: not installed`。改为静态证明：`${VAR:?}` 必填变量共 11 个（`POSTGRES_USER/PASSWORD/DB`、`REDIS_PASSWORD`、`MINIO_ROOT_USER/PASSWORD`、`S3_BUCKET/ACCESS_KEY/SECRET_KEY`、`ROAMLOG_IMAGE_TAG`、`S3_PUBLIC_ENDPOINT`），`docker/production.env.example` 全部覆盖，缺失列表为 `(none)`。

CI 新步骤 YAML 可解析：`python yaml.safe_load(.github/workflows/ci.yml)` → quality job 共 19 steps，新步骤名出现在第 9 位（`Production compose config validation`），顺序在 staging compose 之后、Lint 之前。

### 3.4 既有校验未破坏

```bash
pnpm staging:validate
# Staging static checks passed: compose YAML, environment templates, Dockerfiles, workflow gate, and shell syntax.
```

### 3.5 类型检查

```bash
pnpm --filter @roamlog/api typecheck
# src/modules/media/__tests__/media-rules.spec.ts(44,21): error TS2554: Expected 9 arguments, but got 7.
# test/content-trips.e2e-spec.ts(45,19): error TS2554: Expected 4-5 arguments, but got 3.
# ELIFECYCLE exit 2
```

两条错误均位于**其他并行 Agent 在途修改**的文件（`apps/api/src/modules/media/**`、`apps/api/test/**`，`git status` 显示 `M`/未提交），与本任务零交集：本任务未改动任何 `apps/**`/`packages/**` 文件类型代码。`apps/api/src/config/*` 无错误，本任务新增的 TS 仅 `tooling/scripts/check-env.ts`（不在 turbo typecheck 图内，由 tsx 运行验证）。

### 3.6 Dockerfile ARG（grep 展示）

```text
docker/web.Dockerfile:30:ARG NEXT_PUBLIC_APP_ENV=production
docker/web.Dockerfile:36:    NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV} \
docker/admin.Dockerfile:31:ARG NEXT_PUBLIC_APP_ENV=production
docker/admin.Dockerfile:37:    NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV} \
```

### 3.7 格式与文档链接

```text
pnpm exec prettier --check <touched files>  → All matched files use Prettier code style!
release-checklist.md 相对链接 → 6/6 目标存在
```

（`README.md`、`deploy/README.md`、`docs/operations/README.md` 在 HEAD 时即为 prettier-clean，我的编辑曾破坏对齐，已对**仅本任务触碰的文件**执行 `prettier --write`。）

---

## 4. CodeGraph 证据

1. `codegraph status` → 初次显示 `Pending Changes: Added 3 / Modified 3`（未达标），执行 `codegraph sync` → `Synced 6 changed files / Added: 3, Modified: 3 - 116 nodes in 2.7s`，再次 `codegraph status` → **`[OK] Index is up to date`**。
2. `codegraph explore "environment.ts check-env storage-settings production.env compose.production NEXT_PUBLIC_APP_ENV"`（CLI + MCP 各一次）：命中 8 文件 / 108 符号，给出 blast radius：
   - `validateEnvironment`（`apps/api/src/config/environment.ts:470`）→ 4 callers（`apps/api/scripts/bootstrap-admin.ts`、`apps/api/src/config/app-config.module.ts`），tests `environment.spec.ts`；
   - `parseEnvFile`（`tooling/scripts/check-env.ts:32`）→ 本文件内 1 caller，测试空白；
   - `resolveAdminEnvironment`（`apps/admin/components/admin-shell/admin-environment.ts:26`）→ `admin-topbar.tsx`/`admin-sidebar.tsx`，测试 `admin-shell.test.tsx`。
3. 第二次 `codegraph_explore "EnvironmentSchema AppEnvironment EmailProvider addPublicStorageUrlIssues isInternalStorageHost placeholderFragments validateEnvironment"` 取回 `environment.ts` 全文（含 211–436 行 `EnvironmentSchema` 与 30–55 行常量），据此确认：
   - production 规则挂在 `APP_ENV`（310–325 行）而非 `NODE_ENV`，媒体/邮件分离；
   - `addPublicStorageUrlIssues`（153–209 行）错误消息只含变量名、不含值；
   - `MEDIA_SIGNED_URL_TTL_SECONDS` 范围 `60–604800`（235 行），`APP_ENV`/`EMAIL_PROVIDER` 有 `.default(...)`（30–35 行）→ 这正是 `check-env` 必须额外要求“显式设置”的原因。
4. 收尾 `codegraph status` → `[OK] Index is up to date`。

---

## 5. 已知风险

1. **`release.yml` 未传 `NEXT_PUBLIC_APP_ENV`（不可写，未改）**：release gate 的 `build-push-action` 只传 `NEXT_PUBLIC_DATA_MODE`/`ADMIN_DATA_MODE`/`ASSET_PREFIX`/`LOGIN_PATH`/`MAP_*`。生产正确（ARG 默认 `production`），但 **`image_tag=staging` 的镜像仍会显示 `PRODUCTION` 徽标**——D 项缺陷只在“显式传 ARG”的构建路径上被修复。需要 release.yml 加一行（见 §7）。
2. **legacy staging 构建路径未传 ARG（`compose.staging.yml` 不可写）**：本地 `up -d --build` 仍会用默认 `production`，徽标误显示。已在 `deploy/README.md` 与 README 写明需 `--build-arg NEXT_PUBLIC_APP_ENV=staging` / `build.args`。
3. **`check-env.ts` 依赖 `apps/api/src/config/environment.ts` 源码**（有意为之：单一事实来源）。若该文件被并行改坏（语法），预检会随之失败；tsx 只做类型擦除，不受类型错误影响。
4. **CI 新步骤未实跑**（本机无 Docker）：`docker compose config` 在 Linux runner 上是否因 `env_file: /opt/roamlog/config/.env.production` 路径不存在而报错，未经验证（Compose 通常只在 `up` 阶段检查 env_file 存在性）。若首跑失败，优先在 CI 里创建该路径的临时文件，而**不是**放宽 compose 守卫。
5. **`deploy/README.md` 存在并行未提交改动**，本轮只做锚点替换；若其他 Agent 同时编辑该文件，需人工合并一次。
6. **production 模板新增限流/`API_PORT` 显式键**：值与 schema 默认一致，但从此模板不再自动跟随默认值变化（有意显式化）。

---

## 6. 未覆盖项

1. `pnpm staging:validate` 不覆盖 `compose.production.yml`（详见 §2E）。建议后续在 `staging-validate.py` 增加：
   - `production = load_yaml("docker/compose.production.yml")`；
   - 复用 `privileged`/`latest`/`docker.sock` 文本扫描循环加入该文件；
   - 断言 `${VAR:?}` 集合被 `docker/production.env.example` 覆盖。
   本轮未改（文件不在可写白名单、且任务优先要求“报告”）。
2. 未在 CI 中固化“模板必须失败”的负向断言（防止有人给模板填值后误提交真实密钥）。
3. 未新增 `check-env.ts` 的单元测试（`tooling/scripts` 无测试框架接入；已用正/负样例人工覆盖）。
4. 未验证 `compose.production.yml` 的 `MEDIA_CORS_ORIGINS` 是否真的传到 `minio-init`（静态文本已确认 `environment:` 有该键，运行期未测）。
5. 未改动 `docs/operations/email-production.md` 中“`S3_PUBLIC_BASE_URL` reserved 但 API 仍签名”的表述（第 167 行）——它与 `media-delivery.md` 一致，属既有正确描述，无需改。

---

## 7. 建议的下一步

1. **补 `release.yml` 构建参数**（需 release workflow 负责人）：
   ```yaml
   build-args: |
     NEXT_PUBLIC_APP_ENV=${{ inputs.image_tag == 'staging' && 'staging' || 'production' }}
   ```
   这是让 staging 镜像徽标真正正确的唯一剩余代码改动。
2. **legacy staging**：若仍要保留本地构建，在 `compose.staging.yml` 的 web/admin `build.args` 加 `NEXT_PUBLIC_APP_ENV: staging`（本轮禁改）。
3. **validator 补生产 compose**（§6.1 的最小补丁），并让 CI 同时跑 `python -m py_compile tooling/scripts/staging-validate.py`。
4. **CI 首跑观察**：合并后确认 "Production compose config validation" 步骤通过；若 `env_file` 路径报错，按 §5.4 处理。
5. **rc.4 发版**：直接照 `docs/operations/release-checklist.md` 逐项执行并留证；第 1 步用 `/opt/roamlog/config/.env.production` 预检，第 4 步核对六个变量都在。