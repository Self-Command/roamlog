# ADMIN_PROBE_UI — 后台设置保存失败时说明“哪一步”失败

状态: DONE
任务 ID: ADMIN_PROBE_UI
角色: admin_frontend
日期: 2026-11-19（Asia/Shanghai）
范围: `apps/admin/components/settings/**`、`apps/admin/components/admin-shell`（未改）、测试、`.audit/admin-probe-ui-report.md`，以及经根 Agent 明确批准的 2 处增量 `apps/admin/lib/admin-api-error.ts`（见 §1.1）。未改 `apps/admin/lib/format.ts`、`apps/admin/lib/admin-settings.ts`、`apps/admin/components/workspaces/**`、`apps/api/**`、`apps/web/**`、`packages/**`、`e2e/**`、`docs/**`。

---

## 1. 变更文件

新建：

- `apps/admin/components/settings/probe-error-copy.ts`（target+code 映射表、失败步骤判定、结构化提取器）
- `apps/admin/components/settings/probe-error-block.tsx`（错误块渲染：主文案 / 逐步骤 / 折叠技术详情 / 重试）
- `apps/admin/components/settings/probe-error-copy.test.ts`（21 tests）
- `apps/admin/lib/admin-api-error.test.ts`（2 tests，probe 透传回归）

修改：

- `apps/admin/components/settings/settings-console.tsx`（保存失败分支接入 probe、inline 凭据提示状态、渲染分支）
- `apps/admin/components/settings/setting-field.tsx`（新增可选 `note`：字段级 inline 提示）
- `apps/admin/components/settings/settings-console.test.tsx`（+6 tests，含 storage 分组 fixture）
- `apps/admin/lib/admin-api-error.ts`（**经批准的最小增量**，见 1.1）

### 1.1 为什么必须动 `lib/admin-api-error.ts`（根 Agent 已批准）

服务端 422 已带 `probe`，但 `toAdminApiFailure()` 只保留 `code/status/title/detail/degraded`，**在中间层把 `probe` 丢掉**。不改这里，UI 运行时拿不到 `target/code/checks`，映射表只能靠单测自证、线上仍显示通用文案。增量 2 处：

```ts
// 1) AdminApiFailure 增加可选字段（unknown：端点级形状不在共享契约内）
probe?: unknown;

// 2) ProblemDetails 分支原样带上
const probe = (data as { probe?: unknown }).probe;
return { ..., ...(probe === undefined ? {} : { probe }) };
```

回归测试 `apps/admin/lib/admin-api-error.test.ts` 断言 `failure.probe` 与原始 `probe` 完全相等，并在普通 problem 响应中**不存在**该字段——防止下一次重构再次静默丢字段。

> 未把 probe 形状放进 `packages/contracts`（根 Agent 串行管理；且该 422 与 `POST /settings/storage/test` 一样是绕过全局 filter 的端点级契约）。`apps/admin` 不直接依赖 zod，故 `components/settings/probe-error-copy.ts` 内用**类型化本地解析器**（`SettingsProbe` / `SettingsProbeCheck`），UI 边界不是 `unknown`。

---

## 2. 实现摘要（逐 4 项）

### 2.1 错误映射表（`probe-error-copy.ts`）

- `PROBE_COPY_TABLE`：按 `probe.target` + `probe.code` 的**唯一**文案来源，组件里不写死任何失败文案。
- `{endpoint}` 占位由**当前表单草稿**（回退到上一次服务端值）替换；没有值时为「未配置」。
- 解析顺序：精确 target+code → storage 兜底（bucket/权限，`failedAt: HeadBucket` 同属此列）→ mail 的服务端 `detail` → 通用 mail 指引。**原始 code 永远不作为主文案**。
- `failedAtOf(checks)`：取第一个 `ok:false` 的步骤名，同时用于文案选择与「技术详情」。
- `settingsProbeFromError(error)`：深度受限（4 层）的结构化提取，覆盖 `failure.probe` / `body.probe` / `response.data.probe` / `cause` 等容器，带环检测；即使将来客户端再次换壳也能取到。目标/代码非法、checks 条目畸形都会被丢弃。
- `probeFallbackCopy(detail)`：`SETTINGS_PROBE_FAILED` 但 probe 缺失（代理剥离）时的兜底，仍不展示 code。

### 2.2 渲染（`probe-error-block.tsx` + `settings-console.tsx`）

- 保存失败的 error block 内依次是：mono eyebrow（`保存被拦截 · 存储/邮件`）→ **主文案**（映射结果，`text-ink` 13px）→ 可选第二行 → **逐步检查明细**（`✓ HeadBucket 95ms` / `✗ PutObject —`，失败步骤 `font-medium text-ink` + 红 ✗，成功步骤 `text-muted` + 绿 ✓，均可见）→ `<details data-probe-technical>`「技术详情」（`code` / `target` / `failedAt` / 服务端 `detail`），**默认收起**。
- `role="alert"` 在 `<section>` 上，插入即播报；✓/✗ 本身 `aria-hidden`，每行带 sr-only「通过/失败」，读屏不会只听到符号。
- 错误块为 `border-accent-red/30 bg-surface-1`（ghost/border），重试按钮 `variant="outline"`；**单屏白色 primary 仍只有保存按钮**（测试断言 retry 不含 `bg-ink`、保存按钮含）。
- `MISSING_CREDENTIALS` → `credentialNotes` 逐字段 inline `role="note"`（storage：Access Key / Secret Key；mail：`mail.from` + 按 provider 选 resend key 或 SMTP 用户名/密码）。用户在该字段开始输入后，该提示自动消失（`clearProbeNote`）。
- **表单值不丢失**：错误分支只写 banner / probeNotes，不触碰 `values` / `secretDrafts`；测试断言 endpoint、port、secret 草稿在失败后保持原值，且 secret 草稿确实随 PATCH 提交过。
- `SETTINGS_INVALID`（逐字段 errors[]）、403/2FA、网络/5xx 的既有分支与文案完全不变；probe 分支优先级最高。

### 2.3 对比度与文案

- 只使用既有 token，未新增/调整任何色值：`accent-red #ff2047`、`surface-1 #0a0a0c`、`ink #fcfdff`、`muted #a1a4a5`、`stone #7a8083`。
- 计算对比度（WCAG 相对亮度）：主文案 `text-ink`/`surface-1` ≈ **19:1**；eyebrow 与红 ✗ `#ff2047`/`#0a0a0c` ≈ **5.2:1**；成功步骤 `#a1a4a5`/`#0a0a0c` ≈ **7.8:1**；技术详情 `#7a8083`/`#0a0a0c` ≈ **4.9:1**。全部 ≥4.5:1。
- 英文原始 code 仅出现在折叠的技术详情；测试对 `[data-probe-headline]` 断言不含 `STORAGE_ENDPOINT_UNREACHABLE` / `SMTP_TIMEOUT_UNKNOWN`，且不再出现 `"Configuration rejected"`。

### 2.4 测试

`apps/admin/components/settings/` 由 30 tests → **57 tests**（+27）：`probe-error-copy.test.ts` 21 条（映射表逐项、未知 code、detail、空 endpoint、checks 归一化、错误对象提取、环检测、fallback），`settings-console.test.tsx` 18 → 24 条（+6 渲染/行为）。`apps/admin/lib/admin-api-error.test.ts` 2 条。覆盖任务要求：

- 映射项逐条：storage `STORAGE_ENDPOINT_UNREACHABLE` / `MISSING_CREDENTIALS` / `STORAGE_PUBLIC_ENDPOINT_UNREACHABLE` / 其他（bucket）；mail `CONNECTION_FAILED` / `AUTH_FAILED` / `MISSING_CREDENTIALS` / `MAIL_NOT_CONFIGURED`；两者 `PROBE_UNAVAILABLE`；未知 code。
- `probe.checks`：失败步骤可见（含 `✗ PutObject —`）且成功步骤可见（`✓ HeadBucket 95ms`）。
- 未知 code → 显示 detail、主文案不含原始 code（技术详情内保留）。
- 错误后表单值（含 secret 草稿）保持。
- 技术详情默认 `open` 属性不存在。
- `role="alert"` 存在；重试按钮非 primary。
- 既有 settings 测试无回归（18 条原样通过）。

---

## 3. 映射表实现清单（target+code → 文案）

| target | code / 条件 | 主文案（`headline`） | 附加 |
|---|---|---|---|
| storage | `STORAGE_ENDPOINT_UNREACHABLE` | 存储服务无法连接：检查 endpoint 与网络（当前 endpoint: {endpoint}） | 未配置时 `{endpoint}` = 「未配置」；`failedAt` = 首个失败步骤 |
| storage | `MISSING_CREDENTIALS` | 缺少访问凭据：请先填写 Access Key 与 Secret Key | inline note：`storage.accessKey`、`storage.secretKey` |
| storage | `STORAGE_PUBLIC_ENDPOINT_UNREACHABLE` | 对外访问地址不可达：浏览器可能无法加载图片，检查 publicEndpoint 与 CORS | — |
| storage | 其他 code（含 `failedAt: HeadBucket`、`STORAGE_READ_MISMATCH`、`STORAGE_CONFIG_INVALID`、未知） | Bucket 不存在或无权访问：检查 bucket 名称与权限 | 服务端 `detail` 作为第二行 + 技术详情 |
| storage / mail | `PROBE_UNAVAILABLE` | 探测服务不可用，配置未保存。可稍后重试 | — |
| mail | `CONNECTION_FAILED` | 无法连接邮件服务器：检查 host 与 port（465 用隐式 TLS，587 用 STARTTLS） | — |
| mail | `AUTH_FAILED` | SMTP 认证被拒：检查用户名与应用专用密码（不是账号登录密码） | — |
| mail | `MISSING_CREDENTIALS` | 缺少 mail.from 或凭据配置 | inline note：`mail.from` + provider=smtp 时 `mail.smtpUser`/`mail.smtpPassword`，否则 `mail.resendApiKey` |
| mail | `MAIL_NOT_CONFIGURED` | 邮件配置不完整：检查 provider、from 与凭据 | — |
| mail | 未知 code，有 `detail` | 服务端 `detail` 原文（第二行「邮件探测未通过：检查 host、端口、用户名与密码」） | 原始 code 仅在技术详情 |
| mail | 未知 code，无 `detail` | 邮件探测未通过：检查 host、端口、用户名与密码 | — |
| 任意 | 422 `SETTINGS_PROBE_FAILED` 但 probe 缺失 | 保存前探测失败，配置未写入 | `detail` 或「服务端没有返回探测明细；可稍后重试。」 |

主文案都不含原始 code；未知 code 的「显示 detail」与技术详情里的 `code` 通过 `[data-probe-headline]` 与 `details` 分离，测试分别断言。

---

## 4. 验证命令与结果（原始输出）

### 4.1 `pnpm --filter @roamlog/admin typecheck`

```text
$ tsc --noEmit
[exit code: 0]
```

### 4.2 `pnpm --filter @roamlog/admin exec vitest run components/settings`

```text
 RUN  v5.1.0 C:/Users/BY9700/Desktop/UI/roamlog/apps/admin

 ✓ components/settings/admin-settings.test.ts (12 tests) 12ms
 ✓ components/settings/probe-error-copy.test.ts (21 tests) 14ms
 ✓ components/settings/settings-console.test.tsx (24 tests) 2636ms
   ✓ SettingsConsole (24)
     ✓ explains a blocked storage save instead of a generic rejection 376ms

 Test Files  3 passed (3)
      Tests  57 passed (57)
   Start at  16:07:12
   Duration  5.07s
[exit code: 0]
```

### 4.3 `pnpm --filter @roamlog/admin lint`

```text
$ eslint .
[exit code: 0]
```

### 4.4 `pnpm --filter @roamlog/admin build`

第一次因**并行 Agent 正在同一棵树跑 `next build`** 而失败（`⨯ Another next build process is already running.`），等待后重跑：

```text
✓ Compiled successfully in 1277ms
  Running TypeScript ...
  Finished TypeScript in 9.6s ...
✓ Generating static pages (18/18) in 679ms
Route (app)
...
├ ƒ /admin/settings
...
[exit code: 0]
```

### 4.5 `pnpm --filter @roamlog/admin test`（全量，回归检查）

```text
 FAIL  components/admin-shell/admin-shell.test.tsx > AdminShell > does not link to the unfinished moderation page
AssertionError: expected [ '/admin', '/admin/users', …(10) ] to not include '/admin/content'
 ❯ components/admin-shell/admin-shell.test.tsx:88:23

 Test Files  1 failed | 24 passed (25)
      Tests  1 failed | 162 passed (163)
```

**归属证据（与本任务无关，HEAD 内既有失败）**：

```text
$ git diff HEAD --stat -- apps/admin/components/admin-shell apps/admin/app/admin/content
(无输出：这两个路径在 HEAD 与我改后完全一致)

$ git log --oneline -2 -- apps/admin/app/admin/content apps/admin/components/admin-shell/admin-nav.ts
5df8607 feat(admin,web): rebuild the moderation queue and add user report entry points
ef6a9e2 feat(admin): link the permission matrix from the shell nav

$ grep -rn "admin/content" apps/admin/components/admin-shell/admin-nav.ts
40:      { href: "/admin/content", label: "内容审核", icon: Flag },
```

即：`/admin/content` 页面与导航链接已随 `5df8607` 提交，而 `admin-shell.test.tsx` 仍断言该未完成页面不应被链接 → **提交之间就存在的冲突**，失败测试不 import 任何 settings 文件。本任务 5 个 settings/lib 套件在同一次全量中全部通过。

### 4.6 真实 API + Playwright 截图：**不可行**（原因）

目标目录 `.audit/evidence/admin-probe/` 未生成截图。三个具体阻断点：

1. **后台设置页有 2FA 门禁**：`/admin/settings` 需要 `super_admin` + 平台 TOTP。仓库自带的 smoke harness 已经因此跳过该旅程：
   `e2e/admin/smoke/admin-settings.spec.ts:69-73` → `test.skip(!signedIn, "ADMIN_2FA_ENFORCED: the provisioned super_admin has no TOTP secret; enable a seeded TOTP account to run this journey.")`；`e2e/support/accounts.ts` 的 `provisionSuperAdmin` 只创建密码账号，没有 TOTP secret。凭空造一个已注册 TOTP 的 super_admin 属于认证域改动，超出本任务范围。
2. **本地栈未运行**：PG 55444 在监听，但 API（4000/4260）与 Admin（3001）都没有进程；自起独立端口需要 API + Admin + 会话，而 admin 侧仍被第 1 点卡住。
3. **构建锁竞争**：同一棵树上另一个 Agent 正在 `next build`（4.4 的失败即其证据），再起 dev server 会互相抢 `.next` 锁。

替代证据：`probe-error-block.tsx` 的渲染在 jsdom 中有 6 条断言（role=alert、逐步骤 ✓/✗、折叠 details、非 primary 重试、文案与 detail、值保留），加上 §3 的映射清单；视觉 token 与对比度见 §2.3。建议由具备 TOTP 种子的验收账号在真实栈上补一张截图。

---

## 5. CodeGraph 证据

1. `codegraph status`（`roamlog/`）→ `Index is up to date`（1,772 files / 27,822 nodes / 63,822 edges）。
2. MCP `codegraph_explore`（`projectPath: C:\Users\BY9700\Desktop\UI\roamlog`）查询
   `ProbeErrorBlock probeCopyFor settingsProbeFromError PROBE_COPY_TABLE SettingsConsole save probe banner`：
   - 返回调用流：`SettingsConsole.save` →（error）→ `settingsProbeFromError`；动态渲染 `SettingsConsole → ProbeErrorBlock → Button`；`SettingsPageClient → SettingsConsole`。
   - blast radius：`probeCopyFor` 3 个调用方（均在 settings-console）、`PROBE_COPY_TABLE` 2 个（本文件）、`SettingsConsole` 4 个（settings-page-client）、`ProbeErrorBlock` 2 个（settings-console）；测试命中 `probe-error-copy.test.ts`、`settings-console.test.tsx`。
   - 确认改动只落在 console 的保存失败分支与新增组件，不触达 `AdminSettingsApi` 其它方法、`SettingField` 的既有受控逻辑或 `apps/api`。
3. 早前查询（同一任务）已确认服务端契约：`admin-settings.controller.ts:157 rejected()` 写出 `code: "SETTINGS_PROBE_FAILED"` + `probe{target,code,checks}`，`storage-probe.service.ts` 的 check 名为 `HeadBucket/PutObject/GetObject/PresignedGet/DeleteObject`，`mail.service.ts` 的 code 为 `AUTH_FAILED/CONNECTION_FAILED`，`settings-save-probe.service.ts` 的 `MISSING_CREDENTIALS/PROBE_UNAVAILABLE/MAIL_NOT_CONFIGURED` —— 映射表逐项对齐这些真实枚举，而非猜测。

---

## 6. 已知风险

1. **`lib/admin-api-error.ts` 越界改动**：已获根 Agent 明确批准（2 处增量 + 回归测试）。若其它 Agent 在本任务提交前后改同一文件，需要以 `probe` 透传为准合并，否则 UI 会静默退回通用文案——由 `admin-api-error.test.ts` 兜底报警。
2. **探测请求本身很慢**：storage 最坏可达约 37s、mail 10s（见 `settings-save-probe-report.md` 风险 1）。UI 在等待期间只有「保存中…」与禁用按钮，没有进度文案；本次未加计时/取消（会改变保存语义，需产品确认）。
3. **未知 code 的 mail 主文案是服务端英文 `detail`**：任务要求“未知 code 显示 detail”，因此该行是英文。已知 code 全部为中文；英文 detail 同时会出现在技术详情，属预期重复。
4. **`failedAt` 是推导值**：服务端 probe 体没有 `failedAt` 字段，UI 取「第一个 failed check」。若未来 probe 只返回空 checks（如 mail），技术详情显示 `—`，符合实际信息量。
5. **inline note 只在当前分组内渲染**：`credentialNotes` 可能含该分组不存在的键（例如 storage 的 secret 在 mail 组不该出现），由 `SettingField` 只对现有 item 渲染天然过滤；跨分组切换会清空 banner 与 note（与既有行为一致）。
6. **未新增 e2e/截图**：见 4.6，2FA 种子缺失是真实阻断点，不是时间借口。

## 7. 未覆盖项

- 真实 API + Playwright 截图（原因见 4.6）；建议由 2FA 种子账号补。
- `checks` 中 `DeleteObject` 之后的成功链路截图证据（本机无 MinIO，真实成功路径只有单测）。
- 保存探测的“进行中”进度/耗时提示（同步等待期间无反馈）。
- 移动端视觉检查（本次为纯错误块，沿用既有响应式类；未截图）。

## 8. 建议下一步

1. 由具备 TOTP 的验收账号在真实栈上补 `.audit/evidence/admin-probe/` 截图，覆盖 storage endpoint 不可达与 mail AUTH_FAILED 各一张。
2. 若接受，给保存探测加“预检 token”或进度提示（`settings-save-probe-report.md` 建议 4），避免 37s 静默等待。
3. 把 `probe` 形状收敛进 contracts（`packages/contracts` 由根 Agent 串行管理），替换 UI 侧本地解析器，让字段名写错在编译期暴露。
4. 修复 `admin-shell.test.tsx` 与 `/admin/content` 的既有冲突（不属本任务），否则 admin 全量测试长期 1 红。
5. 增设“结构化错误字段必须能到达 UI”的门禁（根 Agent 已在验收中加），`probe` 是第四例。