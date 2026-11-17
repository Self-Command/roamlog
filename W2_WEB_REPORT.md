状态: DONE
任务 ID: W2-WEB-PAGES

变更文件:
- `apps/web/app/(app)/w/[workspaceSlug]/journal/page.tsx`
- `apps/web/app/(app)/w/[workspaceSlug]/map/page.tsx`
- `apps/web/app/(app)/w/[workspaceSlug]/insights/page.tsx`
- `apps/web/app/(app)/w/[workspaceSlug]/members/page.tsx`
- `apps/web/app/(app)/w/[workspaceSlug]/activity/page.tsx`
- `apps/web/app/(app)/w/[workspaceSlug]/notifications/page.tsx`
- `apps/web/app/(app)/w/[workspaceSlug]/settings/page.tsx`（新增）
- `apps/web/components/journal/**`（新增日志时间线、筛选、详情 Sheet、评论、新建日志）
- `apps/web/components/trip-detail/**`（新增 8 个 Trip Tabs）
- `apps/web/components/map/**`（新增世界足迹页、SVG 示意地图、列表降级）
- `apps/web/components/charts/insights-workspace.tsx`（新增洞察页）
- `apps/web/components/members/members-workspace.tsx`（新增成员与邀请）
- `apps/web/components/activity/activity-workspace.tsx`（新增活动流）
- `apps/web/components/notifications/notifications-workspace.tsx`（新增通知中心）
- `apps/web/components/settings/settings-workspace.tsx`（新增设置）
- `apps/web/components/trips/trip-detail.tsx`
- `apps/web/components/app-shell/app-shell-nav.ts`
- `apps/web/components/providers.tsx`
- `apps/web/lib/demo-store.tsx`（新增本地演示状态与 localStorage 持久化）
- `apps/web/lib/demo-format.ts`（新增展示格式化）
- `apps/web/test/setup.ts`
- `apps/web/test/demo-render.tsx`
- `apps/web/components/**/*.test.tsx`（新增 7 个测试文件）
- `packages/api-mocks/src/demo-content.ts`（新增契约驱动内容 fixtures）
- `packages/api-mocks/src/fixture-ids.ts`
- `packages/api-mocks/src/fixtures.ts`
- `packages/api-mocks/src/handlers.ts`
- `packages/api-mocks/src/__tests__/fixtures.test.ts`

实现摘要:
- Trip detail 已具备概览、日志、行程、相册、地图、预算、打包、活动 8 个 Tabs。
- 日志页支持搜索、旅行/心情筛选、排序、网格/列表切换、月份时间线、右侧 Sheet 详情、收藏、评论与 `@` 提及成员。
- 行程支持完成勾选、按日期分组、新增 Dialog；预算支持新增花费、分类汇总、预算进度和结算建议；打包支持勾选、新增、全部打包/重置。
- 世界足迹页支持地图/列表切换、搜索、状态/年份筛选、旅行侧栏和工作区统计；地图不可用时列表仍可访问。
- 洞察页覆盖年度旅行、月度支出、分类支出、预算对比、记录热力图和旅行记录。
- 成员页支持成员表、角色修改、移除、邀请 Dialog、待处理邀请撤销与重发反馈；Viewer 写入操作在 Trip 内容中隐藏或禁用。
- 活动、通知、设置均为真实工作型页面；通知支持未读/提及筛选、已读、偏好；设置支持资料、工作区、通知、密度、氛围光、减少动效、导出/重置、设备与快捷键。
- 所有页面使用 seed fixtures + `localStorage` 的可解释本地状态；没有宣称真实 API、认证、数据库、上传、邮件或实时协作。
- 扩充的 MSW fixtures/handlers 全部使用 `@roamlog/contracts` Zod schema，没有手写第二套 API 类型。

新增依赖:
- 无。

验证命令与结果:
- `pnpm --filter @roamlog/api-mocks test`：PASS（1 file / 3 tests）
- `pnpm --filter @roamlog/api-mocks typecheck`：PASS
- `pnpm --filter @roamlog/web test`：PASS（8 files / 13 tests）
- `pnpm --filter @roamlog/web typecheck`：PASS
- `pnpm --filter @roamlog/web build`：PASS（Next.js 16.4.6，全部 Web 路由生成成功）
- 视觉检查（1440 / 390）：无 runtime console errors；桌面 `scrollWidth <= innerWidth`；390px 页面 `scrollWidth === innerWidth`，无横向溢出。

截图/日志/接口证据:
- 视觉 QA 截图保存在仓库外：
  `C:\Users\BY9700\AppData\Local\Temp\roamlog-w2-screenshots\w2`
- 已检查：`journal-1440.png`、`journal-390.png`、`journal-sheet-1440.png`、`trip-budget-1440.png`、`trip-itinerary-390.png`、`map-1440.png`、`map-390.png`、`members-1440.png`、`insights-1440.png`、`notifications-1440.png`、`activity-1440.png`、`settings-390.png`、`dashboard-1440.png`
- 3000 预览服务保持运行；未停止 3000/3001。

未覆盖/风险:
- 页面数据来自 fixtures + `localStorage`，未接真实 API；刷新可解释、设置页可重置，但多人并发与 409 冲突流程未在本任务实现。
- 世界地图是确定性 SVG 示意图，不是 MapLibre；已提供列表降级，但真实瓦片/地理编码待后续接入。
- 相册为本地渐变占位帧，未接 S3 预签名、真实上传或图片变体。
- 日志编辑器是轻量文本 Dialog，不是 Tiptap；草稿自动保存、版本历史和公开分享页未实现（公开分享路由也不在本次可写路径内）。
- 行程拖拽排序、presence/WebSocket 缓存失效和真实通知邮件未接入。

建议下一步:
- 由根 Agent 验收并统一提交 Web 与 api-mocks 变更。
- 在 API 内容链路稳定后，将 `demo-store` 的读取与写入逐项替换为 generated client hooks，同时保留当前 fixtures 作为 MSW 回退。
- 补 MapLibre + 列表双路径 E2E、公开分享页与 Tiptap/版本冲突验收。
