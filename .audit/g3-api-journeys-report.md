# G3 API Journeys 报告（真实 API + 真实 PostgreSQL + 真实 Chromium）

任务：`G3_API_JOURNEYS` · qa_verifier · 2026-11-18T22:43+08:00
仓库：`C:\Users\BY9700\Desktop\UI\roamlog` · Playwright 1.65 + Chromium
Spec：`e2e/g3-api/journeys.spec.ts`（新增，唯一新增测试文件）
运行配置：`.audit/evidence/g3-api/playwright.g3.config.ts`（未改仓库根 `playwright.config.ts`）


> **更新（23:40）：第 0 节的 BLOCKED 已被第 7 节取代。**
> 改用仓库 `playwright.live` 基座（`playwright.g3.config.ts`）后：**11 passed / 1 failed** ——
> J1–J6、J8、J9 全部 PASS，仅 J7（viewer 邀请）因 API 邀请接口 **503** 未覆盖。
> 第 1–3 节保留为首次手工搭环境的原始记录（其中“local fixture = mock 模式”的判断已被证伪，见 7.1）。

## 0. 结论摘要

| # | 旅程 | 结果 | 断言数 |
| --- | --- | --- | --- |
| 1 | 注册 / 登录 / 会话 Cookie / 刷新仍登录 | **FAIL（环境阻断，非产品缺陷）** | 0 / 7 通过 |
| 2 | 创建旅行（全字段） | 未覆盖(阻断于 J1) | 0 |
| 3 | 数据库回显比对 | 未覆盖(阻断于 J1) | 0 |
| 4 | 编辑 + PATCH 仅变更字段 | 未覆盖(阻断于 J1) | 0 |
| 5 | 详情工作台 7 tab 真实请求 | 未覆盖(阻断于 J1) | 0 |
| 6 | 分享链接 + incognito 匿名 | 未覆盖(阻断于 J1) | 0 |
| 7 | 权限（viewer） | 未覆盖(阻断于 J1) | 0 |
| 8 | 409 冲突 | 未覆盖(阻断于 J1) | 0 |
| 9 | 移动端 390×844 无横向溢出 | 未覆盖(阻断于 J1) | 0 |

**总判定：BLOCKED —— web(3100) 无法以 api 模式提供可 hydrate 的应用。**
真实 API（:4100）与真实 PostgreSQL（:55443）**均已跑起来并通过健康检查**，卡点 100% 在 web 端服务实例，
不是 API、不是数据库、也不是本轮新写的 spec。

## 1. 环境搭建（逐步验证）

### 1.1 CodeGraph 门禁
`codegraph status` → `[OK] Index is up to date`（1,466 文件 / 22,522 节点 / 49,496 边 / 64.23 MB）。
代码事实查询用 `codegraph_explore`（见第 5 节证据）。

### 1.2 PostgreSQL（真实，55443）
```
initdb -D .data/g3-api/pgdata -U postgres -A trust -E UTF8 --locale=C   # Success
postgres -D .data/g3-api/pgdata -p 55443 -c listen_addresses=127.0.0.1  # 后台前台进程
```
- `database system is ready to accept connections`；`127.0.0.1:55443 LISTENING`。
- `CREATE DATABASE roamlog_g3`（用 `packages/db/node_modules/pg`，embedded 包无 createdb）。
- 迁移：`DATABASE_URL='postgresql://postgres@127.0.0.1:55443/roamlog_g3?schema=public' pnpm db:migrate`
  → `0001_init`、`0002_two_factor_state`、`0003_w0_trip_stop_place_metadata` **全部成功**（All migrations have been successfully applied）。
- 日志：`.audit/evidence/g3-api/pg.log`。

### 1.3 API（真实，4100）—— 一次崩溃 + 一次修复
要求写的是 `pnpm --filter @roamlog/api dev`。**该命令在无 Redis 时无法启动**：
`apps/api/src/config/environment.ts:224` 为 `REDIS_URL: z.url()`（必填），`app-config.service.ts:72` 也是 `required("REDIS_URL")`。
按环境说明“不要伪造结论”，改走仓库既有的真实路径：`e2e/live-support/start-api.ts`
（先起仓库自带的 Redis 协议桩 :46379，再 import `apps/api/src/main.ts`），
这正是 `playwright.live.config.ts` 使用的官方 live E2E 启动方式；**没有 mock 任何 API/DB 数据**。

第 1 次启动：我误给 `REDIS_URL=redis://127.0.0.1:46391`（桩固定监听 46379），
API 进程 20 次重试后崩溃退出：
```
MaxRetriesPerRequestError: Reached the max retries per request limit (which is 20).
at C:\...\node_modules\.pnpm\ioredis@6.0.0\...\event_handler.js:346
```
第 2 次启动：`REDIS_URL='redis://127.0.0.1:46379'` → 成功。
- `GET /v1/health` → **200** `{"status":"ok"}`；全部路由表加载完毕（`api.started` port 4100）。
- `GET /v1/auth/get-session`（匿名）→ **200**（空会话）。
- 日志：`.audit/evidence/g3-api/api.log`。**全程 0 个 5xx**（`"statusCode":200` 共 3 条，均为我的探活 curl）。

### 1.4 Web（api 模式，3100）—— 失败点
环境变量名先核对代码，未猜：
- `apps/web/next.config.ts`：`/v1/:path*` → `${API_URL}/v1/:path*`（**rewrite 用的是服务端 `API_URL`**）。
- `apps/web/lib/api/real.ts` / `auth.ts`：`fetch("/v1/...", { credentials: "include" })`（**相对路径**，不读 `NEXT_PUBLIC_API_BASE_URL`）。
  → 结论：必须设 `API_URL=http://127.0.0.1:4100` + `NEXT_PUBLIC_DATA_MODE=api`；
  `NEXT_PUBLIC_API_BASE_URL` 在 web 端**没有被使用**（任务描述里的该变量是无效变量，已用代码核实）。
- 代理链路验证：`http://127.0.0.1:3100/v1/health` → **200**（rewrite 正常）。

Web 起不来的真实原因（两层）：
1. `apps/web` 的 dev 脚本写死 `next dev --port 3000`，`pnpm ... dev -- -p 3100` 会把 `-p` 当目录参数报错
   （`Invalid project directory provided, no such directory: ...\apps\web\-p`）。
   改用 `pnpm --filter @roamlog/web exec next dev -p 3100`。
2. Next 16 **按项目目录加锁**：3000 端口的既有 dev server（PID 20148，**他人所有，全程未碰**）占着 `apps/web/.next`，
   于是新实例报 `⨯ Another next dev server is already running`。
   采用仓库既有隔离方案 `e2e/live-support/prepare-next-runtime.ts web` → `.e2e-live/runtime/web`（独立 `.next`），
   与 `playwright.live.config.ts` 完全一致的做法。
   但 3100 上最终留下的监听实例是**前一次失败的僵尸实例**（拿到端口后因锁竞争报错退出，端口未释放）：
   它返回的 HTML 是 **mock 模式**且 JS 未 hydrate。

**关键证据（决定性）**：
- `curl http://127.0.0.1:3100/register` 的 HTML 内含 `local fixture`（mock adapter 的 fixture 文案）→ 该实例 `DATA_MODE=mock`，不是 api 模式。
- 页面 HTML 里 `<form noValidate>` 无 `action`；JS 未 hydrate → 原生 GET 提交。
- 浏览器全程 **没有** 发出任何 `/v1/*` 请求：`api.log` 里只有我的 curl（2× `/v1/health`、1× `/v1/auth/get-session`），
  **`/v1/auth/sign-up/email` 出现 0 次**。
- 即：`NEXT_PUBLIC_DATA_MODE=api` 没有生效在最终服务的那个实例上，问题在实例/端口争用，不在产品代码。

## 2. 失败完整记录（J1）

**spec**：`e2e/g3-api/journeys.spec.ts:98` › `J1 register + login + cookie + reload session`

- **断言**：`await expect(page).toHaveURL(/\/(login|w\/)/, { timeout: 40_000 })`
- **期望**：注册成功后跳转 `/w/<slug>`（或 `/login`，走邮箱验证分支）
- **实际**：停留在
  `http://127.0.0.1:3100/register?name=G3+Owner&email=g3-1795013435768%40example.test&password=g3-pass-123456`
- **性质**：环境阻断（未 hydrate + mock 模式实例）。**不是** auth 缺陷，**不能**据此判定注册功能失败。
- **响应/请求片段**：浏览器无任何 API 请求；API 侧 0 条 sign-up 记录。
- **截图**：`.audit/evidence/g3-api/shots/j1-register-native-submit.png`
- **Playwright 上下文**：`.audit/evidence/g3-api/j1-error-context.md`
- **网络观察**：`.audit/evidence/g3-api/network-observations.json`（`observed` 为空数组 + J1 fixture 元数据）
- **fixture 元数据**：`.audit/evidence/g3-api/fixture.json`

### 顺带记录的安全观察（非本轮缺陷判定，建议后续复核）
当注册页**未 hydrate**（JS 加载失败、被 CSP 拦、或服务端半死）时，表单会退化为**原生 GET 提交**，
把 `password` 明文带入地址栏与浏览器历史（见上面的实际 URL）。
即使这是未 hydrate 的边缘状态，也建议给 `<form>` 加 `method="post"` + `action` 兜底，避免口令进入 URL/日志。
本轮我**没有**改产品代码（任务禁止），仅记录。

## 3. 未覆盖项与原因

| 旅程 | 原因 |
| --- | --- |
| J2 创建全字段 | J1 前置失败（无可登录账号、无 workspace `slug`），serial 模式后续用例未运行 |
| J3 DB 回显 | 同上；但 DB 直查能力已验证（迁移 + `pg` 直连可用） |
| J4 编辑 / PATCH 部分字段 | 同上（网络监听器仍在 spec 中，`CAPTURED` 仅收 PATCH） |
| J5 7 tab 真实请求 | 同上 |
| J6 分享 / incognito | 同上 |
| J7 viewer 权限 | 同上；且该用例依赖“邀请 token 从邮件获得”，本环境无 SMTP（API 只存 `tokenHash`，`invitations.service.ts:70-71`），原计划用 DB 直插 membership 作 fixture 并在报告中标注 |
| J8 409 冲突 | 同上 |
| J9 移动端溢出 | 同上 |

没有用 mock 补跑，没有把未跑出结论的用例标通过。

## 4. 端口与进程收尾

已停止并释放（均已 `netstat` 复核无监听）：
- **3100**（web）——僵尸实例已 `taskkill`，`granted port released`
- **4100**（api）——后台任务已 kill，端口释放
- **55443**（PostgreSQL）——`pg_ctl -m fast stop` → `server stopped`，数据目录保留在 `.data/g3-api/pgdata`

未触碰：`3000`（PID 20148 仍在服务，`/` 返回 200）、`55442`（根 Agent 的库仍在跑）。
未跑 build、未做 git 写操作、未改产品代码与 `playwright.config.ts`。

## 5. 复现所需的最小修复建议（交给根 Agent 决策）

1. web 端必须在**独立端口 + 独立 runtime** 上以 `NEXT_PUBLIC_DATA_MODE=api` 启动，且启动后**验证页面已 hydrate**
   （例如 `curl` 检查 HTML 不含 `local fixture`，或 Playwright 断言 `window.__NEXT_DATA__`/表单 submit 未发生原生跳转）。
2. 清理残留 dev server 锁：3100 端口上的僵尸实例是本轮唯一硬阻断，需要“起服务 → 探活 → 校验 data mode”三步都过，再开始跑用例。
3. J1 的登录/注册选择器依赖 `getByLabel("名字"/"邮箱"/"密码")` 与按钮 `创建账号`（已对照 `register-form.tsx` 核实）；hydrate 正常后应可直接复用。

## 6. CodeGraph 证据

```
codegraph status → [OK] Index is up to date (1,466 files / 22,522 nodes / 49,496 edges)
codegraph_explore "trip detail workspace tabs overview itinerary expenses packing members share"
  → 命中 apps/web/components/trip-workspace/{queries,capabilities,index}.ts、apps/web/lib/query.ts、
    apps/web/lib/api/types.ts；确认 7 个 tab（行程/照片/费用/行李/参与者/分享/活动）
    及其真实端点（/v1/trips/:id/stops|media|expenses|packing|participants|share-links|activity|budget/summary）。
codegraph_explore 亦用于定位 apps/api/src/config/{environment,app-config.service}.ts 的 REDIS_URL 必填事实。
```

CodeGraph 证据: `codegraph_explore "trip detail workspace tabs ..."` → `apps/web/components/trip-workspace/queries.ts` 的 7 tab 真实端点 + `apps/api/src/config/environment.ts:224 REDIS_URL: z.url()`（API 启动必须 Redis 的事实依据）；`codegraph status` = `[OK] Index is up to date`。


## 7. 改用 playwright.live 基座后的结果（最终结论）

基座：仓库根新增 `playwright.g3.config.ts`（复制 `playwright.live.config.ts` 的 webServer/projects，
**仅保留** `g3-setup` / `g3-journeys` / `g3-teardown`，去掉 admin），`testDir: "./e2e/g3-api"`，
`ROAMLOG_LIVE_DATABASE_URL='postgresql://postgres@127.0.0.1:55443/roamlog_g3?schema=public'`。
未改 `playwright.live.config.ts` / `playwright.config.ts` / `playwright.staging.config.ts`。
fixture 由 `e2e/g3-api/g3.setup.ts` 调 `runLiveFixtureScript()` 生成（真实 API 登录 + Prisma 建号/工作区），
用例通过 `loadLiveFixture()` 读取，**没有手工造号，也没有 DB 直插 membership**。

最终运行：`npx playwright test --config=playwright.g3.config.ts` → **11 passed / 1 failed（2.4m）**。

### 7.1 先纠正一处我自己的错误判断
首版报告把 `curl /login` HTML 里的 `local fixture` 当作 mock 模式证据 —— **错了**。
`apps/web/components/auth/auth-shell.tsx:62` 把它写成静态文案，**两种模式都会出现**。
真正的模式判别在 `/register`：api 模式渲染“注册后会发送验证邮件…”，mock 模式渲染“…mock 预览不会创建真实账号…”。
G0 门禁已按此改写（`apiCopy=true, mockCopy=false`），并保留首次失败的真实原因（未 hydrate + 无任何 `/v1` 请求）。

### 7.2 逐条结果

| # | 旅程 | 结果 | 断言数 | 关键网络请求（method / URL / status） |
| --- | --- | --- | --- | --- |
| G0 | 三道环境门禁 | **PASS** | 3 | `GET web/register` 200（apiCopy=true, mockCopy=false）；`GET :4100/v1/health` 200 |
| J1 | 注册 + 登录 + 会话 Cookie + 刷新 | **PASS** | 8 | `POST /v1/auth/sign-up/email` **200**；`POST /v1/auth/sign-in/email` 200；`GET /v1/auth/get-session` 200；`GET /v1/me` 200（email 一致）；Cookie `roamlog.session_token`（httpOnly） |
| J2 | 创建旅行全字段 | **PASS** | 12 | `POST /v1/workspaces/:id/trips`（跳转 `/w/…/trips/<uuid>`）；`GET /v1/places/search?q=Osaka`、`q=JPY` 等 |
| J3 | 数据库回显 | **PASS** | 14 | `GET /v1/trips/:id` 200；DB 直查值见下 |
| J4 | 编辑仅发变更字段 | **PASS** | 10 | `PATCH /v1/trips/:id` **200**，body keys = `["budgetAmountMinor","budgetCurrency","destinations","title","version"]`；未改字段全部缺席 |
| J5 | 7 tab 真实请求 | **PASS** | 21 | 见下表（6 个专属 GET + participants 预取，全部 200） |
| J6 | 分享 + incognito 匿名 | **PASS** | 12 | `POST /v1/trips/:id/share-links` **201**（返回 `token` + `url`，一次性）；`GET …/share-links` 200（**不含 token**）；`GET /v1/public/trips/<token>` **200**（360 B，无 bucket/key/variants）；匿名 `get-session` 无 user |
| J7 | viewer 权限 | **FAIL（API 503）** | 0/6 | `POST /v1/workspaces/:id/invitations` → **503**（邮件投递失败）→ 无法产出 viewer，旅程未覆盖 |
| J8 | 409 冲突 | **PASS** | 4 | A：`PATCH /v1/trips/:id` 200（`{"version":2,"title":"…（A）"}`）；B：冲突提示可见；DB 终值 title=「G3 京都七日（A）」version=3 |
| J9 | 移动端 390×844 | **PASS** | 2 | create/detail 均 `scrollWidth=390 = clientWidth=390`（无横向溢出） |

### 7.3 J3 数据库直查（`SELECT * FROM "Trip" WHERE id=$1`）

| 字段 | DB 值 | 页面回显 |
| --- | --- | --- |
| title | `G3 京都七日` | 一致 |
| summary | `真实 API 旅程：寺院、咖啡与雨。` | 一致 |
| status / visibility | `upcoming` / `private` | 一致（“即将出发 / 仅自己”） |
| origin | `Kyoto` | `KYOTO` |
| originLat / originLng / originCountryCode / timeZone | **全部 null** | “未记录坐标 / 旅行时区未设置” |
| destinations | `["大阪府"]` | `大阪府` |
| budgetAmountMinor / budgetCurrency | `1234567` / `JPY` | `JP¥1,234,567` |
| tags / guestNames | `["寺院","咖啡"]` / `["小二"]` | 一致 |

`originLat/Lng/countryCode/timeZone` 为 null 属**契约允许**：本次起点走“手动地点”回退（无坐标/时区）。
**记录为观察项而非失败**：若产品要求起点必带坐标，需要改成强制选地点库条目。

### 7.4 J5 七个 tab 的真实请求（全部 200）

| tab | 请求 |
| --- | --- |
| 行程 | `GET /v1/trips/:id/stops`、`/participants`、`/budget/summary`、`GET /v1/trips/:id`、`GET /v1/workspaces/:id/members` |
| 照片 | `GET /v1/trips/:id/media?limit=100&sort=createdAt:desc` |
| 费用 | `GET /v1/trips/:id/expenses?limit=100&sort=date:desc` |
| 行李 | `GET /v1/trips/:id/packing?limit=100&sort=order:asc` |
| 参与者 | **无新请求**（`/participants` 已由工作台头部预取，页面渲染真实数据：`Wave 5 Owner · 加入于 11月18日 23:17`） |
| 分享 | `GET /v1/trips/:id/share-links` |
| 活动 | `GET /v1/trips/:id/activity?limit=50&sort=createdAt:desc` |

原始数据：`.audit/evidence/g3-api/j5-tabs.json`。

### 7.5 J7 失败详情（唯一 FAIL）

- **spec**：`e2e/g3-api/journeys.spec.ts` › `J7 viewer cannot write and cannot see the share tab`
- **断言**：`expect(invite.status()).toBeLessThan(300)`
- **期望**：201 邀请创建 → 从 `EmailLog` 读 token → viewer 接受 → 只读界面
- **实际**：`POST /v1/workspaces/<id>/invitations` → **503**；`EmailLog` 无对应行，token 无从获取
- **根因**：本环境无 SMTP，邀请邮件的投递失败被 API 以 503 返回（失败关闭）；同一环境下注册的验证邮件也记 `email.delivery_failed`（`template: auth.verify-email`）
- **产品影响（建议单独立项）**：自托管/开发环境无邮件服务时，**邀请成员与邮箱验证整条链路不可用**，Owner 无法把人拉进工作区。当前实现把投递失败当 503，语义上没错，但需要（a）可配置的 dev mailer/日志投递，或（b）允许“邀请已创建、邮件稍后重发”的 201 + 重发入口。
- **截图/上下文**：`.audit/evidence/g3-api/test-results/journeys-G3-live-base-jour-*-nvitation-503-without-SMTP--g3-journeys/`（Playwright 失败截图、trace、video 保留在同一白名单目录）

### 7.6 其他观察（非失败）

1. **注册不跳转**：api 模式下注册成功后停留在 `/register` 并提示“账号已创建。请检查邮箱完成验证…”（无 `next` 跳转），账号 `emailVerified=false`。属设计行为，但依赖邮件 → 见 7.5。
2. **地点标签本地化**：`Osaka` 在库内被解析成 `大阪府`、`Nara` → `奈良市`，同一用例不同轮次标签不同。E2E 断言必须做 locale 容错（本轮已改为 `/(Osaka|大阪)/`、`/(Nara|奈良)/`）。
3. **PATCH 成对字段**：改金额会带 `budgetCurrency`，改目的地有时带 `countryCodes`（取决于地点库是否解析出国别），并始终带 `version`（乐观锁）。未编辑字段（summary/status/visibility/日期/起点/标签/同行人）确认**不发送**。
4. **分享令牌一次性**：列表接口**有意不返回** `token`/`url`，仅 `POST` 201 返回一次（与 UI 文案“创建后会把只读公开页的地址返回一次”一致）。断言据此写在 POST 响应上。

## 8. 安全观察（非环境问题，按根 Agent 认定单列）

未 hydrate 的注册页 `<form noValidate>` 无 `method`/`action`，退化为**原生 GET 提交**，
`password` 进入 URL、浏览器历史与 Referer：

```
http://127.0.0.1:3100/register?name=G3+Owner&email=g3-1795013435768%40example.test&password=g3-pass-123456
```

- 证据截图：`.audit/evidence/g3-api/shots/j1-register-native-submit.png`
- Playwright 上下文：`.audit/evidence/g3-api/j1-error-context.md`
- 复现条件：JS 未加载/未 hydrate（CDN 失败、CSP 拦截、服务端半死等）
- 建议：`<form method="post" action="/register">` 兜底，且在 hydrate 前禁用提交按钮
- 本轮**未修改任何产品代码**

## 9. 本轮收尾（端口/进程）

| 端口 | 用途 | 状态 |
| --- | --- | --- |
| 3100 | web（api 模式，live 基座） | 已释放 |
| 4100 | api | 已释放 |
| 46379 | live Redis 桩 | 已释放 |
| 55443 | PostgreSQL（G3 库） | `pg_ctl -m fast stop` → server stopped |
| 3000 / 3001 / 55442 | 他人所有 | **未触碰**（3000 仍 200） |

未跑 build、未做 git 写操作、未改 `playwright.config.ts` / `playwright.live.config.ts`。

## 10. CodeGraph 证据（本轮）

```
codegraph status → [OK] Index is up to date
codegraph_explore "trip detail workspace tabs overview itinerary expenses packing members share"
  → apps/web/components/trip-workspace/{queries,capabilities}.ts：7 tab 与真实端点映射
codegraph_explore → apps/web/lib/api/{real,auth}.ts：客户端 fetch("/v1/…") 相对路径 + credentials:include
  → 证明 web 走 next rewrite（服务端 API_URL），NEXT_PUBLIC_API_BASE_URL 未被使用
```
