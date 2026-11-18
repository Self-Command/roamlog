# legacy-mock — 演示专用代码边界

这个目录存放 **只在 mock（演示）模式下运行的旧版界面**。它依赖 `apps/web/lib/demo-store.tsx`
（fixture + localStorage 状态）以及 `@roamlog/api-mocks` 的种子数据，**不是生产代码**。

## 硬性规则

1. **不得被生产路由静态 import。**
   - 唯一允许的加载路径：`apps/web/components/providers.tsx` 中的 `next/dynamic`，
     且必须同时受 `DATA_MODE === "mock"` 与 `process.env.NODE_ENV !== "production"` 门控。
   - 路由页只能用 `next/dynamic` + `DATA_MODE` 分支引用本目录；`api` 分支必须渲染真实组件
     （或当真实组件尚不存在时渲染 `EmptyState`，禁止用演示数据伪造）。
2. **不得作为生产依赖。** 生产组件（`*-live.tsx`、`components/app-shell/**` 等）不允许 import 本目录。
3. `pnpm --filter @roamlog/web build` 配合 `NEXT_PUBLIC_DATA_MODE=api` 后，构建产物中不得出现
   `demoFixtureState`、`api-mocks`、`林知夏` 等 fixture 特征串；由
   `components/__tests__/no-fixtures-in-api-mode.test.tsx` 在 CI 中静态守护。

## 目录内容

| 路径                          | 说明                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `trip-detail/trip-detail.tsx` | 旧版旅行详情（8 个 mock tab 外壳），原 `components/trips/trip-detail.tsx`                     |
| `trip-detail/*-tab.tsx`       | activity / budget / itinerary / journal / overview / packing / photos / trip-map 演示 tab     |
| `share/demo-share.ts`         | 演示分享链接解析（直接读 `@roamlog/api-mocks/fixtures`），原 `components/share/demo-share.ts` |
| `mock-root.tsx`               | 演示边界入口：`DemoDataProvider` + MSW 启动，供 `providers.tsx` 懒加载                        |

### 不在此目录的文件

- `components/trip-detail/entry-revision-list.tsx` **没有移动**：它是无 fixture 的纯展示组件，
  且被生产 `components/journal/journal-editor-sheet.tsx`（`journal-live.tsx` 使用）静态引用。
  移动它会打断生产日志页，因此保留原地。

## 删除计划

- `trip-detail/**` 与 `share/demo-share.ts`：等 `WEB_TRIP_WORKSPACE` 用真实 tab（真实 API + 上传 + 预算）
  替换后 **整体删除本目录**。
- `mock-root.tsx`、`providers.tsx` 的 mock 分支、`lib/demo-store.tsx`、`lib/msw.ts`：等演示模式
  正式下线时一并删除，同时移除 `@roamlog/api-mocks` 依赖。

## 仍然在边界外的 mock 模块（待后续任务迁入）

下列文件仍然静态 import `@/lib/demo-store`，但已经只通过路由页的 `next/dynamic` 懒加载，
不在 api 构建的入口图里。它们应由对应 owner 迁入本目录或改造成真实组件：

- `components/journal/journal-workspace.tsx`、`journal-compose-dialog.tsx`、`journal-entry-sheet.tsx`
- `components/members/members-workspace.tsx`
- `components/notifications/notifications-workspace.tsx`
- `components/settings/settings-workspace.tsx`
- `components/activity/activity-workspace.tsx`

`components/__tests__/no-fixtures-in-api-mode.test.tsx` 里的 `KNOWN_LEGACY_VIOLATIONS` 记录了这份清单；
每迁移一个文件，该清单必须同步收缩。
