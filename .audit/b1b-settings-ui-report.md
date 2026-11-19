# B1B_SETTINGS_UI — 后台系统设置界面交付报告

- **状态**: DONE
- **任务 ID**: `B1B_SETTINGS_UI`
- **日期**: 2026-11-19（Asia/Shanghai）
- **范围**: 只修改 `apps/admin` 的 settings 页面、设置组件、settings lib、admin 导航及对应测试；未触碰 `apps/web`、`apps/api`、`packages/**`、其它 admin 组件目录、`docker/**`。
- **契约来源**: `packages/contracts/src/api/admin-settings.ts`（`SETTINGS_GROUPS` / `SETTINGS_GROUP_LABELS` / `AdminSettingItem` / `AdminSettingSecretState`）；字段元数据全部来自 `GET /v1/admin/settings` 的响应，不在前端硬编码任何 key、default、options 或分组字段。

## 1. 变更文件

新增：

- `apps/admin/app/admin/settings/page.tsx`
- `apps/admin/components/settings/settings-page-client.tsx`
- `apps/admin/components/settings/settings-console.tsx`
- `apps/admin/components/settings/setting-field.tsx`
- `apps/admin/components/settings/admin-settings.test.ts`
- `apps/admin/components/settings/settings-console.test.tsx`
- `apps/admin/lib/admin-settings.ts`
- `apps/admin/lib/admin-settings-api.ts`
- `.audit/b1b-settings-ui-report.md`（本文件）

修改：

- `apps/admin/components/admin-shell/admin-nav.ts`（在「数据与运营」中加入 `系统设置` → `/admin/settings`，图标 `Settings2`）

未修改：`apps/web/**`、`apps/api/**`、`packages/**`、`apps/admin/components/{users,workspaces,dashboard,audit,emails,queues,system,media}/**`、`docker/**`、其它 `.audit`。

## 2. 实现摘要（逐 6 项）

### 2.1 页面与导航

- `/admin/settings` 为真实分组设置页：左侧 `settings groups` 导航（group + item count + 未保存圆点），右侧当前分组表单与只读消费状态行。
- 导航入口加在「数据与运营」，`Settings2` 图标，label「系统设置」；侧栏、面包屑、命令面板均复用 `ADMIN_NAV_GROUPS`，无需额外注册。
- 深链 `/admin/settings?group=mail` 由 server component 读取 `searchParams` 并传给客户端，首屏即定位 Mail；客户端切换 group 时用 `history.replaceState` 同步 URL，链接本身仍是真实 `<a href>`（可新标签打开）。
- 非法 group 回退 `general`，不会白屏。

### 2.2 字段渲染（按 type 分派）

- `string` → `Input`；有 `options` 时 → 原生 `Select`（键盘可达，payload 驱动，不硬编码选项）。
- `number` → `type="number"` + `inputMode="decimal"`；本地校验「非空 + 有限数字」，`step` 由 default 是否为整数推导。**范围校验的边界值（min/max）当前没有出现在 `AdminSettingItem` 契约里**，因此前端不伪造边界；服务端 422 的 range 文案会映射到对应字段（见 §2.3）。
- `boolean` → `Switch`，提交 boolean，不提交字符串 `"true"`。
- `json` → 对象为键值行编辑器（增行、删行、键/值分别编辑，值按 JSON 解析），数组/标量为 raw JSON textarea；非法 JSON 就地 `role="alert"` 报错并禁用保存。当前 registry 的 45 个真实 key 中没有 `json` 类型，编辑器用合成数据完成测试。
- `secret` → 只显示 `{hasValue, last4}`：无值显示「未设置」，有值显示 `••••{last4}`；另有独立的「设置新值」密码输入框，提交后重新拉取该分组并只回显新的 last4；页面初始 HTML/输入值中都不包含明文。
- 每个字段显示 `label`、`help`、`type`/`isPublic`/`isSecret` 徽标、`当前值来源：代码默认 | 数据库 | 环境变量`、`最后更新`；`envLocked` 时显示「由环境变量锁定，界面不可改。」并禁用该字段所有可编辑控件（含 JSON 行操作和 reveal）。
- 值来源推导只使用 payload 事实：`envLocked` → 环境变量，`updatedAt !== null` → 数据库，否则代码默认；不做动态探测。

### 2.3 保存与错误

- 顶部「保存更改」是页面唯一的 `variant="primary"` 白色主按钮；仅当当前分组存在 dirty 字段、无本地校验错误、且角色为 `super_admin` 时启用。其余按钮（重新读取、放弃更改、重试、reveal 确认）全部 ghost/outline。
- 提交 `PATCH /v1/admin/settings`，body `{ updates: [...] }`，只包含 dirty 字段；secret 只在输入了新值时出现，已有密文不会回传浏览器。
- 422 `SETTINGS_INVALID`：从 `ProblemDetails.errors[]` 提取 `{field, message}`，逐字段显示在对应字段下方，保留所有已填内容；顶部提示「有字段未通过服务端校验」，可再次保存。
- 403：`ADMIN_ACCESS_DENIED` → 「需要超级管理员权限。」；`ADMIN_2FA_REQUIRED` → TOTP 2FA 文案；401 → 会话过期文案。输入不丢。
- 网络/5xx：显示「保存失败，可重试」+「重试保存」，保留输入并再次提交。
- 保存成功：先 `PATCH`，再 **重新 `GET /v1/admin/settings`**，用服务端返回的该分组替换本地状态后才显示 toast「已保存并重新读取 N 项设置。」；每字段 `updatedAt` 与分组底部「最近写入」随之更新。若写入成功但回读失败，显示「保存已提交，但重新读取失败」并要求重新读取，不假装成功。

### 2.4 reveal（敏感值显示）

- 「显示」按钮仅在 secret `hasValue=true` 时出现；点击先打开 Radix Dialog 确认框，说明「这是一次带审计的操作」，确认后调用 `POST /v1/admin/settings/{key}/reveal`，body `{ confirm: true }`。
- 成功后才在「当前值」输入框中显示明文，并提示「本次显示已记入审计，N 秒后自动隐藏。」；默认 **10 秒**（`SETTINGS_REVEAL_DURATION_MS = 10_000`）后自动恢复 `••••{last4}`。每次 reveal 都重新走确认框。
- 403 映射：`ADMIN_2FA_REQUIRED` → 「需要完成 TOTP 2FA 验证后才能显示敏感值。」；其它 403 → 「需要超级管理员权限，无法显示敏感值。」；401 → 会话过期；网络/5xx → 可重试文案。
- 不显示明文时，页面不持有明文；显示期间明文仅存在于客户端当前输入框内存中。

### 2.5 前端消费状态（只读常量映射）

每个分组底部固定显示一条只读状态行，来自 `lib/admin-settings.ts` 的 `SETTINGS_CONSUMPTION` 常量：

- `general` / `seo` / `theme` → `前端已消费（标题/描述/主题）`
- `mail` / `storage` / `media` / `ai` / `places` / `limits` → `已接入后端，前端/Worker 消费待完成`

没有运行时探测、没有伪造动态状态；该常量已由单测锁定每个 group 的文案。

### 2.6 测试

`apps/admin/components/settings/` 下 23 条测试，覆盖：

- 每种 type 的渲染与提交类型：number → number、boolean → boolean、select/string → string、json → object（断言 `typeof` 与精确 payload）。
- secret 未设置/已设置两种展示；输入新值后仅发送新值、保存后只回显 last4；断言页面 HTML/输入框不含明文。
- reveal 确认后才调用、成功显示明文、审计提示、10 秒自动隐藏；403 2FA 权限文案。
- 422 的 `errors[]` 映射到具体字段并保留输入；403 保存文案；503 可重试且不丢输入。
- 未改动时保存按钮 disabled；改动后 enabled；放弃后恢复 disabled。
- envLocked 字段 disabled + 说明 + 来源「环境变量」。
- 深链 group、分组切换与 URL 更新、分组消费状态行、保存成功后回读并显示 `数据库` 来源/最近写入。

## 3. 验证命令与原始输出

### 3.1 `pnpm --filter @roamlog/admin typecheck` → exit 0

```text
$ tsc --noEmit
```

### 3.2 `pnpm --filter @roamlog/admin exec vitest run components/settings app/admin/settings` → 全绿

```text
 RUN  v5.1.0 C:/Users/BY9700/Desktop/UI/roamlog/apps/admin
 ✓ components/settings/admin-settings.test.ts (8 tests) 7ms
 ✓ components/settings/settings-console.test.tsx (15 tests) 1659ms
 Test Files  2 passed (2)
      Tests  23 passed (23)
   Duration  3.58s (environment 35%, tests 34%, import 15%, setup 12%, transform 4%)
```

### 3.3 `pnpm --filter @roamlog/admin lint` → exit 0

```text
$ eslint .
```

### 3.4 `pnpm --filter @roamlog/admin build` → exit 0，路由表包含 `/admin/settings`

```text
  Finished TypeScript in 8.0s ...
  Collecting page data using 15 workers ...
  Generating static pages using 15 workers (0/17) ...
  Generating static pages using 15 workers (4/17) 
  Generating static pages using 15 workers (8/17) 
  Generating static pages using 15 workers (12/17) 
✓ Generating static pages using 15 workers (17/17) in 669ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /admin
├ ○ /admin/2fa/enroll
├ ○ /admin/audit
├ ○ /admin/emails
├ ○ /admin/flags
├ ○ /admin/login
├ ○ /admin/media
├ ○ /admin/permissions
├ ○ /admin/queues
├ ƒ /admin/settings
├ ○ /admin/system
├ ○ /admin/users
├ ○ /admin/workspaces
├ ○ /login
└ ƒ /v1/[...path]


○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand

```

### 3.5 真实联调（本地栈：API 4000 / Admin dev 3001 / PostgreSQL 55444）

**会话来源**：本地 `roamlog_local` 的 public schema 中没有可用的 `super_admin` 账号（只有 `verify*@roamlog.test` 与 seed 的 `user` 角色）。为完成真实读写，我在**本地数据库**创建了一个临时 `super_admin` 账号 `b1b-admin@roamlog.local`（仅 local DB，未写入仓库、未写入本报告密码）。随后通过 `POST /v1/auth/sign-in/email` 获取 httpOnly session cookie，以下四条 curl 全部带该会话。**没有伪造会话，也没有使用 fixture。**

#### (1) `GET /v1/admin/settings`（拿到分组）

命令：

```bash
curl -s -b /tmp/b1b-cookies.txt http://127.0.0.1:4000/v1/admin/settings
```

原始输出（`-w` 追加状态行；13,171 bytes，9 groups / 45 items；无 secret 明文，secret 项仅有 hasValue/last4）：

```json
{"groups":[{"group":"general","label":"General","items":[{"key":"site.title","group":"general","type":"string","label":"Site title","help":"Shown in the browser tab, SEO titles, and the public site header.","default":"Roamlog","isSecret":false,"isPublic":true,"envLocked":false,"value":"Roamlog 验收基线","updatedAt":"2026-11-19T05:36:22.374Z","updatedById":"01a1f246-d4a5-775b-b48f-97faa107b53e"},{"key":"site.description","group":"general","type":"string","label":"Site description","help":"Default meta description and the short line shown on public pages.","default":"A collaborative travel journal for the trips you take together.","isSecret":false,"isPublic":true,"envLocked":false,"value":"A collaborative travel journal for the trips you take together.","updatedAt":null,"updatedById":null},{"key":"general.defaultLanguage","group":"general","type":"string","label":"Default language","help":"Language used before a visitor or member picks one.","options":["zh-CN","en"],"default":"zh-CN","isSecret":false,"isPublic":true,"envLocked":false,"value":"zh-CN","updatedAt":null,"updatedById":null},{"key":"general.defaultTimeZone","group":"general","type":"string","label":"Default time zone","help":"IANA time zone used for new accounts and date rendering.","default":"Asia/Shanghai","isSecret":false,"isPublic":true,"envLocked":false,"value":"Asia/Shanghai","updatedAt":null,"updatedById":null},{"key":"general.registrationEnabled","group":"general","type":"boolean","label":"Registration open","help":"Turn off to stop new accounts from self-registering.","default":true,"isSecret":false,"isPublic":false,"envLocked":false,"value":true,"updatedAt":null,"updatedById":null}]},{"group":"seo","label":"SEO","items":[{"key":"seo.titleTemplate","group":"seo","type":"string","label":"Title template","help":"Use %s where the page title goes, for example %s · Roamlog.","default":"%s · Roamlog","isSecret":false,"isPublic":true,"envLocked":false,"value":"%s · Roamlog","updatedAt":null,"updatedById":null},{"key":"seo.descriptionTemplate","group":"seo","type":"string","label":"Description template","help":"Default description for pages without their own.","default":"Plan trips, keep a journal, and remember every stop together.","isSecret":false,"isPublic":true,"envLocked":false,"value":"Plan trips, keep a journal, and remember every stop together.","updatedAt":null,"updatedById":null},{"key":"seo.ogImageUrl","group":"seo","type":"string","label":"Open Graph image","help":"Absolute URL of the social preview image. Leave empty to omit it.","default":null,"isSecret":false,"isPublic":true,"envLocked":false,"value":null,"updatedAt":null,"updatedById":null},{"key":"seo.robots","group":"seo","type":"string","label":"Robots directive","help":"Value for the robots meta tag, for example index,follow.","default":"index,follow","isSecret":false,"isPublic":true,"envLocked":false,"value":"index,follow","updatedAt":null,"updatedById":null},{"key":"seo.sitemapEnabled","group":"seo","type":"boolean","label":"Sitemap","help":"Publish /sitemap.xml for public trips.","default":true,"isSecret":false,"isPublic":false,"envLocked":false,"value":true,"updatedAt":null,"updatedById":null}]},{"group":"theme","label":"Theme","items":[{"key":"theme.accent","group":"theme","type":"string","label":"Accent color","help":"Accent used across buttons, focus rings, and charts.","options":["white","amber","blue","emerald","rose"],"default":"white","isSecret":false,"isPublic":true,"envLocked":false,"value":"white","updatedAt":null,"updatedById":null},{"key":"theme.defaultMode","group":"theme","type":"string","label":"Default color mode","help":"Dark, or system. A light palette is not available yet, so system currently renders dark.","options":["dark","system"],"default":"system","isSecret":false,"isPublic":true,"envLocked":false,"value":"system","updatedAt":null,"updatedById":null},{"key":"theme.loginTagline","group":"theme","type":"string","label":"Login tagline","help":"Short line under the login heading.","default":"Every trip deserves a memory.","isSecret":false,"isPublic":true,"envLocked":false,"value":"Every trip deserves a memory.","updatedAt":null,"updatedById":null}]},{"group":"mail","label":"Mail","items":[{"key":"mail.provider","group":"mail","type":"string","label":"Mail provider","help":"Resend or an SMTP relay. Credentials below match the selected provider.","options":["resend","smtp"],"default":"smtp","isSecret":false,"isPublic":false,"envLocked":false,"value":"smtp","updatedAt":null,"updatedById":null},{"key":"mail.from","group":"mail","type":"string","label":"From address","help":"Sender shown on transactional mail.","default":"Roamlog <hello@roamlog.local>","isSecret":false,"isPublic":false,"envLocked":false,"value":"Roamlog <hello@roamlog.local>","updatedAt":null,"updatedById":null},{"key":"mail.resendApiKey","group":"mail","type":"secret","label":"Resend API key","help":"Stored encrypted. Only the last four characters are shown.","default":null,"isSecret":true,"isPublic":false,"envLocked":false,"secret":{"hasValue":false,"last4":null},"updatedAt":null,"updatedById":null},{"key":"mail.smtpHost","group":"mail","type":"string","label":"SMTP host","help":"Relay hostname used when the provider is SMTP.","default":"localhost","isSecret":false,"isPublic":false,"envLocked":false,"value":"localhost","updatedAt":null,"updatedById":null},{"key":"mail.smtpPort","group":"mail","type":"number","label":"SMTP port","help":"Usually 587 for STARTTLS or 465 for implicit TLS.","default":587,"isSecret":false,"isPublic":false,"envLocked":false,"value":587,"updatedAt":null,"updatedById":null},{"key":"mail.smtpUser","group":"mail","type":"string","label":"SMTP user","help":"Username for the SMTP relay. May be empty for unauthenticated relays.","default":"","isSecret":false,"isPublic":false,"envLocked":false,"value":"","updatedAt":null,"updatedById":null},{"key":"mail.smtpPassword","group":"mail","type":"secret","label":"SMTP password","help":"Stored encrypted and never returned by the settings API.","default":null,"isSecret":true,"isPublic":false,"envLocked":false,"secret":{"hasValue":false,"last4":null},"updatedAt":null,"updatedById":null}]},{"group":"storage","label":"Storage","items":[{"key":"storage.endpoint","group":"storage","type":"string","label":"Storage endpoint","help":"S3-compatible API endpoint the server signs against.","default":"http://localhost:9000","isSecret":false,"isPublic":false,"envLocked":false,"value":"http://localhost:9000","updatedAt":null,"updatedById":null},{"key":"storage.publicEndpoint","group":"storage","type":"string","label":"Public endpoint","help":"Browser-facing origin for presigned URLs. Leave empty to reuse the endpoint.","default":null,"isSecret":false,"isPublic":false,"envLocked":false,"value":null,"updatedAt":null,"updatedById":null},{"key":"storage.bucket","group":"storage","type":"string","label":"Bucket","help":"Bucket that stores media and exports.","default":"roamlog","isSecret":false,"isPublic":false,"envLocked":false,"value":"roamlog","updatedAt":null,"updatedById":null},{"key":"storage.region","group":"storage","type":"string","label":"Region","help":"Signing region, for example us-east-1.","default":"us-east-1","isSecret":false,"isPublic":false,"envLocked":false,"value":"us-east-1","updatedAt":null,"updatedById":null},{"key":"storage.accessKey","group":"storage","type":"secret","label":"Access key","help":"Stored encrypted; only the last four characters are shown.","default":null,"isSecret":true,"isPublic":false,"envLocked":false,"secret":{"hasValue":false,"last4":null},"updatedAt":null,"updatedById":null},{"key":"storage.secretKey","group":"storage","type":"secret","label":"Secret key","help":"Stored encrypted and never returned by the settings API.","default":null,"isSecret":true,"isPublic":false,"envLocked":false,"secret":{"hasValue":false,"last4":null},"updatedAt":null,"updatedById":null},{"key":"storage.forcePathStyle","group":"storage","type":"boolean","label":"Force path style","help":"Required by MinIO and some B2/Wasabi deployments.","default":true,"isSecret":false,"isPublic":false,"envLocked":false,"value":true,"updatedAt":null,"updatedById":null}]},{"group":"media","label":"Media","items":[{"key":"media.maxEdge","group":"media","type":"number","label":"Max edge (px)","help":"Longest edge the browser keeps when compressing an image.","default":2000,"isSecret":false,"isPublic":false,"envLocked":false,"value":2000,"updatedAt":null,"updatedById":null},{"key":"media.quality","group":"media","type":"number","label":"WebP quality","help":"Compression quality between 0.4 and 0.95.","default":0.82,"isSecret":false,"isPublic":false,"envLocked":false,"value":0.82,"updatedAt":null,"updatedById":null},{"key":"media.targetBytes","group":"media","type":"number","label":"Target bytes","help":"Size the client compressor aims for before uploading.","default":1500000,"isSecret":false,"isPublic":false,"envLocked":false,"value":1500000,"updatedAt":null,"updatedById":null},{"key":"media.keepOriginal","group":"media","type":"boolean","label":"Keep originals","help":"Upload the untouched original alongside the compressed derivative.","default":false,"isSecret":false,"isPublic":false,"envLocked":false,"value":false,"updatedAt":null,"updatedById":null},{"key":"media.livePhotoEnabled","group":"media","type":"boolean","label":"Live Photos","help":"Accept paired still/motion uploads from iOS.","default":true,"isSecret":false,"isPublic":false,"envLocked":false,"value":true,"updatedAt":null,"updatedById":null},{"key":"media.maxUploadBytes","group":"media","type":"number","label":"Max upload bytes","help":"Largest single upload the presign endpoint accepts.","default":25000000,"isSecret":false,"isPublic":false,"envLocked":false,"value":25000000,"updatedAt":null,"updatedById":null}]},{"group":"ai","label":"AI","items":[{"key":"ai.defaultProvider","group":"ai","type":"string","label":"Default AI provider","help":"Provider id used when a workspace has no override.","default":"openai-chat","isSecret":false,"isPublic":false,"envLocked":false,"value":"openai-chat","updatedAt":null,"updatedById":null},{"key":"ai.timeoutMs","group":"ai","type":"number","label":"Request timeout (ms)","help":"Per-request timeout for AI planning calls.","default":30000,"isSecret":false,"isPublic":false,"envLocked":false,"value":30000,"updatedAt":null,"updatedById":null},{"key":"ai.maxOutputTokens","group":"ai","type":"number","label":"Max output tokens","help":"Upper bound passed to the provider.","default":4096,"isSecret":false,"isPublic":false,"envLocked":false,"value":4096,"updatedAt":null,"updatedById":null},{"key":"ai.dailyQuota","group":"ai","type":"number","label":"Daily quota","help":"Platform-wide AI calls per day. Zero disables planning.","default":1000,"isSecret":false,"isPublic":false,"envLocked":false,"value":1000,"updatedAt":null,"updatedById":null}]},{"group":"places","label":"Places","items":[{"key":"places.provider","group":"places","type":"string","label":"Places provider","help":"Geoapify first, Photon as the keyless fallback.","options":["geoapify","photon"],"default":"geoapify","isSecret":false,"isPublic":false,"envLocked":false,"value":"geoapify","updatedAt":null,"updatedById":null},{"key":"places.apiKey","group":"places","type":"secret","label":"Places API key","help":"Stored encrypted; only the last four characters are shown.","default":null,"isSecret":true,"isPublic":false,"envLocked":false,"secret":{"hasValue":false,"last4":null},"updatedAt":null,"updatedById":null},{"key":"places.lang","group":"places","type":"string","label":"Search language","help":"Language code passed to providers that support it.","default":"zh","isSecret":false,"isPublic":false,"envLocked":false,"value":"zh","updatedAt":null,"updatedById":null},{"key":"places.limit","group":"places","type":"number","label":"Result limit","help":"Maximum suggestions returned per search.","default":6,"isSecret":false,"isPublic":false,"envLocked":false,"value":6,"updatedAt":null,"updatedById":null},{"key":"places.cacheTtlSeconds","group":"places","type":"number","label":"Cache TTL (seconds)","help":"How long normalized place results stay cached.","default":900,"isSecret":false,"isPublic":false,"envLocked":false,"value":900,"updatedAt":null,"updatedById":null},{"key":"places.dailyQuota","group":"places","type":"number","label":"Daily quota","help":"Provider calls per day before degrading to the fallback.","default":2500,"isSecret":false,"isPublic":false,"envLocked":false,"value":2500,"updatedAt":null,"updatedById":null}]},{"group":"limits","label":"Limits","items":[{"key":"limits.searchPerMinute","group":"limits","type":"number","label":"Search requests / minute","help":"Per-account search rate limit.","default":30,"isSecret":false,"isPublic":false,"envLocked":false,"value":30,"updatedAt":null,"updatedById":null},{"key":"limits.uploadPerMinute","group":"limits","type":"number","label":"Uploads / minute","help":"Per-account presign rate limit.","default":10,"isSecret":false,"isPublic":false,"envLocked":false,"value":10,"updatedAt":null,"updatedById":null}]}],"generatedAt":"2026-11-19T05:36:23.416Z"}
HTTP:200
```

分组/条目计数：`general:5 seo:5 theme:3 mail:7 storage:7 media:6 ai:4 places:6 limits:2`（合计 45，与 registry 的 `define({...})` 数量一致）。

#### (2) `PATCH /v1/admin/settings`（把 `site.title` 改为「Roamlog 验收」）

命令：

```bash
curl -s -b /tmp/b1b-cookies.txt -X PATCH http://127.0.0.1:4000/v1/admin/settings \
  -H "Content-Type: application/json" \
  -d '{"updates":[{"key":"site.title","value":"Roamlog 验收"}]}'
```

原始输出：

```json
{"updated":[{"key":"site.title","secret":false,"updatedAt":"2026-11-19T05:36:23.449Z"}],"version":5,"generatedAt":"2026-11-19T05:36:23.453Z"}
HTTP:200
```

> 说明：任务包写的是 `general.site.title`，但契约与 registry 的真实 key 是 `site.title`（见 `AdminSettingKeySchema` 与 `settings.registry.ts`）。先用 `general.site.title` 实测确实返回 422 `UNKNOWN_SETTING`：
>
> ```json
> {"type":"https://roamlog.app/errors/settings-invalid","title":"Unprocessable Content","status":422,"detail":"One or more settings were rejected.","instance":"/v1/admin/settings","code":"SETTINGS_INVALID","errors":[{"field":"general.site.title","code":"UNKNOWN_SETTING","message":"Unknown setting key."}]}
> ```
>
> 因而联调使用事实来源 key `site.title`。

#### (3) `GET /v1/admin/settings/site.title`（确认值已变、updatedAt 更新）

命令：

```bash
curl -s -b /tmp/b1b-cookies.txt http://127.0.0.1:4000/v1/admin/settings/site.title
```

原始输出：

```json
{"key":"site.title","group":"general","type":"string","label":"Site title","help":"Shown in the browser tab, SEO titles, and the public site header.","default":"Roamlog","isSecret":false,"isPublic":true,"envLocked":false,"value":"Roamlog 验收","updatedAt":"2026-11-19T05:36:23.449Z","updatedById":"01a1f246-d4a5-775b-b48f-97faa107b53e"}
HTTP:200
```

同时重新请求完整列表确认 `updatedAt` 与 `updatedById` 已在同一行更新（上一条 GET 已由服务端返回新时间）；分组底部「最近写入」在真实 UI 中也显示为 `11/19 13:36`。

#### (4) `GET /v1/public/settings`（确认公开投影出现 `site.title`）

命令：

```bash
curl -s http://127.0.0.1:4000/v1/public/settings
```

原始输出：

```json
{"settings":{"site.title":"Roamlog 验收","site.description":"A collaborative travel journal for the trips you take together.","general.defaultLanguage":"zh-CN","general.defaultTimeZone":"Asia/Shanghai","seo.titleTemplate":"%s · Roamlog","seo.descriptionTemplate":"Plan trips, keep a journal, and remember every stop together.","seo.ogImageUrl":null,"seo.robots":"index,follow","theme.accent":"white","theme.defaultMode":"system","theme.loginTagline":"Every trip deserves a memory."},"generatedAt":"2026-11-19T05:36:24.515Z"}
HTTP:200
```

#### (5) Playwright 真实 UI 读写（补充证据）

在 Chromium 中通过 `/admin/login` 登录上述本地 super_admin，操作真实 Admin dev（3001）：

- 导航「系统设置」存在；
- `/admin/settings?group=general` 首屏显示数据库值「Roamlog 验收」；
- 未修改时「保存更改」disabled；修改后 enabled；
- 保存后 toast「已保存并重新读取 1 项设置。」，`Site title` 值变为「Roamlog 验收 UI」，字段显示 `当前值来源：数据库 · 最后更新：11/19 13:32`；
- `/admin/settings?group=mail` 显示 `SMTP port=587`、`Resend API key=未设置`，状态行「已接入后端，前端/Worker 消费待完成」；
- 控制台 `pageerror`/`console.error` 为 0。

原始输出：

```json
{
  "navSettings": 1,
  "initialTitle": "Roamlog 验收",
  "saveDisabledInitial": true,
  "saveEnabledAfterEdit": true,
  "savedTitle": "Roamlog 验收 UI",
  "sourceText": [
    "当前值来源：数据库 · 最后更新：11/19 13:32"
  ],
  "statusText": "前端已消费（标题/描述/主题）",
  "mailStatus": "已接入后端，前端/Worker 消费待完成",
  "smtpPort": "587",
  "secretMask": "未设置",
  "revealButtons": 0,
  "errors": []
}
```

> 之后已用 curl 把 `site.title` 恢复为任务目标值「Roamlog 验收」；随后第 (1)~(4) 条联调结果即基于该最终状态（基线先设为「Roamlog 验收基线」，PATCH 后变为「Roamlog 验收」）。

移动端（390×844，Chromium）检查：`overflow=0`，Storage endpoint 输入可见，状态行正确，无 pageerror：

```json
{"overflow":0,"status":"已接入后端，前端/Worker 消费待完成","fieldVisible":true,"errors":[]}
```

## 4. CodeGraph 证据

- 查询（MCP `codegraph_explore`，`projectPath: C:\\Users\\BY9700\\Desktop\\UI\\roamlog`）：
  `SettingsConsole SettingField collectGroupUpdates createAdminSettingsApi admin settings page`
- 关键结果：
  - 调用链：`SettingsConsole (settings-console.tsx:137)` → `save (:314)` → `collectGroupUpdates (lib/admin-settings.ts:330)`。
  - 动态渲染：`SettingsPageClient → SettingsConsole`、`SettingsConsole → SettingField`、`SettingField → Select/Input`。
  - blast radius：`SettingsConsole` 有 4 个调用点（`settings-page-client.tsx`），测试 `settings-console.test.tsx`；`collectGroupUpdates` 3 个调用点，测试 `admin-settings.test.ts`；`SettingField` 2 个调用点（`settings-console.tsx`）。
- `codegraph status`：`Files: 1,545 / Nodes: 23,807 / Edges: 52,612`，结尾 `[OK] Index is up to date`。
- CLI 复核：`codegraph explore "SettingsConsole SettingField collectGroupUpdates createAdminSettingsApi"` 返回同上调用链。

## 5. 已知风险

1. **任务包 key 与契约不一致**：任务写 `general.site.title`，契约/registry 实际是 `site.title`；实际 PATCH 使用 `site.title`。错误 key 已验证会返回 422 `UNKNOWN_SETTING`，UI 会把该 422 映射到字段。
2. **number 的 min/max 不在契约内**：registry 的 Zod schema 有范围，但 `AdminSettingItem` 不暴露 `min/max`，前端无法在提交前做真实范围校验（只能做有限数字校验）；范围错误依赖服务端 422 并映射到字段。要消除这一小段延迟校验，应先扩展契约。
3. **当前 registry 没有 `envLocked: true` 的真实 key**（`grep` 计数 0），因此 envLocked 的显示/禁用/来源「环境变量」由合成字段测试覆盖，真实联调无法点到一个真实 env-locked 设置。
4. **当前 registry 没有 `json` 类型 key**（45 个 key 中 0 个）；结构化编辑器由合成字段测试，未在真实 API 中出现。
5. **reveal 的 10 秒隐藏只是客户端行为**：服务端 reveal 响应没有过期时间字段，明文在客户端内存中最多保留 10 秒；用户可再次 reveal（每次重新审计）。若要求服务端强约束，需要契约新增揭示有效期。
6. **本地数据副作用**：为联调创建了本地 `b1b-admin@roamlog.local`（super_admin，仅 local DB）并把 `site.title` 改为「Roamlog 验收」。密码未写入仓库/报告。建议验收后按需删除该本地账号或保留供 QA 复验。
7. **并发边界**：本次工作期间其它 Agent 正在改 `packages/contracts`、`apps/api`、`apps/web`。最终 13:35 的四项门禁均为 exit 0；更早一次 typecheck 曾因外部 `permissions.ts` 的 cast 报错而失败，该错误由对应文件所有者修复，未由本任务修改。

## 6. 未覆盖项

- 未对真实 envLocked / json key 做 live API 联调（registry 当前没有此类 key）。
- 未在真实环境触发 403 保存/2FA reveal（本地 `ADMIN_2FA_ENFORCED` 未启用；权限文案由单测覆盖，API guard 由 B1A 测试覆盖）。
- 未验证 reveal 明文在服务端日志/审计中的脱敏（API 侧 B1A 已声明 metadata 只含 keys/secrets；本任务未改 API）。
- 未逐组做浏览器目视走查（general/mail/storage 已走查；其余分组由同一渲染器 + 单测覆盖）。
- 未做 Safari/Firefox 实机验证；未做 axe 全量扫描。
- 未实现批量 >50 updates 的分块（registry 目前 45 个 key，上限内）。

## 7. 建议下一步

1. 让 `AdminSettingItem` 契约暴露 `min` / `max`（registry 已有 Zod 边界），前端即可在提交前显示真实范围错误，减少一次 422 往返。
2. 增加真实的 `envLocked` 与 `json` 类型设置（或契约测试夹具），让这两条 UI 分派在 live 环境也被覆盖。
3. 若安全要求更高，给 reveal 契约增加 `expiresAt`/一次性 reveal，并把 10 秒倒计时改为服务端过期；当前是客户端自动隐藏。
4. 验收后清理本地临时 super_admin 与 `site.title` 值（或保留为 QA 账号并纳入本地 seed 说明）。
5. 后续 QA 对 9 个分组做桌面/移动端截图回归，并补 axe 可访问性扫描。
