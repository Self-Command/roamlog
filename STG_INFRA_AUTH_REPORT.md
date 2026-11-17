# STG-INFRA-AUTH delivery report

状态: NEEDS_REVIEW
任务 ID: STG-INFRA-AUTH
角色: Staging 基础设施与认证上线工程师
结论: 基础设施、Compose、CI、运行手册和安全 bootstrap 代码已交付；bootstrap
自动建号路径尚未取得端到端完成证据，不能宣称 staging-ready。未提交 commit。

## 变更文件

Docker / staging:

- `docker/api.Dockerfile`
- `docker/worker.Dockerfile`
- `docker/web.Dockerfile`
- `docker/admin.Dockerfile`
- `docker/*.Dockerfile.dockerignore`
- `docker/compose.staging.yml`
- `docker/compose.yml`
- `docker/minio-init/01-create-bucket.sh`
- `docker/staging.env.example`
- `docker/Caddyfile.staging.example`

CI / 工程入口:

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.env.example`
- `README.md`
- `package.json`
- `tooling/scripts/staging-validate.py`

认证 bootstrap:

- `apps/api/scripts/bootstrap-admin.ts`

运行手册:

- `docs/operations/README.md`
- `docs/operations/staging-deployment.md`
- `docs/operations/release-gate.md`
- `docs/operations/migrations.md`
- `docs/operations/backup-restore.md`
- `docs/operations/rollback.md`
- `docs/operations/secret-rotation.md`
- `docs/operations/health-and-monitoring.md`
- `docs/operations/troubleshooting.md`

边界说明:

- 未修改 Web/Admin UI、contracts、DB schema/migration、worker 业务或 lockfile。
- `package.json` 是并行共享文件。我添加了 `staging:validate`、
  `staging:config` 并修正 `admin:bootstrap`；发现其他 Agent 同期添加了
  `e2e:staging` 与 `k6:staging*`，已保留，不将它们计为本任务交付。

## 已实现

1. 四个多阶段生产镜像：
   - `pnpm deploy --prod` 生成生产依赖；
   - 非 root 用户 `10001:10001`；
   - API/web/admin/worker 均有 healthcheck；
   - API/Worker 使用固定 `tsx@4.23.15` 加载 workspace TypeScript；
   - API 镜像包含 `migrate` target，使用 `prisma@7.10.1`；
   - 在 `/tsconfig.base.json` 复制 monorepo base config，修复容器内
     `tsx` 无法启用 decorators 的真实启动问题。
2. Staging Compose：
   - PostgreSQL 17、Redis 7、MinIO、MinIO init、Mailpit；
   - migrate、api、worker、web、admin；
   - Postgres/Redis/MinIO/Mailpit healthcheck 与命名 volume；
   - `backend` internal、`edge`、worker 专用 `egress` 网络；
   - app 容器只读根文件系统、drop all capabilities、
     `no-new-privileges`、日志轮转；
   - 只有 loopback host ports；
   - MinIO 初始化创建独立 bucket-scoped 应用身份，不把 root 凭据交给应用；
   - 生产环境 HTTPS/CORS/cookie domain 示例与 TLS/CSP/HSTS 反代示例。
3. CI/release gate：
   - install、staging 静态检查、Compose config、lint、typecheck、migrate、
     seed（仅 CI）、test、contracts check、build、Playwright browser smoke、
     API smoke；
   - release workflow 复用 CI，默认 `dry_run=true`；
   - dry run 构建 `api/migrate/worker/web/admin` 镜像但不登录/推送 GHCR；
   - tag 或显式 `dry_run=false` 时发布到 GHCR，仓库名转小写；
   - 自动主机 rollout 未实现，因为仓库没有 staging SSH/Railway/Fly 凭据。
4. Bootstrap：
   - 缺失账号时通过 Better Auth `sign-up/email` 创建普通 `user`，使用随机、
     不输出的生成凭据；
   - 发送邮箱验证邮件和一次性密码重置邮件，并查询 `EmailLog` 形成投递证据；
   - 创建账号不授予任何平台管理员角色；
   - 仅 active、邮箱已验证、TOTP 已验证且未锁定的账号可提升
     `super_admin`；
   - 提升和账号创建均写 system audit；
   - 重复提升为幂等 `already_bootstrapped`；
   - 支持 `--dry-run`、`--help`，错误输出脱敏。
5. 运维手册覆盖域名、Cookie、CORS、CSP、HSTS、部署、迁移、备份/恢复、回滚、
   密钥轮换、健康监控、队列/媒体/邮件排障。

## 验证命令与真实结果

通过：

```text
pnpm --filter @roamlog/api typecheck                         PASS
pnpm --filter @roamlog/api lint                              PASS
pnpm --filter @roamlog/api build                             PASS
pnpm --filter @roamlog/worker typecheck                      PASS
pnpm --filter @roamlog/worker build                          PASS
pnpm --filter @roamlog/api exec vitest run <2 auth specs>    6/6 PASS
pnpm staging:validate                                        PASS
actionlint 1.7.12 (ci + release)                             PASS
Docker Compose v5.8.0 config (local + staging app profile)   PASS
Compose Specification JSON Schema validation                 PASS
pnpm admin:bootstrap -- --dry-run                            PASS, no DB/email mutation
bash -n docker/minio-init/01-create-bucket.sh                PASS
web preview http://localhost:3000                            200, 保持运行
admin preview http://localhost:3001                          307, 保持运行
```

发布产物运行探测，不是 Docker 容器探测：

```text
API pnpm deploy 产物 + tsx dist/main.js
  -> Nest 模块完成初始化，无 decorator/tsconfig transform 错误
Worker pnpm deploy 产物 + tsx dist/main.js
  -> worker.starting / worker.ready
Web pnpm deploy 产物 + next start --port 13100
  -> /login HTTP 200
Admin pnpm deploy 产物 + next start --port 13101
  -> /login HTTP 200
```

环境校验：

```text
staging.env.example 的 production placeholder BETTER_AUTH_SECRET 被正确拒绝
替换为仅用于校验的 32+ 字节 secret 后：
NODE_ENV=production, APP/ADMIN/API=https, exact CORS, cookie domain,
ADMIN_2FA_ENFORCED=true -> validateEnvironment PASS
```

Hadolint 剩余提示：

```text
DL3008: apt packages not version-pinned (ca-certificates/openssl/procps)
```

这是已记录的可复现性警告，不是运行时错误。未发现 privileged、host network、
Docker socket、latest tag 或最终 root user。

## 未完成 / 未验证

1. **Bootstrap 自动建号端到端未证明。**
   - 使用临时嵌入式 PostgreSQL 17.11 + 本地 SMTP sink 执行真实流程；
   - initdb、数据库创建、Prisma migrations 成功；
   - 第一次 bootstrap 命令在 120 秒内未返回 stdout/stderr，进程超时，
     因此没有获得“账号已创建、两封邮件已发送、未提升”的完成证据；
   - 已按协调要求停止继续深挖，并将该路径标为 NEEDS_REVIEW；
   - 现有已验证账号的无 TOTP 拒绝策略仍由既有单元测试覆盖，但首次建号不能
     被宣称 production/staging 验证通过。
2. **没有 Docker CLI，未构建或启动任何容器。**
   - 仅完成 Compose v5.8 `config`、Compose JSON Schema、Dockerfile lint、
     deploy 产物进程探测；
   - 未证明镜像 build、read-only rootfs、non-root UID、tmpfs、healthcheck
     在真实 Docker 中工作。
3. **MinIO 镜像外部阻断。**
   - 官方社区仓库已归档，Docker Hub 镜像删除，Quay 匿名拉取被门禁；
   - Compose 使用 pinned Quay tag，但 clean host 启动前必须配置 Quay 认证，
     或把已验证 digest 镜像到组织私有 registry；
   - 未使用来源不明的第三方镜像，因此不能声称 clean host 可直接 pull。
4. GitHub Actions 未在 GitHub runner 实际执行；actionlint/YAML 只证明结构。
5. 未执行 staging k6、真实 TLS、备份恢复、密钥轮换或外部监控演练。
6. Staging 未自动 seed。当前 seed 代码拒绝 `NODE_ENV=production`，已记录，
   未绕过。
7. CSP 示例为 Next.js 兼容使用 `'unsafe-inline'`；nonce-based CSP 需后续应用
   中间件改造。

## 风险与建议

1. 先解决 MinIO 镜像来源；否则 staging compose 在干净主机上无法启动。
2. 在真实 staging PostgreSQL + Mailpit/Resend 上复测首次 bootstrap：
   - 查找 CLI 超时点（Better Auth handler、邮件 provider 或未关闭句柄）；
   - 验证 SMTP 收到验证/重置邮件；
   - 验证账号为 `user`、邮箱未验证、无 TOTP、无 Admin API；
   - 完成 TOTP 后复跑，只允许 `promoted` 与 audit。
3. 在 CI 或 staging runner 实际执行 release dry-run，构建五个镜像并以
   non-root/read-only 配置启动一次 smoke。
4. 验证 reverse proxy 下 CORS、Secure cookie、HSTS、CSP 与
   `/v1/metrics` 阻断。
5. 恢复演练与回滚演练完成前，不将该 compose 宣称 production-ready。

## 证据与限制声明

- 本机没有 Docker CLI；没有声称任何容器已启动。
- 3000/3001 预览在任务结束时仍返回 200/307，未被停止。
- 未 commit、未创建分支、未推送。
- 未修改 Web/Admin UI、contracts、DB schema 或 root lockfile。
