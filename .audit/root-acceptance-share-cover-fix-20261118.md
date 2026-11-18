# 根 Agent 验收记录 — SHARE_COVER_FIX

任务 ID: SHARE_COVER_FIX
验收结论: **ACCEPT（后端已闭环；前端渲染缺口已另派 SHARE_HERO_COVER）**
时间: 2026-11-18 23:15

## 通过

### 根因与修法（查询形态是本任务的技术亮点）
- 根因：仓储 media 查询只有 `tripId = trip.id` → Workspace 级封面（`media.tripId = null`）进不了 bundle；服务层内联规则本身正确，只是拿不到行。
- 修法：**仍是 1 次 `media.findMany`**，把 `coverMediaId` 并入同一查询：
  ```ts
  where: { workspaceId, status: "ready", deletedAt: null,
           OR: [{ tripId: trip.id }, { id: coverMediaId }] }
  ```
  - 无封面时不加 `OR`，`where` 与改动前**逐字段等价**（零回归面）
  - `workspaceId/status/deletedAt` 留在顶层 → **两个 OR 分支都受租户/状态约束**，跨租户或非 ready 封面根本不会被加载
  - 结果拆分：`media` = `tripId === trip.id`（与改动前逐字节一致）；新增 `coverMedia` = 被引用但不在 gallery 的那一行
  - **无 N+1**：仍是 1 次 media + 1 次 entryMedia，无新增往返
- 服务层：删除内联 `publicCover`，改调**登录态同一个** `TripCoverService.resolve`，loader 只用仓储已加载行 + `row.workspaceId === trip.workspaceId` 防御校验。语义完全继承（ready + 同 Workspace + (tripId 为 null 或 == 该 Trip)），不伪造 URL，响应仍由 `.strict()` 收口。

### 不回归
- 公开 `media` 数组仍是「挂该 Trip 的 ready 媒体 ∪ 各 entry 的 ready 媒体」；**Workspace 级封面不进 gallery**（与登录态 `GET /trips/:id/media` 一致）
- stops/entries/budget/未 ready 过滤未变
- **密码/过期/撤销/recordAccess 一字未改**（我特意核查）

### 测试（覆盖了正确的一组边界）
- 新增 `public-trip-bundle.spec.ts`（11）+ `share-links.module.spec.ts`（DI 1）；`public-cover.spec.ts` 5→11
- 覆盖：Workspace 级封面非空 + 签名 URL、Trip 级封面、**跨 Workspace → null**、processing/failed/pending → null、**软删 → null**、JSON **精确 key 集合**断言（无 bucket/key/variants）、无封面不 500、**`findMany` 调用次数 = 1 + where 逐字段断言**
- 验证：api typecheck exit 0；`share-links + media` → 8 files / **59 tests 通过**；`collab-share.e2e` 4 tests 通过（证明 5 参手工构造仍兼容）

## **最重要的发现（Agent 主动上报，我认可其价值）**

后端已正确返回 `cover`，但**用户可见症状不会消失**，因为：
> `apps/web/components/share/share-article.tsx:45` 的 hero 用 `coverClassForTrip(tripIndex)` 渐变占位，**从不读 `trip.cover`**。

而登录态三处页面都正确使用 `cover?.url ?? cover?.thumbUrl`（`trip-card.tsx:21`、`atlas-workspace.tsx:454`、`dashboard-page.tsx:71`）。

→ 这正是「登录用户看到封面、匿名访客看到渐变块」的**最后一环**。已另派 `SHARE_HERO_COVER` 修复（含 fallback 语义与 4 条测试）。

## 根 Agent 复验

真实 PostgreSQL 全量：**461 passed | 6 skipped（467），exit 0**（较上次 443 增加 18，即本任务新增用例）。

## 剩余风险（接受）

1. 封面若同时是 trip 级媒体会被签两次（仅本地 HMAC，无网络/DB 开销）。
2. `cover.expiresAt` 与 `media` 同一条目的 expiresAt 可能差几毫秒（两次签名）；契约不要求一致。
3. `TripCoverService` 只校验 `tripId`；跨租户由仓储 + 服务层防御共同保证。当前正确，但属「双保险依赖」——若将来有人绕过仓储直接用 projector，租户校验会弱化。记录。
4. `publicPayload` 变 `async`（私有），`readPublic` 已 `await`；CodeGraph 确认无其它调用方。

## 未覆盖

S3 用 stub（与既有测试一致）；未跑 build；web 渲染缺口由 `SHARE_HERO_COVER` 负责。