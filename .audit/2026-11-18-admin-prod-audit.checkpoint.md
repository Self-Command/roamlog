# Roamlog Admin 生产审计 Checkpoint

## 2026-11-18 15:26:22 +08:00

### 状态

- 审计：DONE
- 发布验收：BLOCKED
- 最终报告：`.audit/2026-11-18-admin-prod-audit.md`
- 敏感信息：未落盘；截图表格内容已遮蔽，JSON 已移除邮箱/真实名称/示例姓名。

### 已审计页面/控件

- 登录：邮箱密码、TOTP、会话 Cookie、无会话访问、登录页预填。
- Shell：10 个导航入口、移动导航、面包屑、全局搜索/⌘K、通知抽屉、未读 badge、全部标为已读、环境徽标、2FA、角色选择、返回登录。
- 总览：页面错误、重试、KPI/趋势/审计请求关系。
- 用户：列表、搜索、状态/角色筛选、详情抽屉、角色/暂停/恢复/删除确认、批量条、强制登出、重置 2FA、导出、分页/排序检查。
- 工作区：列表、搜索/状态/套餐、详情、成员/体量、暂停/删除、批量、套餐/所有权入口检查。
- 内容审核：真实 Trip 列表、类型/状态/可见性/Workspace 筛选、详情、删除/恢复确认、举报 badge、flagged 筛选、分享 URL。
- 媒体：空状态、搜索/状态/孤儿筛选、桶名、预览/删除缺失。
- 审计：页面 500、actor 筛选、日期、导出、分页。
- 功能开关：零数据空白、创建/删除缺失、保存/灰度/白名单代码路径。
- 邮件：3 条真实 sent 日志、状态卡、搜索/筛选、测试邮件、重发限制、Mailpit 配置。
- 队列：5 个队列计数、失败空状态、吞吐、健康、暂停/清空确认。
- 系统：DB/Redis/Storage 探针、迁移、API/Worker 版本、Worker 状态、Redis 面板、构建时间。
- 同域：10 路由刷新、404、14 JS+4 CSS、`/v1`、WebSocket、会话、安全头、CSP、缓存头。
- 响应式/可访问性：1440×1000、390×844、移动导航、表格滚动、Tab 焦点、axe WCAG A/AA。

### 已确认问题

- P0：审计记录 UUIDv4 违反 UUIDv7 契约，`/v1/admin/audit` 500，总览和审计页整页失败。
- P0：`docker/compose.staging.yml` 强制 `SMTP_HOST: mailpit`；Mailpit 运行，3 封邮件均为 sent、0 delivered。
- P1：环境 LOCAL / 2FA 状态矛盾 / 假登出 / fixture 通知 / 搜索仅页面。
- P1：用户与工作区详情计数缺失、无分页/排序、用户导出禁用。
- P1：举报/审核队列未实现，举报数硬编码 0，分享链接硬编码 localhost。
- P1：审计 actor 使用 fixture；功能开关零数据且无法创建。
- P1：邮件测试入口缺失，所有 sent 记录均可重发。
- P1：队列吞吐固定 0、跨四队列文案与实际 5 个不符、健康忽略 Worker。
- P1：系统 Worker 误报 DOWN/0 consumers；Redis 面板硬编码。
- P1：生产有 1 个 `.local` super_admin、0 普通用户；bootstrap 残留。
- P2：趋势 12 天标题、登录预填 fixture、无自动登录跳转、长缓存/CSP beacon、移动表格滚动提示、跳转链接焦点。

### 证据路径

- `.audit/2026-11-18-admin-prod-audit/evidence/pages-observations.json`
- `.audit/2026-11-18-admin-prod-audit/evidence/login-observations.json`
- `.audit/2026-11-18-admin-prod-audit/evidence/interaction-extra.json`
- `.audit/2026-11-18-admin-prod-audit/evidence/axe-results.json`
- `.audit/2026-11-18-admin-prod-audit/evidence/production-facts.json`
- `.audit/2026-11-18-admin-prod-audit/evidence/*.png`

### 待审计/未验证

- 所有业务写操作仅打开确认框，未提交。
- 真实外部邮件投递、Resend webhook、低权限角色、会话 TTL、媒体预览/删除、审计/用户导出内容。
- 768/1024 断点。

### 下一步

1. 修复 P0-01 审计 UUID 契约与坏数据。
2. 拆分 production compose 并移除 Mailpit，验证真实 Resend/SMTP。
3. 按最终报告第 10 节任务边界并行返工。
4. 返工后重跑 admin E2E、axe、live E2E 与生产只读核验。

## 2026-11-18 15:33:14 +08:00 — 最终封存

- 最终报告已写入 `.audit/2026-11-18-admin-prod-audit.md`。
- 本 checkpoint 已写入。
- 临时 Playwright 脚本已删除；本地 storage-state 已删除。
- 报告/JSON 扫描：无邮箱、Bearer、密码赋值、Cookie/token 赋值；本报告未包含生产 PII。
- `git status --short --untracked-files=all` 仅显示 `.audit/` 下的审计产物；无产品源码、配置或数据库改动。
- 审计结论：DONE；发布验收：BLOCKED（P0-01 审计契约、P0-02 邮件环境）。
