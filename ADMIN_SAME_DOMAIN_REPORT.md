# ADMIN-SAME-DOMAIN Report

状态: DONE

任务 ID: ADMIN-SAME-DOMAIN

## 变更文件

- `apps/admin/next.config.ts`
- `apps/admin/lib/admin-paths.ts` (新增)
- `apps/admin/lib/admin-paths.test.ts` (新增)
- `apps/admin/app/admin/login/page.tsx`
- `apps/admin/components/admin-shell/admin-console-layout.tsx`
- `apps/admin/components/admin-shell/admin-sidebar.tsx`
- `apps/admin/components/admin-shell/mock-session-provider.tsx`
- `apps/admin/components/admin-ui/admin-data-boundary.tsx`
- `apps/admin/components/login/two-factor-enrollment.tsx`
- `apps/admin/components/admin-shell/admin-shell.test.tsx`
- `apps/admin/README.md`
- `docker/admin.Dockerfile`
- `.github/workflows/release.yml`
- `docker/compose.staging.yml`
- `.env.example`
- `docker/staging.env.example`

未修改 Web、API、Worker、contracts、数据库、根 lockfile；未 commit/push。

## 实现摘要

1. Admin `next.config.ts` 读取 `NEXT_PUBLIC_ADMIN_ASSET_PREFIX`：
   - 未设置或为空：`assetPrefix: undefined`，本地无前缀。
   - 设置为 `/admin-assets`：构建产物中的 JS/CSS/字体全部使用
     `/admin-assets/_next/...`。
   - 未设置 `basePath`，现有 `/admin/*` 路由保持不变。

2. 新增 `getAdminLoginPath()`：
   - 默认返回 `/login`。
   - 设置 `NEXT_PUBLIC_ADMIN_LOGIN_PATH=/admin/login` 时返回 `/admin/login`。
   - 缺失前导 `/` 时自动补齐。

3. 所有 Admin 内部登录跳转/href 已切换到 helper：
   - `two-factor-enrollment.tsx`
   - `admin-data-boundary.tsx`
   - `admin-sidebar.tsx`
   - `mock-session-provider.tsx` (API session guard)
   - `login-panel.tsx` 原本没有 `/login` 字面量，登录成功仍进入 `/admin`，无需改动。

4. `app/admin/login/page.tsx` 不再 redirect，直接渲染 `LoginPanel`。
   `AdminConsoleLayout` 在该路径下跳过控制台 shell，避免登录页被侧栏/顶栏包裹。
   构建产物验证：`/admin/login` 含登录标题，且不含 `管理后台侧栏`。

5. Docker/release/staging build args 已接入：
   - `docker/admin.Dockerfile` 声明并导出两个 `NEXT_PUBLIC_*` build args。
   - `.github/workflows/release.yml` 传入 `/admin-assets` 与 `/admin/login`。
   - `docker/compose.staging.yml` 的 admin build args 传入相同值。
   - env 示例已补充说明，注明这些是 build-time public values。

## 验证命令与结果

```powershell
pnpm --filter @roamlog/admin test
# PASS: 16 test files, 41 tests

pnpm --filter @roamlog/admin typecheck
# PASS: tsc --noEmit

pnpm --filter @roamlog/admin lint
# PASS: eslint .

pnpm exec prettier --check <changed source/config files>
# PASS: All matched files use Prettier code style!

pnpm --filter @roamlog/admin build
# PASS: Next.js 16.4.6, 16/16 static pages, route list includes /admin/login

$env:NEXT_PUBLIC_ADMIN_ASSET_PREFIX='/admin-assets'
$env:NEXT_PUBLIC_ADMIN_LOGIN_PATH='/admin/login'
pnpm --filter @roamlog/admin build
# PASS: Next.js 16.4.6, 16/16 static pages, route list includes /admin/login
```

## 构建产物证据 (`/admin-assets`)

当前 `apps/admin/.next` 是最后一次同域 build 的产物。

```text
apps/admin/.next/server/app/login.html
  /admin-assets occurrences: 44
  /_next/static occurrences:  44

apps/admin/.next/server/app/admin/login.html
  /admin-assets occurrences: 56
  /_next/static occurrences:  56

apps/admin/.next/server/app/admin.html
  /admin-assets occurrences: 56
  /_next/static occurrences:  56
```

HTML 中实际路径示例：

```text
/admin-assets/_next/static/chunks/31w3gvwaex_2g.css
/admin-assets/_next/static/media/07a39a8a4660cc7c-s.p.0r6juujl39pe6.woff2
/admin-assets/_next/static/media/605ce01b664af129-s.p.0wgildi0cnwt9.woff2
```

配置与登录路径证据：

```text
apps/admin/.next/required-server-files.json
  "assetPrefix": "/admin-assets"

apps/admin/.next/routes-manifest.json
  Next.js 16 自动生成 /admin-assets/_next/:path+ 到 /_next/:path+ 的内部 rewrite

apps/admin/.next/static/chunks/3d2d1maocv6mp.js
  包含编译内联的 "/admin/login"
  未包含 process.env.NEXT_PUBLIC_ADMIN_LOGIN_PATH
```

## 运行证据

本地未设置两个变量的 build，在临时端口 `3101` 启动验证：

```text
/login       status=200, 登录标题=true, /admin-assets=0
/admin       status=200, 登录标题=false
/admin/login status=200, 登录标题=true, 无管理后台侧栏
```

同域 env build，在临时端口 `3101` 启动验证：

```text
/login       status=200, /admin-assets=44
/admin/login status=200, 登录标题=true, /admin-assets=56, 无管理后台侧栏
/admin       status=200, /admin-assets=56
/admin-assets/_next/static/chunks/31w3gvwaex_2g.css
             status=200, Content-Type=text/css
```

任务开始时 `3000` 与 `3001` 均无监听进程（连接被拒绝），本次没有停止任何预览进程。
运行验证只使用临时 `3101`，验证后已停止。

## 已知风险

1. **反向代理尚未在本次范围内修改。** `deploy/nginx/roamlog.conf.example`
   仍是 admin 子域方式，只把 `admin.<host>` 的 `/` 转到 Admin。上线到
   `https://we.spacedo.org/admin/*` 前，边缘代理必须：
   - 将 `/admin/*` 原路径转发到 Admin upstream（不能剥掉 `/admin`）；
   - 将 `/admin-assets/*` 原路径转发到 Admin upstream；
   - 不要覆盖 Web 已有的 `/v1/*`、`/_next/*` 或其他根路径。

2. **Better Auth 同域配置未在本次改动。** `https://we.spacedo.org` 需要进入
   trusted origins；same-origin `/v1/auth`、cookie `Secure`/`SameSite`/domain
   需要由部署环境验证。Admin 自身仍有 `/v1/[...path]` 代理，但同域下也可以由
   Web 的 `/v1` 代理统一承接，二者不能互相冲突。

3. **`NEXT_PUBLIC_*` 是构建期内联值。** 只在运行时改 env 不会改变已构建 HTML
   或 JS；发布流程必须继续把两个 build args 传给 Admin image。

4. **`/admin-assets` 是保留路径。** Web/public 文件与边缘路由不得占用该前缀。

5. **未执行 Docker image build。** 本次验证的是本地 `next build`；Dockerfile
   的 build args 已按语法接入，但未在 Docker/BuildKit 中实际构建镜像。

6. 当前 `.next` 是 `/admin-assets` 构建。若需要用 `next start` 复现“本地无前缀”
   产物，应清除两个 env 后重新执行 `pnpm --filter @roamlog/admin build`；
   `pnpm dev` 在未设置 env 时仍按默认 `/login` 与无前缀运行。

## 未覆盖项

- 真实 `https://we.spacedo.org/admin/*` 边缘代理与 TLS/OAuth/Resend 联调。
- 跨应用 cookie、管理员 2FA、Admin API 对 Web 同源 `/v1` 代理的端到端测试。
- Docker 镜像构建与容器内健康检查。

## 建议的下一步

1. 由 devops 任务修改 `deploy/nginx`（或实际边缘配置），同时路由
   `/admin/*` 与 `/admin-assets/*`，保留路径并验证静态资源 200。
2. 在 staging 用同一域跑一次 Admin 登录 + 2FA + `/v1/me` + 页面刷新，确认
   cookie 和 trusted origin。
3. 增加 CI/release 断言：Admin 构建 HTML 必须包含 `/admin-assets/_next/`，
   且不应包含根路径 `/_next/static/`。
