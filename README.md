# Roamlog

Roamlog 是一个协作式旅行记录产品。本仓库是正式全栈代码库，原型位于
`../roamlog-prototype`，仅作为视觉与交互参考，不是生产代码。

## 当前阶段

Wave 0 — Foundation。当前只冻结仓库骨架、契约、数据库 schema/migration/seed
和本地服务。Web、Admin、API 业务模块与 Worker 业务逻辑尚未实现。

## 环境要求

- Node.js 24.x
- pnpm 12.x
- Docker Desktop / Docker Engine + Compose

## 本地启动

```bash
cp .env.example .env.local
pnpm install
docker compose --env-file .env.local -f docker/compose.yml up -d
pnpm db:migrate
pnpm db:seed
```

`docker compose` 不会自动读取根目录的 `.env.local`；请使用上面的
`--env-file .env.local`。如果使用模板默认值，也可以省略该参数。

本地服务：

- Web: `http://localhost:3000`（Wave 1 实现）
- Admin: `http://localhost:3001`（Wave 1 实现）
- API: `http://localhost:4000`（Wave 0 后由 Task 4 提供 health）
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
- MinIO: `http://localhost:9000` / Console `http://localhost:9001`
- Mailpit: `http://localhost:8025`

## 常用命令

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm db:migrate
pnpm db:seed
pnpm contracts:generate
pnpm contracts:check
pnpm api-client:generate
pnpm check:env
```

## 目录

```text
apps/            web, admin, api, worker
packages/        contracts, db, api-client, api-mocks, ui, emails, config
docker/          local Postgres/Redis/MinIO/Mailpit
tooling/         local operational scripts
```

## 契约与数据边界

- `packages/contracts` 是 Zod/OpenAPI/实时事件/权限矩阵的唯一事实源。
- `packages/api-client` 由 Orval 生成，禁止手改。
- `packages/db` 拥有 Prisma schema、migration、seed 与 test factories。
- Feature agent 不得修改 `packages/contracts/**`、`packages/db/**` 或
  `packages/api-client/**`；契约变更由 integrator 统一提交。
- 所有业务查询必须带 `workspaceId` 并先校验成员身份。

## 原型与 seed 声明

- seed 仅在 local/staging 可用；生产环境不创建 demo 用户或 demo 内容。
- 所有 ID 使用 UUIDv7，金额使用最小货币单位整数，日期使用 `date`。
- 当前 seed 会尝试把本地图片上传到 MinIO；不可用时保留数据库关系并写入
  本地 fallback 标记，不依赖外部图库网络。

## 安全

不要提交 `.env`、`.env.local`、真实 token、数据库转储或用户隐私数据。
公开分享 token 只存 hash，明文只在创建时返回一次。
