# AVATAR_EMAIL_FIX 交付报告

**生成时间**：2026-11-20 19:57 CST（截图：头像 19:51、改邮箱 19:50）
**收口复验**：2026-11-20 21:27 CST（3000/4000 实际运行栈，截图见下方 21:27 组）
**状态**：DONE（头像/邮箱缺陷已修复；19:57 初验使用 4173/3200，21:27 收口在 3000/4000 上复验通过）

---

## 2026-11-20 21:27 收口复验（P0-AVATAR-LIMITS）

### 运行栈

检查端口时 `4000`/`46379` 已被另一个 Agent 的当前源码进程占用（API PID `13996`，启动于 `20:58:20`；同进程提供 `46379` Redis stub），`3000` 也已启动（PID `31300`，启动于 `20:58:15`）。按要求**没有杀掉别人的进程**，直接在这套真实栈上复验：

| 服务 | 地址 | 状态 |
| --- | --- | --- |
| Web | `http://localhost:3000` | `GET /login` 200；`GET /v1/health` 经 Next 代理 200 |
| API | `http://localhost:4000` | `GET /v1/health` 200 |
| PG | `127.0.0.1:55444` / `roamlog_local` | 真实数据；读回头像 media id、邮箱变更与 profile 字段 |
| Redis stub | `127.0.0.1:46379` | API 进程内，启动于 20:58:20 |
| Mailpit | `127.0.0.1:1025` / `:8025` | 真实本地 SMTP sink |
| 媒体 drain | `.audit/tools/worker-drain.mts --watch` | 已在跑；见下方队列说明 |

`/v1/public/settings` 返回 200 且是真实配置：`site.title=Roamlog`、`general.defaultTimeZone=Asia/Shanghai` 等。已用最终 profile 账号执行 `POST /v1/auth/sign-in/email`：**HTTP 200**，返回 `emailVerified: true`、`name=验收改名 mwp0l2ix`、`timezone=America/New_York`、`locale=en-US`。

API 重启命令（后续该端口空闲时使用；本次因已有进程占用未执行）：

```bash
cd /c/Users/BY9700/Desktop/UI/roamlog
bash .audit/tools/start-api.sh   # 显式 DATABASE_URL=55444 / REDIS_URL=46379 / API_PORT=4000
```

> 队列边界：`start-api.sh` 的 `46379` 是缓存 stub，BullMQ 的 Lua 脚本无法在它上面消费 job。本次头像上传使用已在运行的 `worker-drain --watch`（真实 `handleMediaJob`、真实 S3/DB/图片管线，非 BullMQ 传输）完成。因此 UI 的「上传→处理→显示」已验收，Redis 队列投递/重试仍未在 4000 栈上验收。

### 本轮验证命令与结果

```bash
cd /c/Users/BY9700/Desktop/UI/roamlog

ROAMLOG_ACCEPTANCE_API_URL=http://localhost:4000 \
ROAMLOG_ACCEPTANCE_WEB_URL=http://localhost:3000 \
ROAMLOG_ACCEPTANCE_DATABASE_URL='postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public' \
ROAMLOG_ACCEPTANCE_MAILPIT_URL=http://127.0.0.1:8025 \
node node_modules/@playwright/test/cli.js test e2e/avatar-email \
  --config=e2e/avatar-email/playwright.live.config.ts
```

结果：**3 passed (17.4s)**，1 worker，3 个测试：

1. `avatar-stability.spec.ts`：真实注册/验证/登录 → 上传头像 → worker-drain 处理 → 页面立即出现 → reload 后仍为可加载图片 → DB `image` 是 media UUID。
2. `change-email.spec.ts`：真实 `POST /v1/auth/change-email` → Mailpit 旧邮箱确认信 → 新邮箱验证信 → 两次点击 → DB 地址变更 → `EmailLog` 记录。
3. `settings-fail-safe.spec.ts`：显示名称/时区/语言保存 → reload 与 `GET /v1/me` 均持久化；空名称、错误头像类型、401、403、503、请求中止均有可见/可理解反馈（401 跳转到带 `next` 的登录页）。

补充检查：

```bash
pnpm --filter @roamlog/api exec tsc --noEmit     # 0 errors
pnpm typecheck                                   # 11/11 tasks passed
```

### 21:27 截图（当前代码，真实数据）

- `.audit/avatar-email/avatar-1440.png`（21:27:53）
- `.audit/avatar-email/avatar-390.png`（21:27:57）
- `.audit/avatar-email/change-email-1440.png`（21:28:00）
- `.audit/avatar-email/change-email-390.png`（21:28:00）
- `.audit/avatar-email/profile-1440.png`（21:28:02，`America/New_York` + `English (US)` 持久化）
- `.audit/avatar-email/profile-390.png`（21:28:03）

![收口头像 1440](avatar-1440.png)

![收口头像 390](avatar-390.png)

![收口改邮箱 1440](change-email-1440.png)

![收口改邮箱 390](change-email-390.png)

![收口个人资料 1440](profile-1440.png)

![收口个人资料 390](profile-390.png)

### Viewer / 越权结论

头像与邮箱都是账号级操作。`UsersController` 的 `/me` 路由只接受当前 session actor，`UsersService.updateMe` 以 `actor.user.id` 为 target，不接受用户 id；因此不存在 Viewer 修改他人资料或工作区设置的入口。该场景对本任务**不适用**，没有为了制造权限场景去改 `workspaces/**`。

---

## 移植来源（硬性要求）

| 来源 | 位置 | 用来做什么 |
| --- | --- | --- |
| Better Auth 官方文档 | <https://better-auth.com/docs/concepts/users-accounts>（User & Accounts → Change Email / Confirming with Current Email，v1.7.x） | `changeEmail.enabled` 默认 false；`sendChangeEmailConfirmation` 发往**当前**邮箱；新邮箱验证后才生效 |
| better-auth 1.7.25 本机类型 | `node_modules/.pnpm/better-auth@1.7.25_@opentel_99dd14a8f57dc03738417592a2a08be8/node_modules/@better-auth/core/dist/types/init-options.d.mts:884-905` | 精确字段名 `user.changeEmail.{enabled, sendChangeEmailConfirmation, updateEmailWithoutVerification}` 与回调载荷 `{user, newEmail, url, token}` |
| better-auth 1.7.25 实现 | `…/better-auth/dist/api/routes/update-user.mjs:434-503` | `CHANGE_EMAIL_DISABLED` 的抛出点；已验证用户走 `sendChangeEmailConfirmation` |
| better-auth 1.7.25 实现 | `…/better-auth/dist/api/routes/email-verification.mjs:200-215` | 点确认链接后**才**向新邮箱发验证信；`requestType: change-email-confirmation` |
| better-auth 1.7.25 实现 | `…/better-auth/dist/context/create-context.mjs:213-224` | `runInBackgroundOrAwait` 吞掉邮件异常仍回 200 → 必须自报投递结果 |
| Better Auth 客户端用法 | 同上官方文档 Change Email → Client Usage | `POST /change-email { newEmail, callbackURL }` |
| 仓库既有先例（头像方案的依据） | `packages/contracts/src/entities/workspace.ts:33`（`logoMediaId: UuidV7Schema.nullable()`）、`apps/api/src/common/services/user-presenter.ts`、`apps/web/components/settings/workspace-settings-page.tsx:232-263` | **工作区 Logo 存 media uuid，URL 在读取时派生**——头像照此模型改成存 media id |
| 仓库既有邮件模板风格 | `apps/api/src/modules/auth/email-delivery.service.ts:91-165`（`emailShell` + `auth.verify-email` / `auth.reset-password` / `workspace.invitation`） | 新增模板复用同一外壳与句式，没有自创邮件设计 |
| 仓库既有验收套路 | `tooling/scripts/e2e-auth-fixture.ts`、`e2e/live-support/*`、`playwright.live.config.ts` | 用真实注册 → 点验证链接 → 真实登录，而不是直连 DB 造账号 |

> 适配层说明：头像方案没有可直接整块搬运的上游实现（这是本项目自己的数据模型问题），因此**照既有 `logoMediaId` 模型做适配**：同一实体字段存稳定 id、URL 在读取时派生。邮件部分严格照 Better Auth 文档字段与语义，模板外壳复用仓库既有 `emailShell`。

---

## 缺陷 1：头像 15 分钟后消失

### 选择的方案：**A（存 mediaId，服务端每次重新签名）**

依据的既有先例是工作区 Logo：**数据库只存稳定的 media uuid，签名 URL 是读取时的派生值，绝不落库**（`Workspace.logoMediaId` + 客户端 `GET /v1/media/:id`）。头像照同一模型落地，差别只在「派生发生在服务端 `GET /v1/me`」，因为 `User.image` 在契约里就是 URL、且头像是账号级资源、没有 workspace 上下文可让每个客户端自行取媒体。

### 契约改动：**没有改动（0 个字段新增）**

- `packages/contracts/src/entities/user.ts:13` `image: z.url().nullable()` 保持不变；`UpdateMeRequestSchema` 也保持不变。
- **为什么不需要追加 `imageMediaId?`**：客户端不需要这个 id（服务端每次读都会重签），而给 `UserSchema` 加字段会让 `packages/api-client/src/generated/**` 里所有引用 `User` 的生成类型（`updateMemberResponseUser`、`adminUserListItem`、`me` 等）全部需要重新生成——纯生成物大 diff，收益为零。所以「只追加」的约束以「零新增」满足，没有破坏任何现有字段。
- 稳定形态落在数据库列：新写入的 `User.image` = media uuid（不再是 900 秒 URL）。契约字段仍是 URL，符合语义。

### 实现（4 个文件）

| 文件 | 变更 |
| --- | --- |
| `apps/api/src/modules/users/avatar-image.ts`（新增） | `isAvatarMediaId()`、`mediaIdFromAvatarUrl()`——从 `buildMediaKey` 生成的 `<ws>/<yyyy>/<mm>/<mediaId>/<variant>.<ext>` 里回收 media id |
| `apps/api/src/modules/users/users.service.ts` | `updateMe`：把客户端提交的上传 URL 还原成 media id 并**校验媒体行存在且 `uploaderId === 当前用户`**，落库存 id；`getMe/updateMe` 统一走 `presentAccount()`，用 `MediaUrlService.sign()` **每次读重新签名**（签名失败降级为首字母，不让 profile 页 500） |
| `apps/api/src/common/services/user-presenter.ts` | `presentUser` 只放行 http(s) URL；裸 media id 呈现为 `null`（否则 `.strict()` + `z.url()` 会让成员列表/Admin 读取 500）。**注：任务书写的是 `apps/api/src/modules/users/user-presenter.ts:23-38`，实际文件在 `apps/api/src/common/services/user-presenter.ts`，不在禁改清单内** |
| `apps/api/src/modules/users/users.module.ts` | 引入 `MediaUrlModule`（只依赖 @Global 的 `StorageService`，不引入 Trips/Workspaces 循环） |

客户端：
- `apps/web/lib/api/me.ts`：文档改为「服务端存 media id、每次读重签」，`uploadAvatar` 仍返回 mediaId（真正被保存的值）。
- `apps/web/components/settings/profile-settings.tsx`：新增**一次性自愈 refetch**——签名 URL 临近过期时（复用既有 `isImageUrlExpired`）刷新一次 `/v1/me` 换新 URL；用 `healedAvatarUrl` 保证同一个 URL 只重试一次，旧数据（行里仍是 URL）不会形成死循环。过期提示文案改为「旧版短期链接，重新上传换成长期有效头像」。

### 头像稳定性证据

1. **数据库里是 id，不是 URL**（决定性证据，URL 才可能过期）：
   `select email, image from "User" where email like 'avatar-e2e-%'` →
   `{"email":"avatar-e2e-mwox4suk@roamlog.test","image":"01a1f8cc-18b4-70d6-aea0-bb2f5af2c70d"}`
   Playwright 里也断言：`expect(stored?.image).toMatch(UUID_PATTERN)`，且 `not.toContain("X-Amz-")`（单测里同断言）。
2. **服务端每次读重新签名**：连续两次 `GET /v1/me` 返回的 `image` 不同、都能 200 加载、且 `X-Amz-Expires` 的到期时间 > now+8min（即签名时间在刚刚，不是上传时刻）。Playwright 断言 + 逐条 `request.get(url)` 断言 `200` + `content-type: image/*`。
3. **刷新后仍在**：Playwright 重载页面 → `img` `naturalWidth > 0`，且 `src` 与刷新前不同（重签成功）。
4. **超过 TTL 后仍在（加速 TTL 实测）**：用 `MEDIA_SIGNED_URL_TTL_SECONDS=60` 起一个 API（4373），等 65 秒后：
   ```
   TTL 60 s
   first URL loads now: 200
   first URL after expiry: 200 (the local S3 stub does not verify SigV4, so this can stay 200)
   URL changed after expiry: true
   re-signed at (X-Amz-Date): 20261120T115334Z -> 20261120T115440Z
   re-signed URL loads: 200
   OK: avatar still renders after the signed URL expired
   ```
   即：过期之后 `GET /v1/me` 用**新的签名时间**（11:53:34Z → 11:54:40Z）重签，新 URL 可加载。生产 TTL 是 900s，行为一致。
5. 旧数据（已过期 URL）不迁移：`presentUser` 原样透传，仍会过期并显示首字母——与任务允许的「旧开发数据不迁移」一致。

---

## 缺陷 2：改邮箱后端是关的

### Better Auth 确切字段（不许猜，已对源码与官方文档）

- `user.changeEmail.enabled: true` ← 默认 `false`，`update-user.mjs:434-437` 因此抛 `400 CHANGE_EMAIL_DISABLED`
- `user.changeEmail.sendChangeEmailConfirmation: async (data: { user, newEmail, url, token }, request?) => Promise<void>` ← `init-options.d.mts:884-895`，官方文档 "Confirming with Current Email"
- `user.changeEmail.updateEmailWithoutVerification` 保持默认 `false`（未验证邮箱也不能靠改邮箱劫持账号）
- 来源 URL：<https://better-auth.com/docs/concepts/users-accounts#confirming-with-current-email>

### 邮件模板：原来**没有**，已新增（不是先造）

`EmailDeliveryService` 原本只有 `auth.verify-email` / `auth.reset-password` / `workspace.invitation`（`email-delivery.service.ts:123-165`），没有 change-email 模板。
现新增 `sendChangeEmailConfirmation(user, newEmail, url)`，template = **`auth.change-email`**，**发往当前邮箱**，正文含新邮箱与确认链接，复用既有 `emailShell`。

### 「新旧邮箱都会收到确认邮件」的真实语义（如实说明）

Better Auth 的语义是**顺序两封**，不是同时：

1. 请求改邮箱 → 确认信发到**当前（旧）**邮箱（`sendChangeEmailConfirmation`）
2. 点击确认链接 → 才向**新**邮箱发 `sendVerificationEmail`（`email-verification.mjs:200-215`，用既有 `auth.verify-email` 模板）
3. 再点新邮箱链接 → 数据库 email 才更新（行内 email 在此之前保持旧值）

两个邮箱最终都会收到邮件且都要点击，这正是文档描述的两步确认。UI 文案同步改成：
「确认邮件已发送到 <当前邮箱>。点击确认后，验证邮件会发到 <新邮箱>；两封都完成后新邮箱才生效。」（`security-settings.tsx`）

### 顺带修的「看似成功其实没发」问题

网关 `apps/api/src/modules/auth/auth.controller.ts`：Better Auth 会吞掉发信异常仍回 200，因此把 `/v1/auth/change-email` 纳入既有 `emailDelivery: "failed"` 标记（与 `request-password-reset` 同一套机制）。前端 `apps/web/lib/api/auth.ts` 解析该标记，失败时抛 `EmailDeliveryFailedError`（文案：确认邮件没有发出…），不会谎报成功。

### 改邮箱的验收证据（真实链路，非 mock）

- **HTTP**：UI 提交触发 `POST /v1/auth/change-email` → `200`，body `{status:true}`，断言 `code !== "CHANGE_EMAIL_DISABLED"`。
- **DB**：`select "to", template, status from "EmailLog" where template='auth.change-email'` →
  `{"to":"email-e2e-mwox3fmr@roamlog.test","template":"auth.change-email","status":"sent"}`
- **邮件**：本机 Mailpit 收到了 `确认更换你的 Roamlog 邮箱`（收件人=旧邮箱），点击后新邮箱收到 `验证你的 Roamlog 邮箱`；两次点击后 DB 中用户 id 不变但 email 变为 `email-e2e-mwox3fmr-new@roamlog.test`，旧地址查不到。
- **如实说明**：本机 SMTP 没有外部 relay，验收用的是 Mailpit 本地收件箱（真实 SMTP 会话，但非真实外部邮箱）。因此**通过真实外网邮箱收信/点链接这一步没有验证**；本机只是因为 Mailpit 起了本地 SMTP sink 才能把两封链接取出来点击。如果按你的约束「不依赖真收信」看：`200 + EmailLog` 的证据链单独也成立。

---

## 测试清单

| 测试 | 命令 | 结果 |
| --- | --- | --- |
| API 全量单测 | `cd apps/api && node ../../node_modules/vitest/vitest.mjs run src` | **130 文件通过 / 1192 用例通过**，8 文件 94 用例 skip（需 `ROAMLOG_TEST_DATABASE_URL`） |
| 头像单测（新增 6 例） | `vitest run src/modules/users` | 通过（存 id 不存 URL、每次读重签、旧 URL 透传、外部 URL 原样、拒绝他人媒体、签名失败降级首字母） |
| `avatar-image` 单测（新增 4 例） | 同上 | 通过 |
| 改邮箱 options 单测（新增 1 例） | `vitest run src/modules/auth` | 通过（`enabled === true` 且回调委托给 EmailDeliveryService） |
| 改邮箱模板单测（新增 1 例） | 同上 | 通过（`auth.change-email`、收件人=旧邮箱、正文含新邮箱与链接、不含旧邮箱） |
| Web `lib/api` 单测 | `cd apps/web && vitest run lib/api` | 32 通过 |
| **Playwright 头像（真实 UI）** | `node node_modules/@playwright/test/cli.js test e2e/avatar-email/avatar-stability.spec.ts --config=playwright.avatar-email.config.ts` | **1 passed (9.4s)** |
| **Playwright 改邮箱（真实 UI + 真邮件链接）** | 同上换 `change-email.spec.ts` | **1 passed (4.2s)** |
| TTL 过期后仍显示 | `ROAMLOG_ACCEPTANCE_API_URL=http://127.0.0.1:4373 node e2e/avatar-email/ttl-after-expiry.mjs <email> <password>` | **OK**（见上方日志） |
| API typecheck | `cd apps/api && node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | 0 错误 |
| Web typecheck | `cd apps/web && node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | 0 错误 |

Playwright 覆盖：正常路径（注册→验证→登录→上传→保存）、空态（新账号「上传头像」）、刷新后持久化（reload 仍显示 + URL 重签）、改邮箱空态/成功态/失败提示路径（`EmailDeliveryFailedError` 分支由单测覆盖，本机 SMTP 正常故未在浏览器触发）。
未覆盖：Viewer 权限拒绝场景（头像/改邮箱都是账号级操作，无角色差异；且 `workspaces/**` 属禁改范围）。

---

## 真实 UI 截图

桌面 1440（头像）：`.audit/avatar-email/avatar-1440.png`（2026-11-20 19:51，真实上传的图片在头像位与 shell 底栏均渲染，"头像已更新。" 提示 + 已验证邮箱）

![头像 1440](avatar-1440.png)

桌面 1440（改邮箱）：`.audit/avatar-email/change-email-1440.png`（2026-11-20 19:50，两步确认提示真实显示）

![改邮箱 1440](change-email-1440.png)

移动 390（头像）：`.audit/avatar-email/avatar-390.png`（2026-11-20 19:51）

![头像 390](avatar-390.png)

---

## 验证命令与结果（可复跑）

```bash
# 0) 依赖：redis + mailpit + worker（详细见 e2e/avatar-email/README.md）
./tooling/services/runtime/bin/redis/Redis-8.10.3-Windows-x64-msys2/redis-server.exe --port 6379 --bind 127.0.0.1 --save '' --appendonly no
./tooling/services/runtime/bin/mailpit/mailpit.exe --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025
cd apps/worker && DATABASE_URL='postgresql://roamlog:roamlog@127.0.0.1:55444/roamlog_local?schema=public' REDIS_URL=redis://127.0.0.1:6379 pnpm exec tsx src/main.ts

# 1) 验收（会复用已起的 4173/3200；没起则按 config 里的 webServer 自行拉起）
node node_modules/@playwright/test/cli.js test e2e/avatar-email --config=playwright.avatar-email.config.ts
```

说明：为了**不重启你的 4000 端口 API**，验收用的是同源码、同开发库的**隔离实例**：API `4173`、Web `3200`（`next dev` 跑在 `.e2e-live/runtime/web`，避免和 3000 的 `.next` 抢锁）。4000 上的老进程我一行都没碰。

---

## CodeGraph 证据

```
node .codegraph/bin/codegraph.js status
→ Files 2,137 / Nodes 35,847 / Edges 83,902 · [OK] Index is up to date

codegraph_explore "logoMediaId workspace presenter logoUrl UserSchema image"
→ packages/contracts/src/entities/user.ts:7 UserSchema(image: z.url().nullable() @13)
→ packages/contracts/src/entities/workspace.ts:33 logoMediaId: UuidV7Schema.nullable()
→ apps/web/components/settings/workspace-settings-page.tsx:237-263（logo 存 id、客户端按 mediaId 取签名 URL）
→ blast radius: presentWorkspace 13 callers

codegraph_explore "presentUser user-presenter updateMe getMe users.controller UsersService me"
→ 调用链 getMe(users.controller.ts:14) → getMe(users.service.ts:45) → presentUser(common/services/user-presenter.ts:23)
→ blast radius: presentUser 12 callers（workspace-presenter / admin-users / session.guard / users.service）

codegraph_explore "media-url service sign signMany presentMedia"
→ apps/api/src/modules/media/media-url.service.ts:92 sign / :102 signMany / :212 signedReadUrl
→ MediaUrlModule 仅依赖 @Global StorageService，可被 UsersModule 安全引入
```

21:27 收口复验追加：

```
codegraph status
→ Files 2,163 / Nodes 36,315 / Edges 85,336 · [OK] Index is up to date

codegraph explore "ProfileSettings uploadAvatar saveProfile UsersService updateMe presentAccount storedAvatar"
→ ProfileSettings(profile-settings.tsx:60) → handleFile(:146) → uploadAvatar(me.ts:129)
→ updateMe(users.service.ts:70) → storedAvatar(:113) → presentAccount(:153)

codegraph explore "MediaUploadRateLimitGuard canActivate MediaUploadLimitsService consume toEffectiveUploadLimits"
→ canActivate(media-upload-rate-limit.guard.ts:33) → resolve(media-upload-limits.service.ts:122)
→ toEffectiveUploadLimits(media-upload-limits.service.ts:79)
→ consume(media-upload-limits.service.ts:140) 有 2 个 guard 调用方，测试命中 media-upload-limits.spec.ts
```

---

## 变更文件

```
M apps/api/src/common/services/user-presenter.ts
M apps/api/src/modules/auth/auth-options.ts
M apps/api/src/modules/auth/auth.controller.ts
M apps/api/src/modules/auth/email-delivery.service.ts
M apps/api/src/modules/auth/__tests__/auth-options.spec.ts
M apps/api/src/modules/auth/__tests__/email-delivery.service.spec.ts
M apps/api/src/modules/users/users.module.ts
M apps/api/src/modules/users/users.service.ts
M apps/api/src/modules/users/__tests__/users.service.spec.ts
A apps/api/src/modules/users/avatar-image.ts
A apps/api/src/modules/users/__tests__/avatar-image.spec.ts
M apps/web/lib/api/auth.ts
M apps/web/lib/api/me.ts
M apps/web/components/settings/profile-settings.tsx
M apps/web/components/settings/security-settings.tsx
A e2e/avatar-email/{README.md,support.ts,avatar-stability.spec.ts,change-email.spec.ts,settings-fail-safe.spec.ts,playwright.live.config.ts,ttl-after-expiry.mjs}
A playwright.avatar-email.config.ts
A .audit/avatar-email/{avatar-1440.png,avatar-390.png,change-email-1440.png,change-email-390.png,profile-1440.png,profile-390.png,evidence.cjs,本报告}
```

未触碰：`ai/**`、`workspaces/**`、`admin/**`、`audit/**`、`apps/admin/**`、`journal/**`、`trip-workspace/**`、`packages/api-client/**`（未重新生成，因为契约没变）。未 `git add` / `commit` / `push`。

---

## 已知风险 / 未覆盖

1. **4000 已由另一个 Agent 的进程于 20:58:20 重启并加载本报告的 avatar/email 源码**（源码 mtime 19:38–19:41）；本报告 21:27 已在 3000/4000 上复验通过。头像历史数据（已过期 URL）会继续显示首字母，重新上传即变长期有效（任务允许不迁移）。上传限额服务在 21:01 又有 fail-safe 改动，晚于该 API 启动时间；见 `.audit/upload-limits/` 报告，若要让限额改动进入该进程需等端口空闲后重启。
2. **其他用户的头像在成员列表 / 评论 / Admin 里会回落到首字母**：这些读路径走 `presentUser`（`workspaces/**`、`admin/**` 属禁改），没有存储依赖可以签名；裸 id 已被降级为 `null` 以保证契约不 500。注意这并**不比改造前更糟**——改造前这些位置的头像在 15 分钟后同样失效。要彻底修需要给 `presentMember` 注入签名器（建议单独立项，涉及 `workspaces/**`，与 `MEMBERS_500` 冲突）。
3. 长时间不刷新的页面（例如一直保持焦点的 shell）在 15 分钟后 `<img>` 会失效，直到下一次 refetch（react-query staleTime 30s + 窗口聚焦会触发）。profile 页已加一次性自愈；shell 未加（`app-shell/**` 不在授权范围）。
4. 本机 S3 是 `.audit/tools/s3-stub.mjs`（另一个 Agent 的 stub），**不校验 SigV4 签名**，所以「过期 URL 返回 403」无法在本机复现；TTL 加速实验改为断言「重签时间戳前进 + 新 URL 可加载」，这是等价证明。
5. 邮件真实外发未验证（无外部 relay）；Mailpit 是本地 SMTP 收件箱。上线 staging 后需要用真实邮箱重跑一次「两封邮件点击」。
6. `EmailDeliveryFailedError` 分支（发信失败提示）只在单测覆盖，未在浏览器触发（本机 SMTP 正常）。
7. 媒体 URL 若将来改成不带 media key 的 CDN 形态，`mediaIdFromAvatarUrl` 会提取不到 id，此时按旧行为把 URL 原样落库（仍会过期）。已在 `avatar-image.ts` 注释写明。
8. 21:27 复验没有启动 `4173/3200`；使用他人已在跑的 `3000/4000`。本次为补 Mailpit/Redis 起了 `1025/8025` 与 `6379`（21:09 启动）；media drain 为既有 `worker-drain --watch`。均不影响 `3000/3001/4000`。
