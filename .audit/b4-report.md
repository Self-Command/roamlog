# B4_MODERATION — 内容审核举报闭环交付报告

状态：DONE（本地 4 段提交；契约生成由 Root 串行执行）
任务 ID：B4_MODERATION
时间：2026-11-19

## 1. 变更文件

### DB / 契约
- `packages/db/prisma/schema.prisma` — `Report` / `ModerationAction`；`Trip` / `JournalEntry` / `Comment` / `Media` 各加 `moderatedAt`、`moderatedById`（additive）
- `packages/db/prisma/migrations/0008_report_moderation/migration.sql` — 新表 + 4 条 CHECK + 8 个可空列 + 3 个索引
- `packages/db/src/factories.ts` — `makeReport` / `makeModerationAction`；4 个内容 factory 补 moderation 字段
- `packages/db/src/__tests__/migration.0008.test.ts`（静态 SQL/Prisma 对账）
- `packages/db/src/__tests__/migration.0008.integration.test.ts`（真实 PG：空库全序、0007 数据保留、CHECK 负例）
- `packages/db/src/__tests__/migration.000{4,5,6,7}.test.ts` — 迁移顺序断言改为“相对顺序”，不再随新迁移变红
- `packages/db/src/__tests__/{address-bbox,provider-geoapify}.integration.test.ts` — 读旧数据前补跑 0008（Prisma client 已含新列）
- `packages/contracts/src/api/reports.ts`（新建）
- `packages/contracts/src/api/index.ts`（末尾 `export * from "./reports"`）
- `packages/contracts/src/__tests__/reports.test.ts`（新建）
- `packages/contracts/src/entities/{trip,journal,comment,media}.ts` — 每模型加两个 optional 字段（Root 已授权；**需串行 contracts:generate**）

### API
- `apps/api/src/modules/reports/**`（新建：controllers / services / target snapshot / e2e harness / 3 个 spec）
- `apps/api/src/app.module.ts`（一行注册 `ReportsModule`）
- `apps/api/src/modules/trips/content-presenters.ts` — `presentTrip` / `presentEntry` 改显式构造（修跨模块 500）
- `apps/api/src/modules/admin/admin.presenters.ts` — `presentMedia` / `presentComment` 改显式构造

### Admin
- `apps/admin/components/content/{reports-data.ts,content-view.tsx,content-view.test.tsx}`（新建）
- `apps/admin/app/admin/content/{page.tsx,page.test.tsx}`（新建）
- `apps/admin/components/admin-shell/admin-nav.ts`（只加回「内容审核」，Flag 图标）

### Web
- `apps/web/components/moderation/{api.ts,report-dialog.tsx,report-menu.tsx,report-dialog.test.tsx,report-mounts.test.tsx}`（新建）
- `apps/web/components/trip-workspace/workspace-header.tsx`（trip 举报入口）
- `apps/web/components/trip-workspace/photos-tab.tsx`（media 举报入口）
- `apps/web/components/journal/journal-editor-sheet.tsx`（entry 举报入口，Root 已授权）
- `apps/web/components/journal/journal-comments.tsx`（comment 举报入口，Root 已授权）

## 2. 实现摘要

### 2.1 数据模型（0008_report_moderation，additive）
- `Report`：UUIDv7 PK、workspaceId/targetType/targetId/reason/detail/reporterId/status/resolvedById/resolvedAt/resolutionNote/createdAt；索引 `(status, createdAt)`、`(workspaceId, targetType, targetId)`。
- `ModerationAction`：append-only，`reportId` 索引。
- 内容侧：`moderatedAt`/`moderatedById` 只在 4 张可举报表上，全部可空、无默认值。
- CHECK：`Report_status_check`、`Report_reason_check`、`Report_targetType_check`、`ModerationAction_action_check`。
- 下架语义：`remove` 同时写 `deletedAt=now`（复用既有可见性过滤）+ `moderatedAt=now` + `moderatedById`；`restore` 仅对 `moderatedAt IS NOT NULL` 的行清三列，因此**不会复活作者自己删除的内容**。

### 2.2 契约
`packages/contracts/src/api/reports.ts`：
- 用户侧 `CreateReportRequestSchema` / `CreateReportResponseSchema`
- 后台 `AdminReportQuerySchema`（status/targetType/reason/workspaceId/from/to/q/sort/cursor/limit）、
  `AdminReportItemSchema`（含内容快照 `target` + `reportCount` + `lastReportedAt`）、`AdminReportPageSchema`、`AdminReportDetailSchema`（report + 同目标全部举报 + 动作历史）、`ResolveReportRequestSchema` / `ResolveReportResponseSchema`
- 错误码常量：`REPORT_DUPLICATE(409)`、`REPORT_TARGET_NOT_FOUND(404)`、`REPORT_ALREADY_RESOLVED(409)`、`REPORT_REASON_INVALID(422)`；限流沿用既有 `RATE_LIMITED(429)`。
- 4 个实体 schema 新增 optional：`moderatedAt`、`moderatedById`；public/share 合约未透出（`PublicTrip` / `PublicStop` / `PublicEntry` 保持原样，且 `PublicEntry = JournalEntrySchema.pick(...)` 不受影响）。

### 2.3 API
- `POST /v1/workspaces/{workspaceId}/reports`（新建 `ReportsModule`）：
  - 任意 workspace 成员（含 Viewer）可提交，无 `@RequirePermission`，仅 `TenantGuard` 成员校验；
  - 目标必须同 workspace 且可见（`deletedAt`/`moderatedAt` 为空；private trip 仅作者可见），否则 404 `REPORT_TARGET_NOT_FOUND`（不泄露存在性）；
  - 同用户同目标重复 → 409 `REPORT_DUPLICATE`；
  - 每用户每小时 10 条（DB `createdAt >= now-1h` count）→ 429 `RATE_LIMITED`；
  - 非法 reason → 422 `REPORT_REASON_INVALID`。
- `GET /v1/admin/reports`：`admin:content:read`；分页 cursor、默认 `createdAt desc`；status/targetType/reason/workspaceId/from/to/q 过滤；`q` 真实搜索工作区名、trip/entry 标题、comment 正文、media caption/key + 举报 detail；批量为当前页目标生成内容快照、`groupBy` 聚合同目标举报数与最新举报时间。
- `GET /v1/admin/reports/{id}`：内容快照 + 同目标全部举报（含聚合）+ 动作历史。
- `POST /v1/admin/reports/{id}/resolve`：
  - `remove` → 目标 `deletedAt/moderatedAt/moderatedById`；`restore` → 清三列（仅曾下架）；
  - 写 `ModerationAction`，审计 `admin.report.resolved`（metadata 仅 reportId/action/targetType，**无内容正文**）；
  - 事务内完成 target 更新 + action + report 状态 + audit；
  - 已 `resolved`/`dismissed` 再裁 → 409 `REPORT_ALREADY_RESOLVED`。
  - 权限复用既有动作集：read=`admin:content:read`，remove/warn/dismiss=`admin:content:delete`，restore=`admin:content:restore`（未新造 `admin:content:write`）。

### 2.4 后台 UI（/admin/content 重建）
- 状态 tab（全部/open/in_review/resolved/dismissed）、目标类型、原因、起止日期、搜索（服务端 q）、cursor 分页（上一页/下一页，过滤变化重置游标）。
- 列表列：目标摘要（类型/标题/作者/工作区/原因）、举报数、最新举报时间（相对+绝对）、状态（+已下架标记）。
- 详情抽屉（Sheet，只读快照 + 长文本展开/折叠）：内容快照、作者/管理员删除时间、全部举报、动作历史、裁决表单（action + note，analyst 只读禁用）。
- 空队列真实空状态「暂无待处理举报」，不造假数据；错误态可重试。
- 裁决成功后关闭抽屉 + `invalidateQueries` + 显式 `page.refetch()`，列表以服务端状态重拉。
- 导航「信任与安全」加回「内容审核」（Flag）。

### 2.5 Web 举报入口
- `ReportDialog`：原因 5 项 + 可选说明（≤1000）+ 提交 + 成功反馈；错误码映射：`REPORT_DUPLICATE`→「你已举报过这条内容」、`REPORT_TARGET_NOT_FOUND`→「这条内容不存在，或你已无权查看」、`REPORT_REASON_INVALID`→原因无效、`RATE_LIMITED`→「举报太频繁」、401→重新登录。
- `ReportMenu`：`MoreHorizontal` 触发器 + Dropdown 末项「举报」，无角色门禁（Viewer 可用）。
- 挂载（`targetType → 位置/文件:行`）：
  - `trip` → trip-workspace 头部，`workspace-header.tsx` 顶栏（约 L124）
  - `media` → 照片每张，`photos-tab.tsx` PhotoCard 操作簇（约 L71）
  - `entry` → `journal-editor-sheet.tsx` SheetHeader 右上（约 L487）
  - `comment` → `journal-comments.tsx` 每条评论右上（约 L107）
- 均为旁路动作：不关闭编辑器、不触发自动保存/脏状态，Radix 菜单键盘语义保留。

## 3. 验证命令与结果

### 3.1 DB（真实 PG `postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=b4`）
```
$ DATABASE_URL=...schema=b4 pnpm --filter @roamlog/db exec prisma migrate deploy
→ 0001..0008 全部应用成功（空库全序）
$ ROAMLOG_TEST_DATABASE_URL=...schema=b4 pnpm --filter @roamlog/db test
→ Test Files 16 passed (16) / Tests 77 passed (77)
   ✓ migration.0008.integration.test.ts 1 passed（空库全序 + 0007 数据保留 + CHECK 负例 23514）
```
（0009_media_motion 由 D2 并行新增；迁移顺序断言已改为相对顺序，不会因后续迁移误报。）

### 3.2 API
```
$ pnpm --filter @roamlog/api exec vitest run src/modules/reports src/modules/admin
→ Test Files 15 passed (15) / Tests 136 passed (136)
  （其中 reports 20：create 6 / admin 10 / presenter-resilience 4）
$ pnpm --filter @roamlog/api typecheck
→ 我的文件 0 error；仅剩 storage/media 两个其它 Agent 在改的文件报错
  （storage-admin.controller.spec.ts、storage-probe.service.spec.ts、media.presenter.ts）
```

### 3.3 Contracts
```
$ pnpm --filter @roamlog/contracts test
→ 10 files / 84 tests：83 passed，1 failed
  失败为 places Agent 的 `entities.test.ts` PublicStop fixture 缺 `provider`
  （其改了 share-links.ts 未同步 fixture），非 B4 文件，已上报 Root 路由。
  我的 reports.test.ts 6 passed；entities/openapi 等其余全过。
```

### 3.4 Admin
```
$ pnpm --filter @roamlog/admin typecheck → exit 0
$ pnpm --filter @roamlog/admin exec vitest run components/content app/admin/content
→ Test Files 2 passed / Tests 7 passed
$ pnpm --filter @roamlog/admin build → exit 0，路由含 ○ /admin/content
```

### 3.5 Web
```
$ pnpm --filter @roamlog/web typecheck → exit 0
$ pnpm --filter @roamlog/web exec vitest run components/moderation
→ Test Files 2 passed / Tests 7 passed
  （dialog 5：提交/重复/目标不存在/限流/菜单 Viewer；mount 2：comment + entry）
```

### 3.6 端到端真实联调（隔离 :4220 + schema b4_e2e，验后已 DROP SCHEMA）
```
## member A GET trip before reports            HTTP 200（修复前 500）
## member A POST report                        HTTP 201
## member A duplicate report                  HTTP 409 REPORT_DUPLICATE
## viewer B POST report                       HTTP 201
## admin GET /v1/admin/reports                HTTP 200（items:2，reportCount:2，含 target 快照）
## admin resolve report 1 remove              HTTP 200（target.deletedAt/moderatedAt 均写入）
## member A GET trip after remove             HTTP 404 TRIP_NOT_FOUND
## admin re-resolve closed report             HTTP 409 REPORT_ALREADY_RESOLVED
## admin resolve report 2 restore             HTTP 200（target.moderatedAt=null）
## member A GET trip after restore            HTTP 200
## audit rows admin.report.resolved           2 条，metadata 仅 action/reportId/targetType
## admin GET report detail                    HTTP 200（reports:2 + actions:1）
```
说明：同一 report 关闭后不能二次裁决，因此 restore 通过**同一目标的第二条 open 举报**完成（这是“裁决终态”与“可恢复”同时成立的唯一路径）。

### 3.7 跨模块回归修复证据（Root 要求）
- 现象：加列后 `GET /v1/trips/{id}` → 500。
- 根因：`presentTrip` 把整行 spread 给 `.strict()` 的 `TripSchema`，多出 `moderatedAt`/`moderatedById`。
- 修复：`presentTrip` / `presentEntry` / `admin.presenters.presentMedia` / `presentComment` 全部**显式构造**；新增 4 条防复发测试（valid row + moderatedAt + `someFutureColumn` 不抛、schema 可 parse）。
- 结果：同一 E2E 同一请求 **500 → 200**（见 3.6 第一条与 restore 后 200）。

## 4. 整行 spread 清单（Root 要求）

已改为显式构造（B4 相关）：
- `apps/api/src/modules/trips/content-presenters.ts:70` `presentTrip`（原 `...record`）
- `apps/api/src/modules/trips/content-presenters.ts:149` `presentEntry`（原 `...record`）
- `apps/api/src/modules/admin/admin.presenters.ts:79` `presentMedia`（原 `...record`）
- `apps/api/src/modules/admin/admin.presenters.ts:111` `presentComment`（原 `...record`）

本来就是显式构造、无需改动：
- `apps/api/src/modules/media/media.presenter.ts:49` `presentMedia`（已显式列字段，注释已提醒 moderatedAt）
- `apps/api/src/modules/comments/comments.service.ts:446` `presentComment`（显式）
- `apps/api/src/modules/share-links/share-links.service.ts:210` `publicPayload`（显式；**未改 share-links 文件**）

仍为 spread 但属于非本次加列表（`Stop`/`Participant`/`Revision`/`ItineraryItem`/`Activity`/`PackingItem`/`Expense`/`Export`）：暂未动，建议后续统一治理（Root 可按需另派）。

## 5. CodeGraph 证据
1. `codegraph_explore`（projectPath=`roamlog`）查询：
   `admin module audit pagination admin:content:write report moderation`
   → 命中 `AdminContentService`、`AdminAuditService`、`AdminGuard`/`RequireAdminAction`、`AdminContentQuerySchema`、分页 `toCursorPage` 等 61 symbols；确认复用 `admin:content:read/delete/restore` 与审计/分页约定。
2. `codegraph_explore` 查询：
   `TripsService get trip read presenter requireTrip cover projection TripCoverService MediaUrlService`
   → 调用链 `get → requireVisibleTrip → requireTrip`，定位 `presentWithCover → presentTrip → TripSchema.parse`；blast radius 显示 10 callers，据此定位 strict-schema 500 根因并加防复发测试。

## 6. 已知风险 / 未覆盖

### 风险
1. **下架 vs 作者删除**：`remove` 会同时写 `deletedAt`，恢复时会把“管理员下架前的作者删除”一并清掉（当前 restore 只判断 `moderatedAt IS NOT NULL`，无法知道作者此前是否已删）。要彻底区分需新增 `authorDeletedAt` 或审计事件回放。
2. **已裁决不可逆**：resolved/dismissed 后不能再次 `restore`；恢复必须依赖同一目标仍在 open 的新举报。若产品想要“从详情直接恢复”，需要新增独立 restore 端点或允许 resolved→restore 的显式状态机。
3. **申诉入口未做**：作者看不到 `moderatedAt` 的“申诉”按钮（契约已透出字段，UI 未做）；这是任务明确未要求的部分。
4. **限流非原子**：每小时 10 条用 `count` 判断，极端并发可略微超限；Redis 窗口更严格但会引入 Redis 依赖。
5. **权限映射折中**：`warn`/`dismiss` 复用 `admin:content:delete`（既有动作集无 write 动词）；若产品要求“警告不需要下架权限”，需要新增 admin 动作。
6. **迁移外键**：按任务给定的模型未加 `Report.workspaceId/reporterId/resolvedById` 外键；目标被硬删后举报仍保留（有快照兜底），但工作区硬删会留下孤儿举报行。

### 未覆盖
- 未做批量裁决（任务只要求单条）。
- 未做举报通知（作者/管理员站内信）。
- 未做媒体/评论的端到端真实上传链路（媒体目标快照与 remove 已覆盖 service 层；E2E 只跑 trip）。
- contracts 全绿依赖 places Agent 修 `entities.test.ts` fixture；`contracts:generate` 由 Root 串行执行（本 Agent 未跑）。

## 7. 建议下一步
1. Root 串行：`contracts:generate` + `api-client:generate`，然后 admin/web 各跑一次 typecheck/test（optional 字段向后兼容）。
2. 产品决定“恢复”语义：新增 `POST /v1/admin/reports/{id}/restore` 或允许 resolved→restore，作者申诉入口复用 `moderatedAt`。
3. 统一治理其余 presenter 的整行 spread（Stop/Packing/Expense/Export 等），一次改完并加同类“未知列”测试。
4. 给 `Report` 补 FK 或定期清理孤儿举报；批量裁决与通知进入下一迭代。