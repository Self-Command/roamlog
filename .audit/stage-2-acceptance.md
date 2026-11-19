# 验收记录（第二轮）— E0 / E1 / F / H / AUTHZ / R1

时间: 2026-11-19 14:40
接续: `.audit/stage-b-acceptance.md`

## E0 环境变量与文档 —— ACCEPT
提交 `c17e91d`（12 文件，仅 env/docs/tooling）。

**闭合生产阻断项**：`CONFIG_ENCRYPTION_KEY` 缺失会让后台第一次保存 secret 就失败（或用随机 key 加密、重启即解不开）。

| 验证 | 结果 |
|---|---|
| 缺 key（`APP_ENV=production`） | **exit 1**，错误点名变量 + 给出 `openssl rand -base64 32` |
| 合法 32 字节 base64 | **exit 0**，`Environment configuration looks valid.` |
| 非法 key ring | exit 1，精确到第几个 entry |
| 三模板缺失键 | **missing = 0**（54 键 schema） |
| `staging:validate` / YAML | 通过 |

文档写明：**丢失该 key = 已存 secret 永久不可解** + 轮转流程。

## E1 AI 规划器（工具调用版）—— ACCEPT
提交 `bea3c03`(contracts) + `2c9a213`(api)。

**三协议各一次真实工具循环**（magpie 本地，prompt「我想去京都待一周，预算 8000 人民币，喜欢咖啡馆和古寺」）：

| 协议 | readOnlyTrace | plannedCalls |
|---|---|---|
| openai-chat | 6× places.search | `trips.create`「京都一周：古寺与咖啡馆」2026-04-05~11, 800000 CNY |
| openai-responses | 5× places.search | `trips.create`「京都七日｜古寺与咖啡馆」 |
| anthropic-messages | 5× places.search | `trips.create`「Kyoto — one week of coffee and old temples」 |

**共同断言：写 service 一次都没被调用**（plan 阶段绝不写库）。

我强加的三条约束均有测试锁死：
1. 工具以调用者身份执行（无 Prisma 直连、签名无 `workspaceId`/`userId`，模型注入会被 strip）
2. plan 只读由服务端强制（请求 `trips.create` → 不执行、进 `plannedCalls`）
3. 每个工具描述含 `Read-only, no side effects.` 或 `WRITES DATA.`

契约 72 tests / api `src/modules/ai`+config 67 tests / 全量 677 tests。

## 根 Agent 串行收口（E1 遗留）
- `PlacesModule` 导出 `PlacesService`，`AiModule` 改为 import 并**删除整套重复 provider**（原实现有两份实例）。
- 注册 `GET/PATCH /v1/admin/permissions`、`PATCH /v1/admin/users/{id}`、AI 两阶段端点 → 重生成：**101 paths / 213 schemas / 25 endpoints / 685 schemas**，`contracts:check` fresh（提交 `eb6d3af`）。

## F 地址持久化 —— ACCEPT
提交 `5ac6c7f`(db) + `183fdfd`(api) + `14846fd`(web)。

**端到端真实证据**：`POST trip(originAddress/originBbox)` → 201 → **独立 GET 回读两字段**（等价刷新）→ `POST stop(address/bbox)` 201 → GET 回读 → 非法 bbox **422 INVALID_BBOX** → `PATCH null` 清空 → `duplicate` 复制 → 公开页 `stops[0].address` 有值、**不含 bbox**。

迁移 `0006` 在全新 schema 全序执行 + 带 0005 前数据两种情况下验证，CHECK 负例 23514。db 64 tests / api 61 / web 67。

**F 挖出的功能级缺陷（已派 `F7` 修）**：`Stop.provider` 的 DB CHECK 与 `PlaceProviderSchema` 只有 `photon|local`，**Geoapify 命中的地点无法落库**（实测 23514）。

## H media 设置接线 —— ACCEPT
提交 `065edfa`（22 文件）。

- `media.maxEdge/quality/targetBytes/maxUploadBytes` 改为 public 并被**压缩管线真实消费**（参数化 worker 协议 + 主线程 fallback + hook），安全带 500–4000 / 0.4–0.95 / 100k–5M / ≤25M，越界回落默认 + warn。
- `keepOriginal`/`livePhotoEnabled` **保持私有**，help 与后台 badge 均标「未接入（不生效）」——**逐键诚实**，不是分组糊弄。
- 真实证据：`/v1/public/settings` 含 4 键、不含 2 开关；stub 验证 policy 变化后阶梯随之变化（0.9→[0.9,0.768,0.659,0.604]）。
- 已知小问题：25MB 十进制 vs `COVER_MAX_BYTES` 25MiB（界面显示 23.8MB），已记待统一。

## AUTHZ_OVERRIDE —— ACCEPT
提交 `54a9d5c`。

**真联调证据（真实登录、真实 Cookie）**：
```
analyst GET /v1/admin/flags        → 403 ADMIN_ACCESS_DENIED
super   PATCH grant admin:flags:read → 200
analyst GET /v1/admin/flags        → 200      ← 生效
super   PATCH revoke               → 200
analyst GET /v1/admin/flags        → 403      ← 回退生效
super   撤销自己的权限              → 无效（仍 200）
给 user 角色授予                    → 无效（user actions 恒空）
DB: PlatformRoleOverride rows 最终 0（无效 diff 不落库）
```
设计：`AdminAuthzPort` seam、30s 缓存、`invalidate()` 立即失效、DB 故障**回落代码矩阵**（不是全放行）、`super_admin`/`user` 不变量、读取侧再兜一次 `grantable` 白名单。

## R1 Redis 韧性 —— ACCEPT（两轮）
提交 `62c146e` → `4390a9c` → `2e25e31`。

**修复前**：`[get] THREW: MaxRetriesPerRequestError ... after 473 ms`，且全仓无 `unhandledRejection` 兜底 → **任一未 await 的拒绝 = 进程退出**。
**修复后**（`REDIS_URL=redis://127.0.0.1:1`，真实进程）：
```
api pid=13192  (OS PID 12264, LISTENING 4321)
GET /v1/health → {"status":"ok"} 200
GET /v1/ready  → {"status":"degraded", "redis":{"status":"down"}} 200
GET /v1/ready 再次 → 200
still alive → ALIVE pid=13192
```

失败语义逐处落实：缓存/限流/幂等/配额 **fail-open**；**队列入队 fail-closed → 503 `QUEUE_UNAVAILABLE`**（不假装入队，且不回声 host:port）。`REDIS_REQUIRED` 仅强化启动期。

**额外修掉两个既有契约违约**（`safeParse` 断言抓到）：
1. `/v1/ready` 返回契约外的 `unavailable`
2. **down 探针的 `error` 字段让 `.strict()` 契约对任何 down 响应恒不合法**，且外泄错误信息

**复活探针**（我裁决的方案 b）：10 次快速退避后每 30s 单次 `connect()`，`unref()` + 失败重武装 + 销毁清理，不留僵尸 socket/定时器。

## 待办（已排期）
- `B4` 举报审核（等 0007 落地后 0008）
- `MAIL_SETTINGS_WIRED`、`AI_SETTINGS_WIRED`、`LIMITS_SETTINGS_WIRED`
- `ATTR_GEOAPIFY` 归属文案（发布阻断项）
- 目的地结构升级（`string[]` → 带 place 对象）
- `settings.subscribe` 断线重试（R1 越界未改）
- 主进程兜底（已派 `MAIN_HARDENING`）
- 25MB 语义统一；幽灵权限项一致性测试