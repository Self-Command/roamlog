# Admin 登录 / 2FA 假数据审计报告

- 任务 ID: `ADMIN_LOGIN_FAKE_DATA`
- 角色: `admin_frontend`
- 日期: 2026-11-19
- 结论: **审计通过，未发现同类假数据。未修改任何产品代码。**
- 依据: CodeGraph v1.6.3（`codegraph status` 显示 1,488 文件 / 22,737 节点，索引 up to date）+ 逐文件读取 + 契约层权限矩阵核对

## 1. 审计范围（逐个文件）

| 文件 | 行数 | 结论 | 判断依据 |
| --- | --- | --- | --- |
| `apps/admin/components/login/login-panel.tsx` | 351 | 通过 | 唯一硬编码数据为角色能力矩阵（4 行）与 `ADMIN_DEMO_EMAIL`；前者逐行核对契约层权限，后者默认关闭且带可见标注，详见 §2、§3 |
| `apps/admin/components/login/two-factor-enrollment.tsx` | 292 | 通过 | 二维码、备用码、totpURI 全部来自 `auth.enableTotp()` 真实响应；空态文案为"认证服务未返回备用码"。无示例码/示例 URI |
| `apps/admin/components/login/login-panel.test.tsx` | 85 | 通过 | 断言默认不预填（`toHaveValue("")`、无 `DEMO` 文案），并断言 api 模式走 `twoFactorRedirect` + `verifyTotp` 真实传输层 |
| `apps/admin/components/login/two-factor-enrollment.test.tsx` | — | 通过 | 断言渲染 `totpURI`、本地 QR、backup codes 并完成注册（api 模式） |
| `apps/admin/app/admin/login/page.tsx` | 11 | 通过 | 仅 `Metadata` + `<LoginPanel />`，无数据注入 |
| `apps/admin/app/admin/2fa/enroll/page.tsx` | 5 | 通过 | 仅渲染 `<TwoFactorEnrollmentPanel />`，无数据注入；`app/admin/2fa/**` 下仅此一页 |
| `apps/admin/components/admin-shell/admin-session-client.ts` | 45（只读） | 通过 | 仅有真实 `authPostHandler("sign-out")` 与错误映射；无姓名/邮箱/时间/数量/ID |

审计判据（沿用 Web 端修复标准）：访客可见装饰内容不得含记录型字段（姓名 / 账号 / 时间 / 数量 / ID / 可枚举行）。上述文件中不存在任何由常量数组伪装成"活动 / 用户 / 记录"的内容。

## 2. 逐句核实（可写文件内所有事实性文案）

| 文案 / UI 元素 | 位置 | 代码依据 | 结论 |
| --- | --- | --- | --- |
| 角色能力矩阵 4 行（Support / Analyst / Admin / Super admin） | `login-panel.tsx:311-326` | `packages/contracts/src/permissions.ts:421-468`：`supportActions` 含 users/workspaces 的 read·suspend·restore 与 emails:resend；`analystActions` 含 metrics/audit/jobs read + `admin:audit:export`；`adminActions` = support ∪ analyst + users/workspaces delete + `admin:users:reset-2fa` + `admin:jobs:retry`；`super_admin` = `ADMIN_ACTIONS` 全集（含 `admin:users:change-role`、`admin:flags:update`、`admin:jobs:manage`） | 4 行 4 项能力全部为真，无夸大 |
| 角色名本身 | 同上 | `packages/api-client/.../platformRole.ts:11`、`admin-access.ts:15-18`（`assertPlatformAction` 由守卫强制执行） | 枚举值真实存在（`support`/`analyst`/`admin`/`super_admin`） |
| `2FA REQUIRED` 徽标 | `login-panel.tsx:302` | `apps/api/src/modules/admin/platform-two-factor.guard.ts:42` 返回 `ADMIN_2FA_REQUIRED`；`apps/api/src/config/app-config.service.ts:112` `ADMIN_2FA_ENFORCED ?? this.isProduction` | 策略为真；但强制默认仅在 production 开启（见 §5 精度风险） |
| "所有后台操作均按平台角色与审计规则约束" | `login-panel.tsx:86` | `admin-access.ts:15-22` + `admin-audit.service.ts` | 为真 |
| "暂停、删除、角色变更和队列操作必须经过确认并写入审计日志" | `login-panel.tsx:308` | `admin-access.ts` 动作门禁 + `admin-audit.service.ts` 写入；前端确认见 `queues-view`/`users-view` 测试 | 为真 |
| "Better Auth / same-origin /v1 proxy" / `API: SAME-ORIGIN PROXY` | `login-panel.tsx:291-293,333-334` | `apps/admin/app/v1/[...path]/route.ts` 存在并代理 `/v1/*` | 为真 |
| `ADMIN :3001` | `login-panel.tsx:295` | `apps/admin/package.json:7,9` `next dev --port 3001` / `next start --port 3001` | 为真 |
| `Data mode` / `Audit writes`（API↔BACKEND / FIXTURE↔MOCK ONLY） | `login-panel.tsx:338-343` | `lib/admin-data-mode.ts:3-9` + `admin-audit.service.ts` 实际写入 | 为真，且随模式变化 |
| "占位表单不会创建 session，也不会发送网络请求" / "输入任意 6 位数字即可进入后台" | `login-panel.tsx:159,239` | fixture 分支在调用 transport 前 return（`104-107`、`205-208`） | 为真（仅 fixture 模式显示） |
| "完成 TOTP 绑定与验证前，所有 Admin API 请求都会返回 `ADMIN_2FA_REQUIRED`" | `two-factor-enrollment.tsx:127-130` | `platform-two-factor.guard.ts:42`；与 `components/admin-ui/admin-data-boundary.tsx:112` 口径一致 | 策略为真；绝对化表述在非 production 且未设 `ADMIN_2FA_ENFORCED=true` 时不成立（见 §5） |
| "密码只用于本次 Better Auth 2FA 注册请求，不会写入前端存储" | `two-factor-enrollment.tsx:152` | `startEnrollment` 只透传给 `auth.enableTotp`，无 storage 写入 | 为真 |
| "QR 在浏览器本地生成，TOTP secret 不会发送给第三方二维码服务" | `two-factor-enrollment.tsx:181` | `lib/qr-code.ts` 的 `createQrMatrix`/`qrMatrixToSvgPath` 本地生成 | 为真 |
| `FIXTURE / 2FA ENROLLMENT` 面板 | `two-factor-enrollment.tsx:41-63` | `if (activeMode === "fixture") return ...` | fixture 专属，门控正确 |

## 3. `ADMIN_DEMO_EMAIL = "demo@roamlog.local"` 判定（保留）

- 位置: `login-panel.tsx:22,37,39`
- 门控: `process.env.NEXT_PUBLIC_ADMIN_DEMO === "1"`，默认关闭；仓库内无任何 `.env*` 设置该变量（`apps/admin` 仅有 `next-env.d.ts`），`docker/admin.Dockerfile` 只注入 `NEXT_PUBLIC_ADMIN_DATA_MODE`，生产/预发布 compose 亦未设置。
- 可见性: 开启时同时渲染 `DEMO PREFILL` 徽标（:71）与"DEMO：已通过 NEXT_PUBLIC_ADMIN_DEMO=1 预填演示邮箱，请勿用于生产"提示（:140）。
- 判定: 属于"操作者显式开启 + 可见标注"的开发者便利，不是访客默认可见的记录型装饰；与 Web 端被删除的无标注假活动卡片不同类。**不改**，仅记录。
- 测试固化: `login-panel.test.tsx:14-19`（默认不预填）与 `:21-29`（开启时预填且标注）。

## 4. 仅报告未改：fixture 数据在 api 模式下的泄漏风险

范围属 `admin-data-source` / 各 view owner，本次**只报告，未修改**。

| 文件:行 | 内容 | 渲染条件 | 是否被 `getAdminDataMode()==="fixture"` 门控 |
| --- | --- | --- | --- |
| `apps/admin/components/audit/audit-view.tsx:264-268` | Actor 筛选 `<Select>` 直接 `MOCK_ADMIN_USERS.map(...)`，把 fixture 管理员**姓名**作为可选项列出 | 审计页筛选栏（`230-270`），无条件渲染 | **否**。同文件 `audit-view.tsx:45` 的 actor 名称映射已按 `mode === "api"` 降级为 `actor <id8>`（:42-43），但下拉选项漏了同样的门控；fixture 专属侧栏 `:387` 门控正确 |
| `apps/admin/components/audit/audit-view.tsx:45` | `MOCK_ADMIN_USERS.find(...)?.name`（仅 fixture 分支，已正确由 :42 先行拦截） | 表格 actor 列 | 是（正确做法，可作对照） |

建议 owner 修复方式（不要在本任务外顺手改）：把 :264 的选项改为 `mode === "fixture" ? MOCK_ADMIN_USERS.map(...) : null`，或 api 模式改为按 `actorId` 输入筛选。

已抽样确认**无**泄漏的同组位置：`components/admin-shell/mock-session-provider.tsx:96-114` 在 api 模式用 `/v1/me` 的 name/email/role，且明确不渲染 fixture 的 `twoFactorEnabled`/`environment`；`admin-sidebar.tsx:176` 角色切换提示为 fixture 分支；`admin-command-palette.tsx:49,60,97` 由 `dataMode === "fixture"` 门控。

## 5. 已知风险

1. `2FA REQUIRED` 徽标与 `two-factor-enrollment.tsx:128-129` 的"所有 Admin API 请求都会返回 `ADMIN_2FA_REQUIRED`"是**无条件/绝对化**表述，而强制默认值 `ADMIN_2FA_ENFORCED ?? isProduction`（`app-config.service.ts:112`）意味着本地 api 模式（非 production 且未设该变量）不会强制。属文案精度问题，非伪造记录，本次不改以免引入未经核实的新文案。
2. 本任务只覆盖登录/2FA 三个目录 + 会话客户端；fixture 泄漏项（§4）为抽样，非 `apps/admin` 全量扫描。
3. 未运行浏览器视觉检查（按要求未启动任何服务），文案与布局的正确性仅基于代码与既有测试。

## 6. 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @roamlog/admin typecheck` | exit 0，`tsc --noEmit` 无输出（0 错误） |
| `pnpm --filter @roamlog/admin exec vitest run components/login` | exit 0，2 个文件 / 7 个测试全通过 |
| `pnpm --filter @roamlog/admin lint` | exit 0，`eslint .` 无输出 |

（因未修改产品代码，以上为基线复验，非回归验证。）