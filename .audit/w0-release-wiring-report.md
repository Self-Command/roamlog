# W0_RELEASE_WIRING — 发布链路修复报告

- 状态：**DONE**（待根 Agent 验收）
- 任务 ID：`W0_RELEASE_WIRING`
- 日期：2026-11-18
- 仓库：`C:\Users\BY9700\Desktop\UI\roamlog`（Windows Git Bash）
- 角色：devops
- 约束遵守：未改 `apps/**`、`packages/**`、`docker/**`（含 `compose.production.yml` 与全部 Dockerfile）、
  `tooling/scripts/check-env.ts`、lockfile、其他 `.audit`；未执行 `git reset/clean/checkout/stash`；
  未提交；未 `pnpm install`；未连接生产服务器；本机无 Docker，未运行任何容器/镜像。

---

## 1. 变更文件

| 文件 | 变更 |
| --- | --- |
| `.github/workflows/ci.yml` | 新增 “Stage production env placeholder for compose validation” step（106-125 行），位于现有 staging compose 校验之后、production compose 校验之前；现有 production 校验步骤（127-138 行，含 `ROAMLOG_IMAGE_TAG=ci-validate` 与 `:?` 注释）零改动 |
| `.github/workflows/release.yml` | `Build release image` 的 `build-args` 追加且仅追加 1 行 `NEXT_PUBLIC_APP_ENV=...`（154 行） |
| `tooling/scripts/staging-validate.py` | 新增 production compose 加载与校验（70 行、147-242 行），新增 CI/Release 回归断言（389-409 行）；净 +102 行 |
| `.audit/w0-release-wiring-report.md` | 本报告（新建） |
| `.audit/w0-release-wiring-report.checkpoint.md` | checkpoint（新建） |

`git diff --numstat`（仅列本任务文件）：

```text
34  0  .github/workflows/ci.yml
1   0  .github/workflows/release.yml
103 1  tooling/scripts/staging-validate.py
```

说明：`ci.yml` 的 34 行增量包含 W0_DOCS_ENV_SYNC 遗留在工作区、尚未提交的
“Production compose config validation” step（12 行）；本任务实际新增的是 106-125 行的
placeholder step（20 行）。本任务未回退他人内容。

---

## 2. 实现摘要（逐缺陷）

### 缺陷 1（P0，CI 零镜像）— 选择方案 A

**问题**：`docker compose --env-file docker/production.env.example -f docker/compose.production.yml config --quiet`
会解析 `x-app-service` 锚点里的 `env_file: /opt/roamlog/config/.env.production`（绝对主机路径）。
GitHub runner 没有该文件，`config` 阶段失败 → quality gate 失败 → release gate 不出镜像。

**选择**：方案 A（在 CI 中把模板落到 compose 期望的绝对路径），不选方案 B（override）。
理由：

1. **校验对象不变**：CI 仍然对**生产实际使用的** `compose.production.yml` 做静态校验，没有第二份
   override 可能随时间漂移（例如生产新增 service / 新增 `:?` 守卫，override 不会自动跟随）。
2. **不会掩盖真实缺变量**：插值来源仍是 `--env-file docker/production.env.example` + step 级
   `ROAMLOG_IMAGE_TAG=ci-validate`。占位文件只满足 `env_file` 的文件系统存在性/可读性，
   **不参与 `${VAR:?}` 插值**，所以模板缺键时 `config` 仍会 fail-fast。
3. **不触碰守卫与服务定义**：`docker/**` 零改动；`:?` 一个未删、一个未放宽。

**实现细节**（`ci.yml:106-125`）：

```yaml
      - name: Stage production env placeholder for compose validation
        # ...（中文/英文注释说明这是 CI-only 占位，不含真实密钥，生产同路径用真文件）
        run: |
          sudo install -d -m 700 -o "$(id -u)" -g "$(id -g)" /opt/roamlog/config
          sudo install -m 600 -o "$(id -u)" -g "$(id -g)" docker/production.env.example /opt/roamlog/config/.env.production
```

- 步骤注释已写明「CI 静态校验占位、不含真实密钥、生产用同一路径的真文件」，并写明
  「插值仍读 `--env-file` + `ROAMLOG_IMAGE_TAG`，占位不能掩盖缺变量，禁止放宽 `:?`」。
- 与任务给出的 `sudo mkdir/cp/chmod 600` 相比，这里用 `install`（与
  `docker/production.env.example` 头部文档的命令一致），并**额外把占位文件/目录属主设为 runner**：
  `docker compose config` 以非特权 runner 用户运行，若文件为 root:root 0600、目录 0700，则它既无法
  遍历目录也可能无法读取文件，会让“修复步骤”自己变成新的失败点。占位文件本身无密钥，属主改为 runner
  不降低生产安全性；**mode 仍是 0600**，生产同路径仍是 root 所有 0600 + 0700 父目录（注释已写明）。

**验证不含“放宽守卫”**：`staging-validate.py` 新增断言，production API 的
`S3_PUBLIC_ENDPOINT` 必须仍包含 `${S3_PUBLIC_ENDPOINT:?`；负样例删除该守卫会被 validator 拒绝（见 §3.4）。

### 缺陷 2（P1，staging 镜像显示 PRODUCTION 徽标）

**实现**：在 `release.yml:154` 的 `build-args`（现有 `|` multiline 风格）末尾按任务给定表达式追加一行：

```yaml
            NEXT_PUBLIC_APP_ENV=${{ (github.event_name == 'workflow_dispatch' && inputs.image_tag == 'staging') && 'staging' || 'production' }}
```

- 只追加这 1 行；其余 7 个 build-arg 文本未动；`:?`、tag 校验、metadata、publish/dry-run 逻辑未动。
- 语义：`workflow_dispatch` 且 `inputs.image_tag == 'staging'` → `staging`；其余（tag push、
  其他 image_tag、dry-run 手动构建未传 staging）→ `production`。
- 与 Dockerfile 对齐：`docker/web.Dockerfile:30`、`docker/admin.Dockerfile:31` 的
  `ARG NEXT_PUBLIC_APP_ENV=production` 会接收该值（web.Dockerfile:36 / admin.Dockerfile:37 将其传入构建 ENV）。
- 注意：该 build-arg 会传给 matrix 中所有组件（api/migrate/worker 未声明该 ARG）。这是沿用现有
  build-args 的统一传参风格，BuildKit 对未使用 ARG 忽略，不改变其它镜像。

### 缺陷 3（P2，validator 漏检 production compose）

**实现**（`staging-validate.py`）：

1. 第 70 行加入 `production = load_yaml("docker/compose.production.yml")`。
2. 第 147-230 行新增 production 断言（沿用 staging 的 `check()` 风格）：
   - 必需 service：`postgres/redis/minio/minio-init/migrate/api/worker/web/admin`；
   - `postgres/redis/minio` 必须有 healthcheck；
   - `backend` 必须 `internal: true`，`edge`/`egress` 必须存在，worker 必须挂 `egress`；
   - `api/worker/web/admin/migrate` 必须 `read_only: true`、`cap_drop: [ALL]`、
     `no-new-privileges:true`，且 `env_file` 必须精确为
     `["/opt/roamlog/config/.env.production"]`（防止 CI 占位路径与生产路径脱节）；
   - `postgres/redis` 不得发布端口；`api/web/admin/minio` 端口必须 `127.0.0.1:` 前缀；
   - API 必须等待 migrate（`service_completed_successfully`）；
   - API 的 `S3_PUBLIC_ENDPOINT` 必须保留 `${S3_PUBLIC_ENDPOINT:?` 守卫（**不放宽**）；
   - `parse_env("docker/production.env.example")` 的 `APP_ENV` 必须为 `production`；
   - `compose.production.yml` 中全部 `${VAR:?}` 必须被 `docker/production.env.example` 覆盖
     （共 11 个键，含 `ROAMLOG_IMAGE_TAG`；模板中 `CHANGE_ME_release_tag` 非空，故 validator
     无需注入值。真正执行 `docker compose config` 的 CI step 仍由 step env 固定
     `ROAMLOG_IMAGE_TAG=ci-validate`，二者一致）。
3. 第 232-242 行把 production 文件加入原 text 扫描循环：禁止 `privileged: true`、
   `network_mode: host`、`/var/run/docker.sock`、`:latest` 镜像。
4. 第 389-397 行新增 CI 回归断言：production 校验 step 必须存在，且必须先把
   `docker/production.env.example` 以 0600 落到 `/opt/roamlog/config/.env.production`。
5. 第 406-409 行新增 release 回归断言：`release.yml` 必须出现 `NEXT_PUBLIC_APP_ENV=`。

实现注意：PyYAML `safe_load` 会展开 `<<: *app-service` 合并键，因此对 `read_only`、`cap_drop`、
`security_opt`、`env_file` 的断言看到的是服务合并后的最终值（已用正样例验证）。

`pnpm staging:validate` 脚本名与成功文案仍保留 “Staging static checks”（历史名称，避免破坏外部
grep/文档引用）；实际覆盖已扩展到 production。未做无关重构。

---

## 3. 验证命令与结果

### 3.1 硬要求：validator

```bash
pnpm staging:validate
```

```text
$ python tooling/scripts/staging-validate.py
Staging static checks passed: compose YAML, environment templates, Dockerfiles, workflow gate, and shell syntax.
EXIT=0
```

```bash
python -m py_compile tooling/scripts/staging-validate.py
# COMPILE_EXIT=0
```

### 3.2 Workflow YAML 与 build-args

```bash
python -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))"
python -c "import yaml;yaml.safe_load(open('.github/workflows/release.yml'))"
```

结果：

```text
.github/workflows/ci.yml YAML OK; jobs= ['quality']
.github/workflows/release.yml YAML OK; jobs= ['validate', 'quality-gate', 'images', 'release']
quality steps: 20
step 7..9: ['Compose config validation', 'Stage production env placeholder for compose validation', 'Production compose config validation']
prod step env: {'ROAMLOG_IMAGE_TAG': 'ci-validate'}
build-arg count: 8
last build-arg: NEXT_PUBLIC_APP_ENV=${{ (github.event_name == 'workflow_dispatch' && inputs.image_tag == 'staging') && 'staging' || 'production' }}
has key: True
other args unchanged: ['API_URL', 'NEXT_PUBLIC_DATA_MODE', 'NEXT_PUBLIC_ADMIN_DATA_MODE', 'NEXT_PUBLIC_ADMIN_ASSET_PREFIX', 'NEXT_PUBLIC_ADMIN_LOGIN_PATH', 'NEXT_PUBLIC_MAP_STYLE_URL', 'NEXT_PUBLIC_GEOCODER_URL']
```

### 3.3 grep

```text
.github/workflows/release.yml:154:            NEXT_PUBLIC_APP_ENV=${{ (github.event_name == 'workflow_dispatch' && inputs.image_tag == 'staging') && 'staging' || 'production' }}
docker/admin.Dockerfile:31:ARG NEXT_PUBLIC_APP_ENV=production
docker/admin.Dockerfile:37:    NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV} \
docker/web.Dockerfile:30:ARG NEXT_PUBLIC_APP_ENV=production
docker/web.Dockerfile:36:    NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV} \
```

### 3.4 validator 自证：临时副本正/负样例

在 `%TEMP%` 复制 `tooling/scripts/`、`docker/`、`.github/workflows/`、`.env.example` 后运行，
**仓库文件零改动**，跑完删除临时目录：

```text
=== POSITIVE ===   POSITIVE_EXIT=0（与仓库运行一致）
=== NEGATIVE: production read_only regression ===        NEGATIVE_EXIT=1  detected
  ERROR: Production api must use a read-only root FS
=== NEGATIVE: production S3_PUBLIC_ENDPOINT guard removed === NEGATIVE_EXIT=1  detected
  ERROR: Production API must keep the required S3_PUBLIC_ENDPOINT guard
=== NEGATIVE: production template missing ROAMLOG_IMAGE_TAG === NEGATIVE_EXIT=1  detected
  ERROR: docker/production.env.example is missing compose interpolation keys: ROAMLOG_IMAGE_TAG
=== NEGATIVE: CI production env placeholder step removed === NEGATIVE_EXIT=1  detected
  ERROR: CI must stage docker/production.env.example at the compose env_file path before validation
=== NEGATIVE: release build-arg removed === NEGATIVE_EXIT=1  detected
  ERROR: Release images must pass NEXT_PUBLIC_APP_ENV so staging builds do not show the PRODUCTION badge
```

### 3.5 Docker 相关命令（**未实跑**，本机无 Docker）

```text
$ docker --version
bash: docker: command not found
```

因此以下三件事**没有**实际执行证据，只做了静态/解析验证：

1. `docker compose --env-file docker/production.env.example -f docker/compose.production.yml config --quiet`
   （CI 步骤 9）；
2. `docker compose ... -f docker/compose.staging.yml config --quiet`（既有步骤）；
3. 任何 `docker/build-push-action` 镜像构建与 Admin 徽标渲染。

已用静态方式证明：compose YAML 可解析、11 个 `${VAR:?}` 全被 production 模板覆盖、
`env_file` 路径与 CI 占位路径完全一致（validator 断言）、`build-args` 键值与 Dockerfile ARG 对齐。

---

## 4. CodeGraph 证据

1. `codegraph status`（开始时）：`Pending Changes: Added 1 files`，未达标 →
   `codegraph sync` → `Synced 1 changed files / Added: 1 - 50 nodes in 2.5s` →
   再次 `codegraph status` → **`[OK] Index is up to date`**（1,388 文件）。
2. MCP `codegraph_explore`：
   查询 `staging-validate.py production compose release.yml build-push-action compose.production.yml CI workflow validation`
   （`projectPath: C:\Users\BY9700\Desktop\UI\roamlog`）→
   **42 symbols / 1 file**；blast radius：`production_env`（`tooling/scripts/staging-validate.py:220`）
   有 1 个本文件调用方、无测试；调用链 `ci → load_yaml`、`production → load_yaml`、
   `load_yaml → read/check`、`parse_env → read`；引用关系
   `production_api → production_services`、`missing_production_interpolation → production_env`、
   `missing_interpolation → interpolated_required`。据此确认新增断言的落点与原有 staging 检查无重复/无冲突。
3. 同一调用返回的逐行源码（70、147-242、387-409 行）与本任务编辑结果一致；收尾
   `codegraph status` 仍为 **`[OK] Index is up to date`**。

---

## 5. 已知风险

1. **无 Docker，CI 步骤未实跑**：`docker compose config` 是否真的因 `env_file` 缺失失败是任务前提；
   本修复按该前提落文件。若 Composer 仅在 `up` 阶段检查 `env_file`，该 step 属无害冗余。
2. **占位文件属主偏离生产**：CI 中目录/文件属主为 runner（mode 仍 0600/0700），生产仍是 root 所有；
   这是为了让非特权 `docker compose config` 能遍历/读取。若未来 CI 以不同用户运行，需要同步调整。
3. **`v*-rc.*` tag push 仍是 PRODUCTION 徽标**：按任务给定表达式，只有
   `workflow_dispatch && image_tag == 'staging'` 映射为 staging；tag push（包括 `v0.4.0-rc.4`）
   仍为 production。是否把 `-rc.` 语义也映射为 staging 需要发布流程决策（未擅自扩大范围）。
4. **build-arg 对所有 matrix 组件生效**：api/migrate/worker 不声明该 ARG；与现有 build-args 传参方式一致，
   BuildKit 预期忽略未使用 ARG，但本机无法构建验证“不会告警/失败”。
5. **validator 与字符串耦合**：新增断言依赖 step 名 `Production compose config validation` 与
   `sudo install -m 600` 文本；若未来重命名/改写 CI step，需同步更新 validator。
6. **validator 成功文案仍是 “Staging static checks”**：历史输出保留，避免破坏外部 grep；覆盖范围已含 production。
7. **`env_file` 断言写死绝对路径**：production 若改变 env 文件策略（例如改为相对路径），
   compose 与 validator 必须一起改；这是有意的防漂移耦合。

---

## 6. 未覆盖项

1. 未在真实 GitHub Actions（ubuntu-latest）上执行新增 step，`sudo install`、runner 属主、
   Compose 的 `env_file` 解析均只有静态依据。
2. 未构建/推送任何镜像，未验证 staging 镜像中 Admin 实际渲染为 STAGING 徽标（只验证 ARG 传递链）。
3. 未修改 legacy staging 构建路径（`docker/compose.staging.yml` 的 web/admin `build.args`，`docker/**` 禁改），
   本地 `up -d --build` 仍会得到 PRODUCTION 徽标。
4. 未更新 `.audit/w0-docs-env-sync-report.md` 中“release.yml 未改、validator 不覆盖 production”的历史描述
   （其他 `.audit` 禁改；以本报告为准）。
5. 未为 `staging-validate.py` 增加持久化单元测试；负样例只在临时副本中执行，未纳入 CI。
6. 未验证 release workflow 的 `quality-gate` 在自托管 runner（无 passwordless sudo）上的行为。

---

## 7. 建议的下一步

1. **合并后首跑 CI**：确认 quality job 的 step 8 日志显示占位文件创建成功、step 9
   `Production compose config validation` 通过；若 `docker compose config` 报 env_file 权限/路径错误，
   按日志调整占位属主（不要放宽 `:?`）。
2. **staging 徽标实机验证**：`workflow_dispatch` + `dry_run=true` + `image_tag=staging` 构建 admin 镜像，
   启动后检查 Admin 环境徽标为 STAGING；再以 tag push 构建确认 PRODUCTION。
3. **发布流程决策**：若 `v*-rc.*` tag 会部署到 staging，另行批准后把表达式扩展为
   `... || startsWith(inputs.image_tag, 'v') && contains(inputs.image_tag, '-rc.')` 之类的映射。
4. **守护发布门禁**：在分支保护中要求 `CI / quality` 必过，避免 compose 校验被绕过。
5. rc.4 发布按 `docs/operations/release-checklist.md` 执行，并留存本报告 §3 的命令输出作为证据。