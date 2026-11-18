# AUTH_SHELL_FAKE_DATA — 登录/注册页右侧「最近工作区活动」假数据清除

- 状态：DONE
- 任务 ID：`AUTH_SHELL_FAKE_DATA`
- 角色：web_frontend
- 方案：**方案 A（删除卡片 + 换成非数据型产品说明）**

## 变更文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `apps/web/components/auth/auth-shell.tsx` | 修改 | 删除 `activityRows` fixture 与整张活动卡片 JSX（含 `local fixture` 标签），替换为静态产品说明面板 |
| `apps/web/components/auth/auth-shell.test.tsx` | 新增 | 该组件此前无测试；新增 2 条回归断言，锁死「品牌栏不得出现活动 / 名单 / 时间戳」 |
| `.audit/auth-shell-fake-data-report.md` | 新增 | 本报告 |

未触碰任何其它文件（`apps/web/components/auth/` 之外无写入）。仓库工作区中其它 180 个文件的改动来自其它任务/其它 Agent，与本任务无关。

## 实现摘要

### 删掉了什么（全部为伪造的“真实感”）

1. `activityRows` 常量（原第 9–28 行）整块删除：
   - 3 条硬编码“活动记录”：`Mira` / `顾南` / `林晚`（假姓名）
   - 3 条假动作文案（「在『首尔，晚秋与夜航』补了一篇日志」「把广藏市场加入 11 月 17 日行程」「邀请你一起维护京都红叶慢行」）
   - 3 个假时间戳：`09:42`、`08:15`、`昨天`
   - 行图标 `CalendarDays` / `MapPin` / `Users`，以及 `lucide-react` 导入（该文件已不再使用图标）
2. `RECENT WORKSPACE ACTIVITY` 标题 + 右上角 `local fixture` 角标（原第 60–62 行）。
3. `activityRows.map(...)` 渲染循环、`divide-y` 活动列表、行内头像 pill、相对时间列——即整张卡片 JSX（原第 58–81 行，39 行）。
4. 全文件不再有数组常量、`.map()` 记录渲染、`key`、人名或时间字面量。

### 换成了什么（非数据型）

同一位置保留一个**同尺寸、同材质**的面板（`rounded-card` / `border-hairline-strong` / `bg-surface-1/70` / `backdrop-blur-sm`，`p-4` → `p-5`），内容为纯产品说明：

- eyebrow：`SHARED, NOT SOCIAL`
- 段落：每位成员按角色阅读和评论，改动留在它发生的位置。没有公开主页，也没有推荐信息流；对外分享需要成员显式创建链接。
- hairline 下沿 mono 标签：`private by default · opt-in share links`

左栏标题/说明、角色 footer、`PageGlow`、左右栏栅格与表单插槽（`{children}` / `AuthPageFrame`）全部原样保留，未新增任何网络请求、未新增 `use client`、未引入新依赖。

### 为什么这不是伪造数据

- 面板不含**任何**记录型字段：没有姓名/账号、没有实体名、没有动作发生时间、没有数量、没有 ID，也没有可枚举的“行”。它不是“用别的假数据替换假数据”，而是从「数据展示」降级为「产品文案」。
- `private by default` 与 `opt-in share links` 均经代码核实，不是文案想象：
  - 分享必须由成员主动创建，且需要 `share-link:create` 权限（`ShareLinksService.create`，`apps/api/src/modules/share-links/share-links.service.ts:72`）；
  - `allowIndex` 默认 `false`、`showBudget` 默认 `false`，可选密码与过期时间（同文件 `:102-104`）；
  - 公开读路径 `readPublic` 必须有合法 token，revoked/过期/password 不匹配一律拒绝（同文件 `:171-208`）。
  - 因此「默认私密 + 分享需显式授权」是真实行为；我**没有**写“仅受邀成员可见”，因为公开分享链接的存在会让这句话失真——初版草稿曾这样写，核对 `share-links` 模块后已改正。
- 文案没有承诺任何尚未实现的能力（无“实时协作”“AI 推荐”等），也没有把 mock 能力包装成线上能力。

### 视觉平衡

原卡片高度 ≈ 标题行 + 3 × 44px 行 ≈ 180–190px。新面板 = eyebrow + 2 行正文（`text-sm leading-6`，`max-w-xl` 约束下约 2 行）+ 分隔线与 mono 行，实测渲染高度同量级；`justify-between` 三栏结构不变，右栏（表单侧）完全未动。手机端左栏本就是 `hidden lg:flex`，故断点以下行为不变。

## 验证命令与结果

全部在 `C:\Users\BY9700\Desktop\UI\roamlog` 下执行，未启动/停止任何服务。

1. `pnpm --filter @roamlog/web typecheck` → **exit 0**
   `> next typegen && tsc --noEmit` → `✓ Types generated successfully`，无 TS 错误。
2. `pnpm --filter @roamlog/web test` → **exit 0**
   ```
   ✓ components/auth/auth-shell.test.tsx (2 tests) 284ms
   Test Files  32 passed (32)
        Tests  203 passed (203)
   ```
   - 基线 31 files / 201 tests → 现 32 files / 203 tests；**201 条既有测试全部通过，0 回归**，新增量恰好是新文件的 2 条。
3. `pnpm --filter @roamlog/web lint` → **exit 0**（`eslint -c ../../eslint.config.mjs .` 无输出）
4. 静态证明（任务指定 grep；Git Bash 下 `**` 不开 globstar，改用 `find | xargs grep` 覆盖子目录）：
   ```
   $ find apps/web/components/auth -type f | xargs grep -nE "activityRows|local fixture|RECENT WORKSPACE ACTIVITY"
   （无输出）
   $ grep -rnE "activityRows|local fixture|RECENT WORKSPACE ACTIVITY" apps/web/components/auth apps/web/app | wc -l
   0
   ```
   **0 命中**（含新测试文件——测试只用行为断言，不复述被删字面量，因此 grep 是干净的 0）。
5. 补充静态检查：
   - `grep -nE "lucide-react" apps/web/components/auth/auth-shell.tsx` → 无（图标依赖已移除）
   - `grep -rnE "Mira|顾南|林晚|分钟前|小时前|09:42|08:15" apps/web/components/auth/` → 仅命中测试里的**否定断言**正则 `/分钟前|小时前|天前|昨天|刚刚/`，无任何假数据。
6. 运行时证据（只读 GET 已在运行的 3000，未启停服务、未改端口占用）：
   ```
   GET http://localhost:3000/login   → HTTP=200
   count[local fixture]=0
   count[RECENT WORKSPACE ACTIVITY]=0
   count[activityRows]=0
   count[SHARED, NOT SOCIAL]=1
   count[private by default]=1
   /register     : local fixture=0
   /invite-accept: local fixture=0
   ```
   即：api 模式下访客 HTML 已不含任何 fixture 标记，渲染的是新文案；同一 `AuthShell` 的 4 个页面（login / register / invite/[token] / invite-accept）一并生效。

## CodeGraph 证据

- `codegraph status`（改动前后各一次）→ `[OK] Index is up to date`，Files 1,487 → 1,489（新增测试文件已自动增量同步），无需 `sync`/`index -f`。
- `codegraph_explore`（`projectPath: C:\Users\BY9700\Desktop\UI\roamlog`）查询 `auth-shell AuthShell login register activityRows local fixture`：
  - 改动前：命中 `activityRows`（`apps/web/components/auth/auth-shell.tsx:9`，1 caller），blast radius 显示 `AuthShell → activityRows`，并列出 `AuthShell` 被 `LoginPage` / `RegisterPage` / `InvitePage` / `InviteAcceptPage` / `AuthPageFrame` 渲染——证明这是**访客首个页面**级别的暴露面，不是 mock-only 装饰。
- 改动后同一查询：CodeGraph 明确返回 **`Not in the index: activityRows`**（“No indexed symbol, file, signature or comment uses this name”），即常量已从代码图消失；`AuthShell` 现位于 `auth-shell.tsx:8`，callers 仍为那 4 个页面 + `AuthPageFrame`，`tests: apps/web/components/auth/auth-shell.test.tsx` 已被识别。
- 二次查询 `ShareLinksService create share link public unauthenticated access` 用于核对文案真实性（见上「为什么这不是伪造数据」）。

## 已知风险

1. **文案依赖产品边界**：`没有公开主页/推荐信息流`、`opt-in share links` 与当前实现一致；若后续上线公开个人主页、发现页或“默认公开”分享，这段文案需同步更新，否则又变成不实陈述。
2. **仅 HTML 级运行时验证**：无浏览器截图工具，未做像素级视觉核对；面板高度按类目估算与原卡片同量级，但真实桌面/移动截图未采集。
3. **3000 上运行的是开发态**：生产构建产物（`next build` / web 镜像）仍保有旧代码，需由发布流程重建；本任务不负责构建部署。
4. 左栏在 `lg` 以下隐藏，因此本次改动对移动端登录页**无可见变化**（移动端此前也看不到该卡片）。

## 未覆盖项

- 视觉回归/截图（需浏览器与可用的预览环境）。
- E2E（`e2e/**` 属禁改范围，且 e2e 需要抢占端口）。
- `apps/admin` 登录面板是否存在同类假数据——**未检查**，超出本任务可写文件与本轮范围（工作区中该文件已被其它任务改动）。
- 未验证 i18n/其它语言下的文案（该组件此前即为中文硬编码，保持现状）。

## 建议的下一步

1. 由发布侧重建 Web 产物并刷新 3000/3100 预览，在桌面宽度 ≥1024 对 login / register / invite 三个页面做一次截图核对（重点看左栏垂直节奏是否有空洞）。
2. 若产品确认“默认私密”是长期承诺，可把该承诺纳入设计文档，避免后续功能（公开主页/发现页）与登录页文案冲突。
3. 建议对本轮“清除 fixture”的其它页面复用同一判据：**访客可见的装饰性内容不得含记录型字段（姓名/时间/数量/ID）**，而不是仅检查是否标注了 `local fixture`。