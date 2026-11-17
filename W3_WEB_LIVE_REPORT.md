# W3-WEB-LIVE Report

状态: DONE
任务 ID: W3-WEB-LIVE

## 变更文件

- `apps/web/lib/api.ts`（删除，拆分为 `lib/api/**`）
- `apps/web/lib/api/errors.ts`（ApiError、401/403/409 判断、Problem Details 解析）
- `apps/web/lib/api/types.ts`（统一 DataAdapter 契约）
- `apps/web/lib/api/shared.ts`（生成 client 响应解包与契约校验）
- `apps/web/lib/api/mock.ts`（mock adapter，仍然走 MSW 边界）
- `apps/web/lib/api/real.ts`（真实 API adapter，消费 `@roamlog/api-client` generated endpoints）
- `apps/web/lib/api/index.ts`（按数据模式选择 adapter）
- `apps/web/lib/api/auth.ts`（Better Auth 登录/注册/验证/重置/登出）
- `apps/web/lib/api/real.test.ts`（live API adapter 冒烟、401、409、数据模式测试）
- `apps/web/lib/data-mode.ts`（`NEXT_PUBLIC_DATA_MODE=mock|api`，默认 `mock`）
- `apps/web/lib/data-provider.tsx`（统一数据 provider，页面只通过 adapter/hooks 取数）
- `apps/web/lib/query.ts`（TanStack Query hooks：me/session/workspaces/trips/entries/itinerary/comments/notifications/activity/search/members/invitations + mutations）
- `apps/web/components/providers.tsx`（QueryClient、401 跳转、Mutation/Query 错误处理、API 模式 SessionBootstrap、MSW 仅 mock/test）
- `apps/web/components/auth/**`（login/register/reset/email-link/invite 接真实 API，mock 模式保持原行为）
- `apps/web/app/(auth)/**`（重置 token、邀请 token、验证/重置 intent）
- `apps/web/app/(app)/w/[workspaceSlug]/journal/journal-live.tsx`（真实 entries、comments、favorite、新建日志）
- `apps/web/app/(app)/w/[workspaceSlug]/{journal,members,activity,notifications,settings,trips/[tripId]}/page.tsx`（mock/api 分派）
- `apps/web/components/trips/trip-detail-live.tsx`（真实 trip、itinerary、entries、版本冲突 UI）
- `apps/web/components/trips/new-trip-page.tsx`、`new-trip-shell.tsx`（API 模式创建旅行）
- `apps/web/components/members/members-live.tsx`（真实成员、角色、移除、邀请、撤销）
- `apps/web/components/activity/activity-live.tsx`（真实 activity）
- `apps/web/components/notifications/notifications-live.tsx`（真实通知、已读、偏好）
- `apps/web/components/settings/settings-live.tsx`（真实个人资料与 Workspace 设置）
- `apps/web/components/app-shell/conflict-dialog.tsx`（409 冲突 Dialog）
- `apps/web/components/app-shell/command-palette.tsx`、`app-shell-view.tsx`（API 模式搜索）
- `apps/web/components/app-shell/user-footer.tsx`（API 模式登出）
- `apps/web/package.json`（声明 `@roamlog/api-client: workspace:*`）

## 实现摘要

- 数据模式：`NEXT_PUBLIC_DATA_MODE` 默认 `mock`；只有显式 `api` 才进入真实 API 分支。当前 3000 mock 预览不使用真实后端，也不会因 API 未启动而破坏。
- mock 模式：保留现有 MSW + fixtures + `localStorage` 预览；MSW 只在 mock 模式且非 production 时启动。
- API 模式：
  - Better Auth session：`/v1/auth/get-session` 通过 `SessionBootstrap` 启动，登录/注册/验证/重置/登出走 Better Auth handler。
  - `/v1/me`、`/v1/me/workspaces`、Workspace、trips、entries、itinerary、comments、notifications、activity、search、members、invitations 全部通过统一 `DataAdapter` + generated client endpoints 接线。
  - 认证成功后进入目标 Workspace；401 由 QueryCache/MutationCache 统一跳转 `/login?next=...`。
  - 编辑旅行/行程使用 `version`；409 `VERSION_CONFLICT` 显示“有人先保存了”Dialog，支持重新加载或覆盖保存。
  - 写作日志会创建 `contentJson`/`contentHtml` 并写入 revision；评论按 `journal_entry` target 接线；Viewer 隐藏写入操作。
  - 搜索命令面板在 API 模式调用 `/v1/workspaces/:id/search`。
- QueryClient 配置：30s staleTime、有限 retry、窗口聚焦刷新、全局 401 处理。
- mock 范围仍保留：map/insights/budget/packing/media/advanced trip tabs 继续使用原型/demo 数据，未在本任务接线。

## 依赖

- 新增 workspace 依赖声明：`@roamlog/api-client: workspace:*`（`apps/web`）。
- 未运行 `pnpm install`；当前工作区已有该 workspace link。
- 无新增第三方依赖。

## 验证命令与结果

```text
pnpm --filter @roamlog/web test
PASS — 9 files / 17 tests

pnpm --filter @roamlog/web typecheck
PASS — Next typegen + tsc --noEmit

pnpm --filter @roamlog/web build
PASS — Next.js 16.4.6，全部 20 条路由生成成功
```

mock 预览健康检查（未停止 3000/3001）：

```text
http://localhost:3000/w/roamlog-crew                 200
http://localhost:3000/w/roamlog-crew/trips           200
http://localhost:3000/w/roamlog-crew/journal         200
http://localhost:3000/w/roamlog-crew/members         200
http://localhost:3000/w/roamlog-crew/activity        200
http://localhost:3000/w/roamlog-crew/notifications   200
http://localhost:3000/w/roamlog-crew/settings        200
http://localhost:3001/admin                          200
```

## 测试覆盖

- 现有 mock 页面测试全部继续通过（8 个原测试文件中的 13 项 + 新增 4 项 = 17）。
- `lib/api/real.test.ts`：
  - 数据模式默认 `mock`，仅显式 `api` 进入 API。
  - live API adapter 冒烟：me、workspaces、trips、trip、itinerary、entries、comments、notifications、activity、search 使用注入的 mock fetch 解析成功。
  - 401 Problem Details → `ApiError(status=401, code=UNAUTHORIZED)`。
  - 409 version conflict → `ApiError(status=409, code=VERSION_CONFLICT)`。

## 已知风险与未覆盖项

- 未对真实 NestJS/PostgreSQL 后端执行端到端 API 模式验收；live 冒烟使用注入 mock fetch，不能宣称真实后端已跑通。
- 邀请预览 API 不存在，邀请页只能显示通用 Workspace 文案；接受后进入 `/`，由当前 Workspace 选择逻辑继续导航。
- Better Auth 2FA challenge、OAuth 按钮、邮件实际投递与退信重试未在本任务接线。
- 日志编辑器仍是轻量纯文本写入，不是 Tiptap；草稿自动保存、revision 恢复、mention 选择器未实现。
- map/insights/budget/packing/photos/media/realtime presence 仍为原型或 demo 路径，不在本任务范围。
- `next-env.d.ts` 会被 `next typegen`/`next build` 自动改写 `.next` 路径；本次已恢复为仓库原有内容，但后续运行类型检查可能再次产生该生成差异。

## 建议下一步

1. 在真实 API/DB 启动后执行一次 API 模式登录 → Workspace → 日志/评论 → 409 冲突的端到端冒烟。
2. 由后续 wave 补齐 Tiptap、revision 恢复、MapLibre、照片上传和实时 presence，并复用当前 adapter/query 层。
3. 为 API 模式增加 Playwright 覆盖：未登录 401 跳转、Viewer 只读、409 Dialog、邀请接受。
