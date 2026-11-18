# 根 Agent 记录 — G3_API_JOURNEYS 首次尝试 BLOCKED（环境，非产品）

时间: 2026-11-18 23:30
结论: **BLOCKED（环境）** —— 真实 API + 真实 PostgreSQL 均跑通，但 web(:3100) 实例是 mock 模式且未 hydrate，9 条旅程无法开跑。

## 已跑通的事实（有价值，非失败）

| 项 | 结果 |
|---|---|
| PostgreSQL 55443 + `roamlog_g3` | initdb → 建库 → **3 个迁移全部成功** |
| API :4100 | `/v1/health` = 200，路由全挂载，全程 **0 个 5xx** |
| 代理链路 | `http://127.0.0.1:3100/v1/health` = 200 |
| CodeGraph 门禁 | `[OK] Index is up to date` |

**关键发现：API 无 Redis 起不来** —— `apps/api/src/config/environment.ts:224 REDIS_URL: z.url()` 是必填项。Agent 改走仓库既有 `e2e/live-support/start-api.ts`（自带 Redis 协议桩 :46379）后成功。这解释了为什么本地"直接跑 api dev"不可行。

## 失败点（环境）

`http://127.0.0.1:3100/register` 的 HTML 含 `local fixture`（mock adapter 文案）→ 该实例 `DATA_MODE=mock`；`api.log` 中 `/v1/auth/sign-up/email` 出现 **0 次**；浏览器全程 **0 个 /v1 请求**。

根因两条：
1. `apps/web` 的 dev 脚本**写死** `next dev --port 3000`，`dev -- -p 3100` 会把 `-p` 当目录；
2. **Next 16 按项目目录加锁**，3000 的既有实例（PID 20148）占着 `apps/web/.next`，新实例报 `Another next dev server is already running`。

**我的任务书写错了一个变量**：`NEXT_PUBLIC_API_BASE_URL` 在 web 代码里**根本没有被使用**。实际是：客户端 fetch 走相对 `/v1/...`，服务端 rewrite 用 `API_URL`。已纠正。

## 我的处置

**不需要手工搭环境** —— 仓库里已有 `playwright.live.config.ts` + `e2e/live-support/*` 的完整基座：
- `prepare-next-runtime.ts web` 把 app 复制到 `.e2e-live/runtime/web` 再起 dev → **官方绕过 Next 16 目录锁的方式**
- `start-api.ts` 内置 Redis 协议桩（46379）
- `live.setup.ts` 产出 `.e2e-live/fixture.json`（含 `web.sessionCookie`、`web.workspace.slug`、`outsider` 等）→ **不必自己造账号、也不必 DB 直插 membership**

已要求该 Agent 新建 `playwright.g3.config.ts`（复制 live 配置的 webServer/projects，改 testDir），并加**三道前置探活门**：
1. `GET /login` = 200
2. HTML **不含** `local fixture`（证明确实 api 模式）
3. `GET /v1/health` = 200

三门不过即判「环境未就绪」，不得继续做产品断言。

## **真实产品缺陷（Agent 发现，我认定成立）**

注册页在**未 hydrate** 时 `<form noValidate>` 无 `method`/`action` → 退化为原生 **GET** 提交 → **password 进入 URL、浏览器历史、Referer**。

这是真实安全问题（低速网络/JS 失败/爬虫场景都会触发）。已记录待修：给表单加 `method="post"` + `action` 兜底，或在未 hydrate 前禁用提交按钮。**不在本任务修**。

## 未覆盖

J1–J9 全部（环境阻断）。Agent 已写好 J2–J9 实现，待环境修好后可直接复用。