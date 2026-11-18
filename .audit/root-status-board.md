# Roamlog rc.4 任务看板（根 Agent 维护）

最后更新: 2026-11-18 21:35 (Asia/Shanghai)
基线: `main` / `b96ca9b`；线上仍 `v0.1.0-rc.3`。

## 状态图例

`DONE` 已交付待验收 · `ACCEPT` 验收通过 · `RUN` 进行中 · `TODO` 未开始 · `BLOCKED` 阻塞

## 已完成 / 进行中

| ID | 角色 | 范围 | 状态 | 验收记录 |
|---|---|---|---|---|
| `W0_HANDOFF_QA` | qa_verifier | 未提交 diff 边界/敏感信息/生成物/PG 迁移/UUIDv4 审计 | **ACCEPT(条件)** | `root-acceptance-g0-20261118.md` |
| `W0_DB` | data_worker | 迁移 0003：Trip 坐标/国家/时区、Stop provider、预算+坐标约束 | **ACCEPT** | `root-acceptance-w0-db-20261118.md` |
| `API_READ_SHAPE` | backend_api | presenter/公开分享适配新契约 + MediaUrlService 签名 | **ACCEPT(条件)** | `root-acceptance-api-read-shape-20261118.md` |
| `WEB_MOCKS_COMPAT` | web_frontend | api-mocks/demo 形状适配，恢复 web build | **ACCEPT** | `root-acceptance-web-mocks-20261118.md` |
| `WEB_TOPBAR` | web_frontend | 顶栏去假 presence/假红点/假头像，真实成员与未读 | **ACCEPT(条件)** | `root-acceptance-web-topbar-20261118.md` |
| `API_PLACES` | backend_api | Photon 代理 + Redis 缓存 + 限流 + 降级 | **ACCEPT(条件)** | `root-acceptance-api-places-20261118.md` |
| `W0_MAIL` | devops | 独立生产 compose（去 Mailpit）+ Resend/SMTP + SPF/DKIM 校验 | **ACCEPT(条件)** | `root-acceptance-w0-mail-20261118.md` |
| `DB_FACTORY_FIX` | data_worker | 修 factories.ts TS2719，解除全仓 typecheck 阻塞 | **ACCEPT** | `root-acceptance-db-factory-20261118.md` |
| `ADMIN_SHELL_TRUTH` | admin_frontend | 去假环境/假 2FA/假通知/假登出；真实 sign-out | **ACCEPT(条件)** | `root-acceptance-admin-shell-20261118.md` |
| `W0_STORAGE_INFRA` | devops | 双 S3 endpoint、公网媒体域、CORS、Nginx media 块 | **ACCEPT(条件)** | `root-acceptance-w0-storage-20261118.md` |
| `API_TRIP_MEDIA` | backend_api | Trip 新字段持久化 + 真实封面投影 + `GET /v1/media/{id}` | RUN | — |
| `WEB_TRIP_FORM` | web_frontend | 旅行创建/编辑全字段 + 日期选择器 + 可搜索 combobox | RUN | — |
| `WEB_VISUAL_QA` | qa_verifier | 1440/820/390 截图、溢出量化、假数据取证 | **ACCEPT** | `root-acceptance-web-visual-20261118.md` |
| `WEB_SHELL_CLEANUP` | web_frontend | 总览/洞察/地图去 fixture，MSW 隔离，真实空状态 | **ACCEPT(条件)** | `root-acceptance-web-shell-cleanup-20261118.md` |
| `W0_DOCS_ENV_SYNC` | devops | 新变量/文档同步、Dockerfile `NEXT_PUBLIC_APP_ENV`、CI production compose 校验 | **ACCEPT** | `root-acceptance-w0-docs-env-sync-20261118.md` |
| `W0_RELEASE_WIRING` | devops | CI env_file 占位、release build-arg、validator 覆盖 production compose | **ACCEPT** | `root-acceptance-w0-release-wiring-20261118.md` |
| `WEB_COVER_UPLOAD` | web_frontend | 封面上传全链路（presign→PUT→complete→poll→setCover），45 tests | **ACCEPT(条件)** | `root-acceptance-web-cover-upload-20261118.md` |
| `WEB_FIXTURES_ISOLATION` | web_frontend | fixtures 出仓：api 构建 0 命中，mock 对照 > 0 | **ACCEPT** | `root-acceptance-web-fixtures-isolation-20261118.md` |
| `ADMIN_CRUD` | admin_frontend | 用户/工作区详情、搜索、分页、真实 CSV 导出 | **ACCEPT(条件)** | `root-acceptance-admin-crud-20261118.md` |
| `API_TRIP_MEDIA` | backend_api | Trip 字段持久化 + 封面投影 + `GET /v1/media/{id}` + cover 收紧 | **ACCEPT(条件)** | `root-acceptance-api-trip-media-20261118.md` |
| `WEB_TRIP_FORM` | web_frontend | 旅行创建/编辑全字段 + 日期选择器 + combobox + 封面接入 | **ACCEPT(条件)** | `root-acceptance-web-trip-form-20261118.md` |
| `WEB_TRIP_WORKSPACE` | web_frontend | 详情工作台（行程/照片/费用/行李/分享/参与者/删除/复制） | **ACCEPT(条件)** | `root-acceptance-web-trip-workspace-20261118.md` |
| `ADMIN_OPS_TRUTH` | admin_frontend | 举报/开关/邮件/队列/系统健康去假（含 Worker 假 DOWN 根因） | **ACCEPT(条件)** | `root-acceptance-admin-ops-truth-20261118.md` |
| `SHARE_COVER_FIX` | backend_api | 匿名分享封面：并入同一次查询、零 N+1、租户约束 | **ACCEPT** | `root-acceptance-share-cover-fix-20261118.md` |
| `SHARE_HERO_COVER` | web_frontend | 分享页 hero 读 `trip.cover`，保留渐变 fallback | **ACCEPT** | `root-acceptance-share-hero-cover-20261118.md` |
| `CONTRACTS_TEST_REPAIR` | backend_api | 过期契约测试（92→94 paths、AdminSystemSchema 样本） | **ACCEPT** | `contracts-test-repair-report.md` |
| `WEB_LINT_DISABLE_SWEEP` | web_frontend | 清 `@next/next` 未注册规则的 disable 注释 | **ACCEPT** | `web-lint-disable-sweep-report.md` |
| `G3_UI_JOURNEYS` | qa_verifier | mock 模式真实浏览器旅程 | RUN（3000） | — |
| `G3_API_JOURNEYS` | qa_verifier | 真实 API+PG+浏览器旅程 | RUN（3100/4100/55443） | — |
| `E2E_SPEC_REFRESH` | qa_verifier | 修会让 CI 挂掉的 dashboard e2e 过期断言 | RUN（3300） | — |
| `SHARE_GALLERY_MEDIA` | web_frontend | 分享页照片墙接真实 `PublicMedia.url/thumbUrl` | RUN | — |

## G1 门禁：**通过**（`g1-PASSED-20261118.md`）

`contracts:check` fresh ｜ typecheck 五端 0 ｜ lint 0 ｜ build 0 ｜ API 461 tests ｜ web 178 ｜ admin 82 ｜ contracts 54

## 已验证的事实（根 Agent 亲自复核）

- **overflow**: 390 / 820 / 1440 全部 `scrollWidth == clientWidth`，无横向溢出。
- **顶栏**: 移动端 390 仅「菜单 / 总览 / 搜索 / 铃铛」，无假成员条；`新建入口 href` = `/w/<slug>/trips/new`；`focus-visible` 实测 2px 外圈可见。
- **假数据仍在**（mock 模式截图）：`9 趟旅行 / 9 个国家 / 21 个城市`、`TOTAL JOURNEYS 9`、`DAYS ON THE ROAD 79`、`BUDGET ¥18,800`、`MSW DEVELOPMENT DATA` +「没有生产后端写入」→ 已派 `WEB_SHELL_CLEANUP`。
- **api typecheck 剩余错误**全在 `apps/api/src/modules/trips/**`（`TripCoverService` 未接线、`TripCreateData` 缺 4 字段、e2e 构造参数 3→4），属 `API_TRIP_MEDIA` 在途。

## 后续待办（未派单）

### 发布门禁 G5/G6 前置
1. devops：构建注入 `NEXT_PUBLIC_APP_ENV`（staging/production），否则环境徽标回退 `NODE_ENV` 误显示 PRODUCTION。
2. devops：`tooling/scripts/check-env.ts` 同步 `APP_ENV`/`EMAIL_PROVIDER`/`S3_PUBLIC_ENDPOINT`/`MEDIA_*` 新变量。
3. devops：给 worker 加 SMTP 或 ADR 确认「生产只用 Resend」。
4. api：`EmailDeliveryService.deliver()` 去掉隐式「SMTP 优先」，按 `EMAIL_PROVIDER` 分支。
5. devops：有 Docker 主机时跑 `docker compose -f docker/compose.production.yml config`。

### Admin（Wave 3）
- `ADMIN_CRUD`：用户/工作区详情、成员、体量、分页、服务端搜索、导出。
- `ADMIN_MODERATION`：举报/审核队列（当前固定 0）、功能开关创建、测试邮件、邮件状态限制、套餐/所有权转移。
- `ADMIN_SYSTEM`：队列吞吐假值、Worker 假 DOWN、系统 Redis/Panel 硬编码。
- `ADMIN_FIXTURE_OFF`：admin `fixtures.ts` / fixture 模式下线（侧栏 fixture 身份「林知夏」）。

### API 补口
- `GET /v1/admin/notifications` + 未读数（Admin 通知中心）；`/v1/me` 补 2FA 状态字段。
- `/v1/me/notifications` 增加 `unreadCount`（替换顶栏「20+」下界语义）。
- `collab-share.e2e-spec.ts` 补 `new MediaUrlService(fakeStorage)`，把 `ShareLinksService` 第 6 参收紧为必填。

### Web（Wave 2 剩余）
- `WEB_COVER_UPLOAD`：封面上传全链路（presign→PUT→complete→轮询 ready→setCover、进度/重试/替换/删除/回显）。
- `WEB_TRIP_WORKSPACE`：详情工作台接真实预算/行程/照片/行李/分享/删除/复制。
- `WEB_JOURNAL`：日志内图片真实上传（当前 placehold）。
- 顶栏外假 presence：`trip-card.tsx`、`dashboard-page.tsx` 由 `trip.status` 推导在线。

### 测试/发布
- G1：真实 PG + 全量 `api test`（交接时 8 failed 必须转绿）+ `web/admin build`。
- G3：Playwright 关键旅程、a11y axe、视觉回归、390/820/1440。
- G5：staging-full（需 MinIO/Mailpit/Redis；本机无 Docker，需远端）。
- G6：rc.4 五镜像 → Release gate → `/opt/roamlog` → 真机登录验证。

## 待清理

- `apps/{admin,web}/next-env.d.ts` 被构建改写，提交前用 `git show HEAD:<path> > <path>` 还原（禁用 checkout）。
- `packages/api-mocks/**` 的 MSW fixtures 最终整体移除（`WEB_SHELL_CLEANUP` 先隔离）。