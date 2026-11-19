# 待办队列（根 Agent 维护，防止跨上下文丢失）

更新时间: 2026-11-19 15:10

## 阻塞中（等槽位或等依赖）

| # | 任务 | 阻塞原因 | 优先级 |
|---|---|---|---|
| 1 | **MEDIA_BUCKET_PER_ROW**：`MediaUrlService` 对所有行用**当前** bucket 签名，没读 `Media.bucket` → 后台一改桶，**所有旧图 URL 404**；同时 `media.service.ts:99` 落库 bucket 用 env 而非当前设置 | 等 `D2_LIVE_PHOTO` 释放 `apps/api/src/modules/media/**` | **P0（换配置即毁数据）** |
| 2 | **DESTINATIONS_UPGRADE**：`Trip.destinations` 仍是 `string[]`，**无地址/坐标**，是"目的地不能在地图显示"的根因；需 `0011` 迁移（`TripDestination` 表）+ 契约破坏性变更 + 表单改造 + 数据迁移 | 等 `D2` 释放 `packages/db`；且 `ATTR` 正在改 `destinations-field.tsx` | P0（功能缺口） |
| 3 | `SETTINGS_SAVE_PROBE`：后台保存 storage 设置前先跑 probe，失败不落库（当前 probe 是独立端点，保存流程没接） | 无依赖，等槽位 | P1 |
| 4 | 后台 `mail`/`storage` 标签改 `backend`（当前仍 `unwired`，而代码已接线 → 标签失真） | 等 `MAIL` 交付后合并核对 | P1 |
| 5 | `PLAYWRIGHT e2e` 全量跑（当前只验证了 `--list` 能装载） | 需要稳定 API + 数据，等所有任务落地 | P1 |

## 已完成但需集成复验

- `STORAGE` 交付后：`media` 落库/签名仍未读 `Media.bucket`（见 #1）
- `MAIL` 交付后：`apps/api/test` 有 3 个 e2e 套件因 `AuthModule` 解析不到 `MailService` 失败（并行在途，等它收尾）
- `D2` 交付后：`packages/db` 才能开 `0011` 迁移

## 已知小债（低优先，不阻塞发布）

- 25MB 语义：`media.maxUploadBytes` 用十进制 25_000_000，而 `apps/web/lib/api/media.ts` 的 `COVER_MAX_BYTES` 是 25 MiB（界面显示 23.8MB）
- `admin:workspaces:transfer` 是 `NON_GRANTABLE_ADMIN_ACTIONS` 里的幽灵项（不在 `ADMIN_ACTIONS`）→ 加一条契约集合一致性测试
- `settings.service.ts:112` 的 `subscribe` 在 `enableOfflineQueue=false` 后启动瞬断会失败且不重试（靠 30s TTL 收敛兜底）
- `providerLabel`（`apps/web/components/trip-workspace/format.ts`）缺 `geoapify` 分支 → Geoapify 的 stop 会显示"手动录入"
- AI system prompt 未注入 `today`（`AI_SETTINGS_WIRED` 正在补）
- 权限覆盖层应迁到独立 `@Global` 模块（现挂在 AccessControlModule，依赖不显式）
- 跨实例 30s 收敛窗口 → 建议 Redis pub/sub 即时失效
- E2E 未覆盖"真实执行 execute 并写库"（刻意避免造脏数据）

## 发布前必须满足

1. `.audit/local-verify/full-acceptance.sh` 全绿（20+ 门禁，含契约自校验、干净库迁移、e2e 装载、假标签门禁）
2. 生产侧：真实 SMTP 凭据（Gmail 应用专用密码当前被拒）、备份任务、`CONFIG_ENCRYPTION_KEY` 已生成并异地备份
3. tag rc.5 → GitHub Actions 构建镜像 → 拉取部署（**不许本地构镜像**）
4. 部署后：`/v1/ready` 三态、媒体上传真实往返、后台设置改一项验一次生效
## 新增待办（2026-11-19 15:55）

| # | 任务 | 依据 | 优先级 |
|---|---|---|---|
| 6 | **WORKSPACE_TRANSFER_PERMISSION**：转移工作区所有权目前由 `admin:workspaces:delete` 兜底（`apps/api/src/modules/admin/admin-workspaces.service.ts:217`），UI 能力检查同样复用 delete（`apps/admin/components/workspaces/workspaces-view.tsx:174-179`）。语义错配：能删工作区的人就能转移所有权。应新增独立 `admin:workspaces:transfer` 动作并重接 API/UI | `DEBT_SWEEP_1` 边界报告（幽灵项 `admin:workspaces:transfer` 已从 `NON_GRANTABLE_ADMIN_ACTIONS` 删除，本次不新增动作） | P1 |

## 流程规则更新（2026-11-19）

1. **契约生成单点**：`contracts:generate` / `api-client:generate` 只由根 Agent 在所有契约改动落地后执行一次（今天已有两次因提前生成把半成品固化）。
2. **迁移提交后必须通知根 Agent 应用**：今天因 `0009_media_motion` 未应用到共享库，导致**所有公开分享页 500**。
3. **`prisma generate` 由提交 schema 的人负责**，不作为"后续事项"（今天 `packages/db` 因此编译不过）。
4. **`packages/contracts` 的任何改动必须保持每一步可编译**：它是被全仓 import 的共享包，语法错误会让所有 Agent 的本地环境同时失效。
