# W4-EDITOR 交付报告

状态：DONE

任务 ID：W4-EDITOR

## 变更文件

新增：

- `apps/web/components/journal/journal-editor.tsx`
- `apps/web/components/journal/journal-editor-sheet.tsx`
- `apps/web/components/journal/journal-comments.tsx`
- `apps/web/components/journal/journal-repository.ts`
- `apps/web/components/trip-detail/entry-revision-list.tsx`
- `apps/web/components/journal/journal-editor.test.tsx`
- `apps/web/components/journal/journal-editor-sheet.test.tsx`
- `apps/web/components/journal/journal-repository.test.tsx`

修改：

- `apps/web/components/trip-detail/journal-tab.tsx`
- `apps/web/components/journal/journal-workspace.tsx`
- `apps/web/app/(app)/w/[workspaceSlug]/journal/journal-live.tsx`
- `apps/web/package.json`（仅新增 Tiptap 依赖；Map/2FA 并行任务的其他依赖不属本任务）

未修改：`components/map/**`、MapLibre 相关文件、auth、Admin、API、Worker、root config、`pnpm-lock.yaml`。未执行 `git commit`，未停止 3000/3001。

## 实现摘要

- Tiptap 3.34.0 编辑器：标题/正文、粗体、斜体、无序/有序列表、引用、代码块、链接、图片占位、撤销/重做。
- 工具栏使用原生 button、`aria-label`、`aria-pressed`、焦点环和 `role="toolbar"`，支持键盘操作。
- 5 秒自动保存、表单失焦保存、手动保存；保存中/成功/失败/重试状态可见。
- 本地草稿按日志写入 `localStorage`，重新打开时可恢复；离开页面前有 `beforeunload` 提醒。
- 409 `VERSION_CONFLICT` 复用现有 `ConflictDialog`：重新加载最新版本或覆盖保存；覆盖保存会先取最新 version，再以新版本写入。
- 保存使用同步 ref 锁，避免失焦与提交同时触发重复保存；冲突期间失焦不会再次发起保存。
- revision 历史与恢复：API 模式调用真实 `listEntryRevisions` / `restoreEntryRevision`；mock 模式使用本地快照。
- 评论 Sheet：读取 comments API 或 mock store，支持 `@` 提及成员并把 `mentionUserIds` 写入评论请求/mock comment。
- API 模式已接入真实 entries/revisions/comments 端点；mock 模式保留本地演示，评论/收藏/新建/编辑/恢复均可操作。
- 日志列表、旅行详情日志 Tab、全部日志页均复用同一编辑器 Sheet；Viewer 只读正文但可评论。

## 可访问性回归修复

Playwright `e2e/web/trips.spec.ts` 报告旅行详情日志行存在 `<button>` 嵌套 `<button>`。已将 `TripJournalTab` 日志行改为：

- 外层 `<article>`，不承担点击交互；
- 主内容使用独立 `<button>`，覆盖缩略图、标题、日期与摘要；
- 收藏按钮为兄弟节点，保留 `aria-label`、`aria-pressed` 和禁用状态；
- 主按钮保留 `focus-visible` 焦点环，键盘与屏幕阅读器可达。

修复后 `pnpm exec playwright test --project=web` 全绿。

## 验证命令与结果

最终复验（2026-11-17 20:49–20:50，当前工作区，无网络依赖）：

- `pnpm --filter @roamlog/web test`：15 个测试文件 / 40 个测试通过。
- `pnpm --filter @roamlog/web typecheck`：通过。
- `pnpm --filter @roamlog/web build`：通过，10/10 静态页生成。

可访问性回归修复后复验（2026-11-17 20:54–20:56）：

- `pnpm --filter @roamlog/web test`：15 个测试文件 / 40 个测试通过。
- `pnpm --filter @roamlog/web typecheck`：通过。
- `pnpm exec playwright test --project=web`：9/9 通过，包含 `trips.spec.ts` 旅行详情切换测试。
- `pnpm --filter @roamlog/web build`：通过，10/10 静态页生成。

```text
pnpm --filter @roamlog/web test
```

结果：15 个测试文件、40 个测试全部通过。

```text
pnpm --filter @roamlog/web typecheck
```

结果：通过（`next typegen` + `tsc --noEmit`）。

```text
pnpm --filter @roamlog/web build
```

结果：通过（Next.js 16.4.6，10/10 静态页生成，所有 Web 路由编译成功）。

预览路由：

- `http://localhost:3000/w/roamlog-crew/journal` → HTTP 200
- `http://localhost:3001/admin` → HTTP 200

额外手动验证：在独立 Playwright 浏览器上下文中点击“写日志”，填写标题/地点并保存；新建日志在列表中可见。该流程同时验证了 mock 新建 UUIDv7、schema 校验和本地持久化。

## 截图

以下截图来自最终代码状态：

- `C:\Users\BY9700\AppData\Local\Temp\roamlog-journal-desktop.png`
- `C:\Users\BY9700\AppData\Local\Temp\roamlog-journal-editor-desktop.png`
- `C:\Users\BY9700\AppData\Local\Temp\roamlog-journal-mobile.png`
- `C:\Users\BY9700\AppData\Local\Temp\roamlog-journal-editor-mobile.png`
- `C:\Users\BY9700\AppData\Local\Temp\roamlog-journal-created.png`

视觉检查：桌面 1440 宽度编辑器为右侧 Sheet，工具栏、正文、保存栏、版本历史、评论区均可见；390 宽度下工具栏换行、Sheet 纵向滚动、保存按钮可达。

## 测试覆盖

- 编辑器渲染与工具栏可访问性。
- 5 秒自动保存。
- 409 冲突 Dialog、覆盖保存使用最新 version。
- revision 列表与恢复。
- 评论 `@` 提及成员并传递 `mentionUserIds`。
- mock repository 新建、版本递增、revision 快照、过期保存拒绝、恢复。

## 已知风险与未覆盖项

- API revision 端点已完成契约/类型接线，但本任务未在真实 PostgreSQL + 登录会话下端到端执行 revision 恢复；需由后续集成/QA 任务验证。
- 图片功能是 Tiptap 图片节点占位，不是上传链路；真实 S3 上传属于媒体任务。
- mock revision 存储为浏览器 `localStorage`，仅用于演示，不会跨设备同步。
- 未新增 Playwright E2E；本轮视觉和创建流程使用临时脚本手动验证。
- 已复跑现有 Web Playwright project，全部 9 条通过。
- `apps/web/package.json` 同时包含 Map 并行任务新增的 `maplibre-gl` / `react-map-gl`；本任务只负责 Tiptap 四项依赖。

