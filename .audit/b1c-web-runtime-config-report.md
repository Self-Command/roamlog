# B1C Web Runtime Config 交付报告

- 任务 ID: `B1C_WEB_RUNTIME_CONFIG`
- 角色: `web_frontend`
- 日期: 2026-11-19
- 提交: `a32ee47 feat(web): read public runtime settings for metadata, copy and theme`
- 状态: **DONE（本任务范围）** — 本任务所有改动、测试、构建、真实页面验证均通过；交付时工作区存在**并行任务未完成的文件**（`apps/web/lib/image/**`、`apps/web/components/media/use-cover-upload.ts`、`packages/contracts/**` 等）导致当前全量 typecheck/test/lint 变红，与本任务文件无关，详见“并行污染说明”。

## 1. 变更文件（仅本任务）

| 文件 | 说明 |
| --- | --- |
| `apps/web/lib/settings.ts`（新建） | 服务端 `getPublicSettings()`、客户端 `usePublicSettings()`、metadata 构建、主题变量解析、失败兜底 |
| `apps/web/lib/settings.test.ts`（新建） | 成功 / 500 / 超时 / 契约不符 / metadata / 主题 / hook 共享缓存 |
| `apps/web/lib/layout-theme.test.ts`（新建） | 直接断言 `RootLayout` 返回的 SSR `<html>` 元素属性与 style |
| `apps/web/app/layout.tsx` | 静态 `metadata` → `generateMetadata()`；`<html>` 写入 `data-theme` / `data-accent` / `--accent-*` / `color-scheme` |
| `apps/web/app/(auth)/login/page.tsx` | 登录页读取 `theme.loginTagline` 并传入表单 |
| `apps/web/components/auth/login-form.tsx` | 新增可选 `tagline` prop，空值回落到原副标题 |
| `apps/web/components/auth/auth-shell.tsx` | 登录页氛围光改为消费 `var(--accent-primary-glow)`（默认 white 与原先橙色一致） |
| `apps/web/components/auth/login-page.test.tsx`（新建） | 页面级：配置生效、缺省回落、空白回落、失败无错误文案 |
| `.audit/b1c-web-runtime-config-report.md`（本文件） | 交付报告 |

未改动：`apps/admin/**`、`apps/api/**`、`packages/**`、`docker/**`、`apps/web/components/{trips,trip-workspace,members,map,charts,dashboard}/**`、其它 `.audit`。

## 2. 实现摘要（逐 5 项）

### 2.1 公开配置读取（服务端 + 客户端）

- 服务端 `getPublicSettings()`：`GET ${API_URL ?? http://localhost:4000}/v1/public/settings`，`next: { revalidate: 30 }` 短缓存，3s 超时（AbortController）。
- 失败兜底：超时、网络错误、非 2xx、响应不符合 `PublicSettingsResponseSchema` 时均 `console.warn` 并返回 `{}`，**永不 throw**；无错误 UI。
- 无参调用包了 React `cache()`（`getCachedPublicSettings`），配合 Next 对 `fetch` 的跨 `generateMetadata` / layout / page 去重，一次请求只读一次配置。
- 客户端 `usePublicSettings()`：TanStack Query，queryKey `["v1","public-settings"]`，`staleTime: 30_000`，共享同一缓存条目；请求失败同样 resolve `{}`。
- 类型全部来自 `@roamlog/contracts`（`PublicSettingsResponse`），只读 registry 中真实存在的公开键，未发明字段。

发现的契约事实（与任务描述有出入，按代码为准）：

- registry 公开键为：`site.title`、`site.description`、`general.defaultLanguage`、`general.defaultTimeZone`、`theme.accent`、`theme.defaultMode`、`theme.loginTagline`；**没有** `general.site.title`。
- `seo.*`（titleTemplate / descriptionTemplate / ogImageUrl / robots / sitemapEnabled）全部 `isPublic: false`，**不会**出现在 `/v1/public/settings`。metadata 构建对 `seo.*` 做了“若未来公开则消费”的防御式读取，当前实际回落到站点值 / `index,follow`。

### 2.2 元数据改为运行期

`apps/web/app/layout.tsx` 的静态 `metadata` 已删除，改为：

```ts
export async function generateMetadata(): Promise<Metadata> {
  return buildSiteMetadata(await getPublicSettings());
}
```

- `title.default` = `site.title`，缺省回落 `"Roamlog — 旅行档案"`；`title.template` 优先 `seo.titleTemplate`，否则 `%s · <site.title>`（缺省 `%s · Roamlog`）。
- `description` = `site.description`，缺省回落原中文描述。
- `openGraph.title/description/images`：有 `seo.*` 时消费；`images` 仅在 `seo.ogImageUrl` 非空时出现；当前公开接口无 SEO 键，故回落到站点标题/描述且不输出图片。
- `robots` = `seo.robots`，缺省 `index,follow`。
- 页面自有 `metadata` / `generateMetadata` 保持不变（如 `/login` 的 `title: "登录"` 叠加根模板 `登录 · Roamlog`；`/share/[token]` 自己的 `robots` 仍优先）。
- 配置缺失 / 接口失败时 `buildSiteMetadata({})` 输出内置默认值，不报错。

### 2.3 登录页文案与主题

- `LoginPage`（Server Component）读取 `theme.loginTagline`，以 prop 传给 `LoginFormView`；空白/缺失时表单使用原文案「登录后会进入 Workspace 总览。会话由 Better Auth 的 httpOnly cookie 维护。」
- 主题在 SSR 阶段写入 `<html>`（无客户端 effect、无闪烁）：
  - `data-theme="light" | "dark" | "system"`
  - `data-accent="white" | "amber" | "blue" | "emerald" | "rose"`
  - `style="--accent-primary: …; --accent-primary-soft: …; --accent-primary-glow: …; color-scheme: …"`
- `theme.defaultMode=system` 时 `color-scheme: light dark`，由浏览器按 `prefers-color-scheme` 解析；与 reduced-motion 无关。
- 登录页氛围光改为消费 `var(--accent-primary-glow)`；默认 `white` 映射到原橙色氛围（视觉不变），`blue/emerald/rose` 会随配置改变。

### 2.4 不破坏现有行为

- 现有路由、组件、空状态、错误态未改；登录表单原有的邮箱/密码校验、2FA 挑战、错误提示逻辑未动（只在凭据页副标题做替换）。
- 配置读取失败：页面正常渲染默认值，不显示错误横幅，不产生 500；只有服务端 `console.warn`。
- 请求次数：根布局一次（React cache + Next fetch memoization），客户端 hook 共享单条 TanStack Query 缓存；没有逐页请求。
- 默认主题（white/system）SSR 输出与原先视觉一致（黑画布、白色强调、橙色氛围光）。

### 2.5 测试

新增 18 个测试用例：

- `lib/settings.test.ts`（11）：
  - 成功读取 + 断言 URL、`headers.accept`、`next.revalidate === 30`；
  - HTTP 500 → `{}` 且 warn，不抛；
  - 超时（10ms 主动 abort）→ `{}` 且 warn；
  - 契约不符 → `{}` 且 warn；
  - metadata 配置齐全（title/description/OG image/robots）与完全缺失（内置默认、无 images、无错误文案）；
  - 站点名派生 title template；
  - 主题 accent 改变 → `--accent-primary` 变化；未知 mode/accent 回落；
  - 客户端 hook 两个消费者共享一次请求；请求失败 → `{}` 且无错误。
- `lib/layout-theme.test.ts`（3）：直接调用 `RootLayout`，断言 SSR `<html>` 的 `data-theme/data-accent/style/color-scheme`；white→rose 后 style 变化；API 失败时默认值且无 error 文案。
- `components/auth/login-page.test.tsx`（4）：`theme.loginTagline` 渲染；缺失/空白回落原文案；配置失败无错误文案且登录按钮正常。

## 3. 验证命令与结果

以下 4 条为本任务完成、并行任务尚未污染工作区时的原始输出（时间 13:11–13:12）。

### 3.1 `pnpm --filter @roamlog/web typecheck`

```text
$ next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully

[exit code: 0]
```

### 3.2 `pnpm --filter @roamlog/web test`

```text
 Test Files  29 passed (29)
      Tests  209 passed (209)
   Start at  13:11:33
   Duration  17.98s (import 32%, environment 30%, tests 21%, setup 10%, transform 7%)
```

本任务新增用例均通过：

```text
 ✓ lib/settings.test.ts (11 tests)
 ✓ lib/layout-theme.test.ts (3 tests)
 ✓ components/auth/login-page.test.tsx (4 tests)
 ✓ components/auth/auth-shell.test.tsx (2 tests)
 ✓ components/auth/login-form.test.tsx (5 tests)
```

### 3.3 `pnpm --filter @roamlog/web lint`

```text
$ eslint -c ../../eslint.config.mjs .

[exit code: 0]
```

（改动文件单独 lint 亦为 exit 0。）

### 3.4 `pnpm --filter @roamlog/web build`

```text
▲ Next.js 16.4.6 (Turbopack)
✓ Compiled successfully in 8.1s
  Running TypeScript ...
  Finished TypeScript in 4.8s ...
✓ Generating static pages using 15 workers (10/10) in 730ms

Route (app)                                 Revalidate  Expire
┌ ○ /                                              30s      1y
├ ○ /login                                         30s      1y
├ ○ /register                                      30s      1y
...
[exit code: 0]
```

路由表显示 `/login` 等静态页 `Revalidate 30s`，即运行期配置改动无需重建，最长 30s 后重新生成。

### 3.5 真实生效验证（本地 API `http://127.0.0.1:4000` + web dev `3000`）

`curl http://127.0.0.1:4000/v1/public/settings` 原始输出：

```json
{"settings":{"site.title":"Roamlog","site.description":"A collaborative travel journal for the trips you take together.","general.defaultLanguage":"zh-CN","general.defaultTimeZone":"Asia/Shanghai","theme.accent":"white","theme.defaultMode":"system","theme.loginTagline":"Every trip deserves a memory."},"generatedAt":"2026-11-19T05:12:54.692Z"}
```

`curl -s http://127.0.0.1:3000/login` 关键片段：

```html
<title>登录 · Roamlog</title>
<html lang="zh-CN" class="…" data-theme="system" data-accent="white"
      style="--accent-primary:#fcfdff;--accent-primary-soft:rgba(252, 253, 255, 0.16);--accent-primary-glow:rgba(255, 89, 0, 0.18);color-scheme:light dark">
<meta name="description" content="A collaborative travel journal for the trips you take together."/>
```

登录副标题来自配置：

```text
Every trip deserves a memory.
```

氛围光消费运行期变量：

```html
<div aria-hidden="true" class="page-glow opacity-70" style="--page-glow-color:var(--accent-primary-glow)"></div>
```

截图（Playwright，当前 dev server）：

- `.audit/evidence/b1c/login.png`（1440×900，桌面）
- `.audit/evidence/b1c/login-mobile.png`（390×844，移动端）

截图中右侧登录表单副标题为 `Every trip deserves a memory.`，标题 `回到你的旅行档案`，表单与按钮布局未变。

## 4. CodeGraph 证据

1. `codegraph status`（改动后）：

```text
Project: C:\Users\BY9700\Desktop\UI\roamlog
Files: 1,517   Nodes: 23,217   Edges: 50,697   [OK] up to date
```

2. MCP `codegraph_explore` 查询 `getPublicSettings buildSiteMetadata resolveThemePresentation RootLayout LoginPage theme.loginTagline`，关键结果：

```text
resolveThemePresentation (apps/web/lib/settings.ts:274) — 3 callers in apps/web/app/layout.tsx; tests: apps/web/lib/settings.test.ts
buildSiteMetadata (apps/web/lib/settings.ts:188) — 3 callers in apps/web/app/layout.tsx; tests: apps/web/lib/settings.test.ts
RootLayout (apps/web/app/layout.tsx:33) — 1 caller; tests: apps/web/lib/layout-theme.test.ts
LoginPage (apps/web/app/(auth)/login/page.tsx:11) — tests: apps/web/components/auth/login-page.test.tsx
PublicSettingsController (apps/api/src/modules/settings/public-settings.controller.ts:12)
SettingsService.getPublicSettings (apps/api/src/modules/settings/settings.service.ts:196) — filter(entry.isPublic && !entry.isSecret)
```

3. 首轮 `codegraph_explore` 查询 `AdminSettingItem isPublic PublicSettingsResponse settings registry public settings controller`，命中 `packages/contracts/src/api/admin-settings.ts` 的 `PublicSettingsResponseSchema` 与 `PublicSettingsController`，确认响应形状 `{ settings: Record<key, value>, generatedAt }`。

## 5. 已知风险

1. **SEO 配置当前不可公开读取**：`seo.titleTemplate/descriptionTemplate/ogImageUrl/robots` 均为 `isPublic: false`，`/v1/public/settings` 不返回。本实现已按“若公开则消费”写好，但线上 OG 图与 robots 目前只能是默认值（`index,follow`、无 OG 图）。要真正运行期化 SEO，需要 API 侧把对应键标记为 public（或提供单独的公开 SEO 投影）。
2. **任务描述键名与实际 registry 不一致**：任务写 `general.site.title`，registry/契约实际是 `site.title`。按代码为准使用 `site.title`，未发明 `general.site.title`。
3. **light 模式无完整浅色 token**：`packages/ui/src/styles/tokens.css` 只有深色画布（`color-scheme: dark`），且本任务禁止修改 `packages/**`。当前 `defaultMode` 已完整映射到 `data-theme` + `color-scheme`（system 由 UA 按 `prefers-color-scheme` 解析），但 `light` 不会反转整套 UI 配色；完整浅色主题需要 `packages/ui` token 级改造，属后续任务。
4. **accent 的可见范围**：运行期已注入 `--accent-primary*` 并驱动登录页氛围光；现有组件仍大量使用固定的 `accent-orange/blue/...` token，未全局换色。若要求“改强调色 → 全站按钮/焦点环变”，需要 `packages/ui` 或组件层改为消费语义变量。
5. **并行污染（交付时）**：交付期间其它 Agent 正在改 `apps/web/lib/image/**`、`apps/web/components/media/use-cover-upload.ts`、`apps/web/components/media/cover-upload-error.ts`、`packages/contracts/src/{api/places,entities/stop}.ts`、`apps/web/package.json`、`pnpm-lock.yaml`、`apps/web/next-env.d.ts`。当前再次运行全量 typecheck/test/lint 会因这些未完成文件报错（如 `use-cover-upload.ts` 未使用变量、`components/trips/...` 的 `provider` 类型不匹配、cover uploader 测试失败），**不是本任务改动导致**；本任务文件定向 typecheck/lint/test 全部通过。最终合并前需等并行任务落地后重跑 4 条验证。

## 6. 未覆盖项

- 未验证“在后台改设置 → 刷新 `/login` 立即变化”的端到端链路：`apps/admin` 由并行 Agent 修改，写设置需要 `super_admin` 登录与 CSRF/会话，本任务不应触碰。现有证据为：API 实测返回公开配置、SSR HTML 与配置逐字一致、fetch `revalidate: 30`、构建路由表 `Revalidate 30s`、单测覆盖 30s 参数。
- 未对真实 `light` 模式做视觉回归（无浅色 token，见风险 3）。
- 未实测 `seo.ogImageUrl` 输出（当前接口不返回该键）；仅在单测中以注入配置验证将输出 `images: [{ url }]`。
- 未提交截图二进制到 git（保留在 `.audit/evidence/b1c/`，供验收查看）。

## 7. 建议下一步

1. API/契约：把 `seo.titleTemplate`、`seo.descriptionTemplate`、`seo.ogImageUrl`、`seo.robots` 标记为可公开（或新增公开 SEO 投影），再回归 `buildSiteMetadata`。
2. 设计系统：在 `packages/ui` 增加浅色 token 与语义 accent（`--accent-primary` 等）消费点，覆盖 primary 按钮、focus ring、图表。
3. 等并行任务落地后，由根 Agent 在工作区干净状态下重跑：`pnpm --filter @roamlog/web typecheck && pnpm --filter @roamlog/web test && pnpm --filter @roamlog/web lint && pnpm --filter @roamlog/web build`。
4. 如需更强“免重建”证据，可在 staging 用带审计的后台账号改 `site.title`，记录 t0/t+30s 的 `/login` HTML 对比。