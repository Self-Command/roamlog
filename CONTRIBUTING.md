# 贡献指南

感谢参与 Roamlog。这个仓库是全栈产品，不是单页面原型；提交前请先确认改动落在正确的应用、包和契约层。

## 开始之前

1. 阅读根目录 [README](README.md) 与 [架构文档](docs/architecture.md)。
2. 阅读离目标文件最近的 `AGENTS.md`；更深目录的规则优先。
3. 搜索现有 issue/PR，避免和其他人同时修改同一契约、迁移或共享组件。
4. 涉及权限、API 响应、数据库、上传、导出、邀请、邮件或实时事件时，先写清楚契约和失败路径。

## 环境

```bash
node --version   # >=24 <25
pnpm --version   # >=12
pnpm install --frozen-lockfile
```

界面开发可直接使用 mock 模式：

```bash
pnpm --filter @roamlog/web dev
pnpm --filter @roamlog/admin dev
```

完整 API 模式、Docker 服务、迁移、seed 和 Web/Admin 数据模式设置见 README 的[快速开始](README.md#快速开始)。不要为了让本地启动成功而关闭 production seed guard、Admin 2FA 或租户校验。

## 改动边界

| 目录/包                        | 规则                                                     |
| ------------------------------ | -------------------------------------------------------- |
| `packages/contracts`           | Zod、OpenAPI、权限和实时事件的唯一事实源；先改这里       |
| `packages/api-client`          | 由 `pnpm api-client:generate` 生成，禁止手改             |
| `packages/db`                  | Prisma schema、迁移、seed 和 factories；迁移只能串行生成 |
| `packages/ui`                  | tokens 与基础组件；不要为单个页面复制一套私有 token      |
| `apps/web`, `apps/admin`       | 只消费契约和生成 client；不要私自发明后端字段            |
| `apps/api`, `apps/worker`      | 所有业务查询带 Workspace 上下文；任务必须可重试和幂等    |
| `.github`, `docker`, `tooling` | 变更需要同时更新证据和运维说明                           |

不要顺手重构无关代码、删除用户文件、替换核心框架或引入未讨论的数据库/认证方案。

## 契约优先

涉及 HTTP 字段、错误码、权限或实时事件时：

```bash
# 1. 修改 packages/contracts
pnpm contracts:generate
pnpm api-client:generate

# 2. 确认没有 drift
pnpm contracts:check
```

- 错误继续使用 RFC 7807 Problem Details。
- 带 `version` 的资源必须保留乐观并发；版本不匹配返回 `409`。
- 不得把 Workspace、Trip 或对象级权限只放在前端判断。
- 同一资源如果新增字段，考虑 Web、Admin、mock、OpenAPI 和生成 client 的所有消费者。

## 数据库迁移

- 一次只允许一个迁移写入者。
- 不修改已合并 migration；新增 migration 来完成修复。
- 不在 migration 中跑 seed、回填不可控数据或调用外部服务。
- 先在空库和已有数据副本上验证；破坏性变更必须附备份/回滚说明。
- API 和 Worker 必须在同一 schema 版本上运行。

常用命令：

```bash
pnpm db:migrate
pnpm db:seed
pnpm db:studio
```

`db:seed` 只适用于 local/staging，禁止在生产使用。

## 代码风格

- TypeScript strict，优先小函数、显式类型边界和清晰错误处理。
- 业务查询必须显式解析并传递 `workspaceId`；不能只按资源 id 查询后补权限判断。
- 金额使用最小货币单位的整数；不要用浮点数保存或结算金额。
- 共享逻辑放 `packages/*`，不要复制到 Web/Admin/API 三份。
- 新增 UI 交互必须包含 loading、empty、error、forbidden 和冲突/网络失败状态。
- CSS 使用现有 tokens；不要引入大面积彩色 surface、投影海报或第二套字体体系。
- 不添加无意义注释；注释解释约束和原因，不复述代码。

## 测试

最低验证：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm contracts:check
pnpm build
```

涉及浏览器或交互时再补：

```bash
pnpm e2e:api
pnpm e2e:web
pnpm e2e:admin
pnpm e2e:a11y
pnpm e2e:visual
```

涉及权限、认证、租户隔离、分享 token、上传、导出、邮件或队列时：

- 至少增加一个正向测试和一个拒绝/失败测试。
- 跨 Workspace 读写必须有 `403`/`404` 证据。
- 队列任务必须有确定性幂等键与失败重试覆盖。
- 分享链接必须覆盖过期、撤销、密码或错误 token。

没有测试时，PR 必须写明不可自动化的原因、手工步骤、实际输出和覆盖缺口。禁止用“应该可以”作为验证结论。

## UI 与可访问性

- 页面标题上限：页面 56px、旅行 48px、日志 36px。
- 每屏最多一个白色 primary 按钮。
- 首屏必须展示真实可操作内容，不允许大字号口号占满首屏。
- 必须覆盖 1440、1024、390 布局；表格在移动端转卡片或可滚动区域。
- 键盘顺序、焦点可见、Dialog/Sheet 焦点恢复、Esc 关闭和 `prefers-reduced-motion` 必须可验证。
- 截图只使用公开演示数据；发布规则见 [截图资产索引](docs/assets/screenshots/README.md)。

## 安全与隐私

- 不提交 `.env`、`.env.local`、`docker/.env.staging`、密钥、token、cookie、数据库 dump 或用户数据。
- 不在日志、Sentry、审计或截图里暴露密码、TOTP、邀请 token、分享明文 token 或连接字符串。
- 发现漏洞请按 [SECURITY.md](SECURITY.md) 私下报告，不要公开 issue。
- 引入新依赖前检查许可证、维护状态和安全公告；不要用未知镜像替代 MinIO 或其他固定依赖。

## 提交与 PR

建议使用 Conventional Commits，例如：

```text
feat(web): add map filter persistence
fix(api): reject cross-workspace share token access
docs(ops): add restore drill evidence
```

PR 描述至少包含：

- 目标和用户价值。
- 改动文件/模块与契约影响。
- 验证命令和实际结果。
- 截图/日志/API 证据（UI 或运行时改动）。
- 已知风险、未覆盖项和需要的后续工作。

请保持 PR 小而聚焦。不要把格式化整个仓库、无关重命名或顺手修复混入功能 PR。

## PR 检查清单

- [ ] 只改了任务范围内文件，没有无关重构。
- [ ] 契约、mock、生成 client 和 OpenAPI 保持同步。
- [ ] 权限与租户隔离有测试。
- [ ] migration 串行且在空库/已有数据上可执行。
- [ ] `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm contracts:check`、`pnpm build` 通过。
- [ ] UI 覆盖桌面/移动端、加载/空/错误/权限拒绝状态。
- [ ] 可访问性和 reduced motion 已检查。
- [ ] 没有密钥、真实用户数据或未脱敏截图。
- [ ] 文档、环境变量示例和运维说明同步更新。
- [ ] 已记录未验证项和风险。
