# B1D_SETTINGS_TRUTH — 设置不再说谎

状态: DONE（本地 commit，未 push）
任务 ID: B1D_SETTINGS_TRUTH
角色: backend_api + web_frontend

## 变更文件

- `apps/api/src/modules/settings/settings.registry.ts`
- `apps/api/src/modules/settings/settings.service.ts`
- `apps/api/src/modules/settings/__tests__/settings.registry.spec.ts`
- `apps/api/src/modules/settings/__tests__/settings.service.spec.ts`
- `apps/api/src/modules/settings/__tests__/admin-settings.controller.spec.ts`
- `packages/contracts/src/api/admin-settings.ts`
- `packages/contracts/src/__tests__/admin-settings.test.ts`
- `apps/web/lib/settings.ts`
- `apps/web/app/layout.tsx`
- `apps/web/lib/settings.test.ts`
- `apps/web/lib/layout-theme.test.ts`
- `.audit/b1d-report.md`（本文件）
- `.audit/b1d-public-settings.json`（真实接口响应证据，仅公开值）

未触碰其它 Agent 的并行目录（admin/settings、users、places、admin API、permissions、db、media/image/trip-form）。

## 缺口 1：SEO 设置从“能改”到“真生效”

1. `seo.titleTemplate`、`seo.descriptionTemplate`、`seo.ogImageUrl`、`seo.robots` 改为
   `isPublic: true`。SEO 本来就是要被爬虫与匿名壳读取的公开信息，标记公开是正确的语义。
2. `/v1/public/settings` 的唯一白名单仍然是 `isPublic && !isSecret`
   （`settings.service.ts` `getPublicSettings`）；secret 即使被误标 public 也不会出境。
   现在正好返回 11 个公开键（7 个旧键 + 4 个 SEO 键）。
3. 契约新增唯一配色枚举 `THEME_MODES = ["dark", "system"]` / `ThemeModeSchema`，
   registry 直接引用同一份，不再各写一套。
4. 前端 `buildSiteMetadata()` 真正消费 `seo.*`：
   - `seo.titleTemplate` 写入 Next `title.template`。`%s` 占位替换由导出的
     `applyTitleTemplate()` 实现；模板无 `%s` 时按“完整标题”原样输出（与 Next 自身行为一致）。
   - `seo.descriptionTemplate` 作为默认 Open Graph description。
   - `seo.ogImageUrl` 为空 / 缺失 / `null` 时不输出 `openGraph.images`。
   - `seo.robots` 写入站点级 `robots`，空值回落 `DEFAULT_ROBOTS`。
   - 页面自己的 `metadata` / `generateMetadata`（如 `(auth)/login` 的 `title: "登录"`）
     仍覆盖站点级；`/share` 的 `robots: { index: false, follow: false }` 仍覆盖站点级
     robots（Next 按字段整体替换，已用真实 HTML 验证）。
5. 空值一律回落现有硬编码：`DEFAULT_TITLE_TEMPLATE`、`DEFAULT_SITE_DESCRIPTION`、
   `DEFAULT_ROBOTS`，请求失败/超时也仍是 `{}` → 默认值，不抛错。

## 缺口 2：移除假的 light 主题

- 契约与 registry 的可选值收敛为 `dark | system`；`light` 变成非法值。
- 读取归一化：`SettingsService.normalizeLegacyRead()` 在 `validateRead()` 之前把库里/缓存里
  历史的 `theme.defaultMode = "light"` 归一化为 `system`，并用
  `settings.legacy_value_normalized` 记一条 warn（每进程每键最多一条），不会 500。
  写入路径**不归一化**：PATCH `light` 直接被 schema 拒绝，返回 422 `SETTINGS_INVALID`。
- `system` 的语义：当前 `@roamlog/ui` 只有深色 token（`:root` 即深色），没有任何浅色配色，
  代码注释已写清 “system 在浅色调色板落地前等价于 dark”。
- 前端 `<html>`：`data-theme` 只输出 `dark | system`，`color-scheme` 对应
  `dark` / `light dark`；`generateViewport()` 输出同一 `color-scheme` 的 meta。
  不再有任何 `light` 分支。`resolveThemeMode("light")` 在客户端防御性回落 `system`，
  旧缓存也无法复活假浅色。

## 45 键 isPublic 复核表

“当前”= 本次改动后的值。只有 4 个键由 false 改为 true（SEO）；没有发现任何
secret / ai / limits 被误设为 true，因此没有反向改动。

| # | key | 当前 isPublic | 应否公开 | 理由 |
|---|-----|---------------|----------|------|
| 1 | site.title | true | 是 | 浏览器标题、页头与 SEO 标题的基础值 |
| 2 | site.description | true | 是 | meta description 默认值 |
| 3 | general.defaultLanguage | true | 是 | 匿名页面的 `<html lang>` |
| 4 | general.defaultTimeZone | true | 是 | 日期渲染默认值，无敏感信息 |
| 5 | general.registrationEnabled | false | 否（当前） | 运营开关；web 壳未消费，公开没有收益。非敏感，将来需要注册入口开关时可再公开 |
| 6 | seo.titleTemplate | true（false→true） | 是 | 爬虫与匿名壳必须知道站点标题模板 |
| 7 | seo.descriptionTemplate | true（false→true） | 是 | 站点默认描述就是公开 meta |
| 8 | seo.ogImageUrl | true（false→true） | 是 | 社交预览图 URL，不是密钥 |
| 9 | seo.robots | true（false→true） | 是 | 公开的 robots meta 指令 |
| 10 | seo.sitemapEnabled | false | 否 | 发布流程开关，仅服务端使用 |
| 11 | theme.accent | true | 是 | 公开视觉 token 选择 |
| 12 | theme.defaultMode | true | 是 | 公开默认配色（dark/system 均非敏感） |
| 13 | theme.loginTagline | true | 是 | 登录页公开文案 |
| 14 | mail.provider | false | 否 | 内部基础设施选择；暴露供应商只增加攻击面 |
| 15 | mail.from | false | 否 | 运营发件地址，公开会被爬虫抓取用于垃圾邮件 |
| 16 | mail.resendApiKey | false | 否 | 密钥；`isSecret: true`，双重排除 |
| 17 | mail.smtpHost | false | 否 | 内部主机名 |
| 18 | mail.smtpPort | false | 否 | 内部网络参数 |
| 19 | mail.smtpUser | false | 否 | 账号标识 |
| 20 | mail.smtpPassword | false | 否 | 密钥；`isSecret: true` |
| 21 | storage.endpoint | false | 否 | 内部签名端点，暴露存储拓扑 |
| 22 | storage.publicEndpoint | false | 否 | 浏览器直连存储地址；当前 web 未消费，公开只会暴露拓扑 |
| 23 | storage.bucket | false | 否 | 存储桶名，扩大攻击面 |
| 24 | storage.region | false | 否 | 基础设施拓扑 |
| 25 | storage.accessKey | false | 否 | 密钥；`isSecret: true` |
| 26 | storage.secretKey | false | 否 | 密钥；`isSecret: true` |
| 27 | storage.forcePathStyle | false | 否 | 内部 S3 兼容参数 |
| 28 | media.maxEdge | false | 否（当前） | 浏览器压缩参数，但 web 现在用自身常量；公开无消费者，属于后续“服务端驱动压缩”议题 |
| 29 | media.quality | false | 否（当前） | 同上 |
| 30 | media.targetBytes | false | 否（当前） | 同上 |
| 31 | media.keepOriginal | false | 否（当前） | 服务端上传策略 |
| 32 | media.livePhotoEnabled | false | 否（当前） | 服务端功能开关 |
| 33 | media.maxUploadBytes | false | 否（当前） | 服务端 presign 限制；客户端预校验可后续通过公开投影解决 |
| 34 | ai.defaultProvider | false | 否 | 内部供应商选择 |
| 35 | ai.timeoutMs | false | 否 | 内部参数，可被用来推断容量 |
| 36 | ai.maxOutputTokens | false | 否 | 内部配额参数 |
| 37 | ai.dailyQuota | false | 否 | 平台运营配额 |
| 38 | places.provider | false | 否 | 内部供应商路由 |
| 39 | places.apiKey | false | 否 | 密钥；`isSecret: true` |
| 40 | places.lang | false | 否（当前） | 服务端搜索参数；页面渲染不需要 |
| 41 | places.limit | false | 否（当前） | 服务端结果数限制 |
| 42 | places.cacheTtlSeconds | false | 否 | 内部缓存策略 |
| 43 | places.dailyQuota | false | 否 | 配额/运营信息 |
| 44 | limits.searchPerMinute | false | 否 | 速率限制；公开等于告诉对方何时绕过 |
| 45 | limits.uploadPerMinute | false | 否 | 同上 |

## 验证命令与结果（原始输出）

### 1) API typecheck + settings tests

```text
$ pnpm --filter @roamlog/api typecheck
$ tsc --noEmit
[exit code: 0]

$ pnpm --filter @roamlog/api exec vitest run src/modules/settings
 RUN  v5.1.0 C:/Users/BY9700/Desktop/UI/roamlog/apps/api
 ✓ src/modules/settings/__tests__/admin-settings.controller.spec.ts (11 tests) 331ms
 ✓ src/modules/settings/__tests__/settings.service.spec.ts (24 tests) 33ms
 ✓ src/modules/settings/__tests__/settings.registry.spec.ts (9 tests) 8ms
 ✓ src/modules/settings/__tests__/secret-box.spec.ts (7 tests) 7ms
 Test Files  4 passed (4)
      Tests  51 passed (51)
```

### 2) contracts tests

```text
$ pnpm --filter @roamlog/contracts test
 ✓ src/__tests__/admin-settings.test.ts (7 tests) 26ms
 ✓ src/__tests__/openapi.test.ts (10 tests) 710ms
 Test Files  8 passed (8)
      Tests  65 passed (65)
```

附加：`pnpm --filter @roamlog/contracts typecheck` → `[exit code: 0]`。

### 3) web typecheck + vitest

```text
$ pnpm --filter @roamlog/web typecheck
$ next typegen && tsc --noEmit
✓ Types generated successfully
[exit code: 0]

$ pnpm --filter @roamlog/web exec vitest run lib/settings app/layout
 ✓ lib/settings.test.ts (16 tests) 193ms
 Test Files  1 passed (1)
      Tests  16 passed (16)
```

说明：`app/layout` 过滤器在当前 `vitest.config.ts` 的 `include`（`lib/**/*.test.ts`、
`components/**/*.test.tsx`）下匹配不到文件，因此布局测试单独执行：

```text
$ pnpm --filter @roamlog/web exec vitest run lib/layout-theme
 ✓ lib/layout-theme.test.ts (6 tests) 13ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

### 4) web lint

```text
$ pnpm --filter @roamlog/web lint
$ eslint -c ../../eslint.config.mjs .
[exit code: 0]
```

### 5) 真实生效验证（API 4000 / web dev 3000 均在运行）

`curl http://127.0.0.1:4000/v1/public/settings` 原始响应（已保存到
`.audit/b1d-public-settings.json`）：

```json
{"settings":{"site.title":"Roamlog 验收","site.description":"A collaborative travel journal for the trips you take together.","general.defaultLanguage":"zh-CN","general.defaultTimeZone":"Asia/Shanghai","seo.titleTemplate":"%s · Roamlog","seo.descriptionTemplate":"Plan trips, keep a journal, and remember every stop together.","seo.ogImageUrl":null,"seo.robots":"index,follow","theme.accent":"white","theme.defaultMode":"system","theme.loginTagline":"Every trip deserves a memory."},"generatedAt":"2026-11-19T05:31:22.203Z"}
```

键清单与 secret 扫描：

```text
general.defaultLanguage
general.defaultTimeZone
seo.descriptionTemplate
seo.ogImageUrl
seo.robots
seo.titleTemplate
site.description
site.title
theme.accent
theme.defaultMode
theme.loginTagline
absent  mail.resendApiKey
absent  mail.smtpPassword
absent  storage.accessKey
absent  storage.secretKey
absent  places.apiKey
absent  ai.timeoutMs
absent  limits.searchPerMinute
absent  general.registrationEnabled
```

`curl http://localhost:3000/login` → HTTP 200，HTML 头部：

```html
<html lang="zh-CN" ... data-theme="system" data-accent="white"
      style="...;color-scheme:light dark">
<title>登录 · Roamlog</title>
<meta name="robots" content="index,follow"/>
<meta property="og:title" content="Roamlog"/>
<meta property="og:description" content="A collaborative travel journal for the trips you take together."/>
```

`<title>登录 · Roamlog</title>` 证明：页面自己的 title「登录」经站点
`seo.titleTemplate="%s · Roamlog"` 渲染，而不是硬编码回落（旧实现只会得到
`%s · Roamlog 验收` 或构建期常量）；`robots=index,follow` 来自 `seo.robots`；
`seo.ogImageUrl=null` 时没有 `og:image`。

`curl http://localhost:3000/share/test-token-123` → HTTP 200：

```html
<title>共享旅行 · Roamlog</title>
<meta name="robots" content="noindex, nofollow"/>
<meta property="og:title" content="Roamlog 验收 · Roamlog"/>
```

证明：页面级 `/share` noindex 覆盖站点 robots；同时 title 模板与 OG 文案来自配置。

## CodeGraph 证据

- `codegraph status` → `[OK] Index is up to date`（1,538 files / 23,697 nodes）。
- `codegraph explore "getPublicSettings publicSettingDefinitions theme defaultMode settings service"`
  → 79 symbols / 6 files；blast radius：
  `getPublicSettings`（`apps/api/src/modules/settings/settings.service.ts:198`）2 callers =
  `PublicSettingsController`；`publicSettingDefinitions` 1 caller（registry spec）；
  `getPublicSettings`（web）9 callers，包含 `apps/web/app/layout.tsx` 与
  `apps/web/app/(auth)/login/page.tsx`。
- 首次 `codegraph_explore`（改动前）确认 `PublicSettingsController` → `getPublicSettings`
  → `SettingsService.get` 的调用链，并显示 `defaultMode` 在索引中只是字符串键（非符号），
  因此 isPublic 行为只能从 registry 读取，随后用测试锁定。

## 已知风险

1. `system` 的视觉诚实性：`data-theme="system"` + `color-scheme: light dark` 会让浏览器
   原生控件（滚动条/表单）按 OS 变浅，而画布仍是深色 token。这是“只有深色 token”阶段的
   已知折衷；`data-theme` 不含 `light`，不会假装有浅色主题。建议下一步补浅色 token 后再
   把 `system` 真正解析为 OS 主题。
2. 站点级 Open Graph title 在默认配置下是 `Roamlog · Roamlog`（`site.title="Roamlog"` 套
   `%s · Roamlog`）。这是 title 模板语义的直接结果，不是 bug，但视觉上重复；可以在后续把
   首页改为 `title.absolute` 或让运营把模板改成 `%s`。
3. 运行中的 4000/3000 属于并行环境，若被其它任务重启，真实生效验证需重跑；证据已落盘
   `.audit/b1d-public-settings.json`（只含公开值）。

## 未覆盖项

- 未在真实数据库里写入历史 `"light"` 行做破坏性验证（避免污染并行 Agent 的运行时数据）；
  归一化由 service 单测（DB 行 + Redis 缓存两条路径）和 Nest controller 测试覆盖。
- 未执行 `contracts:generate`（按任务约束由根 Agent 串行执行）。本次契约只新增一个未被
  OpenAPI 文档引用的枚举，`contracts:check`/`openapi.test` 已通过，预计无需重新生成。
- `media.*` 仍是“可改但 web 未消费”的状态（不属于本任务两个缺口）；是否公开给客户端驱动
  压缩，留待媒体任务统一决策。

## 建议下一步

1. 根 Agent 串行执行 `contracts:generate` 并确认生成物无 diff（本次不应有）。
2. 补浅色 token 后，把 `system` 解析为真正的 OS 主题，并恢复 `light` 的契约值。
3. 让 `media.*` 通过公开投影驱动 `apps/web` 压缩参数，或从 admin 中移除这些只影响服务端的
   字段说明，避免第三个“假设置”。
4. 首页使用 `title.absolute`，消除 `Roamlog · Roamlog` 的 OG 重复。