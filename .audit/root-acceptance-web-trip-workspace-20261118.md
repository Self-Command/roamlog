# 根 Agent 验收记录 — WEB_TRIP_WORKSPACE

任务 ID: WEB_TRIP_WORKSPACE
验收结论: **ACCEPT（条件：照片上传/旅行评论/reorder 未接，逐项有端点清单）**
时间: 2026-11-18 23:05

## 通过

### 7 个 tab 全部接真实端点（不是 mock）

| tab | 读 | 写 | 空状态 |
|---|---|---|---|
| 行程 | `GET /v1/trips/{id}/stops` | `POST …/stops`、`PATCH /v1/stops/{id}`+version、`DELETE` | 「还没有行程节点」+ 添加 |
| 照片 | `GET /v1/trips/{id}/media` | `DELETE /v1/media/{id}` | 「这趟旅行还没有照片」 |
| 费用 | `GET …/expenses` | `POST`、`DELETE /v1/expenses/{id}` | 「还没有记录支出」 |
| 行李 | `GET …/packing` | `POST`、`PATCH`+version、`DELETE` | 「行李清单还是空的」 |
| 分享 | `GET …/share-links` | `POST`（201 返回 `url` 直接用，不拼域名）、`DELETE` | 「还没有分享链接」 |
| 参与者 | `GET …/participants` | `POST`、`DELETE …/participants/{userId}` | 「还没有参与者」 |
| 活动 | `GET …/activity`（50 条倒序） | — | 「还没有活动记录」 |

### 封面（我已要求，已落实）
`import { CoverUploader } from "@/components/media"`，传 `workspaceId` + **`trip`**；组件自己 `POST /v1/trips/{id}/cover` 并失效缓存；展示只用 **`trip.cover.url/thumbUrl`** 签名 URL，不拼存储路径；`onChange` 写回 `queryKeys.trip`；**原 `coverClassForTrip()` 渐变假封面已删除**。

### 预算语义正确（这个判断值得记）
用 `GET /v1/trips/{id}/budget/summary` 的 `originalTotals`（精确分币种），**刻意丢弃 approx 的 `displayTotal`** —— 因为汇率折算与「多币种不折算」的要求冲突。这是主动拒绝了一个看似方便但会造假的字段。

### 409 / 权限 / fixture
- 409 接既有 `ConflictDialog`；带 version 的 PATCH = 行李勾选 + 行程节点编辑；「覆盖保存」先读最新 version 再重试，读不到即中止（不静默覆盖）。三条测试名具体可查。
- 角色矩阵**源自 contracts 的 `can()`，未自创**：viewer 连 `share-link:read` 都没有 → 分享 tab 整个隐藏；所有写操作对 viewer 禁用且每个控件带 `title` 原因；未伪造更严限制。
- fixture 断言：渲染结果不含 `林知夏`/`¥18,800`/`demo-store`/`fixtures`/`MSW`。

### 验证
- `web typecheck` → **0 error**
- `vitest run components/trip-workspace components/trips` → **4 files / 31 tests 通过**；fixture 守卫 5/5
- scoped eslint（自己的工作台文件 + `trip-detail-live.tsx`）→ **exit 0**

## 条件项（逐项有端点，非阻塞）

| 未接入 | 所需能力 |
|---|---|
| 照片上传 | 通用上传 UI（端点已有 `presign` + `complete`；`components/media` 当前只交付封面组件） |
| 旅行级评论 | **契约无 trip 目标**（`CommentTargetTypeSchema = journal_entry\|itinerary_item`），需新增 trip comment 目标/端点 |
| 行程 reorder 按钮 | 端点已有 `POST …/stops/reorder`（`useReorderStops`），仅未接 UI |
| 费用自定义分摊 / 收据附件 | 端点支持，未做 UI |
| 邀请嘉宾写入 | 无独立端点（走 `PATCH /v1/trips/{id}` 的 `guestNames`） |
| 编辑页本体 | 依赖 `WEB_TRIP_FORM` 交付的 `trips/[tripId]/edit`（已建） |

## 风险（我评估后接受，但记录）

1. **media 列表契约与实现不一致**：`MediaPage` 用 `MediaSchema`（**含 `bucket`/`key`/原始 `variants`**），而实现把签名 URL 塞进 `variants`（`presentMedia` 的 `variantUrls`）。Agent 做了双形态容错。
   → **这是真实的契约/实现漂移**：`GET /v1/trips/{id}/media` 等**已认证**列表端点仍返回 `bucket` + `key` + 原始 variants，与「单媒体读已彻底移除 bucket/key」的处置不一致。属 P1 信息暴露债（非阻塞，因需改契约+重生成）。已入待办。
2. `lib/query.ts` 缺 7 个域 hook，Agent 自建 `trip-workspace/queries.ts`。建议后续合并到 `lib/query.ts`（收敛，非缺陷）。
3. 全仓 lint 仍红 2 条，均在他人文件（`topbar-members.tsx:62`、`trip-form/currencies.ts:86`），已分别派单修复；其自己目录 scoped lint 为 0。

## 未覆盖

实机截图（按指令未启动 dev server / 未 build）→ G3 由我统一补。