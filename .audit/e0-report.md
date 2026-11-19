# E0_ENV_DOCS — env templates, preflight and provider docs

状态: **DONE**
任务 ID: `E0_ENV_DOCS`
角色: devops
交付时间: 2026-11-19 (Asia/Shanghai)
工作树 HEAD: `422a6dc` (并行 Agent 的改动仍在工作树中，本任务只提交自己的路径)
环境: Windows Git Bash / Node `v24.22.2` / pnpm `12.18.0` / Python `3.12.10`

## 1. 变更文件

| 文件 | 变更 |
| --- | --- |
| `.env.example` | 新增 Place/AI/设置加密/媒体压缩变量块，每项带用途、取值、必填与默认值 |
| `docker/production.env.example` | 新增 `CONFIG_ENCRYPTION_KEY`/`_KEYS`（占位 + `openssl rand -base64 32`）、Places、AI、媒体压缩变量 |
| `docker/staging.env.example` | 同上一组变量；补齐 12 个 schema 键（`APP_ENV=staging`、`API_PORT`、限流、`EMAIL_PROVIDER=mailpit`、`S3_PUBLIC_ENDPOINT`、`MEDIA_SIGNED_URL_TTL_SECONDS`、加密 key）使 missing=0 |
| `tooling/scripts/check-env.ts` | 加密 key 强制校验、AI 条件校验、Places/媒体压缩校验、敏感值脱敏、AI 开关不匹配告警 |
| `docs/operations/settings-encryption.md` | 新建：保护范围、丢失=永久不可解、key ring 轮转、SQL 校验 |
| `docs/operations/ai-provider.md` | 新建：三协议、OpenAI/Anthropic/magpie 示例、超时/配额、失败码、成本控制 |
| `docs/operations/places.md` | 新建：Geoapify 3000/天、缓存策略、归属声明、条款边界、切换 provider |
| `docs/operations/README.md` | 索引新增 3 份 runbook |
| `docs/operations/secret-rotation.md` | inventory 增加加密 key；新增“不可随意轮转、见专用 runbook”章节 |
| `docs/operations/release-checklist.md` | 预检规则增加加密 key 与可选特性说明 |
| `README.md` | 环境变量表同步 4 行 + 生产阻断项/可选 AI/归属声明段落 + 严格模式说明 |
| `.audit/e0-report.md` | 本报告 |

未修改任何 `apps/` 下文件、`packages/contracts`、`apps/admin`、`apps/web` 或 compose 文件。

## 2. 实现摘要（逐项）

### 2.1 生产阻断项：`CONFIG_ENCRYPTION_KEY`

- 三个模板都出现该键：
  - production/staging：`CHANGE_ME_base64_32_bytes` 占位 + `openssl rand -base64 32` 注释；
  - `.env.example`：**空值** + 生成命令注释。原因：`environment.ts` 会对“已设置但非法”的 key 直接抛错，若本地模板放占位值，`pnpm dev` 的 API 会启动失败；空值是 schema 允许的“未配置”，首次保存 secret 时才失败。这是对“三模板都放占位”的唯一有意偏离，已在模板注释和 docs 中说明。
- `check-env.ts` 新增 `checkEncryptionKey()`，在 `APP_ENV=production` 时：
  - 缺失 → `CONFIG_ENCRYPTION_KEY is required when APP_ENV=production ... Generate a key with: openssl rand -base64 32`；
  - 存在 → base64 解码必须 32 字节且 canonical round-trip 一致（防止 `Buffer.from` 忽略非法字符）；
  - `CONFIG_ENCRYPTION_KEYS` 可选，但每个 entry 都校验，错误按 entry 序号命名，不回显值；
  - 非 production 缺失时只 `WARN`（本地保存 secret 会得到 `SETTINGS_ENCRYPTION_UNAVAILABLE`）。
- 两个变量加入 `REDACTED_KEYS`（连同 `AI_API_KEY`、`GEOAPIFY_API_KEY`）。
- 文档写明：丢失 key = 已存 secret 永久不可解；数据库备份只有密文；轮转顺序为 `KEYS=<new>,<old>` → 滚动重启 → 后台重存所有 secret → SQL 确认无旧 keyId → 才移除旧 key；并给出 keyId 计算与 `SystemSetting` 查询。

### 2.2 AI 条件校验

- 仅在 `AI_ENABLED=true` 时要求 `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL`；未启用时最多告警，不阻断，端点由 API 返回 `503 AI_NOT_CONFIGURED`。
- 同时校验 `AI_PROTOCOL` 枚举、`AI_TIMEOUT_MS`(5000–120000)、`AI_MAX_OUTPUT_TOKENS`(256–32000)、`AI_DAILY_QUOTA`(0–100000)。
- 额外发现并对齐：E1 的 `environment.ts`（并行改动，schema 47→54 键）与 `ai.settings.ts` **不读取 `AI_ENABLED`**，只以 `AI_BASE_URL && AI_MODEL` 判定 `configured`。因此 check-env 在 `AI_ENABLED=false` 但端点变量仍非空时给出告警，避免“以为关了其实还在计费”；README/AI 文档明确写了这一点。

### 2.3 其余新变量

- Places：`PLACES_PROVIDER`（geoapify|photon）、`GEOAPIFY_API_KEY`、`PLACES_FALLBACK_TO_PHOTON`、`GEOAPIFY_DAILY_LIMIT`（0 关闭上限）。
  - 校验：provider 枚举、fallback 布尔、额度整数；`geoapify` 无 key 时：fallback 开启→警告，fallback 关闭→报错（否则地点搜索无 provider）。
- 媒体压缩：`MEDIA_MAX_EDGE`、`MEDIA_QUALITY`、`MEDIA_TARGET_BYTES`、`MEDIA_KEEP_ORIGINAL`。
  - 默认值与现有 web 常量对齐：`IMAGE_MAX_EDGE=2000`、`IMAGE_TARGET_BYTES=1500000`、quality ladder 首位 `0.82` → 模板 `82`。
  - 校验：edge 320–8192、quality 1–100、target 100000–50000000 bytes、keep-original 布尔。
- 每个变量在模板中都有一行注释（用途/取值/必填/默认），完整说明在 `docs/operations/{places,ai-provider}.md`。

### 2.4 模板一致性修复（staging）

staging 模板原本缺 12 个 `environment.ts` schema 键（`APP_ENV`、`API_PORT`、四个限流、`EMAIL_PROVIDER`、`S3_PUBLIC_ENDPOINT`、`MEDIA_SIGNED_URL_TTL_SECONDS`、两个加密键）。为满足 missing=0 已补齐：

- `APP_ENV=staging` 显式声明（NODE_ENV 仍是 production；只影响 `APP_ENV` 专属规则，staging 继续允许 Mailpit）。
- `API_PORT=4000`、`RATE_LIMIT_*=默认值`、`EMAIL_PROVIDER=mailpit`（避免 schema 默认 `smtp` 静默改变路由）。
- `S3_PUBLIC_ENDPOINT=http://minio:9000`（legacy staging 继续对内部 endpoint 签名）。
- `MEDIA_SIGNED_URL_TTL_SECONDS=900`。
- `CONFIG_ENCRYPTION_KEY=CHANGE_ME_base64_32_bytes` + 空 `CONFIG_ENCRYPTION_KEYS`。

`pnpm staging:validate` 仍通过（见验证 #4）。

## 3. 变量一致性 missing/extra 表

脚本：一次性 Node 脚本，解析 `apps/api/src/config/environment.ts` 的 `.object({...})` 键集合，与三个模板的 `KEY=` 集合对比。脚本原文见 §7。

| 模板 | schema 键 | 模板键 | missing | extra |
| --- | ---: | ---: | ---: | ---: |
| `.env.example` | 54 | 92 | **0** | 38 |
| `docker/staging.env.example` | 54 | 87 | **0** | 33 |
| `docker/production.env.example` | 54 | 79 | **0** | 25 |

`extra` 分两类，均非缺失：

1. **Compose/部署键**（不属于 API schema，pre-existing）：`POSTGRES_*`、`REDIS_PASSWORD`、`MINIO_*`、`*_PORT`、`ROAMLOG_IMAGE_TAG`、`ROAMLOG_ENV_FILE`、`NEXT_PUBLIC_*`、`NEXT_TELEMETRY_DISABLED`、`OTEL_EXPORTER_OTLP_ENDPOINT`、`DEMO_*`、`ROAMLOG_SEED_*`、`BOOTSTRAP_SUPER_ADMIN_NAME`、`MEDIA_CORS_ORIGINS`（minio-init 使用）。
2. **本轮新增、尚未进入 API schema 的键**：`AI_ENABLED`（E1 schema 未包含，作为预检开关）、`PLACES_*`、`GEOAPIFY_*`、`MEDIA_{MAX_EDGE,QUALITY,TARGET_BYTES,KEEP_ORIGINAL}`。其中 AI 的 7 个端点/超时/配额键在任务执行期间已被 E1 加入 schema（47→54），因此不再出现在 extra；C/D1 的键仍由模块直接读 `process.env`/web 常量。

原始输出（最终运行）：

```text
schema keys (54): ADMIN_2FA_ENFORCED, ADMIN_URL, AI_API_KEY, AI_BASE_URL, AI_DAILY_QUOTA, AI_MAX_OUTPUT_TOKENS, AI_MODEL, AI_PROTOCOL, AI_TIMEOUT_MS, API_PORT, API_URL, APP_ENV, APP_URL, AUTH_RATE_LIMIT_MAX, BETTER_AUTH_SECRET, BETTER_AUTH_URL, BOOTSTRAP_SUPER_ADMIN_EMAIL, CONFIG_ENCRYPTION_KEY, CONFIG_ENCRYPTION_KEYS, CORS_ORIGINS, DATABASE_URL, EMAIL_FROM, EMAIL_PROVIDER, EXPORT_SIGNED_URL_TTL, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, LOG_LEVEL, MEDIA_PRESIGN_RATE_LIMIT_MAX, MEDIA_SIGNED_URL_TTL_SECONDS, NODE_ENV, PUBLIC_SHARE_PASSWORD_RATE_LIMIT_MAX, PUBLIC_SHARE_RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS, REDIS_PREFIX, REDIS_URL, RESEND_API_KEY, S3_ACCESS_KEY, S3_BUCKET, S3_ENDPOINT, S3_FORCE_PATH_STYLE, S3_PUBLIC_BASE_URL, S3_PUBLIC_ENDPOINT, S3_REGION, S3_SECRET_KEY, SENTRY_DSN, SENTRY_TRACES_SAMPLE_RATE, SESSION_COOKIE_DOMAIN, SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_USER, TRUST_PROXY

== .env.example (92 keys) ==
missing (0): (none)
extra   (38): ADMIN_PORT, AI_ENABLED, BOOTSTRAP_SUPER_ADMIN_NAME, DEMO_EDITOR_EMAIL, DEMO_OWNER_EMAIL, DEMO_SEED_ENABLED, DEMO_VIEWER_EMAIL, GEOAPIFY_API_KEY, GEOAPIFY_DAILY_LIMIT, MAILPIT_SMTP_PORT, MAILPIT_UI_PORT, MEDIA_CORS_ORIGINS, MEDIA_KEEP_ORIGINAL, MEDIA_MAX_EDGE, MEDIA_QUALITY, MEDIA_TARGET_BYTES, MINIO_CONSOLE_PORT, MINIO_IMAGE, MINIO_MC_IMAGE, MINIO_PORT, MINIO_ROOT_PASSWORD, MINIO_ROOT_USER, NEXT_PUBLIC_APP_ENV, NEXT_PUBLIC_GEOCODER_URL, NEXT_PUBLIC_MAP_STYLE_URL, NEXT_TELEMETRY_DISABLED, OTEL_EXPORTER_OTLP_ENDPOINT, PLACES_FALLBACK_TO_PHOTON, PLACES_PROVIDER, POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_PORT, POSTGRES_USER, REDIS_PORT, ROAMLOG_ENV_FILE, ROAMLOG_SEED_PRINT_SHARE_TOKEN, ROAMLOG_SEED_S3_UPLOAD, WEB_PORT

== docker/staging.env.example (87 keys) ==
missing (0): (none)
extra   (33): AI_ENABLED, BOOTSTRAP_SUPER_ADMIN_NAME, DEMO_SEED_ENABLED, GEOAPIFY_API_KEY, GEOAPIFY_DAILY_LIMIT, MEDIA_KEEP_ORIGINAL, MEDIA_MAX_EDGE, MEDIA_QUALITY, MEDIA_TARGET_BYTES, MINIO_BROWSER_REDIRECT_URL, MINIO_IMAGE, MINIO_MC_IMAGE, MINIO_ROOT_PASSWORD, MINIO_ROOT_USER, NEXT_PUBLIC_GEOCODER_URL, NEXT_PUBLIC_MAP_STYLE_URL, NEXT_TELEMETRY_DISABLED, OTEL_EXPORTER_OTLP_ENDPOINT, PLACES_FALLBACK_TO_PHOTON, PLACES_PROVIDER, POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER, REDIS_PASSWORD, ROAMLOG_ENV_FILE, ROAMLOG_IMAGE_TAG, ROAMLOG_SEED_PRINT_SHARE_TOKEN, ROAMLOG_SEED_S3_UPLOAD, STAGING_ADMIN_PORT, STAGING_API_PORT, STAGING_MAILPIT_UI_PORT, STAGING_MINIO_CONSOLE_PORT, STAGING_WEB_PORT

== docker/production.env.example (79 keys) ==
missing (0): (none)
extra   (25): AI_ENABLED, GEOAPIFY_API_KEY, GEOAPIFY_DAILY_LIMIT, MEDIA_CORS_ORIGINS, MEDIA_KEEP_ORIGINAL, MEDIA_MAX_EDGE, MEDIA_QUALITY, MEDIA_TARGET_BYTES, MINIO_BROWSER_REDIRECT_URL, MINIO_MC_IMAGE, MINIO_ROOT_PASSWORD, MINIO_ROOT_USER, NEXT_TELEMETRY_DISABLED, PLACES_FALLBACK_TO_PHOTON, PLACES_PROVIDER, POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER, PRODUCTION_ADMIN_PORT, PRODUCTION_API_PORT, PRODUCTION_MINIO_CONSOLE_PORT, PRODUCTION_MINIO_S3_PORT, PRODUCTION_WEB_PORT, REDIS_PASSWORD, ROAMLOG_IMAGE_TAG

TOTAL missing across three templates: 0
```

## 4. 验证命令与结果

### 验证 1 — 变量一致性（必须 missing=0）

```bash
$ node <one-off>/env-key-drift.mjs
schema keys (54) ...
== .env.example (92 keys) ==
missing (0): (none)
== docker/staging.env.example (87 keys) ==
missing (0): (none)
== docker/production.env.example (79 keys) ==
missing (0): (none)
TOTAL missing across three templates: 0
```

结果：**exit 0，missing=0**。完整输出见 §3。

### 验证 2 — production 模板预检必须以 1 失败并指出加密 key

```bash
$ env -u NODE_ENV -u APP_ENV pnpm exec tsx tooling/scripts/check-env.ts \
    --env production --env-file docker/production.env.example
Loaded environment from C:\Users\BY9700\Desktop\UI\roamlog\docker\production.env.example (mode: production)
WARN: GEOAPIFY_API_KEY is empty, so Geoapify search is skipped. Set the key, or set PLACES_PROVIDER=photon. Photon fallback is enabled.
ERROR: CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte value (the value is not printed). Generate a key with: openssl rand -base64 32
ERROR: APP_URL still contains a placeholder value; replace it before deploying.
ERROR: ADMIN_URL still contains a placeholder value; replace it before deploying.
ERROR: API_URL still contains a placeholder value; replace it before deploying.
ERROR: BETTER_AUTH_URL still contains a placeholder value; replace it before deploying.
ERROR: CORS_ORIGINS still contains a placeholder value; replace it before deploying.
ERROR: SESSION_COOKIE_DOMAIN still contains a placeholder value; replace it before deploying.
ERROR: POSTGRES_PASSWORD still contains a placeholder value; replace it before deploying.
ERROR: DATABASE_URL still contains a placeholder value; replace it before deploying.
ERROR: REDIS_PASSWORD still contains a placeholder value; replace it before deploying.
ERROR: REDIS_URL still contains a placeholder value; replace it before deploying.
ERROR: BETTER_AUTH_SECRET still contains a placeholder value; replace it before deploying.
ERROR: CONFIG_ENCRYPTION_KEY still contains a placeholder value; replace it before deploying.
ERROR: MINIO_ROOT_PASSWORD still contains a placeholder value; replace it before deploying.
ERROR: S3_SECRET_KEY still contains a placeholder value; replace it before deploying.
ERROR: S3_PUBLIC_ENDPOINT still contains a placeholder value; replace it before deploying.
ERROR: MEDIA_CORS_ORIGINS still contains a placeholder value; replace it before deploying.
ERROR: EMAIL_FROM still contains a placeholder value; replace it before deploying.
ERROR: RESEND_API_KEY still contains a placeholder value; replace it before deploying.
ERROR: ROAMLOG_IMAGE_TAG still contains a placeholder value; replace it before deploying.
ERROR: BOOTSTRAP_SUPER_ADMIN_EMAIL still contains a placeholder value; replace it before deploying.
ERROR: CONFIG_ENCRYPTION_KEY: CONFIG_ENCRYPTION_KEY and every CONFIG_ENCRYPTION_KEYS entry must be base64-encoded 32-byte values
ERROR: S3_PUBLIC_ENDPOINT: S3_PUBLIC_ENDPOINT still contains a placeholder; replace it before deploying
ERROR: EMAIL_FROM: Replace the placeholder EMAIL_FROM before production
ERROR: RESEND_API_KEY: RESEND_API_KEY must be a real Resend key (re_...), not a placeholder

Environment configuration is invalid (25 problem(s)).
[exit: 1]
```

结果：**exit 1**，3 条错误分别覆盖“长度/base64 非法”“模板占位”“schema 32 字节规则”，均点名 `CONFIG_ENCRYPTION_KEY` 并给出生成命令。值从未打印。

### 验证 3 — 合法合成 env 必须通过

合成文件：复制 production 模板，替换全部占位（域名 `roamlog.test`、随机 DB/Redis/MinIO/S3 密码、真实 `re_...` 形状 key、48 字节 `BETTER_AUTH_SECRET`），并用 `crypto.randomBytes(32).toString("base64")` 生成两个合法 key（current + ring）。临时文件在仓库外，未提交。

```bash
$ env -u NODE_ENV -u APP_ENV pnpm exec tsx tooling/scripts/check-env.ts \
    --env production --env-file <temp>/e0-valid-production.env
Loaded environment from C:\Users\BY9700\AppData\Local\Temp\e0-valid-production.env (mode: production)
WARN: GEOAPIFY_API_KEY is empty, so Geoapify search is skipped. Set the key, or set PLACES_PROVIDER=photon. Photon fallback is enabled.
Environment configuration looks valid.
[exit: 0]
```

结果：**exit 0**（唯一 warning 是“未配置 Geoapify key、Photon 兜底开启”，属预期可选状态）。key 长度均为 44 字符且未输出。

### 验证 4 — `pnpm staging:validate`

```bash
$ pnpm staging:validate
$ python tooling/scripts/staging-validate.py
Staging static checks passed: compose YAML, environment templates, Dockerfiles, workflow gate, and shell syntax.
[exit: 0]
```

### 验证 5 — production compose YAML 可解析

```bash
$ python -c "import yaml;yaml.safe_load(open('docker/compose.production.yml'));print('yaml ok')"
yaml ok
[exit: 0]
```

### 附加验证（证明边界条件）

缺失 key（合法 env 去掉加密值）：

```text
ERROR: CONFIG_ENCRYPTION_KEY is required when APP_ENV=production: secrets saved in Admin settings cannot be encrypted without it. Generate a key with: openssl rand -base64 32
Environment configuration is invalid (1 problem(s)).
[exit: 1]
```

非法 key ring entry：

```text
ERROR: CONFIG_ENCRYPTION_KEYS entry 1 must be a base64-encoded 32-byte value (the value is not printed). Generate a key with: openssl rand -base64 32
ERROR: CONFIG_ENCRYPTION_KEY: CONFIG_ENCRYPTION_KEY and every CONFIG_ENCRYPTION_KEYS entry must be base64-encoded 32-byte values
Environment configuration is invalid (2 problem(s)).
[exit: 1]
```

`AI_ENABLED=true` 但缺三个端点值：

```text
ERROR: AI_BASE_URL is required when AI_ENABLED=true. Set AI_ENABLED=false to keep the planner off and let the endpoints answer 503 AI_NOT_CONFIGURED.
ERROR: AI_API_KEY is required when AI_ENABLED=true. ...
ERROR: AI_MODEL is required when AI_ENABLED=true. ...
Environment configuration is invalid (3 problem(s)).
[exit: 1]
```

`AI_ENABLED=false` 但残留端点值（计费风险告警，不阻断）：

```text
WARN: AI_BASE_URL/AI_API_KEY/AI_MODEL are set while AI_ENABLED=false. The API derives `configured` from AI_BASE_URL+AI_MODEL and does not read AI_ENABLED, so AI would still be active; empty the endpoint values to keep it off, or set AI_ENABLED=true and provide all three.
Environment configuration looks valid.
[exit: 0]
```

格式化与类型：

- `pnpm exec prettier --check` 对本次改动的 TS/Markdown 全部通过（已 `--write` 对齐；`.env*` 无 prettier parser，不属于 format 检查范围）。
- `git diff --check` 无空白错误。
- 说明：用临时严格 `tsc --noEmit` 检查 `check-env.ts` 会报 `options` 使用前未赋值与 `process.env` 索引签名等**既有**问题（行号 258+，非本次新增）；仓库没有 tsconfig 覆盖 `tooling/`，`turbo typecheck` 只跑 workspace 包，故该脚本由 `tsx` 执行、不在 workspace typecheck 范围内。

## 5. CodeGraph 证据

- `codegraph status`
  - 最终输出：`[OK] Index is up to date`，`Files: 1,569` / `Nodes: 24,266`。
- `codegraph_explore "CONFIG_ENCRYPTION_KEY CONFIG_ENCRYPTION_KEYS secretCipher settings encryption key ring"`（`projectPath=C:\Users\BY9700\Desktop\UI\roamlog`）
  - 命中 `apps/api/src/modules/settings/secret-box.ts`：`SecretBox.fromEnvironment → parseKeyRing → parseKey`，key ring 首位为 current，`keyIdFor(SHA-256)`，AES-256-GCM，AAD=setting key；错误码 `CONFIG_ENCRYPTION_KEY_MISSING/INVALID`、`SECRET_DECRYPT_FAILED`。
  - 命中 `apps/api/src/config/app-config.service.ts`：`configEncryptionKey`/`configEncryptionKeys` getter。
  - 命中 `settings.service.ts:box()`：缺 key → `503 SETTINGS_ENCRYPTION_UNAVAILABLE`；解密失败 → `SETTINGS_SECRET_UNREADABLE`（文档据此编写）。
- `codegraph_explore "places provider Geoapify fallback Photon provider configuration media compression settings AI provider configuration"`
  - 命中 `apps/api/src/modules/places/places.settings.ts`：`resolvePlacesSettings` 读取 `PLACES_PROVIDER`/`GEOAPIFY_API_KEY`/`GEOAPIFY_DAILY_LIMIT`/`PLACES_FALLBACK_TO_PHOTON`，默认 `DEFAULT_GEOAPIFY_DAILY_LIMIT=3000`、`DEFAULT_PLACES_FALLBACK_TO_PHOTON=true`、cache TTL 900/30。
  - 命中 `places-cache.service.ts` 的 provider-scoped `places:v3:` 键，`places-quota.service.ts` 的 UTC 日配额与 fail-open 行为（地点文档据此编写）。
- 非代码图覆盖、用只读命令核对的事实：`settings.registry.ts` 的 5 个 `isSecret` 键（`mail.resendApiKey`、`mail.smtpPassword`、`storage.accessKey`、`storage.secretKey`、`places.apiKey`）；`ai.settings.ts` 的 `configured = Boolean(baseUrl && model)` 与默认 60000/6000/20；web 压缩常量 `IMAGE_MAX_EDGE=2000`/`IMAGE_TARGET_BYTES=1500000`/quality `0.82`；`packages/contracts/src/api/ai.ts` 的 `AI_ERROR_CODES`；AI plan service 的 429/502/503 映射。

## 6. 已知风险

1. **`AI_ENABLED` 不在 API 代码中**：E1 的 `environment.ts`/`ai.settings.ts` 不读取它，API 以 `AI_BASE_URL && AI_MODEL` 判定已配置。模板/预检按任务要求以 `AI_ENABLED=true` 作为开关；已加“开关 false 但端点仍设置”的 warning 并在文档中要求同时清空端点，避免静默计费。若 E1 后续实现 `AI_ENABLED`，check-env 的行为仍兼容。
2. **媒体压缩变量尚未被代码读取**（D1 在跑）：模板按现有 web 常量取默认（2000px/82/1.5MB/keep=false）。若 D1 采用 0–1 的 quality 或不同单位，模板与 check-env 的 1–100 假设需要同步调整。另：Next.js 客户端变量若需构建期注入，还需 Docker build args，本任务未覆盖（D1/构建负责人）。
3. **`AI_SCHEMA_INVALID`** 在 contracts 中定义，但当前 E1 代码未检索到发射点（请求/工具参数错误走 `AI_TOOL_FAILED`/`INVALID_ARGUMENTS`，上游格式错误走 `AI_UPSTREAM`）。文档按契约描述该码，属于待接线项。
4. **“Powered by Geoapify” 归属当前 UI 缺失**：`apps/web/components/map/map-canvas.tsx` 只有 `© OpenStreetMap`；文档将其标为 Geoapify 模式的发布阻断项，需要 UI 负责人补上（本任务禁止改 apps）。
5. **staging 语义变化**：新增 `APP_ENV=staging`（此前未声明、默认 development）。只影响 `APP_ENV` 专属规则（staging 仍允许 Mailpit、不要求公开媒体 origin），但部署方应知道该文件现在显式声明 staging。
6. **`.env.example` 的加密 key 为空**（见 §2.1 理由）：与“三模板都用占位”有一处有意偏离；若强行放占位，本地 API 启动会被 `validateEnvironment()` 拒绝。
7. **staging 模板的加密占位**会使“原样启动 staging”在首次写 secret 时失败；这与其他 `replace-with-*` 占位一致，部署前必须替换。
8. **check-env 的媒体/地点范围校验是基于当前默认值的约定**：若 C/D1 改单位或范围，需要同步更新，否则会出现“文档正确但实现不同”的漂移。

## 7. 未覆盖项

- 未启动 Docker/compose，未做容器内 API 启动验证（本机无 Docker CLI，仓库约束如此；仅静态 compose/YAML 校验）。
- 未对 staging 模板跑 `validateEnvironment()` 全量 boot 校验（只跑 `pnpm staging:validate` 静态检查；模板含 `replace-with-*`，原样 boot 预期失败）。
- 未运行全仓 `pnpm typecheck` / `pnpm test`：并行 Agent 正在改 `apps/api`、`apps/web`、`packages/contracts`，此时全仓门禁不能归因于本任务；只做了针对性校验（见 §4）。
- 未实际调用 OpenAI/Anthropic/本地 magpie，也未验证 AI 端点的运行期失败码（E1 代码仍在并行落地）。
- 未验证 `CONFIG_ENCRYPTION_KEYS` 轮转的实际重加密（需要运行中的 API + 数据库 + 后台操作；文档给出了流程与 SQL）。
- 未更新 `docs/architecture.md`（不在本任务允许文件列表）与备份脚本（`production-backup-restore.md` 未纳入）。

## 8. 建议下一步

1. **E1**：要么实现 `AI_ENABLED` 读取（与预检一致），要么把它从模板/校验中移除；并接线 `AI_SCHEMA_INVALID`。
2. **D1**：确认 `MEDIA_*` 的单位与注入方式（运行时 vs Next 构建期）；若为构建期，补 Docker build args 与 release workflow。
3. **Web/UI**：在地点搜索结果旁补 “Powered by Geoapify”，移动端与 reduced-motion 均可见。
4. **C**：考虑把 `PLACES_*`/`GEOAPIFY_*` 提升进 `environment.ts` schema，让 API boot 与预检共用同一份校验。
5. **Ops**：把 `CONFIG_ENCRYPTION_KEY` 加入生产 secret 清单与异地备份演练；发布前用真实 `.env.production` 跑一次 `check-env` 并保存输出。
6. **CI**：可把本报告 §7 的一致性脚本固化为 `tooling/scripts/check-env-keys.mjs` 并加入 quality gate，防止模板再次漂移。

---

## 附录：一致性脚本原文（一次性，未提交）

```js
import { readFileSync } from "node:fs";

const schema = readFileSync("apps/api/src/config/environment.ts", "utf8");
const block = schema.slice(
  schema.indexOf(".object({"),
  schema.indexOf("})", schema.indexOf(".object({")),
);
const schemaKeys = new Set(
  block
    .split(/\r?\n/)
    .map((line) => /^\s{4}([A-Z][A-Z0-9_]*):/.exec(line)?.[1])
    .filter(Boolean),
);

const templates = [
  ".env.example",
  "docker/staging.env.example",
  "docker/production.env.example",
];

const parse = (path) =>
  new Map(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line.trim()))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i).trim(), line.slice(i + 1)];
      }),
  );

console.log(`schema keys (${schemaKeys.size}): ${[...schemaKeys].sort().join(", ")}\n`);
let allMissing = 0;
for (const path of templates) {
  const keys = parse(path);
  const missing = [...schemaKeys].filter((k) => !keys.has(k)).sort();
  const extra = [...keys.keys()].filter((k) => !schemaKeys.has(k)).sort();
  allMissing += missing.length;
  console.log(`== ${path} (${keys.size} keys) ==`);
  console.log(`missing (${missing.length}): ${missing.length ? missing.join(", ") : "(none)"}`);
  console.log(`extra   (${extra.length}): ${extra.length ? extra.join(", ") : "(none)"}\n`);
}
console.log(`TOTAL missing across three templates: ${allMissing}`);
```

> 注：脚本解析的是 `environment.ts` 的顶层 `.object({...})` 键；`apps/api/src/config/environment.ts` 在任务期间被并行 Agent 修改（47→54 键），本报告数值为最终运行结果。`.env*` 文件不进入 prettier 检查（无 parser），这与仓库现状一致。

## 附录：commit

本报告与代码/文档同 commit：

```text
feat(devops): document and validate the settings encryption key and the new providers
```

精确暂存路径见 §1；未使用 `git add -A`，未 amend/rebase/reset，未 push。