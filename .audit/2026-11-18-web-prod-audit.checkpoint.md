# Web 审计 Checkpoint

- 时间：2026-11-18（Asia/Shanghai）
- 当前阶段：已建立报告骨架；顶部工作栏结论已确认并落盘；继续表单/控件审计
- 已审计：AGENTS.md、报告骨架、顶部工作栏截图（用户图 + topbar-loaded + overview/notifications 生产截图）、app-shell-view、AvatarGroup/getInitials、dashboard 生产文案、data-mode/providers
- 已确认问题：
  - P0 生产页显示 `MSW DEVELOPMENT DATA` + “没有生产后端写入”文案（dashboard-page.tsx:130-133；overview-desktop.png）
  - P1 顶部工作栏 “同行/编辑” 是 CJK 头像首字重叠，不是功能标签；AvatarGroup -space-x-2 + 2 字首字 + 26px（avatar.tsx:67-110；app-shell-view.tsx:173-188）
  - P1 合作头像为假 presence（app-shell-view.tsx:173-188）
  - P1 通知红点常显、不读未读数（app-shell-view.tsx:190-210）
  - P1 生产工作区/账号为 `Roamlog Platform Admin...` / `admin@roamlog.local`（overview-desktop.png），疑似种子账号进入生产
- 证据路径：`.audit/evidence/overview-desktop.png`、`notifications-desktop.png`、`topbar-loaded-1440.png`、`topbar-loaded-820.png`、`topbar-user-zoom-5x.png`
- 待审计：登录/注册、旅行创建/编辑、日志、设置、成员邀请、搜索、通知、分享、评论、presence、移动端溢出、控件选型
- 下一步：读 forms/controls 代码，逐个字段形成矩阵；补 1 次 Playwright 顶栏几何/交互证据

