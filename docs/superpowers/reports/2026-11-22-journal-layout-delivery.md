# Roamlog 日志排版交付报告

日期：2026-11-22（Asia/Shanghai）
任务：日志文章排版完整移植
状态：**已实施 / 功能验收通过 / 生产发布仍 BLOCKED**

## 1. 结论

日志正文已从单栏富文本升级为可持久化、可清洗、编辑器 / 详情 / 公开分享一致的排版系统。

已交付：

- 单图 figure/figcaption、图注行内编辑、alt/title/链接/新窗口/显示尺寸、默认/左浮动/居中/右浮动、替换、删除、预览。
- Gallery 1–6 列方形网格、多选上传、向已有图库追加、逐图图注、列数、删除、上移/下移、拖拽排序实现、编辑器/只读灯箱、mediaId 过期换签与失败占位。
- Columns 2–4 栏、完全等宽、插入菜单、BubbleMenu 左右加列/删列、Tab/Shift-Tab，真实浏览器点击已验证。
- 编辑器与分享页共用 `journal-layout.css`：标题、列表、引用、代码、表格、task list、图片 float 环绕、390/1440 响应式。
- 分享页服务端首屏正文、无 JS 可读、密码门、Gallery 灯箱按需加载。
- API/Web 清洗：figure/gallery/columns、固定 data-* 归一化、`target="_blank"`、contentJson link mark、空锚点/空 figure 清理。
- 真实栈 E2E 与 CI Gate：layout、gallery upload、share password、security、a11y、gallery drag，以及依赖漏洞审计。

当前不能直接宣称“可生产上线”：当前工作区未提交，生产 env / 备份恢复 / 发布审批 / 邮件 / 监控证据不足。详见 `.audit/journal-layout/deploy-readiness.md`。

## 2. 功能交付

| 模块       | 交付内容                                                                                                                    | 关键入口                                                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image      | figure/figcaption、旧 `<img>` 兼容、行内图注、alt/title/link/new-window/宽高、默认/左/中/右、替换、删除、预览、mediaId 换签 | `apps/web/components/journal/extensions/journal-image.ts`、`journal-image-node-view.tsx`、`journal-image-toolbar.tsx`、`journal-image-settings.tsx`、`journal-image-caption.tsx` |
| Gallery    | 1–6 列、方形裁切、真实多选上传、追加、逐图图注、列数、删除、上下移、dnd-kit、灯箱、mediaId 换签/占位                        | `journal-gallery.ts`、`journal-gallery-node-view.tsx`、`journal-gallery-image-node-view.tsx`、`journal-gallery-panel.tsx`、`share-gallery-lightbox.tsx`                          |
| Columns    | 2–4 栏、等宽、Toolbar 2/3/4 菜单、BubbleMenu、Tab/Shift-Tab、undo/redo                                                      | `journal-columns.ts`、`journal-columns-node-view.tsx`、`journal-columns-bubble.tsx`                                                                                              |
| 共享排版   | 标题/段落/列表/引用/代码/表格/task list、figure、gallery、columns、float、移动端折叠                                        | `apps/web/components/journal/journal-layout.css`                                                                                                                                 |
| 编辑器接入 | 节点注册、图片/Gallery 上传、2/3/4 栏、按需加载 editor chunk                                                                | `apps/web/components/journal/journal-editor.tsx`、`apps/web/app/(app)/w/[workspaceSlug]/journal/journal-live.tsx`                                                                |
| 分享       | SSR 首屏正文、无 JS、密码门、Gallery 灯箱、灯箱按需加载                                                                     | `apps/web/app/share/[token]/page.tsx`、`apps/web/components/share/public-share-page.tsx`、`public-trip-server.ts`、`share-article.tsx`、`share-gallery-lightbox.tsx`             |
| 安全清洗   | target `_blank`、data-* 枚举、contentJson link mark、空锚点/空 figure、XSS                                                  | `apps/api/src/common/services/sanitize.service.ts`、`apps/web/components/share/html.ts`、`apps/api/src/modules/entries/content-json-links.ts`                                    |
| CI         | 六条排版 E2E + dependency audit                                                                                             | `.github/workflows/ci.yml`                                                                                                                                                       |

## 3. 验证证据

### 3.1 单元 / 组件 / API

- Web `components/journal + components/share` 最近汇总：**22 files / 228 tests passed**。
- Web 全量：**96 files / 832 tests passed**。
- API 全量：**150 files / 1340 tests passed**；17 files / 118 tests 因未设置 `ROAMLOG_TEST_DATABASE_URL` 跳过。
- DB 未设置测试 URL：**17 files / 87 tests passed**，10 files / 8 tests skipped；设置隔离 schema 并执行迁移后：**27 files / 125 tests passed**。
- 默认 `pnpm test`：**10/10 Turbo tasks passed**，无 failed。
- `pnpm --filter @roamlog/web typecheck`、`pnpm --filter @roamlog/api typecheck` 通过。
- `pnpm --filter @roamlog/web build`、`pnpm --filter @roamlog/api build` 通过。
- `pnpm contracts:check` 通过（OpenAPI 115 paths / 229 schemas，API client fresh）。
- `pnpm staging:validate` 通过。
- `git diff --check` 通过。

### 3.2 真实栈 Playwright

| Spec                                      |     结果 | 覆盖                                                                                                  |
| ----------------------------------------- | -------: | ----------------------------------------------------------------------------------------------------- |
| `e2e/web/journal-layout.spec.ts`          | 1 passed | Owner 登录、真实 API/DB、Columns 真实点击、Gallery/Image 渲染、保存/刷新、分享、Viewer 只读、1440/390 |
| `e2e/web/journal-gallery-upload.spec.ts`  | 2 passed | 真实 presign→PUT→complete→S3、2 图上传、追加第 3 图、图注 UI 持久化、失败不半插入、刷新、分享灯箱     |
| `e2e/web/journal-layout-security.spec.ts` | 1 passed | 危险 link mark、非法 data-*、XSS、空锚点/空 figure、`_blank` roundtrip                                |
| `e2e/web/journal-layout-a11y.spec.ts`     | 3 passed | 工具栏、图片设置 Esc 焦点、Columns 键盘、Gallery 灯箱焦点、分享页键盘                                 |
| `e2e/web/journal-share-password.spec.ts`  | 1 passed | 密码门 SSR、无 JS、错误密码、正确解锁、正文/灯箱、刷新重新锁定                                        |
| `e2e/web/journal-gallery-drag.spec.ts`    | 1 passed | Gallery 真实 pointer 排序、刷新持久化、分享、键盘替代                                                 |

### 3.3 截图与机器证据

全部位于 `.audit/journal-layout/`（不提交）：

- `e2e-desktop-1440.png`、`e2e-mobile-390.png`
- `e2e-share-1440.png`、`e2e-share-390.png`、`e2e-share-lightbox-1440.png`
- `e2e-gallery-upload-1440.png`、`e2e-gallery-upload-390.png`、`e2e-gallery-share-1440.png`
- `share-nojs-1440.png`、`share-nojs-390.png`
- `share-password-gate-1440.png`、`share-password-gate-390.png`、`share-password-unlocked-1440.png`
- `a11y-1440.png`、`a11y-390.png`、`a11y-share-390.png`
- `security-e2e-detail-1440.png`、`security-e2e-share-1440.png`
- `perf-journal-editor-list-1440.png`、`perf-journal-editor-open-1440.png`
- `perf-share-lightbox-opened.png`

### 3.4 性能与安全

- 分享页未点 Gallery 时不再加载 YARL：首屏 lightbox JS/CSS 请求 **0**；点击后才加载。
- Journal 列表首屏不再请求编辑器 chunk；打开日志后加载。编辑器 chunk 约 214.9 KiB gzip，属按需成本。
- `pnpm security:check`：无已知漏洞。
- 依赖 override：`effect@3.22.5`、`glob@14.0.6`。
- `security-upgrade.md` 是 high-only 修复时的中间快照；最终 audit 结论以 `security-moderate.md` 为准。
- CI `dependency-audit` job 已接入 `pnpm audit --audit-level high`，失败不静默。
- CI workflow 已通过 `actionlint`、Prettier、`pnpm staging:validate`，但尚未触发新的 GitHub Actions run；首次 run 需确认 MinIO 启动时间与 job 总时长。

### 3.5 全量 Gate 与提交准备

- `pnpm security:check`：No known vulnerabilities found。
- `pnpm contracts:check`：OpenAPI 115 paths / 229 schemas，API client 836 schemas。
- `pnpm typecheck`：11/11 packages passed。
- `pnpm build`：5/5 tasks passed；Web 10 个静态页、Admin 23 个静态页。
- `pnpm staging:validate`、`git diff --check`：passed。
- TEST-1 修复了无 `ROAMLOG_TEST_DATABASE_URL` 时，DB integration suite 在 `describe.skip` 回调顶层解析空 URL 的收集期失败。
- 复现与回归命令：

```bash
cd /c/Users/BY9700/Desktop/UI/roamlog
env -u ROAMLOG_TEST_DATABASE_URL pnpm --filter @roamlog/db test
DATABASE_URL='postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=test_guard_1122' \
  pnpm --filter @roamlog/db exec prisma migrate deploy
ROAMLOG_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=test_guard_1122' \
  pnpm --filter @roamlog/db test
pnpm test
```

- 结果：默认无 URL 87 passed；隔离 schema 125 passed；全仓 `pnpm test` 10/10 tasks passed。
- 完整 Gate 证据：`.audit/journal-layout/final-gate.md`。
- 发布提交分组：`.audit/journal-layout/release-commit-plan.md`。
- `.audit` 索引清理方案：`.audit/journal-layout/release-index-plan.md`。

## 4. 延期 / 未覆盖

- `wide/full` 图片突破正文容器、不等宽栏（70/30 等）不在本期范围。
- 密码分享刷新后保持解锁未实现；当前设计为刷新重新锁定。若产品要求保持解锁，需要新增短 TTL 分享会话 cookie。
- Gallery 真实 pointer 拖拽已由真实 S3 上传 + Playwright 鼠标事件验证并通过；仅覆盖“上传 → 保存 → 重开 → 排序”稳定路径。刚上传未保存时立即打开设置的历史选中态问题仍需回归。
- 图片设置与 Gallery 预览的运行时全局回调已移除；Esc/焦点由 Radix Popover 和 NodeView scoped listener 管理，A11Y 完整 spec 3 passed。
- 真实 15 分钟签名过期后的客户端换签 E2E 未做时间旅行；NodeView 逻辑单测覆盖。
- BullMQ 队列投递、重试、stalled-job recovery 未在本地真实 Redis 验证；本地 S3 上传链路真实，worker 以 `handleMediaJob` drain。
- 真实触屏、NVDA/VoiceOver、Lighthouse/移动带宽未覆盖。
- `contentJson` 非 link 节点 attrs 仍主要依赖节点层校验；link mark 已由 API 递归规范化。

## 5. 生产发布判断

**BLOCKED**，不是排版功能阻塞，而是发布 Gate 未完成：

- 当前工作区 dirty，未形成干净 release commit/tag。
- 生产环境变量未重新 preflight。
- 30 天内备份恢复演练证据缺失。
- 发布审批 Gate、Resend 邮件、Sentry/告警、super_admin 清理/2FA 当前证据不足。
- 最新 CI / Release 证据仍基于 rc.10 之前的提交。

完整 Gate 矩阵、证据命令和时间估算见 `.audit/journal-layout/deploy-readiness.md`。

建议顺序：提交干净 commit → 跑完整 CI（含六条排版 E2E/security gate）→ 新 tag/镜像 → 生产 env preflight → 备份恢复演练 → 邮件/监控/审批 → staging/production smoke。

## 6. 移植来源与许可证

- `emdash-cms/emdash@732867e9836efbd9fa9cf01f4fd086949b1bb392`（MIT）
  - `packages/admin/src/components/editor/GalleryNode.tsx`
  - `packages/admin/src/components/editor/GalleryDetailPanel.tsx`
  - `packages/admin/src/components/editor/ImageDetailPanel.tsx`
  - `packages/admin/src/components/editor/ImageNode.tsx`
  - `packages/admin/src/portable-text/schema.ts:328-430`
  - `packages/core/src/components/Gallery.astro:177-240`
  - `packages/core/src/components/Image.astro`
- `hunghg255/reactjs-tiptap-editor@496b84967ef58b85465edb1c4eae517de11fba73`（MIT）
  - `src/extensions/Column/Column.ts`
  - `src/utils/columns.ts`
  - `src/components/Bubble/RichTextBubbleColumns.tsx`
  - `src/styles/columns.scss`
- 明确排除：`efemkay/obsidian-modular-css-layout`（GPL-3.0）、`tnichols217/obsidian-columns`（GPL-3.0）、`tianma-if/edgeever`（AGPL-3.0）、Tiptap Pro 专有扩展。不得复制其代码/CSS/类名。

## 7. CodeGraph 证据

- `codegraph status`：`[OK] Index is up to date`
- `codegraph explore "JournalEditor JournalImage JournalGallery JournalColumns JournalImageNodeView JournalGalleryNodeView JournalColumnsBubble"`：命中编辑器、三类 NodeView、Gallery 设置/灯箱与 Columns BubbleMenu 调用链。
- `codegraph explore "SanitizeService sanitizeContentJsonLinkMarks sanitizePublicHtml ShareArticle publicPayload"`：确认 `EntriesService → SanitizeService → ShareLinksService → ShareArticle` 与 `contentJson` 安全入口。
- `codegraph explore "JournalLive JournalEditorSheet dynamic import PhotoLightbox"`：确认列表按需加载编辑器、灯箱动态加载。

## 8. 工作区说明

- 本轮未 commit、未创建 tag。
- `.audit/`、`test-results/`、`playwright-report/`、`.codegraph/`、`.env*` 已被忽略；`apps/web/next-env.d.ts` 与 `apps/admin/next-env.d.ts` 已恢复为 HEAD 内容。
- 仓库索引仍有 **395 个历史 `.audit` 文件（约 26.8 MiB）被跟踪**；`.gitignore` 不会自动移除。发布负责人需审批后单独执行 `git rm -r --cached .audit`，审核 staged deletions，再单独提交索引清理，不能与产品改动混合。方案见 `.audit/journal-layout/release-index-plan.md`。
- 工作区仍 dirty，包含 Journal 排版、分享地图/媒体、Insights 契约等并行改动；发布前按 `.audit/journal-layout/release-commit-plan.md` 分组审查和提交。
