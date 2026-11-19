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

---

## 第二批需求（用户 2026-11-19 追加，全部"只移植不设计"）

| # | 需求 | 决策 | 状态 |
|---|---|---|---|
| B1 | **可见性 custom + 同行人重设计** | 同行人可提升 editor；分享链接保留且独立；工作区级授权对该区全体生效 | P1 已交付（判定收敛到 6 处 + 40 组对拍）；**P2 API / P3 UI 待派** |
| B2 | **全球地址（中国门牌级 + 全球）** | 腾讯主 + 高德备（待 key）+ Geoapify 全球；中国坐标**允许入库**；Photon 中国兜底**必须关**；允许地图点选兜底 | 腾讯实测通过；接入中 |
| B3 | **真实 3D 地球** | 接受**矢量地球**（非照片级卫星）；零新增依赖（maplibre `projection="globe"`） | 实现中 |
| B4 | **洞察图表重做** | shadcn/ui Charts + Recharts（139.7KB gzip）；**禁无限循环动效**；热力图保持 DOM 网格 | 实现中 |
| B5 | **EXIF 元数据 + 地图打点** | exifr；**压缩前读**；精选约 40 字段；公开页**显示精确 GPS** + Owner 开关 | 实现中（地图打点后置） |
| B6 | **富文本编辑器** | **已是 TipTap 3.34** → 走 A 路线：补官方扩展，不换栈 | 实现中 |
| B7 | **AI 聊天页（ChatGPT 式）** | assistant-ui 骨架 + vercel/chatbot 渲染 + LibreChat 审批语义；**不买付费包** | 实现中（本阶段 localStorage） |
| B8 | **AI 写作（选中优化）** | **方案 A：原位预览 + 接受**（Notion/Google Docs 范式）；需 `baseVersion` + `selectionHash` 校验 | 调研完成，**待派** |

## 关键约束（贯穿第二批）

1. **只移植不设计**：报告必须写"移植自哪里"（URL / 路径 / commit）；写不出来视为自己设计，按未完成退回。
2. **依赖由协调者一次性安装**（已装 `gcoord`/`exifr`/`recharts`/`@assistant-ui/react`/tiptap 扩展）；任务包一律冻结 `package.json`。
3. **输出纪律**：命令带 `| tail`，禁跑全量 test（前几轮 Agent 大面积失败与输出过载相关）。
4. **契约生成单点**：只有根 Agent 跑 `contracts:generate`。
5. **迁移提交后必须通知根 Agent 应用**到共享库（0009/0010 漏应用曾导致公开页与行程页全 500）。

## 第二批已知待办

| 项 | 说明 |
|---|---|
| `VIS P2/P3` | 可见性 API（grants + 同行人状态/角色）+ UI（搜索式多选、chip、同行人面板） |
| `AI_WRITING` | 编辑器内选中改写（方案 A） |
| AI 会话服务端持久化 | 当前仅 localStorage |
| 地图打点（照片 GPS） | EXIF 存了坐标，地图侧未消费 |
| 高德备源 | 等用户 key；无 key 时降级 |
| 天地图补测 | CGCS2000≈WGS-84，免转换，可作中国免费兜底 |
| worker 上传落桶 | 入队→上传间换桶会导致行 bucket 与实际不一致 |

## 迁移台账（共享库已应用 13 条）

0009 media_motion · 0010 trip_destinations · 0011 export_bucket · 0012 visibility_and_participants · 0013 stop_provider_tencent

---

## 第三批：P0 与结构化缺陷（2026-11-19 晚）

### 两条 P0（都是"错数据比空数据更危险"，且都不是单测能发现的）

| # | 缺陷 | 证据 | 处置 |
|---|---|---|---|
| P0-1 | **Photon 返回同路错门牌号**：`北京市朝阳区建国路87号` → `建国路75号数字艺术园区` | 实测 | 中国分支禁用 Photon 兜底（`d792332`） |
| P0-2 | **腾讯把海外汉字地名解析成中国地点**：`东京` → 黑龙江宁安；`巴黎` → 上海；`纽约` → 江苏南通 | 实测 6 例 | 路由收紧为「country=CN 或 汉字+中国地址标记」（`6b2a3a1`） |
| P0-3 | **Photon 也把汉字地名解析成中国村镇**（Geoapify 不可用时） | 实测 | 含汉字查询不走 Photon 兜底（`f917680`） |

**关键证据（证明单源方案必然错）**：

| 查询 | 全球源 Geoapify | 中国源腾讯 |
|---|---|---|
| 建国路87号 | **吉林 42.527,125.726** ❌ | 北京 39.908,116.473 ✅ |
| 东京 | 日本 35.677,139.764 ✅ | **黑龙江宁安** ❌ |

→ 同一个查询两个源各错一半，**按地址特征分流是唯一可行解**。

### 反复出现的模式（值得写进规范）

1. **"声称本地绿"可能是缓存假绿**：turbo 缓存藏过 5 个 api 错误；`tsconfig.tsbuildinfo` 增量缓存造成过一次 typecheck 假绿。
2. **本地与生产配置不一致会导致误判**：`.env.local` 缺 `GEOAPIFY_API_KEY` 时全球路由退化到 Photon，使一个正常行为看起来像缺陷。
3. **并行开发中的瞬时构建失败 ≠ 真缺陷**：`next build` 报的错可能属于**正在跑的其他 Agent**；必须用当时的实际输出定位，不能照抄别人的归因。已发生 1 次（AI_CHAT_PORT 报 setup.ts/chart-container.tsx，实为 PHOTO_MAP 的在途文件）。
4. **共享文件被多 Agent 触碰要查提交内容**：`apps/web/test/setup.ts` 被 RICHTEXT 与 AI_CHAT_PORT 同时改；已核实 `d9b92a1` 只含 jsdom stub，未卷入他人改动。
5. **`next build` 会杀掉 :3000 的 dev server**（覆写 `.next`）。跑 build 前先确认，跑完重启。
6. **本机 `pnpm --filter @roamlog/web build` 返回 126**，须用 `cd apps/web && node ./node_modules/next/dist/bin/next build`。

### 共享文件写入者纪律（新增第 5 条）

5. **`packages/contracts` 与 `packages/db/prisma` 同一时间只允许一个写入者**；依赖安装由协调者一次性完成，任务包一律冻结 `package.json`。

### 待办（第三批）

| 项 | 状态 |
|---|---|
| `EXIF_WIRING` | 照片网格接线 + 行程设置里的精确位置开关 + 修 `read-photo-exif.ts` lint |
| `PHOTO_MAP` | 照片 GPS 上地图（在途） |
| `AI_E2E_VERIFY` | 配 magpie 供应商，跑真模型端到端，验数据库副作用 |
| `VIS_ADVERSARIAL` | 穷举仍绕过统一可见性规则的读路径（已发现 6 处，怀疑还有） |
| `VIS_P2/P3` | 阻塞于 EXIF_WIRING 占用的 trips 模块与 contracts |
| `AI_WRITING` | 方案 A 已定；阻塞于 contracts |
| AI 会话服务端持久化 | 当前仅 localStorage |
| 海外地名别名加权 | Geoapify 已正确；仅无 key 退化路径需关注 |

### 迁移台账（共享库已应用 14 条）

0012 visibility_and_participants · 0013 stop_provider_tencent · **0014 media_exif**（Media.exif/lat/lng + Trip.showExactPhotoLocation + 2 索引 + CHECK lat/lng 成对）
