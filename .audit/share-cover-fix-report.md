# SHARE_COVER_FIX — 交付报告

状态: DONE
任务 ID: SHARE_COVER_FIX
角色: backend_api
仓库: `C:\Users\BY9700\Desktop\UI\roamlog`（shared worktree，branch `main`，未提交任何改动）
时间: 2026-11-18

---

## 1. 变更文件

生产代码（2 个，均在允许范围内）:

- `apps/api/src/modules/share-links/share-links.repository.ts`
  - `PublicTripBundle` 新增 `coverMedia: Record<string, unknown> | null`
  - `loadPublicTrip` 的 media 查询并入 `coverMediaId` 分支；结果拆分为 `directMedia`（→`media`）与 `coverMedia`
- `apps/api/src/modules/share-links/share-links.service.ts`
  - 注入 `TripCoverService`（可选参数，与既有 `MediaUrlService` 相同的构造约定）
  - 删除内联的 `publicCover`，改由 `resolveCover` 调用**登录态同一个** `TripCoverService.resolve`
  - 新增 `coverCandidates` / `coverMediaSources` 两个模块级 helper（含 Workspace 防御性校验）

测试（3 个）:

- `apps/api/src/modules/share-links/__tests__/public-trip-bundle.spec.ts`（**新增**，仓储层，11 tests）
- `apps/api/src/modules/share-links/__tests__/public-cover.spec.ts`（**扩展**，服务层，5 → 11 tests）
- `apps/api/src/modules/share-links/__tests__/share-links.module.spec.ts`（**新增**，DI/模块装配，1 test）
- `apps/api/src/modules/share-links/__tests__/public-payload.spec.ts`（仅 bundle 形状跟随 `coverMedia` 字段，1 行）

报告:

- `.audit/share-cover-fix-report.checkpoint.md`
- `.audit/share-cover-fix-report.md`（本文件）

**未修改**：`apps/web/**`、`apps/admin/**`、`packages/**`、`apps/api/src/modules/{trips,media,places,admin}/**`、`trip-cover.service.ts`（无需改参数）、compose/deploy、lockfile、其它 `.audit`。
`share-links.module.ts` 中的 `MediaModule` import 是上一轮 `API_TRIP_MEDIA` 的未提交改动，**不是我改的**，但我的 DI 依赖它（`MediaModule` re-export `MediaUrlModule` → `TripCoverService`）。

---

## 2. 实现摘要（含查询形态）

### 2.1 根因

`loadPublicTrip` 原先只有一条 media 查询：`where: { tripId: trip.id, workspaceId, status: "ready", deletedAt: null }`。
Workspace 级封面（`media.tripId = null`，由 `trip.coverMediaId` 引用）因此永远进不了 `PublicTripBundle.media`，而服务层的封面投影只从 `bundle.media` 取行 ⇒ `cover: null`。
登录态 `TripsService.resolveCovers → TripCoverService.resolve(records, ids => repository.findMediaForCover(workspaceId, ids))` 的 loader 并不按 trip 过滤，所以能看到封面。**两侧规则本来就一致，缺的是公开路径的仓储取数。**

### 2.2 仓储：并入既有查询，无 N+1

仍是一次 `media.findMany`（无第二次查询、无 `findUnique` 补偿）:

```ts
this.prisma.client.media.findMany({
  where: {
    workspaceId: shareLink.workspaceId,
    status: "ready",
    deletedAt: null,
    ...(coverMediaId === null
      ? { tripId: trip.id }
      : { OR: [{ tripId: trip.id }, { id: coverMediaId }] }),
  },
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
});
```

- `workspaceId` / `status` / `deletedAt` 留在**顶层**，因此同时约束两个 `OR` 分支：跨 Workspace、非 `ready`、软删的封面**根本不会被加载**。
- 查询结果拆分：`media` = `tripId === trip.id` 的行（与改动前逐字节一致）；`coverMedia` = 被引用但不在 gallery 里的那一行。
- 没有封面（`coverMediaId === null`）时 `where` **完全等价**于改动前（不加 `OR`），由仓储测试逐字段断言。
- 索引友好：`@@index([tripId, createdAt])` + 主键 `id`，OR 可走 bitmap/index 组合。

**查询次数对比**：每次公开读仍是 1 次 `media` 查询 + 1 次 `entryMedia` 查询（改动前就是这样），没有新增往返。

### 2.3 服务：使用与登录态相同的 projector

```ts
const covers = await this.coverProjector().resolve(
  [{ id: tripId, coverMediaId }],
  async (mediaIds) => coverMediaSources(candidates, mediaIds, workspaceId),
);
return covers.get(tripId) ?? null;
```

- `coverProjector()` = 注入的 `TripCoverService`，缺失时回退 `new TripCoverService(this.mediaUrlSigner())`（与 `MediaService.coverProjector()` 同款写法），因此手工构造的 e2e 仍可编译、运行时行为确定。
- loader **只暴露仓储已经加载的行**（`bundle.coverMedia` + `bundle.media`），并按请求 id 过滤；不会自己发查询，不可能扩大租户边界。
- 语义完全继承 `TripCoverService.resolve`：`ready` + 同 Workspace + (`media.tripId` 为 null **或** == 该 Trip) → `TripCover`；其他情况 `null`。**不伪造 URL**（拿不到签名就 `null`）。
- 额外防御：`coverMediaSources` 要求 `row.workspaceId === trip.workspaceId`，即使未来调用方递进外部行也不会产生跨租户封面（服务层测试覆盖）。
- 响应仍由 `PublicTripResponseSchema.parse`（`.strict()`）收口：`bucket` / `key` / `variants` 无字段可落，测试对序列化结果做了 `/bucket|variants|"key"/` 与 bucket 名的双重断言。
- 未改动分享链接的密码 / 过期 / 撤销 / `recordAccess` 逻辑（`readPublic` 前半段一字未改，既有 e2e 4 tests 仍绿）。

### 2.4 不回归

- 公开 `media` 数组仍是「挂在该 Trip 的 ready 媒体 ∪ 该 Trip 各 entry 的 ready 媒体」，**Workspace 级封面不会被塞进 gallery**（登录态 `GET /trips/:id/media` 同样只列 `tripId` 命中的媒体，保持一致）。
- `stops` / `entries` / `budget` 投影与未 ready 过滤逻辑未变；`public-payload.spec.ts` 原 5 个断言（含签名调用次数 `calls.sort()`）全绿。

---

## 3. 验证命令与结果

```bash
# 1) 类型检查
pnpm --filter @roamlog/api typecheck
# -> $ tsc --noEmit
# -> [exit code: 0]（0 错误）

# 2) 目标测试
pnpm --filter @roamlog/api exec vitest run src/modules/share-links src/modules/media
# -> ✓ src/modules/share-links/__tests__/share-links.module.spec.ts (1 test)
# -> ✓ src/modules/media/__tests__/media-read.spec.ts (11 tests)
# -> ✓ src/modules/share-links/__tests__/public-cover.spec.ts (11 tests)
# -> ✓ src/modules/share-links/__tests__/public-payload.spec.ts (5 tests)
# -> ✓ src/modules/media/__tests__/media-rules.spec.ts (4 tests)
# -> ✓ src/modules/share-links/__tests__/public-trip-bundle.spec.ts (11 tests)
# -> ✓ src/modules/media/__tests__/media-url.service.spec.ts (8 tests)
# -> ✓ src/modules/media/__tests__/trip-cover-projection.spec.ts (8 tests)
# -> Test Files  8 passed (8)
# -> Tests  59 passed (59)

# 3) 跨 Agent 共享的 e2e（手工构造 5 参数的 ShareLinksService，不可由我修改）
pnpm --filter @roamlog/api exec vitest run test/collab-share.e2e-spec.ts
# -> Test Files  1 passed (1) / Tests  4 passed (4)

# 4) 静态检查（附加）
pnpm exec eslint src/modules/share-links            # [exit code: 0]，无告警
pnpm exec prettier --check <我新增/改动的文件>        # 新增文件已格式化；repository/service/spec 在 HEAD 或上一轮就已不符合 prettier，未做整文件重排以免制造无关 diff
```

### 覆盖的场景（对应任务清单）

| 要求 | 覆盖测试 |
| --- | --- |
| Workspace 级 ready 封面（tripId = null）→ 公开 `cover` 非空且含签名 URL | 仓储 `loads a Workspace-level cover in the same media query…`；服务 `projects a Workspace-level cover…`（断言 url/thumbUrl/expiresAt/宽高/blurhash） |
| Trip 级 ready 封面 → 同上 | 服务既有 `projects a ready cover of the same trip…`；仓储 `keeps a trip-attached cover inside the gallery…` |
| 封面属另一个 Workspace → `cover: null` | 仓储 `never loads a cover row owned by another Workspace`；服务 `refuses a cover row from another Workspace…` |
| 封面 `processing` / `failed` → `cover: null` | 仓储 `never loads a %s cover`（processing/failed/pending）；服务 `reports a null cover when the cover media is %s` |
| 封面媒体已软删 → `cover: null` | 仓储 `never loads a soft-deleted cover`（软删过滤在仓储层，与登录态 `findMediaForCover` 的 `deletedAt: null` 同层） |
| 响应 JSON 不含 `bucket`/`key`/`variants` | 服务 `keeps storage coordinates out of the public cover`（含精确 key 集合断言） |
| 无封面时 `cover: null` 且其余字段正常（不 500） | 服务 `still answers the rest of the share…` / `emits durationDays and a null cover…`；仓储 `survives a stale cover reference…` |
| 查询形态（无 N+1、并入既有查询） | 仓储对 `media.findMany` **调用次数 = 1** 与 `where` 逐字段断言 |
| DI 装配（新构造参数真的接上） | `share-links.module.spec.ts` 编译 `AppModule` 并 resolve `ShareLinksService` / `ShareLinksRepository` / `TripCoverService` |

---

## 4. CodeGraph 证据

```bash
codegraph status
# 初始: Pending Changes: Added 5 / Modified 26  →  codegraph sync（31 文件 / 1,097 节点 / 4.2s）
# 之后: [OK] Index is up to date（改动落盘后仍在本次会话内保持 up to date）

codegraph explore "ShareLinksRepository loadPublicTrip PublicTripBundle ShareLinksService publicPayload TripCoverService resolve"
# -> 70 symbols / 6 files
#    publicPayload (share-links.service.ts:202) — 1 caller
#    loadPublicTrip (share-links.repository.ts:115) — 1 caller（readPublic）
#    TripCoverService 12 callers（media-url.module / media.service / trips.service）
#    tested via: share-links/__tests__/public-cover.spec.ts, public-payload.spec.ts, test/collab-share.e2e-spec.ts
#    → 证明 blast radius 仅限 public share 读路径，未触及 trips/media 的登录态投影

codegraph explore "ShareLinksRepository loadPublicTrip coverMedia resolveCover coverMediaSources TripCoverService resolve publicPayload"
# -> 45 symbols / 4 files，改动后的调用链：
#    publicPayload → resolveCover → coverCandidates / coverMediaSources / coverProjector
#    coverProjector → TripCoverService（instantiates）
#    loadPublicTrip → loadBudget；readPublic → loadPublicTrip
#    CoverMediaSource → MediaUrlSource（extends）
```

结论：改动集中在 `share-links` 模块的 public read 路径；`TripCoverService.resolve` 的既有调用方（`trips.service.ts` × 2）行为未变。

---

## 5. 已知风险

1. **Web 侧仍不渲染封面（用户可见症状不会仅凭本修复消失）** —— 高优先级交接项。
   `/share/[token]` → `PublicSharePage` → `ShareArticle`（`apps/web/components/share/share-article.tsx:45`）的 hero 使用 `coverClassForTrip(tripIndex)` 渐变占位，**从不读取 `trip.cover.url`**。
   登录态是读的（`trip-card.tsx:21`、`atlas-workspace.tsx:454`、`dashboard-page.tsx:71` 都用 `cover?.url ?? cover?.thumbUrl`）。
   即：后端现在已正确返回 `cover`，但匿名页仍显示渐变块。`apps/web/**` 不在我的可写范围，需要单独的 web 任务。
2. 封面若同时是 trip 级媒体，会被签两次（gallery 一次 + projector 一次）。`getSignedUrl` 是本地 HMAC，无网络/DB 开销，可接受；如未来要求严格单次签名，可让 projector 复用已签名视图（不建议现在做）。
3. `cover` 的 `expiresAt` 与 `media` 数组同一条目的 `expiresAt` 可能相差毫秒（两次签名）；契约不要求一致。
4. `TripCoverService.resolve` 只校验 `tripId`（不校验 `workspaceId`）；跨租户由**仓储查询**保证，服务层另有 `workspaceId` 防御校验。若未来把 projector 用到别的 loader，仍需保持「loader 按 Workspace 取数」的契约（已在 `trip-cover.service.ts` 的 `CoverMediaLoader` 注释中写明，未改该文件）。
5. `publicPayload` 从同步变为 `async`（内部私有方法），`readPublic` 已 `await`；无其它调用方（CodeGraph 确认 1 caller）。

---

## 6. 未覆盖项

- **未跑真实 PostgreSQL 全量测试**（按任务分工由根 Agent 串行执行：`127.0.0.1:55442 / roamlog_g1`）。
- 未跑 `build`（按要求）。
- 未做浏览器/视觉验证（`apps/web` 渲染缺口未修，现在截图无法证明封面可见）。
- 未验证真实 S3/MinIO 签名（测试用 `StorageService` stub，与既有测试一致）。
- 未新增 Prisma 迁移 / 契约变更（不需要）。
- `prettier --check` 对 `share-links.repository.ts` / `share-links.service.ts` / `share-link-tenant.guard.ts` 报 warn，但 HEAD 版本同样不达标（属既有状态，未做整文件重排）。

---

## 7. 建议的下一步

1. **根 Agent 跑真实 PG 全量确认**：`pnpm --filter @roamlog/api test`（含 `test/**/*.e2e-spec.ts`，会用 `test-app.ts` 编译 `AppModule`，可再次验证 DI）。
2. **开一个 web 任务（必要，否则用户看不到修复效果）**：`apps/web/components/share/share-article.tsx` 的 hero 改为渲染 `trip.cover?.url ?? trip.cover?.thumbUrl`（与 `trip-card.tsx` 一致），保留无封面时的现有渐变作为 fallback；`share.test.tsx` 增加「有 cover 渲染 `<img>` / 无 cover 保持渐变」的用例。注意 `WEB_TRIP_FORM` / `WEB_TRIP_WORKSPACE` 正在改 `apps/web`，需排队避免冲突。
3. 可选后续（非本任务）：公开分享页的 `media` gallery 与封面去重展示、`allowIndex`/`showBudget` 的产品行为复核。