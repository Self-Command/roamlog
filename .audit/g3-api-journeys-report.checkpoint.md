# G3 API Journeys — checkpoint（最终）

状态：**DONE**（9 条旅程：8 PASS / 1 FAIL；FAIL 为真实 API 503，已定位根因）

- 基座：仓库根新增 `playwright.g3.config.ts`（复制 `playwright.live.config.ts`，仅保留 g3-setup/g3-journeys/g3-teardown），
  `ROAMLOG_LIVE_DATABASE_URL=postgresql://postgres@127.0.0.1:55443/roamlog_g3?schema=public`
- fixture：`e2e/g3-api/g3.setup.ts` → `runLiveFixtureScript()`（真实 API 登录 + Prisma 建号/工作区）；用例用 `loadLiveFixture()`
- 最终运行：**11 passed / 1 failed（2.4m）**
  - PASS：G0 门禁、J1 注册/登录/会话、J2 全字段创建、J3 DB 回显、J4 PATCH 只发变更、J5 7 tab、J6 分享+incognito、J8 409、J9 移动端
  - FAIL：J7 viewer —— `POST /v1/workspaces/:id/invitations` → **503**（无 SMTP，邮件投递失败，失败关闭）
- 纠正：`local fixture` 是 `auth-shell.tsx:62` 静态文案，**不是** mock 模式证据；模式判别改用 `/register` 的分支文案
- 观察：起点手动回退时 originLat/Lng/countryCode/timeZone = null（契约允许）；地点标签本地化（大阪府/奈良市）；
  PATCH 成对字段 budgetCurrency/countryCodes + version；分享 token 仅 POST 一次性返回
- 安全（根 Agent 另开任务）：未 hydrate 的注册表单原生 GET 提交把 password 带进 URL
- 端口：3100 / 4100 / 46379 / 55443 全部释放；3000 / 3001 / 55442 未触碰
- 未被 git/build 触碰；未改 `playwright.config.ts` / `playwright.live.config.ts`

CodeGraph 证据: `codegraph status` = `[OK] Index is up to date`；`codegraph_explore` 命中 trip-workspace 7 tab 端点与
`apps/web/lib/api/*` 的相对 `/v1/…` fetch（证明未使用 `NEXT_PUBLIC_API_BASE_URL`）。