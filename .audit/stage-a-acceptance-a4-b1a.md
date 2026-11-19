# 验收记录 — A4（后台清理）与 B1A（设置底座）

时间: 2026-11-19 11:50

## A4_ADMIN_FIXTURE_MODE —— ACCEPT

提交 `e8449b7`（隐藏审核入口）、`2129d17`（删 fixture 模式）、`5851089`（我补提交的 content 数据源清理）

| 门禁 | 结果 |
|---|---|
| admin typecheck | **0 错误**（我复跑） |
| admin 测试 | **15 files / 80 tests**（我复跑） |
| admin lint | exit 0 |
| admin build | `Compiled successfully`，路由表**无 `/admin/content`** |
| `rg fixture\|演示预览\|LIVE API\|ADMIN API ERROR`（非测试） | **0 命中** |
| `grep admin/content`（排除 .next/.turbo） | **0 命中** |

**CodeGraph 交叉验证**：`getAdminDataSource`、`AdminDataSource`、`fixtureResource`、`getAdminDataMode` 四个符号「Not in the index」——说明不是"绕过"而是真的从代码图删除。

**两处判断值得记**：
1. **没有把字面量 `/admin/content` 写进测试**（否则会违反"grep 含测试也要 0 命中"），改用**结构性断言**（`ADMIN_NAV_GROUPS` 与路由目录扫描）。这比字符串断言更强，且不与门禁自相矛盾。
2. 无 API 时列表页现在显示「加载失败，请稍后重试」+ `<details>` 折叠 code/HTTP/detail；邮件与 worker 状态无数据源时显示「未接入」，**不再用 fixture 谎报 Healthy**——这正是 B 阶段「禁止假功能」的先行落实。

**风险（接受）**：fixture 测试数据集中在 `test/admin-sample-data.ts`（仅测试引用、不进 bundle），比 14 个测试各自重复构造更可维护。

## B1A_SETTINGS_BACKEND —— ACCEPT

提交 `02c8dce`（db）、`fc400e9`（api）

### 根 Agent 统一执行的串行操作
```
pnpm contracts:generate → 98 paths / 213 schemas（94→98，203→213）
pnpm api-client:generate → 24 endpoint files / 648 schemas（23→24，614→648）
pnpm contracts:check → 两侧 fresh
pnpm db:migrate（本地 55444）→ 0004_system_setting 应用成功
```

### 交付内容
- **Prisma**：`SystemSetting`（key/group/valueType/value/secretCipher/secretLast4/keyVersion/envLocked/isPublic/updatedById/时间戳）+ 一条 additive `0004` 迁移（含 valueType 与 secret-shape CHECK，**不种子行**）；`packages/db` 导出 `DEFAULT_SETTINGS`（不写库）。
- **加密**：AES-256-GCM，`v1:<keyId>:<base64(iv|ct|tag)>`，AAD = setting key；支持 `CONFIG_ENCRYPTION_KEY` + `CONFIG_ENCRYPTION_KEYS` **key ring**（首 key 当前、其余历史可解）；解密失败抛明确错误，**绝不返回空串**。
- **缓存**：进程 5s → Redis 300s → DB；`set` 走事务 + `INCR settings:version` + pub/sub 失效 + 审计；**DB 故障抛错不回落默认值**；secret 永不写 Redis。
- **校验**：9 个分组全覆盖（general/seo/theme/mail/storage/media/ai/places/limits），未知 key/类型错误 → 422 `SETTINGS_INVALID`，**不回显值**。
- **API**：`GET/PATCH /v1/admin/settings`、`GET /v1/admin/settings/{key}`、`POST .../reveal`、`GET /v1/public/settings`；新增 `admin:settings:read/write`（仅 super_admin）；PATCH 与 reveal 均写审计，metadata 只含 `{keys, secrets}`。

### 验证
| 命令 | 结果 |
|---|---|
| `db test`（真实 PG，独立 schema） | 8 files / **48 tests**（含 0004 集成 7 条：空 schema 全序执行、0004 前数据保留、CHECK 约束） |
| `api typecheck` | 通过 |
| `api exec vitest run src/modules/settings src/config` | 6 files / **74 tests** |
| `contracts test` | 8 files / **62 tests** |
| 三端 lint + prettier | exit 0 |

### 风险（接受，已入账）
1. 缓存一致性靠 pub/sub，失败时最多 5s TTL 收敛；Redis 不可用时 `version=null`。
2. **加密密钥丢失 = 已存 secret 不可恢复**（reveal 报 `SETTINGS_SECRET_UNREADABLE`，不静默）；本轮无重加密 CLI。
3. 审计在事务提交后写；审计失败会让 PATCH 返回 5xx 但**配置已生效**。
4. 未做 admin UI（B1B）、未做 mail/storage 的 test-connection、reveal 未做 step-up reauth、无真实 Redis 集成测试（pub/sub 用桩）。

## 全量现状（我刚复跑）

| 套件 | 结果 |
|---|---|
| `pnpm typecheck`（11 包） | 11/11 success |
| `pnpm lint` | 11/11 success（worker 19 warnings，0 errors） |
| api 测试（真实 PG） | **72 files / 508 tests / 6 skipped** |
| admin 测试 | 15 / 80 |
| contracts 测试 | 8 / 62 |
| contracts:check | fresh（98 / 213 / 24 / 648） |