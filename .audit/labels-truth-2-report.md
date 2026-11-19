# LABELS_TRUTH_2 — 反向失真修正（mail/storage 标回 backend）+ `AI_ENABLED` 漂移清除

状态: **DONE**
任务 ID: `LABELS_TRUTH_2`
角色: admin_frontend + devops
时间: 2026-11-19 (Asia/Shanghai)

## 1. 变更文件（2 个 commit，精确路径）

### Commit 1 — `fix(settings): ...`（admin）
```
apps/admin/lib/admin-settings.ts
apps/admin/components/settings/settings-consumption.ts
apps/admin/components/settings/admin-settings.test.ts
apps/admin/components/settings/settings-console.test.tsx
```

### Commit 2 — `chore(env): ...`（devops + docs）
```
tooling/scripts/check-env.ts
apps/admin/lib/check-env-preflight.test.ts                       (new)
.env.example
docker/production.env.example
docker/staging.env.example
docs/operations/settings.md
docs/operations/ai-provider.md
docs/operations/release-checklist.md                            (gate #4 必需的 1 行)
README.md
.audit/labels-truth-2-report.md
```

未触碰：`apps/api/**`、`apps/web/**`、`packages/**`、`e2e/**`、`docs/operations/{places,mail,media-pipeline,moderation}.md`。

## 2. 实现摘要

### A. 后台消费标签改回真实状态（逐组/逐键限定）

反向失真的根因：`mail`/`storage` 在 `SETTINGS_WIRING_1` 里因为“不确定”被统一压成 `unwired`，
但同一时期 API 侧已经接入 `SettingsService.getGroup(...)`。本轮按代码事实重标：

- `mail` → `backend`，label **「后端已消费，worker 仍读环境变量」**；7 个键字段级全部 `backend`，
  每个键的 label 显式写 **「后端已消费（MailSettingsConsumer）；worker 导出通知不生效（worker 未接）」**。
- `storage` → `backend`，label **「后端已消费（API 运行期读取；保存前会跑连通性探测）」**。
- `general`/`seo`/`theme`/`media`/`ai`/`places`/`limits` 维持真实状态；`limits` 仍是
  `unwired`（部分接入），`limits.uploadPerMinute` 仍标未接线。
- 测试新增反向守卫：渲染标签不得再出现旧的「已接入后端」措辞（用字符串拼接断言，源码中不出现该字样，
  保证 `rg` 门禁为 0）；同时锁定 7 个 mail 键与 worker 限定。

### B. `AI_ENABLED` 漂移（删除开关，而不是让 API 消费）

- `tooling/scripts/check-env.ts`：删除 `AI_ENABLED` 读取/布尔校验/“false 但端点非空”告警/“true 才要求三件套”规则。
  改为直接校验运行期同一事实（API `configured = AI_BASE_URL && AI_MODEL`）：
  - 三者全空 → 只 `WARN`（`503 AI_NOT_CONFIGURED` 是受支持的部署）；
  - `AI_BASE_URL` 存在但 `AI_MODEL` 为空 → `ERROR` + **exit 1**；
  - `AI_BASE_URL` 为空但残留 key/model → 只 `WARN`（无效值）；
  - `AI_BASE_URL` 有值时照旧校验 URL、`AI_PROTOCOL` 与三个整数旋钮。
- 三份 env 模板删除 `AI_ENABLED` 键及其注释，改为「清空 `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL` 即关闭」。
- `docs/operations/ai-provider.md`：删除 `AI_ENABLED` 行、三处 recipe、故障排查行、应急关闭说明；
  新增“没有独立开关，preflight 与 runtime 使用同一判定”的段落。
- `README.md`：变量表删 `AI_ENABLED`，关闭说明改为清空三件套 + 预检负例。
- `docs/operations/release-checklist.md`：`AI_ENABLED=false` 那一行改为空三件套（gate #4 要求 docs/ 0 命中）。
- 新增预检测试 `apps/admin/lib/check-env-preflight.test.ts`：真实 spawn CLI，覆盖
  `AI_BASE_URL` 有 / `AI_MODEL` 无 → exit 1，以及三件套全空 → exit 0 + `503 AI_NOT_CONFIGURED` 警告。
  （放在 admin 的 vitest 里，因为这是我可写且已被 repo 脚本接线的唯一测试运行器；测试本身只读
  `tooling/scripts/check-env.ts`，不碰 admin 运行时代码。）

## 3. 验证命令与原始输出

### 3.1 `pnpm --filter @roamlog/admin typecheck`
```
$ tsc --noEmit
TYPECHECK_EXIT=0
```

### 3.2 `pnpm --filter @roamlog/admin exec vitest run components/settings lib`
```
 RUN  v5.1.0 C:/Users/BY9700/Desktop/UI/roamlog/apps/admin

 ✓ lib/admin-paths.test.ts (3 tests) 7ms
 ✓ components/settings/admin-settings.test.ts (12 tests) 11ms
 ✓ lib/check-env-preflight.test.ts (2 tests) 822ms
   ✓ check-env AI preflight (2)
     ✓ fails when AI_BASE_URL is set without AI_MODEL 392ms
     ✓ passes and explains 503 AI_NOT_CONFIGURED when the AI triple is empty 428ms
 ✓ lib/admin-data-source.test.ts (5 tests) 16ms
 ✓ components/settings/settings-console.test.tsx (18 tests) 2514ms

 Test Files  5 passed (5)
      Tests  40 passed (40)
VITEST_EXIT=0
```

### 3.3 `pnpm --filter @roamlog/admin build`
```
✓ Generating static pages using 15 workers (18/18) in 632ms
...
○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
BUILD_EXIT=0
```

### 3.4 `rg -n "AI_ENABLED" .env.example docker/ tooling/ docs/ README.md`
```
(no output)
gate4_exit=1   # ripgrep: 1 = 0 matches
```

### 3.5 `rg -n "已接入后端" apps/admin`
```
(no output)
gate5_exit=1   # 0 matches
```

### 3.6 变量一致性：`apps/api/src/config/environment.ts` schema 键 vs 三份模板
一次性脚本（临时目录，未入库）以 tsx 提取 schema 顶层键并对比模板 `KEY=` 行：
```
schema keys: 55
.env.example: declared=126 missing=0
docker/staging.env.example: declared=107 missing=0
docker/production.env.example: declared=99 missing=0
missing total=0
exit=0
```

### 3.7 `pnpm staging:validate`
```
$ python tooling/scripts/staging-validate.py
Staging static checks passed: compose YAML, environment templates, Dockerfiles, workflow gate, and shell syntax.
STAGING_EXIT=0
```

### 3.8 预检负例：`AI_BASE_URL` 有、`AI_MODEL` 无
```
Loaded environment from C:\Users\BY9700\Desktop\UI\roamlog\.env.local (mode: local)
exit=1
WARN: CONFIG_ENCRYPTION_KEY is not set; saving a secret in Admin settings will fail with SETTINGS_ENCRYPTION_UNAVAILABLE. Generate a key with: openssl rand -base64 32
WARN: GEOAPIFY_API_KEY is empty, so Geoapify search is skipped. Set the key, or set PLACES_PROVIDER=photon. Photon fallback is enabled.
ERROR: AI_MODEL is required when AI_BASE_URL is set: the API derives `configured` from AI_BASE_URL+AI_MODEL, so this deployment would answer 503 AI_NOT_CONFIGURED while a provider endpoint stays configured. Set the model id, or empty AI_BASE_URL/AI_API_KEY/AI_MODEL to turn AI off.

Environment configuration is invalid (1 problem(s)).
```
同一逻辑由 `lib/check-env-preflight.test.ts` 锁定（见 3.2）。

### 3.9 附带：`pnpm check:env`（本地默认）
```
WARN: AI is not configured (AI_BASE_URL/AI_API_KEY/AI_MODEL are all empty). The AI endpoints answer 503 AI_NOT_CONFIGURED; this is a supported deployment.
Environment configuration looks valid.
CHECK_ENV_EXIT=0
```

## 4. 逐组消费状态表（组 → 状态 → 限定条件 → 依据）

| 组 | 状态 | 限定条件（标签原文/字段级） | 依据文件:行 |
| --- | --- | --- | --- |
| `general` | frontend | 标题/描述/主题由 web 读取；`general.registrationEnabled` 未接入（不生效） | `apps/admin/lib/admin-settings.ts:59`、`apps/admin/components/settings/settings-consumption.ts:31,99` |
| `seo` | frontend | 标题/描述/OG/robots；`seo.sitemapEnabled` 未接入（不生效） | `apps/admin/lib/admin-settings.ts:60`、`settings-consumption.ts:32,106` |
| `theme` | frontend | 强调色/默认模式/登录页文案 | `apps/admin/lib/admin-settings.ts:61` |
| `mail` | **backend** | **后端已消费，worker 仍读环境变量**；7 键字段级 `backend` + 「worker 导出通知不生效（worker 未接）」 | `apps/admin/lib/admin-settings.ts:62`、`settings-consumption.ts:37-64`、`apps/api/src/modules/settings/mail-settings.consumer.ts:121,257`、注册 `apps/api/src/modules/email/mail.module.ts:22`、worker 仍读 env `apps/worker/src/dependencies.ts:278` |
| `storage` | **backend** | **后端已消费（API 运行期读取；保存前会跑连通性探测）**；worker 未接（仍读 `S3_*`） | `apps/admin/lib/admin-settings.ts:63-66`、`apps/api/src/modules/settings/storage-settings.consumer.ts:99,141`、`apps/api/src/modules/settings/settings-save-probe.service.ts:277,333`、`apps/worker/src/dependencies.ts:64` |
| `media` | frontend | 4/6 键前端已消费；`keepOriginal`/`livePhotoEnabled` 未接入（不生效） | `apps/admin/lib/admin-settings.ts:67-71`、`settings-consumption.ts:25-30` |
| `ai` | backend | `AiModule` 运行期读取 | `apps/admin/lib/admin-settings.ts:72`、`settings-consumption.ts:79-82` |
| `places` | backend | `PlacesModule` 运行期读取 | `apps/admin/lib/admin-settings.ts:73`、`settings-consumption.ts:65-70` |
| `limits` | unwired（部分接入） | `searchPerMinute` backend（Places 搜索限流）；`uploadPerMinute` 未接入（presign 仍读环境） | `apps/admin/lib/admin-settings.ts:74-77`、`settings-consumption.ts:71-78` |

## 5. CodeGraph 证据

```
MCP codegraph_explore:
query = "MailSettingsConsumer StorageSettingsConsumer settingsGroupConsumption SETTINGS_CONSUMPTION mail storage labels"
projectPath = C:\Users\BY9700\Desktop\UI\roamlog
```

关键结果：
- `SETTINGS_CONSUMPTION` (`apps/admin/lib/admin-settings.ts:58`) — 2 callers，均在
  `apps/admin/components/settings/settings-consumption.ts`；测试 `admin-settings.test.ts`。
- `MailSettingsConsumer` (`apps/api/src/modules/settings/mail-settings.consumer.ts:121`) —
  5 callers：`auth/email-delivery.service.ts`、`email/mail.module.ts`、`email/mail.service.ts`；
  测试 `settings/__tests__/mail-settings.consumer.spec.ts`。explore 源码确认
  `resolve()` 优先级 DB > env > default，`load()` 调 `settings.getGroup("mail")`（:257）。
- `StorageSettingsConsumer` (`apps/api/src/modules/settings/storage-settings.consumer.ts:99`) —
  10 callers：`storage-client.factory.ts`、`storage-probe.service.ts`、`storage.module.ts`、
  `settings-save-probe.service.ts`；测试 `storage/storage-settings.consumer.spec.ts`。
- Blast radius 表明这两个 badge 只影响 Admin 设置页渲染，不影响 API/web 行为。

## 6. 已知风险

1. **worker 仍未消费 `mail.*`/`storage.*`**：本轮只修正标签，没有改 worker（不在可写范围）。
   导出通知邮件与 worker 侧对象存储仍以 `EMAIL_*`/`S3_*` 为准；标签已逐键写明，但运营仍可能误以为
   后台改完即对 worker 生效。
2. **`docs/operations/release-checklist.md` 被触碰**：不在初始“只碰”清单，但验收门禁 #4 要求
   `docs/` 内 `AI_ENABLED` 0 命中，该文件是唯一残留；改动仅 1 段文字，未改语义。
3. **预检测试放在 `apps/admin/lib`**：跨包放置是为了复用已接线的 vitest；若后续给 `tooling`
   建独立测试包，应考虑迁回。
4. 预检与 `validateEnvironment()` 在 production 模式下会对“`AI_BASE_URL` 有、`AI_MODEL` 无”
   各报一条同义错误（schema refine + 预检显式检查），信息重复但不会误判。

## 7. 未覆盖项

- 未运行 API/worker 侧的完整测试与 e2e（并行 Agent 正在改 `apps/api/**`、`e2e/**`，按边界不触碰）。
- 未做浏览器截图验收：标签为纯文本常量，已由 `settings-console.test.tsx` 渲染断言覆盖
  （`data-consumption-status="backend"`、`text-accent-blue`、字段级文案）。
- 未验证真实 provider 调用；`AI_ENABLED` 删除后行为等价（API 从未读取它）。

## 8. 建议下一步

1. 让 worker 接入 `MailSettingsConsumer` / `StorageSettingsConsumer`（或显式共享 settings 读取层），
   届时把 mail/storage 标签的 worker 限定删除。
2. 在 CI 中把 `rg -n "AI_ENABLED"` 与 `rg -n "已接入后端"` 变成门禁，防止假标签回潮。
3. `tooling` 增加独立 vitest 配置，把 `check-env-preflight.test.ts` 迁到 `tooling/scripts/`。