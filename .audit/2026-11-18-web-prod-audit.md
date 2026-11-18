# Roamlog Web 生产审计报告（2026-11-18）

状态：FINAL
范围：`apps/web` + 生产 `https://we.spacedo.org` 已有截图；不含 `apps/admin` / `apps/api` 功能审计。
方法：代码静态审计 + 现有生产截图 + 截图放大补证；未执行生产写操作，未重复全量截图。
生产模式判定：命令面板文案为“搜索真实 API 的旅行、日志与评论”，设置/成员/通知显示 `LIVE API`，日志文案为“来自真实 API”，可判定生产 `NEXT_PUBLIC_DATA_MODE=api`。但 insights/map/dashboard 仍有代码级 demo 泄漏。

## 1. 顶部工作栏截图问题结论

用户截图中的“同…编辑”不是产品功能文案，也不是一个按钮，而是两个中文姓名头像的 fallback 首字在重叠头像组里拼出的视觉串。

| 元素 | 结论 | 实际行为 / 根因 | 证据 | 级别 |
|---|---|---|---|---|
| 搜索框 + `⌘K` | 真实功能 | 点击打开 `CommandPalette`；全局监听 Meta/Ctrl+K；生产模式下输入 ≥2 字会查真实 search API。 | `app-shell-view.tsx:155-171`、`app-shell-view.tsx:86-93`、`command-palette.tsx:151-160` | P2（无键盘上下选择） |
| “同…编辑” | 布局 bug + 假数据 | 不是 label。`AvatarGroup` 用 `-space-x-2` 重叠 26px 头像；`getInitials` 对中文名取前 2 字，所以“同行者”→“同行”、“编辑者”→“编辑”，两串字在重叠圆里连读成“同行编辑”。 | 用户截图、`topbar-user-zoom-5x.png`；`packages/ui/src/primitives/avatar.tsx:82`、`packages/ui/src/lib/initials.ts:10`、`app-shell-view.tsx:173-188` | P1 |
| 合作头像 | 假数据 | 当前用户永远 `online: true`；另外两人取 `trips[0]/[1].guestNames[0]`，无数据时回退硬编码“同行者”“编辑者”。成员页实际只有 1 名成员，头像组却显示 3 人。 | `app-shell-view.tsx:173-188`；`members-desktop.png` 显示 `01 MEMBERS`；`overview-desktop.png` 显示 3 个头像 | P1 |
| 头像组无障碍标签 | 假数据/错误 | `label` 固定为 `${min(3, trips.length+1)} 位协作者在线`。即使 0 旅行也读“3 位协作者在线”，而第三位 `online` 未设置；真实在线数为 0（无 Socket.IO presence）。 | `app-shell-view.tsx:176-187`；全仓无 `socket.io-client`/presence 订阅 | P1 |
| 通知红点 | 假数据/硬编码 | 红点是无条件渲染的 `<span>`，不读未读数、不随已读变化。通知页同时显示 `INBOX / 00 UNREAD`。 | `app-shell-view.tsx:190-201`；`notifications-desktop.png`；`notifications-live.tsx:105` | P1 |
| 铃铛 | 真实功能 | `Link` 到 `/w/:slug/notifications`，可访问；问题只在红点。 | `app-shell-view.tsx:191-203` | — |
| 加号 | 真实但语义不符 | `aria-label="快速新建"`，实际与搜索框一样只打开命令面板，没有“新建旅行/日志/成员”菜单。 | `app-shell-view.tsx:205-210` | P2 |
| 工作栏整体 | 布局 bug | 1440 与 820 均出现头像文字挤压、与铃铛视觉粘连；`sm:flex` 在 640px 就显示头像组，窄屏更挤。 | `topbar-loaded-1440.png`、`topbar-loaded-820.png`、`user-reported-topbar.png` | P1 |

结论：`⌘K` 和铃铛是真功能；头像是假 presence；“同行编辑”是中文首字重叠造成的布局 bug；红点是假未读；加号是真实但错位的“快速新建”。P0 不在这里，P0 见第 2 节。

## 2. 生产假数据 / 假文案 / 硬编码清单

### 2.1 会直接误导生产用户的假数据（P0）

| 项 | 证据 | 说明 | 级别 |
|---|---|---|---|
| 洞察页展示 9 趟旅行、79 天、¥50,312、20 笔支出、热力图 | `insights-desktop.png`；`insights-workspace.tsx:39`（`useDemoStore`）、`insights-workspace.tsx:160` | 页面无条件使用 demo store，未走 API。总览同账号显示 0 旅行，洞察却显示 9 旅行，数据自相矛盾。 | P0 |
| 地图页展示 9 个国家、9 趟旅行、21 城市、fixture 坐标 | `map-desktop.png`；`atlas-workspace.tsx:47`、`:128`、`:224-227` | 页面无条件使用 demo store；`打开旅行` 指向 fixture trip id，生产真实库没有这些旅行，点击会进入错误/404 详情。 | P0 |
| 总览页 `MSW DEVELOPMENT DATA` + “没有生产后端写入” | `overview-desktop.png`、`overview-mobile.png`；`dashboard-page.tsx:130-133` | 生产 API 模式仍无条件渲染开发徽标和“fixtures/没有生产后端写入”，直接否认产品可用性。 | P0 |
| 新建旅行保存占位路线 | `new-trip-shell.tsx:62-69` | 生产创建请求硬编码 `origin:"未填写"`、`destinations:["未填写"]`、`tags:[]`、预算 null、visibility workspace；用户无法填写这些核心字段。 | P0 |
| 生产旅行详情没有预算/行程新增能力 | `trip-detail-live.tsx:278-294` 只读展示；`:399-430` 仅标题/摘要/状态；全文件无“添加行程” | demo 版有 `BudgetTab`/`ItineraryTab`/`PackingTab`/`PhotosTab`，生产 live 版全部没有；预算与行程是 v1 核心能力。 | P0 |

### 2.2 假/过期文案与硬编码（P1/P2）

| 项 | 证据 | 说明 | 级别 |
|---|---|---|---|
| 旅行库描述“所有卡片都来自本地 fixtures，并连接到旅行详情骨架” | `trips-library.tsx:117`；`trips-mobile.png` | 生产已是真实 API，文案仍是原型。 | P1 |
| 旅行库错误态“检查 mock 边界后重试” | `trips-library.tsx:81` | 生产错误提示暴露 mock 概念。 | P2 |
| `URL 状态将在 Wave 1 接入` | `trips-library.tsx:204`；`trips-mobile.png` | 原型期占位徽标，生产仍显示。 | P2 |
| 新建旅行 `FORM SKELETON` 徽标 | `new-trip-shell.tsx:107`；`new-trip-desktop.png` | 用户正在生产创建真实旅行，却看到“表单骨架”。 | P1 |
| 新建旅行“封面可在详情页继续补充” | `new-trip-shell.tsx:86` | 详情页没有任何封面编辑入口，文案不可兑现。 | P1 |
| 命令面板“表单骨架将在本轮提供” | `command-palette.tsx:55-56`；`command-palette-open-desktop.png` | 新建旅行页早已存在，提示过期。 | P2 |
| 顶部假 presence（3 人/在线） | `app-shell-view.tsx:173-188` | 见第 1 节；成员页只有 1 人。 | P1 |
| 通知红点常显 | `app-shell-view.tsx:190-201` | 通知页 0 未读。 | P1 |
| 旅行卡/看板头像在线状态由 `trip.status === "active"` 推导 | `trip-card.tsx:23-30`、`dashboard-page.tsx:226-236` | 没有真实 presence，只是把“旅行进行中”伪装成“人在线”。 | P2 |
| 生产工作区/账号为 `Roamlog Platform Administrator...` / `admin@roamlog.local` | `overview-desktop.png`、`settings-desktop.png`、`members-desktop.png` | 可能是 bootstrap 管理账号，不是普通演示人物；但 `.local` 账号出现在生产 UI，需确认是否为预期管理员身份并禁止普通用户租户使用。 | P1（待确认） |

### 2.3 合理空状态（不是假数据）

以下由真实 API 返回为空，属于合理空状态：

- 总览 `0 趟旅行 / 0 国家 / 0 城市`（`overview-desktop.png`）。
- 日志 `0 ENTRIES / 没有匹配日志`（`journal-desktop.png`）。
- 通知 `00 UNREAD / 没有匹配通知`（`notifications-desktop.png`）。
- 成员 `01 MEMBERS`，仅当前 Owner（`members-desktop.png`）。

### 2.4 localStorage / seed

- demo store 使用 `roamlog:wave2-demo-state:v1`，读写 `localStorage`：`apps/web/lib/demo-store.tsx:83,197-212`。
- 生产 insights/map 仍引用该 store；即使没有写入，也会把 bundle 内 fixture 当作真实数据展示。
- `packages/api-mocks/src/fixtures.ts` 内包含首尔、冰岛、阿马尔菲、圣托里尼、京都、巴塔哥尼亚等 demo 行程；生产 insights/map 的 9 旅行即来自此。

## 3. 表单与字段逐项矩阵

### 3.1 登录 / 注册 / 账号

| 表单 | 字段 | 控件 | 可填 | 可保存 | 刷新回显 | 缺口 / 证据 |
|---|---|---|---|---|---|---|
| 登录 | 邮箱 | `Input type=email` | 是 | 是（Better Auth session） | 是 | `login-form.tsx:299-311` |
| 登录 | 密码 | `Input type=password` | 是 | 是 | 是 | `login-form.tsx:313-323` |
| 登录 | TOTP / 备用码 | 条件 `Input` | 是 | 是 | 是 | `login-form.tsx:206,227` |
| 注册 | 名字 / 邮箱 / 密码 | `Input` | 是 | 是 | 是 | `register-form.tsx:72-115` |
| 忘记密码 | 邮箱 | `Input type=email` | 是 | 发送重置邮件 | 不适用 | `email-link-form.tsx:64-99` |
| 重置密码 | 新密码 / 确认 | `Input type=password` | 是 | 是（API 模式） | 不适用 | `reset-password-form.tsx:68-119`；mock 模式明确提示未接后端 |
| 邀请接受 | 无输入（读取 token/角色） | 按钮 | — | 是 | 是 | `invite-accept.tsx:43-99` |

### 3.2 旅行创建（`/trips/new`）

| 字段 | 当前控件 | 可填 | 可保存 | 刷新回显 | 结论 / 缺口 |
|---|---|---|---|---|---|
| 封面 | 无 | 否 | 否 | 否 | P1：无上传、无选择、无预览；详情页只按索引生成渐变 `coverClassForTrip`。 |
| 标题 | `Input` | 是 | 是 | 是 | 必填，`maxLength=160`，有校验；`new-trip-shell.tsx:111-121`。 |
| 简介/摘要 | `Textarea` | 是 | 是 | 是 | 可选，`maxLength=1000`；`:122-130`。 |
| 起点 | 无 | 否 | 硬编码 `"未填写"` | 显示“未填写” | P0：`new-trip-shell.tsx:62`；用户完全无法填写。 |
| 出发地 | 无 | 否 | 否 | 否 | P0：没有独立字段；与“起点”都缺失。 |
| 目的地 | 无 | 否 | 硬编码 `["未填写"]` | 显示“未填写” | P0：`new-trip-shell.tsx:63`。 |
| 路线/途经点 | 无 | 否 | 否 | 否 | P0：无 stops/waypoints UI；OpenAPI 已有 `/v1/trips/:id/stops` 与 reorder，前端未接。 |
| 天数 | 无 | 否 | 派生 | 详情按日期计算 | P2：`tripDurationDays(startDate,endDate)` 只读；不支持不规则行程。 |
| 开始日期 | `Input type=date` | 是 | 是 | 是 | `new-trip-shell.tsx:131-140`；无 min/max、无时区。 |
| 结束日期 | `Input type=date` | 是 | 是 | 是 | `new-trip-shell.tsx:141-151`；校验仅“结束不早于开始”。 |
| 预算 / 币种 | 无 | 否 | 硬编码 null | 显示“未设置” | P0：`new-trip-shell.tsx:67-68`；工作区有默认币种，但旅行预算不能填。 |
| 可见性 | `Select`（3 项） | 可选 | 保存时被忽略，硬编码 `"workspace"` | 永远回显 workspace | P1：`new-trip-shell.tsx:152-158` 的 Select 没有 `value/onChange`；提交 `:69`。 |
| 标签 | 无 | 否 | 硬编码 `[]` | 无 | P1：`new-trip-shell.tsx:65`；全前端无标签输入。 |
| 状态 | 无 | 否 | 硬编码 `"planning"` | 显示“计划中” | P2：创建页不能选愿望/已归来等。 |

### 3.3 旅行编辑（详情弹窗）

| 字段 | 当前控件 | 可填 | 可保存 | 刷新回显 | 结论 / 缺口 |
|---|---|---|---|---|---|
| 标题 | `Input` | 是 | 是（带 version） | 是 | `trip-detail-live.tsx:404-406`。 |
| 摘要 | `Textarea` | 是 | 是 | 是 | `:407-414`。 |
| 状态 | `Select`（6 项） | 是 | 是 | 是 | `:415-428`；冲突 409 有处理。 |
| 封面 | 无 | 否 | 否 | 否 | P1。 |
| 起点 / 出发地 / 目的地 / 路线 / 途经点 | 无 | 否 | 否 | 只读展示 | P0：详情概览展示 `trip.origin/destinations`，但编辑弹窗没有这些字段。 |
| 天数 | 无 | 否 | 派生 | 只读 | P2。 |
| 开始/结束日期 | 无 | 否 | 否 | 只读 | P1：创建后无法改期。 |
| 预算/币种 | 无 | 否 | 否 | 只读“未设置” | P0。 |
| 可见性 | 无 | 否 | 否 | 只读 Badge | P1：创建后无法改可见性。 |
| 标签 | 无 | 否 | 否 | 不展示 live 详情 | P1。 |

### 3.4 日志

| 字段 | 当前控件 | 可填 | 可保存 | 刷新回显 | 缺口 / 证据 |
|---|---|---|---|---|---|
| 所属旅行 | 原生 `Select` | 是 | 是 | 是 | 仅有旅行时可用；旅行多时应改可搜索 combobox；`journal-editor-sheet.tsx:514-530`。 |
| 标题 | `Input` | 是 | 是 | 是 | 必填，`maxLength=180`；`:533-545`。 |
| 日期 | `Input type=date` | 是 | 是 | 是 | `:546-556`；没有限制在旅行日期范围内。 |
| 地点 | `Input` 裸文本 | 是 | 是 | 是 | 必填；应改地点搜索/自动补全；`:557-570`。 |
| 正文 | 富文本编辑器 | 是 | 是（自动保存 + 乐观锁） | 是 | `journal-editor-sheet.tsx:571-585`。 |
| 封面/相册 | 无 | 否 | 否 | 否 | 生产没有媒体上传。 |
| 标签/心情/天气 | 无 | 否 | 否 | 否 | demo 版有 mood，live 版没有。 |

### 3.5 设置 / 成员邀请 / 搜索

| 表单 | 字段 | 控件 | 可填 | 可保存 | 刷新回显 | 缺口 |
|---|---|---|---|---|---|---|
| 个人资料 | 显示名称 | `Input` | 是 | 是 | 是 | `settings-live.tsx:151-157`。 |
| 个人资料 | 邮箱 | `Input` 只读 | 否 | — | 是 | 不允许改邮箱；合理。 |
| 个人资料 | 时区 | `Select` 5 项 | 是 | 是 | 是 | `settings-live.tsx:23`；5 项暂不需要 combobox。 |
| 个人资料 | 语言 | `Select` 2 项 | 是 | 是 | 是 | `settings-live.tsx:24-27`。 |
| Workspace | 名称 | `Input` | Owner/Admin 可填 | 是 | 是 | `settings-live.tsx:191-201`。 |
| Workspace | Slug | `Input` 只读 | 否 | — | 是 | 合理。 |
| Workspace | 默认时区 | `Select` 5 项 | 是 | 是 | 是 | 5 项暂可。 |
| Workspace | 默认币种 | `Select` 5 项 | 是 | 是 | 是 | 5 项暂可；但旅行预算仍不能填。 |
| 成员邀请 | 邮箱 | `Input type=email` | 是 | 是（API） | 是 | `members-live.tsx:353-362`。 |
| 成员邀请 | 角色 | `Select` Admin/Editor/Viewer | 是 | 是 | 是 | `:362-371`；3 项合理。 |
| 成员邀请 | 留言 | `Textarea` | 是 | 是 | 是 | `:372-385`。 |
| 搜索 | 查询 | `Input`（命令面板） | 是 | 不写 | — | `command-palette.tsx:80-94`；≥2 字查 API，最多 8 条，无分页。 |

### 3.6 起点 / 目的地 / 路线 / 天数 / 日期 / 预算逐个结论

- 起点：无输入；创建硬编码“未填写”；编辑不可改。P0。
- 出发地：没有独立字段，完全缺失。P0。
- 目的地：无输入；创建硬编码“未填写”；编辑不可改。P0。
- 路线/途经点：无 UI；OpenAPI 已有 stops CRUD/reorder，前端未接。P0。
- 天数：由起止日期计算，只读；无“天数”字段，不能表达不规则行程。P2。
- 开始/结束日期：创建可填并落库；编辑/改期不可用。P1。
- 预算/币种：创建/编辑都没有；详情只显示“未设置”；demo 预算页不进生产。P0。

## 4. 控件选型清单

| 场景 | 当前 | 建议 | 文件 |
|---|---|---|---|
| 日志“所属旅行” | 原生 `Select` 列出全部旅行 | 旅行 > 8 条时改为可搜索 combobox；支持标题/目的地/日期 | `apps/web/components/journal/journal-editor-sheet.tsx:514-530` |
| 日志“地点” | 裸 `Input` | 地点/城市搜索 combobox + 可手输；写 stop/purpose | `apps/web/components/journal/journal-editor-sheet.tsx:557-570` |
| 旅行起点/出发地/目的地 | 缺失 | 异步地点 combobox（城市/机场/车站），带时区与国家码 | `apps/web/components/trips/new-trip-shell.tsx`、`trip-detail-live.tsx` |
| 路线/途经点 | 缺失 | 可排序多段 stop 列表 + 地图选点；复用 `/stops`、`/stops/reorder` | 新建/详情 |
| 标签 | 缺失 | creatable multi-select，最多 N 个，支持已有标签建议 | 新建/详情 |
| 货币（旅行预算） | 缺失 | 搜索 combobox（当前工作区仅 5 币种可先用 Select）；与金额成对校验 | 新建/详情 |
| 时区/语言/默认币种 | 原生 Select 5/2/5 项 | 当前选项少，可保留；扩展后改 combobox | `settings-live.tsx:151-244` |
| 可见性 | 未接线的 Select | 改为 radio/segmented + 权限后果说明；必须写入 payload | `new-trip-shell.tsx:152-158` |
| 日期 | 原生 `type=date` | 保留原生日期控件；补 min/max、旅行范围与本地化格式；不要用裸文本 | 新建/日志/行程 |
| 行程开始时间 | 缺失 | `type=time` 或时间选择器；当前只有日期 | `trip-detail-live.tsx`（生产无新增表单） |
| 封面/相册/头像 | 缺失 | 文件上传 + 预览/进度/失败重试；走 presign + media id | 新建/详情/设置 |
| 行程类型 | demo `Select` 5 项 | 5 项可保留 Select/segmented；生产需先补新增入口 | `trip-detail/itinerary-tab.tsx:202-213`（仅 demo） |

结论：代码中没有发现日期/时间用裸文本的控件；现有日期均为原生 `type=date`。真正的问题是缺字段、缺上传、缺多选，以及把需要搜索的地点/长列表旅行用了裸 input/原生 select。

## 5. 无响应 / 空实现控件清单

| 控件 | 实际行为 | 证据 | 级别 |
|---|---|---|---|
| 顶部头像组 | 纯展示 `div`，不可点、无 tooltip/成员列表；内容是假 presence | `app-shell-view.tsx:173-188` | P1 |
| 顶部通知红点 | 永远显示；不随未读变化 | `app-shell-view.tsx:199` | P1 |
| 顶部加号 | 打开命令面板，不是快速新建菜单 | `app-shell-view.tsx:205-210` | P2 |
| 命令面板 | 打开/搜索/跳转可用；无方向键选择、无 Enter 激活、无结果 loading/error；API 失败静默为空 | `command-palette.tsx:96-139,141-160` | P2 |
| 新建旅行可见性 | 可选择，但提交忽略，永远保存 workspace | `new-trip-shell.tsx:152-158,69` | P1 |
| 旅行详情“编辑旅行” | 可用，但只能改标题/摘要/状态；封面/路线/日期/预算/标签/可见性都无入口 | `trip-detail-live.tsx:399-430` | P1 |
| 旅行详情“添加行程” | 生产版不存在；只有 demo 版有 | `trip-detail-live.tsx`（无）；`trip-detail/itinerary-tab.tsx:79-82`（demo） | P0 |
| 旅行预算/支出 | 生产详情没有预算 tab；demo `BudgetTab` 只在非 api 模式挂载 | `trips/[tripId]/page.tsx` 条件渲染；`trip-detail.tsx:38,205` | P0 |
| 相册/打包/活动 tab | 生产详情只有概览/日志/行程；demo 才有相册/打包/活动 | `trip-detail-live.tsx:300-360` | P1 |
| 分享 | 只有 `/trips/:id/map` 页有“分享”按钮；详情页没有；API 可创建链接 | `trip-map-live.tsx:88-91`、`share-link-dialog.tsx:119` | P2（可发现性） |
| 评论 | 日志详情内可评论，真实 API；日志卡片的消息图标旁显示的是收藏/version，不是评论数 | `journal-live.tsx:115-125,265-275`；`journal-live.tsx:243-246` | P2 |
| presence | 无 Socket.IO 客户端、无 presence 订阅；全是硬编码/推导 | 全仓无 `socket.io-client`；`activity-workspace.tsx:194` 自述未接 | P1 |
| 通知已读/偏好 | 真实 API，可用 | `notifications-live.tsx:94-120,228-264` | — |
| 成员邀请/角色/撤销 | 真实 API，可用；移除前 `confirm` | `members-live.tsx:100-120` | — |
| 设置保存 | 真实 API，可用 | `settings-live.tsx:110-244` | — |
| 旅行筛选/排序 | 客户端对已加载列表生效；无分页/加载更多；搜索不传 API | `trips-library.tsx:56-100` | P2 |
| 日志筛选 | 搜索词传 API；旅行筛选对 API 返回的最多 100 条再客户端过滤；无分页 | `journal-live.tsx:52-78` | P2 |
| 洞察导出 | 可下载 CSV，但导出的是 demo fixture 的 20 笔支出 | `insights-workspace.tsx:128-152` | P0（随假数据） |
| 头像上传 | live 设置没有；demo 设置点击只提示“未接对象存储” | `settings-workspace.tsx:174` | P2 |
| 2FA 安全页 | 页面存在 `/settings/security`，但 live 设置没有入口链接 | `apps/web/app/(auth)/settings/security/page.tsx`；`settings-live.tsx` 无链接 | P2 |
| 移动端“更多”/底部导航 | 真实导航 | `app-shell-view.tsx:212-240` | — |

## 6. 视觉与响应式

| 检查项 | 结论 | 证据 | 级别 |
|---|---|---|---|
| 1440 顶栏 | 头像文字重叠成“同行编辑”，与铃铛视觉粘连；搜索框/铃铛/加号本身对齐正常 | `overview-desktop.png`、`topbar-loaded-1440.png`、用户截图 | P1 |
| 820 顶栏 | 更挤：头像 3 个 + 铃铛 + 加号 + 搜索同排，中文首字连读明显 | `topbar-loaded-820.png` | P1 |
| 390 顶栏 | 头像组隐藏；搜索退化为一个很宽的“只有放大镜”的空按钮，语义弱但不溢出 | `overview-mobile.png`、`trips-mobile.png` | P2 |
| 移动旅行库状态筛选 | 6 个状态在 390 横向溢出，最后一项被截；容器有 `overflow-x-auto`，可横滑但无渐隐/提示 | `trips-mobile.png`；`trips-library.tsx:174-190` | P2 |
| 移动底部导航 | 全页截图中固定导航/FAB 叠在内容中部，是截图伪影；`main` 有 `pb-28`，未证实真实视口遮挡 | `app-shell-view.tsx:212-216`；`overview-mobile.png` | 未验证 |
| 空/错/加载 | 总览/旅行/日志/通知/成员/设置有 skeleton + empty + error；insights/map 是同步 demo，没有 loading/error/真实空状态 | 代码 + 截图 | P1 |
| 焦点 | 命令面板输入框焦点环清晰；顶栏搜索/铃铛/加号有 `focus-visible` ring | `command-palette-open-desktop.png`；`app-shell-view.tsx:162-209` | 通过 |
| reduced motion | 全局 tokens 有 `prefers-reduced-motion`；地图 spinner 有 `motion-reduce:animate-none` | `packages/ui/src/styles/tokens.css:283`、`map/city-search.tsx:89` | 通过 |
| 对比度/10px 文本 | 多处 `text-[9px]/[10px]` + `text-stone`，未做对比度测量；视觉上偏弱 | 多处 | 未验证 |

## 7. 修复任务建议（按 app/web 文件边界，可并行）

### Task W1：工作栏真实性与头像布局（P1）

- 角色：`web_frontend`（可兼 `qa_verifier` 自查）
- 可写文件：`apps/web/components/app-shell/app-shell-view.tsx`、`apps/web/components/app-shell/command-palette.tsx`、`packages/ui/src/primitives/avatar.tsx`、`packages/ui/src/lib/initials.ts`
- 禁止触碰：trips/insights/map/settings 页面、任意 API/DB 文件
- 必须实现：
  - 删除硬编码假 presence；只显示真实工作区成员（可复用 `useMembersQuery`），或隐藏头像组直到 Socket.IO presence 接入。
  - 中文头像首字只取 1 字；`AvatarGroup` 最多 2 个 + overflow；`-space-x-1`；`md` 以下隐藏；补 visible label/tooltip。
  - 红点接真实未读数（可用 `notifications?unreadOnly=true`），0 时完全不渲染。
  - 加号改为真实快速新建 popover（旅行/日志/成员），或改名为“打开命令面板”。
  - 删除命令面板“表单骨架将在本轮提供”；补方向键/Enter。
- 契约前置：presence 事件已存在于 `packages/contracts/src/events/realtime.ts`，但 web 无 Socket.IO 客户端；未接前必须隐藏假在线。未读计数可先用现有通知查询，不必新增后端。
- 验证：`pnpm --filter web typecheck`、相关组件测试、1440/820/390 截图；检查 0 未读时无红点、1 成员时无假头像。

### Task W2：旅行创建/编辑/详情的数据完整性（P0）

- 角色：`web_frontend`
- 可写文件：`apps/web/components/trips/new-trip-shell.tsx`、`apps/web/components/trips/trip-detail-live.tsx`、`apps/web/components/trips/trips-library.tsx`、`apps/web/components/trips/trip-card.tsx`、`apps/web/lib/trip-presentation.ts`
- 禁止触碰：app-shell、insights/map 页面、API/DB
- 必须实现：
  - 新建/编辑补齐：封面、起点、出发地、目的地、路线/途经点、预算/币种、标签、可见性；日期可改；天数只读派生。
  - 可见性 Select 接入 state 与 payload；删除 `FORM SKELETON`、fixtures/封面可补充等假文案。
  - 详情接入预算/支出、行程新增/编辑/勾选、相册/分享入口（至少预算 + 行程）。
  - 旅行列表改服务端 search/sort 或至少分页；删除 `URL 状态将在 Wave 1 接入`。
  - 地图 `打开旅行` 不得指向不存在 fixture；列表/详情统一真实 API。
- 契约前置：`CreateTripRequest`/`UpdateTripRequest` 已含 origin/destinations/tags/budget/visibility/coverMediaId；stops/cover/expenses 端点已在 `packages/contracts/openapi.json`。无需新后端契约，但要先核对 `/v1/trips/:id/cover` 与媒体 presign 的实际可用性。
- 验证：typecheck、trips 组件测试、创建→刷新→编辑→刷新 E2E；确认 DB 中 origin/destinations/budget/tags 非占位。

### Task W3：生产 demo 数据隔离与文案收口（P0）

- 角色：`web_frontend`（必要时 `architect` 定聚合契约）
- 可写文件：`apps/web/components/dashboard/dashboard-page.tsx`、`apps/web/components/charts/insights-workspace.tsx`、`apps/web/components/map/atlas-workspace.tsx`、`apps/web/app/(app)/w/[workspaceSlug]/insights/page.tsx`、`apps/web/app/(app)/w/[workspaceSlug]/map/page.tsx`
- 禁止触碰：app-shell、trips 组件（W2 所有）
- 必须实现：
  - insights/map 改为真实 API 数据；未接好前显示“尚未接入”空状态，绝不能渲染 fixture 的 9 旅行/预算/坐标。
  - 总览删除 `MSW DEVELOPMENT DATA` 与“没有生产后端写入”；按真实 API 模式显示准确文案。
  - 删除/隔离 demo-store 引用；生产 bundle 不应包含可展示的 demo trip 数据。
  - map 的 trip 链接只来自真实 API；删除 `FIXTURE COORDINATES` 或改成真实来源。
  - 补 loading/error/empty 状态。
- 契约前置：若 insights 需要服务端聚合，先定义 `GET /v1/workspaces/:id/insights`（旅行数、国家、预算/支出、分类、热力）；map 可复用现有 trips/stops。未定契约前 web 端不得自行编造统计。
- 验证：同一账号总览与 insights 的旅行数一致；断网/空库显示空状态；生产截图不再出现 9/¥50,312。

并行边界：W1 只碰 shell/avatar，W2 只碰 trips，W3 只碰 dashboard/insights/map；无共享文件。W3 的总览与 W2 的旅行库文案不同文件，可并行。

## 8. 证据、未验证项与严重级别

### 8.1 证据路径

- 生产截图：`.audit/evidence/overview-desktop.png`、`overview-mobile.png`、`insights-desktop.png`、`map-desktop.png`、`journal-desktop.png`、`members-desktop.png`、`settings-desktop.png`、`notifications-desktop.png`、`trips-mobile.png`、`new-trip-desktop.png`、`settings-mobile.png`
- 顶栏：`.audit/evidence/user-reported-topbar.png`、`topbar-loaded-1440.png`、`topbar-loaded-820.png`、`topbar-user-zoom-5x.png`
- 命令面板：`.audit/evidence/command-palette-open-desktop.png`、`command-palette-search-desktop.png`
- 代码证据：本报告各行内 `file:line`。

### 8.2 未验证项

- 未用 Playwright 读取生产 DOM 的 computed width/overlap；顶栏结论来自截图 + CSS，未做几何测量（无生产登录态，避免登录/写操作）。
- 未在生产执行创建/编辑旅行；字段落库结论来自代码与 API 模式证据，未做破坏性验证。
- 未验证移动端固定底栏在真实视口是否遮挡内容；全页截图中的中段覆盖是截图伪影，代码有 `pb-28`。
- 未做 axe/对比度测量；仅检查了焦点类与 reduced motion 全局样式。
- 未验证 `admin@roamlog.local` 是否为预期 bootstrap 管理员；仅标记风险，不判定为漏洞。
- 未验证 insights/map 的真实 API 替代方案性能；仅确认当前为 demo 数据。

### 8.3 严重级别汇总

- P0：5 项——insights 假统计、map 假数据/假链接、总览 MSW 生产文案、旅行核心字段不可填、生产详情无预算/行程新增。
- P1：10 项——顶栏中文头像重叠、假 presence、通知红点、可见性不落库、编辑字段缺失、封面/标签缺失、过期 fixtures 文案、生产 `.local` 管理员身份待确认、insights/map 无真实空状态、分享入口不可发现。
- P2：命令面板键盘/过期提示、加号语义、移动筛选可发现性、无分页、评论图标误用、头像上传/2FA 入口缺失、10px 对比度未测。

### 8.4 验收结论

当前 Web 生产不可按“全栈 v1 完成”验收。真实 API 已接管登录、总览、旅行列表/详情、日志、成员、通知、设置，但旅行数据模型只读写最小字段；insights/map 仍是 demo 数据；顶栏存在假 presence 与布局缺陷。建议先完成 W2（旅行核心数据）与 W3（demo 隔离），W1 可与 W2 并行。

