# WEB_TRIP_WORKSPACE — 旅行详情真实工作台

状态: **DONE**
任务 ID: WEB_TRIP_WORKSPACE
完成时间: 2026-11-18T22:55+08:00

---

## 1. 变更文件（严格在授权范围内）

新增 `apps/web/components/trip-workspace/**`（19 个产物）：

| 文件 | 职责 |
|---|---|
| `capabilities.ts` | 角色能力矩阵，直接调用 `@roamlog/contracts` 的 `can(role, action, resource)` |
| `queries.ts` | 作用域查询层：生成 hook 包装 + `{status,data}` 归一化 + 冲突用最新 version 读取 |
| `workspace-context.tsx` | Provider：trip/workspace/role/capabilities + `mutate()`（403/409/网络分流）+ `refresh()` |
| `workspace-header.tsx` | 概览头部：标题/日期/天数/状态/可见性/起点(坐标·国家·时区)/目的地/标签/同行人/预算 vs 已花/封面/操作 |
| `trip-workspace.tsx` | 工作台装配：头部 + Radix Tabs + 删除/复制对话框 + `ConflictDialog` |
| `panel.tsx` | 面板骨架与三态（loading / error+retry / empty） |
| `dialogs.tsx` | `ConfirmDialog` / `DeleteTripDialog`（输入标题确认）/ `DuplicateTripDialog` |
| `money.ts` | minor units 精确格式化（按币种解析小数位）、分币种合计、金额解析 |
| `format.ts` | 日期/分类/provider/媒体状态/分享状态/活动动词文案 |
| `media-urls.ts` | 从 `variants` 容错读取签名 URL（无 URL 不画假图） |
| `member-directory.ts` | `userId → 成员姓名`（未知 id 显示短 id，不编造姓名） |
| `stops-tab.tsx` / `photos-tab.tsx` / `expenses-tab.tsx` / `packing-tab.tsx` / `share-tab.tsx` / `participants-tab.tsx` / `activity-tab.tsx` | 7 个真实 tab |
| `__tests__/{harness,header,mutations,tabs}.test.tsx|harness` | Vitest 套件（fetch 级断言） |

修改：`apps/web/components/trips/trip-detail-live.tsx`（449 行 → 79 行，只做装配）。
**未触碰**：`components/media/**`、`components/trips/trip-form/**`、`components/forms/**`、`lib/**`、`providers.tsx`、`legacy-mock/**`、`apps/api/**`、`apps/admin/**`。

---

## 2. 逐条回答（任务方要求的三件事之外的必答项）

### 2.1 七个 tab：数据来源与空状态文案

| # | Tab | 真实数据来源（hook / 端点） | 空状态文案 | 状态 |
|---|---|---|---|---|
| 1 | 行程 | `useListStops` → `GET /v1/trips/{id}/stops`；写：`useCreateStop`(`POST …/stops`) / `useUpdateStop`(`PATCH /v1/stops/{id}`, 带 version) / `useDeleteStop`(`DELETE /v1/stops/{id}`) | 「还没有行程节点」+ 添加第一个节点 | 已接入 |
| 2 | 照片 | `useListTripMedia` → `GET /v1/trips/{id}/media`；删：`useDeleteMedia`(`DELETE /v1/media/{id}`)；分组按 `date ?? createdAt` | 「这趟旅行还没有照片」 | 列表已接入；**上传未接入** |
| 3 | 费用 | `useListExpenses` → `GET /v1/trips/{id}/expenses`；写：`useCreateExpense`(`POST …/expenses`) / `useDeleteExpense`(`DELETE /v1/expenses/{id}`) | 「还没有记录支出」+ 记第一笔 | 已接入 |
| 4 | 行李 | `useListPacking` → `GET /v1/trips/{id}/packing`；写：`useCreatePackingItem` / `useUpdatePackingItem`(`PATCH /v1/packing/{id}`, 带 version) / `useDeletePackingItem` | 「行李清单还是空的」+ 添加第一件 | 已接入 |
| 5 | 分享 | `useListShareLinks` → `GET /v1/trips/{id}/share-links`；写：`useCreateShareLink`(`POST …/share-links`) / `useRevokeShareLink`(`DELETE /v1/share-links/{id}`) | 「还没有分享链接」+ 创建第一个链接 | 已接入（viewer 整 tab 隐藏） |
| 6 | 参与者 | `useListTripParticipants` → `GET /v1/trips/{id}/participants`；写：`useAddTripParticipant`(`POST …/participants`) / `useRemoveTripParticipant`(`DELETE …/participants/{userId}`) | 「还没有参与者」+ 添加第一位 | 已接入 |
| 7 | 活动 | `useListTripActivity` → `GET /v1/trips/{id}/activity`（50 条，`createdAt:desc`） | 「还没有活动记录」 | 已接入 |

预算 vs 已花不走客户端求和，而是 `useGetBudgetSummary` → `GET /v1/trips/{id}/budget/summary` 的 `originalTotals`（**精确分币种**），并刻意丢弃 `displayTotal`（`approx:true`，属于汇率折算，与本任务「不折算」要求冲突）。

### 2.2 哪些是「未接入」，所需端点

| 项 | 现状 | 需要的端点 / 缺口 |
|---|---|---|
| 照片上传 | 只有列表/分组/删除；无上传入口（不放假按钮） | 已有 `POST /v1/workspaces/{id}/media/presign` + `POST /v1/media/{id}/complete`；缺**通用照片上传 UI**（`components/media` owner 目前只交付了封面 `CoverUploader`） |
| 旅行级评论 | 「未接入」 | 契约 `CommentTargetTypeSchema = journal_entry \| itinerary_item`，**没有 trip 目标类型**；需要新增 `comment target: trip` 或独立 `POST /v1/trips/{id}/comments` |
| 行程节点排序（上移/下移） | 未做 UI | 端点已存在 `POST /v1/trips/{id}/stops/reorder`（`useReorderStops`），本次未接按钮 |
| 邀请「嘉宾」写入 | 只读展示 `trip.guestNames` | 无独立端点；需借 `PATCH /v1/trips/{id}` 的 `guestNames` 字段（编辑页 `WEB_TRIP_FORM` 负责） |
| 编辑旅行表单本体 | 入口指向 `/w/{slug}/trips/{id}/edit` | 该路由页由 `WEB_TRIP_FORM` 交付；若未建则会 404（依赖项，非本任务缺口） |
| 费用「自定义分摊」 | 只做均摊 | 端点支持 `splitMode:"custom"` + 每人 `shareAmountMinor`；报名 UI 未做 |

### 2.3 封面

- 已用 `@/components/media/cover-uploader` 的 `CoverUploader`（`import { CoverUploader } from "@/components/media"`），传入 `workspaceId` + **`trip`**，由组件自己执行 `POST /v1/trips/{id}/cover` 并失效查询。
- 展示完全依赖 **`trip.cover.url` / `trip.cover.thumbUrl`**（服务端签名 URL），前端不拼任何存储路径；`onChange` 只把新 `trip` 写回 `queryKeys.trip(tripId)` 缓存。
- `disabled={!capabilities.setCover}`（viewer 禁用）；`onError` 把组件错误码文案渲染为 `role="alert"`。
- **删除旧假封面**：原实现的 `coverClassForTrip()` 渐变占位已移除，不再用渐变假装有图。

### 2.4 是否都是真实 mutation（端点清单）

| 操作 | 是否真实 | 端点 / body |
|---|---|---|
| 旅行删除（输入标题二次确认） | 是 | `DELETE /v1/trips/{id}`；成功后 `router.push('/w/{slug}/trips')` |
| 旅行复制 | 是 | `POST /v1/trips/{id}/duplicate`，body `{title?}`（留空则服务端决定） |
| 行程节点增/改/删 | 是 | `POST /v1/trips/{id}/stops` · `PATCH /v1/stops/{id}` `{version,…}` · `DELETE /v1/stops/{id}` |
| 费用增/删 | 是 | `POST /v1/trips/{id}/expenses` `{date,category,note,amountMinor,currency,paidById,splitMode,participants}` · `DELETE /v1/expenses/{id}` |
| 行李增/勾选/删 | 是 | `POST /v1/trips/{id}/packing` · `PATCH /v1/packing/{id}` `{version,packed}` · `DELETE /v1/packing/{id}` |
| 分享创建/撤销 | 是 | `POST /v1/trips/{id}/share-links` `{password?,expiresAt,showBudget,allowIndex}`（201 返回的 `url` 直接展示，**不拼域名**） · `DELETE /v1/share-links/{id}` |
| 参与者增/删 | 是 | `POST /v1/trips/{id}/participants` `{userId}` · `DELETE /v1/trips/{id}/participants/{userId}` |
| 照片删除 | 是 | `DELETE /v1/media/{id}` |

生成客户端不抛 4xx：所有写操作都过 `assertMutationOk()`，把 `status>=400` 转成真实 `ApiError`，**不会把失败当成功**。

### 2.5 409 版本冲突 → ConflictDialog

- 已接既有 `@/components/app-shell/conflict-dialog`（`ConflictDialog`），渲染在工作台壳层。
- 带 version 的 PATCH：`PATCH /v1/packing/{id}`（勾选）、`PATCH /v1/stops/{id}`（编辑）。
- 「覆盖保存」先 `listStops/listPacking` 读**最新 version** 再重试（`latestStopVersion` / `latestPackingVersion`），读不到就中止，不猜 version、不静默覆盖。「重新加载」= 放弃本地改动并刷新。
- 测试名（`__tests__/mutations.test.tsx`）：
  - `409 打开 ConflictDialog；覆盖保存先读最新 version 再重试，不静默覆盖`
  - `编辑节点：PATCH /v1/stops/{id} 携带 version 与改动字段`
  - `勾选：PATCH /v1/packing/{id} 携带当前 version`

### 2.6 角色权限矩阵（来自 `packages/contracts/src/permissions.ts` 的 `can()`）

| 能力 | viewer | editor | admin | owner | 禁用时提示 |
|---|---|---|---|---|---|
| 读 行程/照片/费用/行李/参与者/活动 | ✅ | ✅ | ✅ | ✅ | — |
| **读 分享链接**（`share-link:read` 属 contentWriteActions） | ❌ | ✅ | ✅ | ✅ | 分享 tab 整个隐藏 + `ShareTab` 内置「当前角色不能查看分享链接」兜底 |
| 编辑旅行 / 复制旅行 | ❌ | ✅ | ✅ | ✅ | `title="Viewer 只能阅读和评论，不能编辑旅行"` |
| 删除旅行（`trip:delete` 属 contentWriteActions） | ❌ | ✅ | ✅ | ✅ | 同上（按契约，editor 即可删；未擅自收紧） |
| 行程节点 增/改/删 | ❌ | ✅ | ✅ | ✅ | `title="Viewer 只能阅读和评论，不能添加/编辑/删除行程节点"` |
| 费用 增/删 | ❌ | ✅ | ✅ | ✅ | 同上 |
| 行李 增/改/删 | ❌ | ✅ | ✅ | ✅ | 同上 |
| 照片 删除 | ❌ | ✅ | ✅ | ✅ | 同上 |
| 封面 设置 | ❌ | ✅ | ✅ | ✅ | `CoverUploader disabled` |
| 分享 创建/撤销 | ❌ | ✅ | ✅ | ✅ | 同上 |
| 参与者 增/删 | ❌ | ✅ | ✅ | ✅ | 同上 |

说明：`admin/owner 更多` 在该契约里只体现为 `workspace:update`、`member:*`、`invitation:create-admin` 等**工作区级**动作，本工作台不涉及；旅行内容写入（trip/stop/expense/packing/share-link）在 `contentWriteActions` 里对 editor 起全部开放。**没有伪造更严格的限制**。每个禁用控件都带 `title` 原因（测试断言 `getAttribute("title")` 含「Viewer 只能阅读和评论」）。

### 2.7 是否断言不含 fixture 特征

是。`__tests__/tabs.test.tsx` 的 `工作台渲染结果不含 demo-store / fixture 特征` 断言 `container.textContent` 不含：`林知夏`、`¥18,800`、`demo-store`、`fixtures`、`MSW`。
另：全仓 fixture 边界守卫 `components/__tests__/no-fixtures-in-api-mode.test.tsx` 5/5 通过（我的目录没有静态 import `@/lib/demo-store` 或 `@roamlog/api-mocks`）。

### 2.8 未做项

1. 照片上传入口（等通用上传组件）。
2. 旅行级评论（契约缺 target 类型）。
3. 行程节点上移/下移（`useReorderStops` 未接按钮）。
4. 费用自定义分摊、收据附件（`receiptMediaId` 未做 UI）。
5. 行李 bulk/reorder/指派（`assigneeId` 只读展示）。
6. 分享链接「已存在链接复制」：**契约不返回 token/url**（只有创建响应带一次），故列表行只提供撤销，创建后提供复制。
7. 视觉/响应式实机截图：按任务要求**未启动 dev server、未跑 build**，因此无 390/820/1440 实机截图（见风险）。

---

## 3. 验证命令与结果

```bash
# 1) CodeGraph 门禁
$ codegraph status
[OK] Index is up to date   # Files 1,459 / Nodes 22,423 / Edges 49,126

# 2) 类型
$ pnpm --filter @roamlog/web typecheck
$ next typegen && tsc --noEmit
✓ Types generated successfully          # 0 error（无输出即 0）

# 3) 指定测试
$ pnpm --filter @roamlog/web exec vitest run components/trip-workspace components/trips
✓ components/trips/trips-library.test.tsx (4 tests)
✓ components/trip-workspace/__tests__/tabs.test.tsx (12 tests)
✓ components/trip-workspace/__tests__/mutations.test.tsx (11 tests)
✓ components/trip-workspace/__tests__/header.test.tsx (4 tests)
Test Files  4 passed (4)
     Tests  31 passed (31)

# 4) fixture 边界守卫
$ pnpm --filter @roamlog/web exec vitest run components/__tests__/no-fixtures-in-api-mode
Test Files  1 passed (1)   Tests  5 passed (5)

# 5) lint（仅我的文件）
$ cd apps/web && pnpm exec eslint -c ../../eslint.config.mjs components/trip-workspace components/trips/trip-detail-live.tsx
SCOPED_LINT_EXIT=0          # 输出为空

# 6) 全仓 web lint（CI quality gate）
$ pnpm --filter @roamlog/web lint
FULL_LINT_EXIT=1
✖ 2 problems (2 errors, 0 warnings)
  components/app-shell/topbar-members.tsx:62   @next/next/no-img-element 规则未注册
  components/trips/trip-form/currencies.ts:86  no-useless-assignment
```

**全仓 lint 剩余 2 条 error 都不在我可写范围内，且与我已修掉的两条是同一类缺陷：**

| 文件 | 错误 | 修法 | owner |
|---|---|---|---|
| `apps/web/components/app-shell/topbar-members.tsx:62` | `@next/next/no-img-element` 规则未注册（disable 注释引用未注册规则） | 删掉该行 `// eslint-disable-next-line @next/next/no-img-element`，保留原生 `<img>` | app-shell owner |
| `apps/web/components/trips/trip-form/currencies.ts:86` | `no-useless-assignment`（`name` 赋值未被后续使用） | 去掉无用初值赋值（参照 `money.ts` 里 `let digits: number;` 的写法） | `WEB_TRIP_FORM` |

我的两个文件已按同样方式修好并验证：`photos-tab.tsx` 删除了 disable 注释（改为普通说明注释），`money.ts` 用 `let digits: number;` 去掉无用赋值；`components/trip-workspace/**` 的 lint 输出为空。

测试覆盖清单（31 条中的关键项）：
- 7 tab 真实渲染 + 空状态 + 错误三态：`清洗寺/京都/护照/地铁票`、`还没有行程节点`、`还没有记录支出`、`这趟旅行还没有照片`、`行李清单还是空的`、`行程节点读取失败`+`重试`
- 多币种不折算：`按币种分别合计，不合并、不折算`、`预算与已花按币种分别展示，不折算、不合并`
- 真实 mutation 参数：`记一笔…minor units`、`删除：DELETE /v1/expenses/{id}`、`添加参与者…{userId}`、`创建：POST 带密码与过期时间`、`撤销：DELETE /v1/share-links/{id}`、`删除需要输入标题确认…`、`复制：POST …/duplicate`、`勾选…version`、`编辑节点…version`
- 409：见 §2.5 三个测试名
- 权限：`viewer 看不到分享链接，也不发请求`、`viewer 的写操作按钮被禁用并给出 title 原因`、`viewer 的编辑/删除/复制按钮禁用并写明原因`
- 封面/编辑入口：`封面用服务端签名 URL 渲染，编辑入口指向 edit 路由`（断言 `img[alt="当前旅行封面"]` 的 `src === trip.cover.url`，且 `href=/w/{slug}/trips/{id}/edit`）
- fixture 边界：见 §2.7

---

## 4. 截图 / 日志 / 接口证据

- 无截图：任务明确要求「不启动 dev server、不跑 build（G3 统一）、不连生产」，故未做实机视觉复核。
- 接口证据来自测试里 fetch 级断言（真实 URL + 真实 JSON body），例如：
  - `DELETE /v1/trips/0198f000-…-d1` → `router.push("/w/roamlog-crew/trips")`
  - `POST /v1/trips/…/duplicate` body `{"title":"京都慢行 副本"}`
  - `POST /v1/trips/…/expenses` body `{"amountMinor":8850,"currency":"CNY","splitMode":"equal","participants":[{"userId":…}]}`
  - `PATCH /v1/packing/…` body `{"version":3,"packed":true}`；409 后覆盖保存为 `{"version":7,"packed":true}`

---

## 5. CodeGraph 证据

```
$ codegraph status
[OK] Index is up to date    (Files 1,459 / Nodes 22,423 / Edges 49,126；期间自动同步 9 个改动文件)

$ codegraph explore "TripDetailLive useGetTrip useUpdateTrip expenses packing entries media shareLinks trip-detail tabs"
命中：apps/web/components/trips/trip-detail-live.tsx（原 449 行唯一实现）、
packages/api-client/src/generated/endpoints/{trips,media}（useGetTrip/useUpdateTrip/useListTripMedia 真实 hook）、
packages/contracts/src/entities/{trip,stop,expense,packing,media,share-link}.ts、
legacy-mock/trip-detail/trip-detail.tsx（blast radius：旧 mock tab 外壳）

$ codegraph explore（二次确认）→ packages/api-client/src/generated/endpoints/{stops,expenses,packing,share-links,participants,budget}
```

---

## 6. 已知风险

1. **契约与实现不一致（需后端确认）**：`GET /v1/trips/{id}/media` 的 OpenAPI 类型是 `MediaPage`（`MediaSchema` 无 `url` 字段），但 API 实现（`apps/api/src/modules/media/media.presenter.ts`）把签名 URL 塞进 `variants`。`media-urls.ts` 同时兼容 `thumbUrl/url` 与 `variants.*.url`；两者都没有时显示真实状态、绝不画占位图。`API_TRIP_MEDIA` 正在改该模块，若形态变化，照片 tab 会退化为「暂无签名预览地址」而不报错。
2. **`lib/query.ts` 缺域 hook**：stops/expenses/packing/media/share-links/participants/budget 无 hook 且该文件非我所有，故在 `components/trip-workspace/queries.ts` 自建作用域层（直接用生成 hook）。建议 owner 合并进 `lib/query.ts`，避免两套键命名。
3. **生成客户端不抛 4xx**：已用 `assertMutationOk` + `settle()` 兜住；任何后续新增调用必须走同样路径，否则会把 `403` 当数据渲染。
4. **分享已存在链接不可复制**：契约只在创建响应返回 `token/url`，列表不返回（安全设计），故列表行只有撤销。
5. **编辑页依赖**：`/w/{slug}/trips/{id}/edit` 由 `WEB_TRIP_FORM` 交付；页面未建时按钮会 404。
6. **无实机视觉验证**：响应式为静态保障（Radix Tabs 容器 `overflow-x-auto` + `w-max min-w-full`、grid 断点 `sm/xl`、flex 子项 `min-w-0`、图片 `aspect-[4/3]`+`object-cover`），未在 390/820/1440 实机截图确认。
7. `trip:delete` 对 editor 开放是契约现状（`permissions.ts:292`），未擅自收紧；若产品要收紧需改契约。
8. **CI lint gate 仍为红（exit 1）**，但剩下的 2 条 error 在 `components/app-shell/topbar-members.tsx` 与 `components/trips/trip-form/currencies.ts`，属其他 Agent 的文件，我无权修改；修法已在 §3 表中给出（各 1 行）。

---

## 7. 建议的下一步

1. 让 `API_TRIP_MEDIA` 明确媒体列表契约（把签名 URL 写进 OpenAPI，或用 `GET /v1/media/{id}` 逐个取），前端按最终契约收紧 `media-urls.ts`。
2. 由 `lib/query.ts` owner 吸收 `trip-workspace/queries.ts` 的 7 个域 hook，统一 `queryKeys`。
3. 补照片上传（复用 presign/complete 链路，等同 `CoverUploader` 的 `size="photo"` 变体）。
4. 契约层新增旅行级评论目标（`trip`）后补评论 tab。
5. 接 `useReorderStops` 的拖动/上移下移，完成「行程顺序」闭环。
6. G3 统一阶段做 390/820/1440 实机截图 + 键盘 Tab/方向键走查（Radix Tabs 已原生提供 `aria-selected` 与方向键切换）。