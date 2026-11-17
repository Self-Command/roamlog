# W3-ADMIN-LIVE 交付报告

状态: DONE（存在 1 个后端契约缺口）

任务 ID: W3-ADMIN-LIVE

## 变更文件

- `apps/admin/app/admin/**`
- `apps/admin/app/v1/[...path]/route.ts`
- `apps/admin/app/layout.tsx`
- `apps/admin/components/admin-ui/**`
- `apps/admin/components/admin-shell/**`
- `apps/admin/components/login/**`
- `apps/admin/components/dashboard/**`
- `apps/admin/components/content/**`
- `apps/admin/components/media/**`
- `apps/admin/components/emails/**`
- `apps/admin/components/flags/**`
- `apps/admin/components/queues/**`
- `apps/admin/components/users/**`
- `apps/admin/components/workspaces/**`
- `apps/admin/lib/**`
- `apps/admin/package.json`

未修改 Web、API、Worker、`packages/contracts`、`packages/db` 或根配置。

## 实现摘要

- 新增 `NEXT_PUBLIC_ADMIN_DATA_MODE=fixture|api`，默认 `fixture`。当前 3001 预览继续使用同步 fixture，不发送 Admin API 请求。
- 新增同源 `/v1/[...path]` 代理，转发 cookie、请求头与多个 `Set-Cookie` 到 `http://localhost:4000`，避免 Admin 浏览器端跨域和 httpOnly session cookie 问题。
- `admin-data-source.ts` 扩展为 fixture 资源 + API hooks/adapter：
  - metrics、users、workspaces、trips/entries/comments、media、audit、flags、emails、jobs、system 均通过 `@roamlog/api-client` hooks 读取。
  - users/workspaces suspend/restore/delete/role、force logout、reset 2FA、content delete/restore、media delete、flag update、email resend、job retry 通过生成 mutation 提交。
- 页面只消费 `AdminDataBoundary` 资源，不直接 fetch。API 模式有 loading、empty、network/HTTP error、`ADMIN_2FA_REQUIRED` gate、403/401 与 `x-roamlog-degraded` 可见状态。
- `AdminDataBoundary` 外层增加稳定 client-only 边界：SSR 与 hydration 首帧都输出同一“正在准备后台视图”占位，挂载后再渲染 Radix Switch/Checkbox 页面内容。根因是 Radix 隐藏 input 的 `style` 属性在 SSR 与客户端首次渲染中不一致；未使用 `suppressHydrationWarning`，console guard 未关闭或放宽。
- API 模式平台角色来自 `/v1/me`，侧栏角色切换被锁定；前端 `canPlatform` 只做 UX guard，最终权限由后端 guard 决定。
- 登录页 API 模式调用 Better Auth：
  - `POST /v1/auth/sign-in/email`
  - 识别 `twoFactorRedirect`
  - `POST /v1/auth/two-factor/verify-totp`
- 新增 `/admin/2fa/enroll`：
  - `POST /v1/auth/two-factor/enable`
  - 展示 `totpURI`、本地生成 QR、backup codes
  - `verify-totp` 成功后返回后台
  - fixture 模式保留演示说明，不发起真实注册
- QR 由本地纯 TS 生成器生成，TOTP secret 不发送到第三方二维码服务。
- API 列表/详情契约差异处理：
  - 列表接口未返回 users/workspaces 的详情计数与成员/会话明细时，UI 显示 `—` 和明确说明，不伪造 fixture 明细。
  - API 模式不展示 fixture audit actor 名称或 fixture workspace/user 明细。

## 依赖

`apps/admin/package.json` 新增：

- `@roamlog/api-client`: `workspace:*`
- `@tanstack/react-query`: `5.107.1`

本地验证时创建了 `apps/admin/node_modules/@roamlog/api-client` workspace symlink；未手工修改 lockfile。运行 `pnpm exec tsx` 校验二维码时，pnpm 打印了一次 workspace install 的幂等检查（`Already up to date`，无新下载）。

## 验证命令与结果

```text
pnpm --filter @roamlog/admin test
Test Files  15 passed (15)
Tests       34 passed (34)

pnpm --filter @roamlog/admin typecheck
tsc --noEmit 通过

pnpm --filter @roamlog/admin build
Next.js 16.4.6 production build 通过
包含 /admin/2fa/enroll 与 ƒ /v1/[...path]

pnpm exec playwright test --project=admin
8 passed (8)
flags / roles / responsive console guard 全部通过
```

验证后预览仍可用：

```text
http://localhost:3000 -> 200
http://localhost:3001/login -> 200
http://localhost:3001/admin -> 200
http://localhost:3001/admin/flags -> 200
http://localhost:3001/v1/admin/metrics -> 503 ADMIN_API_UNAVAILABLE（当前 API:4000 未启动，代理错误结构可见）
```

## 测试覆盖

- 原有 25 项 Admin fixture 测试继续通过。
- 新增 API adapter 测试：
  - 默认模式为 fixture
  - 403 `ADMIN_2FA_REQUIRED` 与 degraded header
  - mutation 成功透传
  - mutation 失败抛 `AdminMutationError`
  - 平台角色映射以后端值为准
- 新增 2FA UI 测试：
  - credentials → `twoFactorRedirect` → TOTP challenge
  - enrollment 展示 QR、totpURI、backup codes 并完成 verify
  - fixture enrollment 不发起网络注册
- 新增 `AdminDataBoundary` 403 2FA gate 测试。
- 新增 hydration 回归测试：服务端渲染 `AdminDataBoundary` 内 Radix Switch 时，HTML 不得包含隐藏 `type="checkbox"` input，并必须输出稳定占位。
- QR 生成器用独立 QR 参考实现做过 ASCII otpauth URI 的逐模块对比（同 mask 下 0 差异）。

## 已知风险与未覆盖项

- 验证时 API `:4000` 未启动，未使用真实 API + 已注册 TOTP 的管理员账号跑完整浏览器端 2FA enrollment → session → Admin mutation E2E。当前证据是生成 client 编译、adapter/UI 单测、proxy 503 错误结构、production build。
- 当前 Admin API 契约没有队列 pause/resume/clear、测试邮件入口。API 模式下这些控件保持可见但禁用，并明确提示契约缺口；失败任务 `retry` 已接入真实 mutation。
- Admin API users/workspaces 列表返回基础实体，不包含详情计数、会话或成员列表。API 模式显示 `—`/说明，避免把 0 当成真实值；后续建议补列表详情字段或按需详情请求。
- Dashboard 没有趋势时间序列端点，API 模式只展示当前 metrics 快照单点；邮件健康由最近 100 条邮件日志推导，不是全量统计。
- client-only 边界会让 Admin 业务页首屏先显示短暂准备占位，再显示真实页面；这是为避免 Radix SSR/hydration 属性不一致的明确取舍。
- `apps/admin/next-env.d.ts` 在 build 后由 Next.js 自动切换为 `.next/types`，已恢复原 `.next/dev/types` 内容，避免生成噪音。
- 根工作区存在其他 Agent 对 Web、API、根 `package.json`、`pnpm-lock.yaml` 的并发改动；本报告不声称验证了这些改动。

## 建议的下一步

1. 在 API 已启动、测试管理员已具备 TOTP 的环境中跑一次完整 E2E：登录 challenge → `/v1/me` → Admin metrics → user suspend → audit 记录。
2. 补 Admin users/workspaces 详情字段或详情接口消费，替换当前 `—` 占位。
3. 由后端补队列 pause/resume/clear 与测试邮件端点后，再开放对应 API 模式操作。
4. 将 fixture/API 双模式加入 Playwright smoke：fixture 3001 视觉回归 + API 模式关键权限路径。
