# W4-WEB-2FA — Web Better Auth 2FA UX

状态: NEEDS_REVIEW

任务 ID: W4-WEB-2FA

## 变更文件

- `apps/web/lib/api/auth.ts`
- `apps/web/components/auth/login-form.tsx`
- `apps/web/components/auth/login-form.test.tsx`
- `apps/web/components/auth/two-factor-security.tsx`
- `apps/web/components/auth/two-factor-security.test.tsx`
- `apps/web/components/auth/totp-qr.tsx`
- `apps/web/components/auth/qr-code.ts`
- `apps/web/app/(auth)/settings/security/page.tsx`
- `W4_WEB_2FA_REPORT.md`

本任务未新增依赖。工作区中的 `apps/web/package.json` 与 `pnpm-lock.yaml` 改动来自并行 Map/Editor 任务，不属于本交付。

## 实现摘要

- 登录 credentials 成功后解析 Better Auth `twoFactorRedirect`，进入 TOTP challenge，不再直接跳转。
- Challenge 支持验证器 6 位码和一次性备用码；包含错误重试次数、挑战过期、临时锁定、403 权限错误和网络失败文案。
- 新增 `/settings/security` 独立账号安全页：
  - API 模式读取真实 `get-session`，显示 `twoFactorEnabled`。
  - 2FA 开关 → 确认当前密码 → `two-factor/enable` 返回 `totpURI` + `backupCodes`。
  - QR 在浏览器本地生成，显示可复制的 TOTP secret。
  - 显示本次生成的剩余备用码与一次性语义，验证 6 位 TOTP 后才标记启用。
  - 支持重新生成整组备用码，以及验证密码 + 当前 TOTP 后关闭 2FA。
  - mock 模式明确显示 `DEMO / MOCK MODE`、`NO REAL ENROLLMENT`，开关禁用，不伪造注册、QR 或备用码。
- Better Auth 调用路径：
  - `POST /v1/auth/sign-in/email`
  - `POST /v1/auth/two-factor/enable`
  - `POST /v1/auth/two-factor/verify-totp`
  - `POST /v1/auth/two-factor/verify-backup-code`
  - `POST /v1/auth/two-factor/generate-backup-codes`
  - `POST /v1/auth/two-factor/disable`
  - `GET /v1/auth/get-session`
- 键盘与屏幕阅读器：真实 label、`role=alert`、`role=status`、`aria-pressed` 方式切换、按钮 focus-visible、QR `role=img`、本地成功/错误状态。

## 验证命令与结果

```text
pnpm --filter @roamlog/web test
13 test files passed, 34 tests passed (工作区并行任务增加了测试，最终复跑结果)
```

包含新增覆盖：

- enroll：`totpURI`、本地 QR、secret、备用码、6 位验证后启用。
- 错误 TOTP：`401 INVALID_CODE` 文案与失败次数提示。
- 备用码挑战：`verify-backup-code` 后完成登录。
- disable：验证当前 TOTP 后调用 `two-factor/disable(password)`。
- 重新生成备用码：替换整组并标注一次性。
- mock 模式：明确 demo，不触发网络注册。
- 错误映射：401 / 403 / 429。

```text
pnpm exec eslint -c eslint.config.mjs <本任务文件>
exit 0，无输出
```

```text
scoped tsc check
No TypeScript errors in W4-WEB-2FA files.
```

完整 `pnpm --filter @roamlog/web typecheck` / `next build` 当前被并行 Map 任务阻塞：

```text
components/map/map-canvas.tsx — MapLibre event / MapRef 类型不匹配
components/map/trip-map.tsx — override 修饰符错误
next build: Compiled successfully in 5.2s，但 TypeScript 阶段失败
```

上述错误文件不在本任务可写范围，也未由本任务修改。

## 截图/日志/接口证据

- `GET http://localhost:3000/settings/security` → HTTP 200。
- Playwright 视觉检查：
  - Desktop `1440×1000`，mock 模式安全页正常。
  - Mobile `390×844`，标题、demo 卡片与禁用开关无横向溢出。
  - 临时截图：`%TEMP%\w4-web-2fa-desktop.png`、`%TEMP%\w4-web-2fa-mobile.png`。
- Vitest 输出中的 `HTMLCanvasElement.getContext()` 提示来自 jsdom 下现有 UI/QR 测试环境，不是失败；QR 仍由 SVG path 渲染并通过 `role=img` 断言。

## 已知风险

- Better Auth 客户端接口不返回备用码的精确剩余数量。页面只在生成新码时显示“当前剩余 N 个”，并明确说明使用后由服务端立即删除；没有伪造跨设备实时计数。若产品要求持续显示精确剩余数，需要 API/integrator 增加安全计数契约。
- Better Auth `two-factor/disable` 实际接受密码，不接受 TOTP code。本 UI 先校验当前 TOTP，再调用 disable(password)，以满足“关闭需验证码”的产品要求；这比单独密码更严格。
- 未进行真实 PostgreSQL / Better Auth 浏览器 E2E；真实 API 链路仅按已通过的 API integration contract 对齐。
- `qr-code.ts` 从 Admin 的本地 QR 实现复制到 Web，避免第三方二维码服务泄露 secret。后续可提取为共享包以消除重复。
- 完整 build 被并行 Map 文件类型错误阻塞，需 Map 负责人修复后重新执行根验收。

## 未覆盖项

- 真实 API 模式的 live enroll/challenge/disable 浏览器 E2E。
- 邮件恢复 2FA（当前 Better Auth 2FA 方案使用备用码恢复）。
- 信任设备 30 天选项未暴露到 Web UI。
- 精确备用码剩余计数（受当前客户端契约限制）。

## 建议的下一步

1. Map 任务修复后重新运行完整 `typecheck` 与 `build`。
2. API/integrator 评估是否提供安全的备用码剩余计数或重新生成提示。
3. 在真实 API 模式补 Playwright E2E：enroll → 错误 TOTP → 正确 TOTP → 登出 → challenge → 备用码 → disable。
