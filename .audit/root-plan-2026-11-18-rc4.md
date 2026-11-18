# Roamlog rc.4 开发总计划（根 Agent 维护）

日期: 2026-11-18 (Asia/Shanghai)
基线: `main` / `b96ca9b`；线上仍是 `v0.1.0-rc.3`。
未提交: `W0_CONTRACTS`（契约/OpenAPI/api-client）+ `fix_admin_p0_audit_contract`（审计 v4 读取兼容 + 总览分区块降级）。
当前门禁: **G0 交接验收进行中**（`W0_HANDOFF_QA`，只读）。

## 0. 铁律

1. 所有 Agent 必须先 `codegraph status`，再用 `codegraph explore`；交付附 `CodeGraph 证据:`（见 `AGENTS.md` 第 0 节）。
2. 一个文件同一时间只有一个 writer；共享文件、迁移、生成物串行。
3. 禁止 `git reset/clean/checkout/stash`；禁止覆盖他人未提交改动；禁止把 rc.3 当成已修复版本。
4. 每个 Agent 边做边写独立 checkpoint，不能只把结论留在上下文。
5. 不修与任务无关的缺陷；发现即记录并上报。
6. 验收只认证据：命令、退出码、日志、截图、DB 查询。
7. 生产服务器 `root@217.217.197.188` 上 `classbook`、`chaoxing`、`opencode`、`ai`、`api` 等站点不得受影响；不改宿主机 Nginx 其他 server 块。

## 1. 文件所有权（唯一 writer）

| 范围 | Owner | 备注 |
|---|---|---|
| `packages/contracts/**`、`packages/api-client/**`、`packages/contracts/openapi.json` | `w0_contracts` | 已冻结；任何字段变更先找根 Agent |
| `packages/db/prisma/schema.prisma`、`packages/db/prisma/migrations/**` | `w0_db` | 迁移串行，唯一 writer |
| `apps/api/src/modules/admin/**`、`apps/api/test/admin-*.e2e-spec.ts` | `admin_p0` | 审计/总览 |
| `apps/api/src/modules/places/**`、`search/**` | `api_places` | Wave 1 |
| `apps/api/src/modules/media/**`、`storage/**`、trip cover 相关 service | `api_media` | Wave 1 |
| `apps/api/src/modules/trips/**`（presenters/service）、`share-links/**` | `api_trips` | Wave 1/兼容修复 |
| `apps/api/src/modules/{packing,expenses,comments,entries,participants,itinerary}/**` | `api_content` | Wave 1 测试与缺口 |
| `deploy/**`、`compose*.yml`、`.github/workflows/**`、env 校验 | `w0_storage` / `w0_mail` / `devops` | 两个 owner 不得同时改同一 compose |
| `apps/web/app/(app)/w/[workspaceSlug]/trips/new/**`、`apps/web/components/trips/new-trip-*` | `web_trip_form` | Wave 2 |
| `apps/web/components/trip-detail/**`、`trips/[tripId]/**`、`trip-detail-*` | `web_trip_workspace` | Wave 2 |
| `apps/web/components/app-shell/**`、`dashboard/**`、`journal/**`、`insights`、`map` 页面、`apps/web/lib/demo-store*`、`packages/api-mocks/**` | `web_shell` | Wave 2 去假数据 |
| `apps/admin/**`（除已确认 P0 文件） | `admin_ops` / `admin_crud` | Wave 3 |
| `.audit/<task>-report.md`、`.checkpoint.md`、`evidence/<task>/` | 各 Agent 自己 | 不互相覆盖 |

## 2. 波次

### G0 交接验收（进行中）
- `W0_HANDOFF_QA`：diff 边界/敏感信息/生成物一致性；contracts:check；API/Web/Admin typecheck；相关单测；Admin/Web build；embedded PostgreSQL + `admin-audit-uuid-compat.e2e-spec.ts` + 迁移测试。
- 已知风险（根 Agent 预判，待 QA 证实）：新 Trip/Stop/PublicTrip 读契约增加了必填字段（`durationDays`、`cover`、`originLat/Lng`、`originCountryCode`、`timeZone`、`provider` 等），而 `content-presenters.ts`、`share-links.service.ts` 未同步投影 → 运行时 `TripSchema.parse` 抛错、API 测试必红。
- 处置：G0 失败项按 owner 派最小修复（预计 `api_trips` 补投影默认值），不做新功能。

### Wave 0（串行优先）
1. `W0_DB`：一条迁移（Trip origin lat/lng/country/timezone；Stop provider/providerPlaceId/timeZone；预算 pair/nonnegative check；origin 坐标 pair check）；空库 + 既有数据兼容；迁移测试。
2. `W0_API_COMPAT`（`api_trips`）：presentTrip/presentStop/public share 最小投影（真实派生 durationDays，未接字段显式 null，不伪造 URL）；API 全绿后才允许部署。
3. `W0_STORAGE`（`devops`）：S3 双 endpoint（内网 minio:9000 + 公网媒体域）、公开读/签名 URL TTL、CORS、env 校验、Media 授权写入。
4. `W0_MAIL`（`devops`）：production compose 拆分、移除 Mailpit、Resend/SMTP、SPF/DKIM 验证文档、密钥不落库。

> 迁移与生成物必须串行；W0_DB 完成前，W1 不得改 schema。

### Wave 1 API（并行 2-3 个）
- `API_PLACES`：`GET /v1/places/search` 服务端代理 Photon/等价源；Redis 缓存（短 TTL + 归一化 key）、限流、超时/降级 `degraded=true`、手动地点回退；契约测试 + 故障注入测试。
- `API_MEDIA`：`GET /v1/media/{mediaId}`；Trip `cover` 投影（large/thumb、expiresAt）；`durationDays` 真实派生；`POST /v1/trips/{id}/cover`（ready + trip 归属 + 权限）；PATCH `coverMediaId` 收紧；公开分享媒体可显示 URL 且不泄露 bucket/key。
- `API_CONTENT`：日志/照片/行李/费用/分享/参与者缺失能力的路由与测试（逐项，不堆 mock）。
- 每个端点必须有：401/403/404/409/422、租户隔离、契约响应测试。

### Wave 2 Web（并行 3 个；先等 API 端点可用）
- `WEB_TRIP_FORM`：完整创建/编辑表单（封面、标题、简介、状态、可见性、日期、起点/目的地/途经、天数派生、预算/币种、标签、同行人）；日期选择器 + 可搜索 combobox（键盘/空/加载/错误/手动降级）；封面上传全链路（presign→PUT→complete→轮询 ready→setCover、进度、重试、替换、删除、刷新回显）。
- `WEB_TRIP_WORKSPACE`：详情工作台接真实预算/费用、Stop 行程、照片、行李、分享、删除/复制；真实空状态；禁止 mock tab。
- `WEB_SHELL`：顶栏只展示真实成员/未读数，删除假在线/假红点/假头像组；国内 1 字头像；820/390 不溢出；总览/洞察/地图清除 fixture/demo store，无聚合显示“尚未接入”。
- 视觉：黑画布、衬线标题、mono 元数据、hairline；标题帽 56/48/36；每屏最多一个白色 primary；首屏真实内容；reduced motion、焦点、对比度。

### Wave 3 Admin（API 稳定后）
- `ADMIN_OPS`：审计 UUID（已完成）+ 总览错误边界（已完成）+ 假环境徽标/假 2FA/假登出/假通知 badge/假举报数/系统 Redis/Panel/队列吞吐/Worker 健康。
- `ADMIN_CRUD`：用户/工作区详情、成员、体量、分页、服务端搜索、导出；举报/审核队列；功能开关创建；测试邮件；邮件状态限制；套餐/所有权转移。
- 所有按钮必须真实可用；不可用则移除或明确“未接入”。

## 3. 验收门禁

| Gate | 内容 | 通过标准 |
|---|---|---|
| G0 | 交接验收 | 无越界/泄密；contracts:check；三端 typecheck；相关单测；Admin/Web build；PG 迁移 + UUIDv4 e2e 全绿（或缺陷已归属） |
| G1 | 契约 & 生成物 | contracts:check、api-client:check、契约测试全绿；OpenAPI 与实现一致 |
| G2 | API | typecheck、单测、真实 PG e2e、鉴权矩阵、错误码；无吞错 |
| G3 | Web | typecheck、build、Playwright 关键旅程、390/820/1440 截图、a11y（axe）、无 fixture |
| G4 | Admin | typecheck、build、关键操作真实可用、无死按钮/假数据 |
| G5 | 发布前 | lint、全量测试、staging-full、媒体上传、邮件链路、备份/回滚检查 |
| G6 | 线上 | rc.4 镜像 5 个构建完成、Release gate 通过、部署后登录/刷新/旅行全字段/封面/地点搜索/后台操作真实可用、线上无假数据 |

## 4. 验证命令（统一）

```bash
cd /c/Users/BY9700/Desktop/UI/roamlog
codegraph status
pnpm contracts:check
pnpm --filter @roamlog/api-client api-client:check
pnpm --filter @roamlog/contracts test
pnpm --filter @roamlog/api typecheck
pnpm --filter @roamlog/web typecheck
pnpm --filter @roamlog/admin typecheck
pnpm --filter @roamlog/api test
pnpm --filter @roamlog/web test
pnpm --filter @roamlog/admin test
pnpm --filter @roamlog/web build
pnpm --filter @roamlog/admin build
```

真实 PostgreSQL（无 Docker，本地 embedded PG）：

```bash
PG_BIN=".data/bootstrap-e2e/node_modules/@embedded-postgres/windows-x64/native/bin"
"$PG_BIN/initdb.exe" -D .data/handoff-qa-20261118/pgdata -U postgres -A trust -E UTF8 --locale=C
"$PG_BIN/pg_ctl.exe" -D .data/handoff-qa-20261118/pgdata -l .data/handoff-qa-20261118/pg.log -o "-p 55440 -c listen_addresses=127.0.0.1" start
"$PG_BIN/createdb.exe" -h 127.0.0.1 -p 55440 -U postgres roamlog_handoff
DATABASE_URL='postgresql://postgres@127.0.0.1:55440/roamlog_handoff?schema=public' pnpm db:migrate
ROAMLOG_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55440/roamlog_handoff?schema=public' pnpm --filter @roamlog/api exec vitest run test/admin-audit-uuid-compat.e2e-spec.ts
```

## 5. 发布流程（G6）

1. 全量验证通过 → 提交 `main`（按逻辑分组 commit），打 tag `v0.1.0-rc.4`。
2. 触发 GitHub Action，确认 5 个镜像构建成功、Release gate 通过。
3. 拉取到服务器 `/opt/roamlog`，仅重启 roamlog 栈；不触碰同宿主其他站点。
4. 部署后真实登录验证：登录/刷新、工作区、旅行全字段创建/编辑/回显、封面上传/替换、可搜索地点、日期/预算、后台关键操作。
5. 检查线上无 fixture/MSW/假数量/假坐标/假红点；记录截图与响应。
6. 回滚预案：保留上一版镜像 tag 与 compose 环境；异常 5 分钟内回退。

## 6. 当前风险

- 契约先行但 API 投影未接（G0 预计失败，需最小兼容修复）。
- 本地无 Docker/PostgreSQL，只能 embedded PG；staging-full 需要 MinIO/Mailpit/Redis，当前不可用。
- S3 生产 endpoint `minio:9000` 浏览器不可达，需公网媒体域 + CORS + Nginx。
- 线上 rc.3 仍含假数据；在 rc.4 完成前不得宣称已修复。
- 共享文件（compose、env、contracts、migrations）必须串行，避免 merge 冲突。
