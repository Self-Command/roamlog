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

---

## 状态快照（2026-11-19 21:12，换模型续跑，三个中断任务已收尾并重新派发）

**HEAD**：`eb3fa2d feat(map): plot geotagged photos as a second cluster layer on the atlas`
**上一提交**：`bf50a55 feat(settings): make ai.baseUrl/ai.model/ai.apiKey admin-configurable`

### 三个中断的 Agent 已收尾（我验收后分别提交/复用，未代写产品代码）

| Agent | 现场 | 处置 | 结论 |
|---|---|---|---|
| `de3a52b0` AI_SETTINGS | 7 个 `ai.*` key 已注册、defaults 用 `null`、`PLACE_PROVIDERS` 漂移已修、`ai.settings.ts` storage-first；settings+ai 16 文件 166 通过 | 我 `git add` 后提交 `bf50a55` | **ACCEPT** |
| `17cec915` PHOTO_MAP | 6 个文件（photo-layer/photo-points/map-camera/cluster-points-source + 2 测试）类型检查干净、`components/map` 7 文件 36 通过 | 我提交 `eb3fa2d`；顺手回滚了被 `next build` 改写的 `next-env.d.ts` | **ACCEPT** |
| `84c986ee` VIS_ADVERSARIAL | 报告 413 行完整（4 处绕过统一规则 + blast radius + 复现用例）；`visibility-audit.spec.ts` **8 红 1 绿**，红即缺陷清单 | **不改代码**，把红用例当验收夹具重派 `VIS_FIX` | **ACCEPT（审计产物）** |

### `packages/db` 测试重新核对（上次 4 个 FAIL 是假警报）

带上 `ROAMLOG_TEST_DATABASE_URL` 重跑：**106 通过 / 2 失败**，两条都是**测试自身的历史包袱**，不是回归：
- `address-bbox.integration.test.ts`：该用例只回放到 `0006`+`0008` 就断言 Prisma 模型，而 `Trip.showExactPhotoLocation` 是 0014 加的 → 用例缺迁移，属测试债。
- `seed.integration.test.ts:134`：断言"其它工作区行数为 0"，但共享库里已有真实数据 → 用例假设了独占库，属测试债。
→ 已记为待派 `TEST_DEBT_DB`（低优先，不阻塞发布）。

### 当前在跑（4 个）

| Agent | 任务 | 内容 |
|---|---|---|
| `c7b49cc9` | **VIS_FIX** | 修 4 处可见性旁路（reports / share-links / worker export / worker reminders），目标 `visibility-audit.spec.ts` 9/9 绿；要求把 grep 源码断言换成真跑 DB 的行为断言 |
| `722c6871` | **AI_E2E_VERIFY** | 配 magpie 真模型跑 chat→execute，**直接查库核对 Trip/Stop/PackingItem 行数**，定性 P0"说已执行但无数据"；只验证不改产品代码 |
| `5f0c6119` | **EXIF_TRIP_SETTINGS** | 把 `showExactPhotoLocation` 从照片页搬到 `trips/[tripId]/edit`（用户已拍板"行程设置"） |
| `f725487a` | **AI_WRITING** | B8 方案 A（原位 diff 预览+接受），新增 `POST /ai/rewrite` 契约；**本轮唯一契约写入者**，生成命令由我统一跑 |

### 本地 API 重启的正确姿势（我踩过一次，务必照抄）

`cd apps/api && npx tsx ../../e2e/live-support/start-api.ts` **必须带内联 env**，否则进程会退回仓库根 `.env.local` 里的
`DATABASE_URL=...localhost:5432` 与 `REDIS_URL=redis://localhost:6379`（都是错的），表现是 health=200 但所有碰库路由 500：

```bash
cd /c/Users/BY9700/Desktop/UI/roamlog/apps/api
DATABASE_URL='postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public' \
REDIS_URL='redis://127.0.0.1:46379' \
API_PORT=4000 API_URL='http://127.0.0.1:4000' \
npx tsx ../../e2e/live-support/start-api.ts
```

自检三连：`/v1/health`=200、`/v1/public/settings`=200 且有真实数据、`POST /v1/auth/sign-in/email`=200。

**只能有一个 :4000 实例**：`start-api.ts` 的 redis stub 固定绑 `46379`，第二个实例会以 `EADDRINUSE 46379` 自杀（health 立刻 000）。
2026-11-19 21:2x 出现过一次「`health=200` 但所有碰库路由 500」的窗口，原因是重启时 env 丢失、进程退回了 `.env.local` 的 5432/6379；
另有一次 agent 清理自己的残留进程时按 pid 误杀了 :4000。**结论：重启前先确认 `46379` 与 `4000` 都空，且重启必须带上面四个 env。**

### 我（协调者）待执行，不可委派
1. 收 `AI_WRITING` 后跑 `pnpm contracts:generate` + `pnpm api-client:generate` + `pnpm contracts:check`
2. 收齐后统一 `next build`（会杀掉 :3000，需重启）
3. 派 `VIS_P2`（可见性 API：grants + participant status/role）→ `VIS_P3`（UI）
4. 派 `TEST_DEBT_DB`（上面两条 db 测试债）
5. rc.5：tag → GitHub Actions 构建镜像 → 部署（用户已选"第二批做完再部署"）

---

## 历史快照（2026-11-19 20:41，用户要求暂停派单、等待在跑任务完成）

**硬指标**：130 commits（rc.4 后） · 迁移 14（0014_media_exif） · 契约 103 端点 · 全量 API 测试 129 文件 / 1054 通过
**HEAD**：`c74fe7c feat(media): show the EXIF summary in the photo grid and wire the exact-location switch`
**服务**：web:3000 ✅ · api:4000 ✅（已用最新代码重启） · PG 55444 ✅ · magpie:3425 ✅ · Redis/MinIO 未起

### 在跑（3 个，等它们完成，不再派新任务）

| Agent | 任务 | 内容 | 备注 |
|---|---|---|---|
| `17cec915` | PHOTO_MAP | 照片 GPS 上地图（复用已有 map 组件） | **必须修掉它引入的 `components/map/photo-layer.test.tsx:238` TS2345**，否则 `next build` 失败 |
| `84c986ee` | VIS_ADVERSARIAL | 穷举是否还有第 7 处可见性旁路（只读 + 只写测试） | 它已写过 `visibility-audit.spec.ts`，当前有 1 个 TS6133 + 6 条红测试（属它的在途状态，等它收尾） |
| `de3a52b0` | AI_SETTINGS | 后台注册 `ai.baseUrl`/`ai.model`/`ai.apiKey` + 修 `PLACE_PROVIDERS` 漂移 | 前两次因 cwd 与过界约束失败；已放宽允许改 `packages/db/src/settings-defaults.ts`，并给了精确插入点 |

### 换模型后要立刻做的顺序

1. **收齐 3 个 Agent 的交付** → 我逐条验收
2. `AI_SETTINGS` 落地 → **重派 `AI_E2E_VERIFY`**（配 magpie 真跑"真模型→计划卡→确认→执行→数据库验行数"）
3. `EXIF_WIRING` 已完成并 **开关已决定迁移到「行程设置」**（用户拍板，尚未实施——需派一个迁移任务）
4. `EXIF_WIRING` 释放 `trips` 模块后 → **派 `VIS_P2`（可见性 API）**
5. `VIS_P3`（可见性 UI）
6. `AI_WRITING`（编辑器内选中改写，方案 A：原位预览+接受）
7. 集成验收 → 准备 rc.5

### 已定但未实施的产品决策（换模型后不要重复问用户）

| 决策 | 内容 |
|---|---|
| 精确位置开关 | **放在行程设置界面**（用户 2026-11-19 20:41 选「行程设置（推荐）」，当前代码在照片标签页，待迁移） |
| 地址方案 | 腾讯主（中国门牌级）+ Geoapify 全球 + Photon 仅非汉字兜底 + 地图点选兜底 |
| 地球视图 | 矢量 3D 地球（非照片级卫星） |
| 公开分享 GPS | 默认显示精确位置，Owner 可关 |
| EXIF 深度 | 精选约 40 字段，不存原图 |
| AI 聊天页 | assistant-ui 骨架 + vercel/chatbot 渲染 + LibreChat 审批语义；不买付费包 |
| AI 改写 | 方案 A：原位 diff 预览 + 接受/拒绝，写入前校验 `baseVersion` + `selectionHash` |

### 关键密钥（只在 `.env.local`，已确认未泄漏到任何被跟踪文件）

- `TENCENT_MAPS_KEY` = 腾讯 WebService（中国主源）
- `GEOAPIFY_API_KEY` = 全球源（已在 `.env.local`，本机验证已用）
- 高德 key 用户**尚未提供**

### 新记 backlog：精确位置开关的服务端覆盖不足（2026-11-19 21:35 我验收时发现）

`Trip.showExactPhotoLocation` 当前**只**被 `apps/api/src/modules/share-links/share-links.service.ts` 读取，
认证态的媒体读取（`GET /v1/workspaces/{id}/media`，也就是照片地图图层的数据源）**完全不看这个开关**。
后果：开关关掉后，工作区地图上的照片图层、照片详情页仍然给出精确坐标。

- 短期处置：把 UI 文案收缩到「只承诺公开分享页」（已派 `EXIF_TRIP_SETTINGS` 返工，文案必须与实现对齐）。
- 待派任务 `EXIF_SCOPE_SERVER`（可选，需产品决定）：是否让关闭开关也影响成员可见的地图/详情。
  我的判断：工作区成员本来就能看到照片本身，精确坐标对成员不构成泄漏，**当前实现可以不改**；
  但若要做，必须在 `media` 读取路径统一裁剪，不能只在前端隐藏（前端隐藏＝假功能）。

---

## 验收记录（2026-11-19 21:50）

### VIS_FIX → ACCEPT（7 提交：fbe3854 / 63c0542 / 6f0be72 / 76d6009 / 9676426 / 6fcd244 / 0793258）

我复跑：`visibility-audit.spec.ts` **9/9 通过**（修复前 8 红）；`grep "visibility: { not"` 全仓非测试文件 **0 命中**。
规则本体落到 `packages/db/src/trip-access.ts`（`packages/db/src/index.ts:38` 导出），`apps/api/src/modules/trips/trip-access.ts` 改为 re-export。

**越界裁定：接受。** 它新增了 `packages/db/src/trip-access.ts` 与 `index.ts` 一行导出，不在我给的写权限清单内。
理由成立：worker 的 `tsconfig.build.json` 有 `rootDir: "src"`，跨 app 相对导入 api 源码会 TS6059（CI 跑 `pnpm build`），而"禁止第二份谓词"又不允许复制。
**这是我的清单不完整，不是 agent 擅自扩张**——与之前 `settings-defaults.ts` 那次同类。结论：以后凡"worker 需要复用 api 规则"的任务，白名单必须直接包含 `packages/db`。

### EXIF_TRIP_SETTINGS → ACCEPT（返工后 `7f8c676`）
`tsc` 0 错误；`components/trip-workspace` + `components/trips/trip-form` **9 文件 / 92 通过**；假承诺串 0 命中。
驳回原因留档：它曾把「公开页显示精确位置」擅自扩大成「地图与照片详情对所有人只显示城市级位置」，而服务端只有 `share-links.service.ts` 读该开关 → 假承诺。

### AI_E2E_VERIFY → ACCEPT（报告 `.audit/ai-e2e-report.md`，432 行）

真实模型链路**通**：chat 201（8.2~45.8s）→ execute 201（14~119ms）→ Trip/Stop/PackingItem 真实落库，计划阶段严格只读（5 用例前后行数一致）。

| 编号 | 缺陷 | 证据 | 处置 |
|---|---|---|---|
| **P0** | `ai-execute.service.ts:110` `partialFailure: succeeded>0 && failed>0`，全失败时为 false → 201 + 前端「已执行/全部完成」，库 0 行 | 删行程后 execute | 已派 `AI_FAILURE_TRUTH`（`63cbb0ab`） |
| P1 | 无 `trips.update` 工具 →「改成 6 天」新建重复行程，原行程不变 | 实测 | 待派 `AI_TRIP_TOOLS` |
| P1 | 单轮计划拿不到刚建 tripId（`ai-tools.ts:477`）→「5 天 3 节点」只落 Trip、0 个 Stop | 实测 | 同上 |
| P1 | 运行进程缺 `CONFIG_ENCRYPTION_KEY` → 任何 secret（含 `ai.apiKey`）写入 503 | `settings/secret-box.ts:92` | **我已在本机 `.env.local` 补上**（gitignored，已确认），重启后生效 |
| P2 | `ai.timeoutMs=30000` 不约束整次 chat（实测 45.8s） | 实测 | backlog |
| P2 | summary 英文直出给中文用户 | 同 P0 文件 | 并入 `AI_FAILURE_TRUTH` |

未覆盖（agent 自述，可信）：真 key 错误路径（本地网关不校验 Authorization）、浏览器渲染（:3000 未监听）、itinerary.addDay/budget 工具、并发版本冲突、配额第 21 次边界。

`.audit/ai-e2e/` 下 7 个可复跑脚本已留存（`05-allfail-deleted-trip.mjs` 即 P0 复现）。

### 用户新增反馈（2026-11-19 21:55）：3D 地球放大缩小「体验极差 + 非常卡」

已派 `GLOBE_PERF`（`86575fd6`）。要求**先测量再修**：fps、>50ms 长任务数、滚轮缩放首帧延迟、缩放期瓦片请求数，四项修复前后对比。

我初步扫到的可疑点（**未验证，仅供 agent 对照，不是结论**）：
- `globe-view.tsx` 的 `<Map projection="globe">` **没有设 `minZoom`/`maxZoom`** —— 深层缩放时球面重投影成本会急剧上升。
- `interactiveLayerIds` 每次渲染新建数组字面量 → 事件订阅可能反复重建。
- `atlas-workspace.tsx` 的 `photoLayer`/`activePhotoKey`/`focusPhotosToken` 任一变化都会重渲染整棵地图树。
- `cooperativeGestures={narrow}`：窄屏下 MapLibre 要求「按住 Ctrl 才滚轮缩放」，**这会被用户感知成「缩放极差」，但它是交互设计而不是性能问题**。已要求 agent 把这两件事分开给结论。

### AI_FAILURE_TRUTH → ACCEPT（我真跑真实链路复验）

`.audit/ai-e2e/05-allfail-deleted-trip.mjs` 实跑结果（:4000 当前代码）：
```
execute -> 201 in 32ms
partialFailure: true
summary: "2 项全部失败，没有写入任何数据"
DB PackingItem rows for that trip: 0
```
修复前是 `partialFailure:false` + 英文 summary；现在两个都对。

三态判定我逐行核过 `apps/web/components/ai/chat-model-adapter.ts:85-89`：
`failed===0 → ok`；`failed===results.length → all-failed`（全部失败）；否则 `partial`。
所以 2/2 失败会走 `all-failed` → 徽章「全部失败」+ 「没有写入任何数据，下面是每一步的结果。」，不会再出现「已执行/全部完成」。

**遗留小瑕疵（非产品代码）**：`05-allfail-deleted-trip.mjs` 尾部那行 `前端会渲染：badge=部分失败` 是脚本自己的旧硬编码映射，与 UI 实际三态不符。
该脚本在 `.audit/` 下，属验收工具不计入产品；下次动这个脚本时顺手改成读三态。

### AI_TRIP_TOOLS 暂时不能派（契约冲突）
`AI_TOOL_NAMES` 定义在 `packages/contracts/src/api/ai.ts:30`，而 `AI_WRITING`（`f725487a`）正在写同一个 `ai.ts`（已提交 `b764717` 加了 rewrite 端点）。
新增 `trips.update` 工具必须改这个文件 → **等 `AI_WRITING` 交回契约权后再派**，否则两个 agent 抢同一文件。

### 本轮已派（并行、互不冲突）
- `GLOBE_PERF`（`86575fd6`）—— 地球缩放卡顿，先测量再修
- `ADMIN_AI_SETTINGS`（`853ca745`）—— 后台能否真正配置 ai 网关、密钥是否泄漏
- `PARTICIPANTS_UI`（`ed18dabd`）—— 参与者页显示邀请状态/角色（只读，不做改角色）

### AI_WRITING（B8 选中文字 AI 优化）→ ACCEPT（4 提交：b764717 / db64ac3 / 3f19ee3 / d770531）

我复跑：`apps/web` `components/journal` + `lib/ai` **4 文件 / 36 通过**；`tsc --noEmit` **0 错误**。
契约面：`POST /v1/workspaces/{workspaceId}/ai/rewrite`，请求严格封闭（无 prompt/system/command 字段），错误码 `AI_REWRITE_TEXT_TOO_LONG` / `AI_SELECTION_HASH_MISMATCH` / `AI_REWRITE_EMPTY`。

**我已跑完生成步骤**（契约权收回后）：
- `pnpm contracts:generate` → **104 paths / 213 schemas**
- `pnpm api-client:generate` → 25 endpoint files / 738 schema files
- `pnpm contracts:check` → 两项均 fresh ✅

**用户裁定的偏差**：实际实现是「锚定在选区下方的浮动面板 + 删除/新增 diff」，**不是正文内联高亮**。
原因：`@tiptap/pm` 未声明在 `apps/web/package.json`，pnpm 下 `require.resolve('@tiptap/pm/state')` → MODULE_NOT_FOUND（我已实测确认），无法注册 ProseMirror Decoration。
**我询问用户并给了两个选项，用户选择「接受当前锚定选区的面板」** → 因此**不新增 `@tiptap/pm` 依赖**，本条结案，不再返工。
（旁证：移植来源 Novel 本身的 `ai-completion-command.tsx` 用的就是这种浮动面板。）

已知风险（用户已知情，不再处理）：跨段落选区接受后可能合并相邻块；接受后走既有 5s 自动保存而非即时 persist；面板定位在 jsdom 无布局引擎，真实位置需人工看。

### PARTICIPANTS_UI → CHANGES_REQUESTED（一处）

复核通过：`tsc` 0 错误，`components/trip-workspace` **5 文件 / 45 测试全绿**（新增 8 条）。

**我写任务包时的错误**：我在 brief 里写的状态词表是 `pending`/`accepted`，但服务端真实枚举是
`packages/contracts/src/entities/enums.ts:31` 的 **`invited` / `joined` / `declined`**。
agent 发现后做了双词表兼容，但把 `declined` 一并归进「未知」——这是**正常业务状态**，显示成"未知"会让用户以为系统坏了。
已退回要求：`declined` → 「已拒绝」，只有三值之外的意外值才落「未知」，并补测试。

**我确认不用改的两处**（避免它过度返工）：
1. `presentParticipant` 的 `invitedAt: joinedAt`：查 `packages/db/prisma/schema.prisma:471-491`，`TripParticipant` **没有独立 `invitedAt` 列**（只有 `joinedAt @default(now())`、`respondedAt`、`invitedById`），所以「邀请于=行创建时间」是当前模型下唯一可得的事实，不是造假。
2. 角色徽章展示"有效权限"而非 `participant.role`：决定正确（工作区 owner/admin 覆盖全成员）。

### 进度快照（2026-11-19 22:40，用户问过一次）
第二批量 8 项 **≈89%**；本批 4 个 agent 全部完成预计 **≈93–94%**。
但**发布进度是 0**：147 个 commit 未 push、40 个文件未提交、统一 `next build` 一次没跑。
上线路径：本批交付收口 → 统一构建 → 打 rc.5 → GitHub Actions → 部署。

端口实况：API `:4000` ✅、PG `:55444` ✅、magpie `:3425` ✅；Web/Admin 的 dev server 被 agent 占用在 `:3100`/`:3201`
（Next 16 同一项目只允许一个 dev 实例，所以 `:3000`/`:3001` 起不来），等 agent 交付后恢复标准端口。

---

## 用户严厉批评（2026-11-19 23:05）—— AI 页面「只是壳子」

原话：「你的SSE流做了吗？你现在按照生产级别的去完整移植啊？你只移植UI？功能也完整移植啊。现在把功能给我完整移植入做完。完整生产级别的」

**批评成立，我的验收有重大遗漏。** 我之前把 AI 对话页记成 70~80%，实际是**只接了工具循环，UI/传输层是壳**。核实结果：

| 缺什么 | 证据 |
|---|---|
| **SSE 流式** | `ai.controller.ts` 只有 `@Post("chat")` / `@Post("rewrite")` / `@Post("runs/:runId/execute")`，无 `@Sse`、无 `Res()` 流式；`adapters/adapter.ts` 的 `AiProtocolAdapter` 只有 `step(): Promise<AiStepResult>`，无流式方法。API_E2E 实测单次 chat **8.2~45.8s**，全程白屏 |
| **服务端持久化** | `apps/web/components/ai/thread-list-adapter.ts:14` 自述 “localStorage-backed … server-side persistence is a later”；`information_schema` 查 **0 张 Ai\* 表** |
| **多轮上下文** | `AiChatRequestSchema`（`packages/contracts/src/api/ai.ts:78-83`）= `{message, hints?}` `.strict()`，**没有历史字段** → 每轮失忆 |
| **停止/重新生成** | `ai-assistant.tsx` / `thread-list-adapter.ts` grep `abort|stop|regenerate|retry` 无命中（只有 retryAction 的 UI 槽位） |

**我的判断错误来源**：`AI_E2E_VERIFY` 报告的是**后端工具链路**通（chat→execute→真实落库），我据此给了 80%，但用户看到的是**界面**——界面确实没有流式、没有历史。这正是我反复强调的「不要拿后端证据替代前端体验」，我自己犯了。

### 处置
- 已派 `AI_PORT_SPEC`（`cfcb6509`，**只读**）：锁定 SSE / 持久化 / 多轮 / 停止生成的**移植来源到 repo+path+commit+行号**，产出 `.audit/ai-port-spec.md` 与 Wave 计划。
- Wave 0 必须等 `AI_TRIP_TOOLS`（`e1f346c9`）交回 `packages/contracts/src/api/ai.ts` 与 `apps/api/src/modules/ai/**`，因为它是当前唯一契约写者。
- **口径修正**：AI 对话页真实完成度按「用户可感知」重算 = **40%**（工具循环真、界面壳）。以后所有百分比一律按用户可感知功能计，不按后端能力计。

### 生产级 AI 对话页的验收底线（我定，供后续 task 包）
1. 首字节 < 1.5s，逐字出现，不是等 30s 一次性刷出；
2. 刷新/换设备后历史仍在（服务端库）；
3. 第二轮能指代第一轮（「把它改成 6 天」）；
4. 能中途停止生成；
5. 失败可重试且不重复写库；
6. 断网/刷新后不丢已生成内容。

---

## 用户严厉批评 #2（2026-11-19 23:10）—— 设置页 IA 与英文

原话：「系统设置的ui怎么设计的？系统设置只包含系统相关的啊？上面ai和存储地图哪些都在里面 谁让你设置选项里面又内置了设置选项？」
「还有你麻痹设置怎么是英文的？」

### 核实结果（两条都成立）
1. **IA 错**：`admin-nav.ts` 侧栏只有一个「系统设置」；`settings-console.tsx:721` 在页面内部又渲染 `<nav aria-label="设置分组">` 左侧导航列出 9 组（general/seo/theme/mail/storage/media/ai/places/limits）。这就是「设置里又内置设置」。
2. **英文**：
   - `SETTINGS_GROUP_LABELS`（`packages/contracts/src/api/admin-settings.ts:28-38`）全英文：General/SEO/Theme/Mail/Storage/Media/AI/Places/Limits。
   - `settings.registry.ts` **48 个 `label` + 48 个 `help` 全英文**（`"Site title"`/`"Mail provider"`/`"Resend API key"`…），`SETTINGS_GROUP_SUMMARIES` 却是中文 → 中英混排。
   - 全后台另有 **28 处英文 `<option>`**（Active/Free/Pro/Team/User/Support/Analyst/Admin/Super admin/Ready/Processing/Failed/Delivered/Queued…）。

### 目标 IA（我定，已发）
```
数据与运营：邮件 / 队列 / 功能开关 / 系统设置 / 系统健康
服务配置（新分组）：AI 服务 /admin/services/ai
                    存储服务 /admin/services/storage
                    地图服务 /admin/services/places
                    发信服务 /admin/services/mail
                    媒体处理 /admin/services/media
```
- `/admin/settings` 只留 4 组：general/seo/theme/limits，**删掉页面内左侧分组导航**，改单页分区表单。
- 5 个服务页 = 单一表单，无二级导航，复用现有 `SettingField` 与保存/探测逻辑。

### 已派
- `ADMIN_SETTINGS_IA`（`853ca745`，由原 `ADMIN_AI_SETTINGS` 改向）：IA 重构 + 设置全中文化（含 registry 48×2 文案与 Zod 校验消息）。
- `ADMIN_I18N`（`56e29a96`）：后台其余页面的 28 处英文与所有用户可见英文，建 `apps/admin/lib/labels.ts` 集中映射。

### 我的教训（写死，后续所有 task 包必查）
- **凡交付 UI，验收必须包含「语言一致性」与「信息架构层级」两项**，不能只看 tsc + 测试绿。
- 检查项：①页面里有没有第二层导航；②有没有英文残留；③中文有没有和英文混排；④枚举值是否被误翻。

### 用户指令（2026-11-19 23:16）：「干掉它 重新分配子agent去做，不要让他再做了」

执行：
- `interrupt_agent(853ca745)` → 已停止（Background subagent was stopped, left no closing message）。
- 清理它留下的痕迹：`git checkout -- apps/admin/next-env.d.ts`（Next 生成物，`.next/dev/types`→`.next/types`）；`apps/admin/scripts/verify-ai-settings.mjs` 移到 `.audit/tools/`，删除空目录 `apps/admin/scripts/`。**它没有留下任何产品代码改动**。
- 重新派 `ADMIN_SETTINGS_REBUILD`（`2c70cc2d`）：全新 brief，从零重建设置 IA + 全中文化，**强制要求 Playwright 截图**（`.audit/settings-ia/01-sidebar.png` … `07-media.png`），交付里必须用图片引用。

保留 `ADMIN_I18N`（`56e29a96`）不动——它做的是 users/workspaces/media/emails 等**其它**页面的英文，与设置页无文件重叠。已明确告知双方：`apps/admin/lib/labels.ts` 归 `ADMIN_I18N`，`ADMIN_SETTINGS_REBUILD` 只能读不能写。

---

## 超时 agent 处置 + 审计结论（2026-11-19 23:20 前后）

### 用户指令：「把大于40分钟的子agent全部让他交付当前报告 然后派新子agent继续做」
按派发时间算，>40min 的是 `GLOBE_PERF`(~75min) 与 `AI_TRIP_TOOLS`(~45min)。已分别发「停止新工作、只做交付、提交、给交接单」。

- `AI_TRIP_TOOLS` → 已交付 `6c0b48c`（trips.update + tripId 注入 + copy.ts 修复），8 文件，tsc 三端 0 错误，api ai 测试 12 文件/107 通过。
  真实链路 502 的原因是 **:4000 进程跑了 63 分钟、代码陈旧**；我重启后实测 chat 201/3866ms，502 消失。
  → 已派接任 `AI_TRIP_TOOLS_2`（`9e3d3a54`）：补 `trips.list`（模型无法发现既有行程，trips.update 形同虚设），并真跑 3 条链路验收。
- `GLOBE_PERF` → 仍在等交接单。

### 我替已关闭 agent 补的提交
`161dbdd fix(ai): show all-failed plan runs as a failure, not a clean success`
`AI_FAILURE_TRUTH` 报 DONE 但**从未 commit**，改动一直躺在共享工作区。我验证 web tsc 0 错误 + components/ai 21 通过后补提交，commit message 里注明是协调者代提交及原因。

### PORT_COMPLETENESS_AUDIT → DONE（`.audit/port-completeness-audit.md`，411 行）
**真移植 4 / 半成品 6 / 壳 0**。真移植：B3 地球、B5 EXIF、B8 AI 改写、后台设置。半成品：B4 图表、B6 富文本、B2 地址、B7 AI 对话、B1 可见性、分享页。

补齐清单（按严重度）：
| 级 | 缺口 | 处置 |
|---|---|---|
| P0 | B1 `custom` 无 grants API/UI；参与者无法提角色 | 已派 `VIS_GRANTS_API`（`6d6903f5`） |
| P0 | B7 AI 无 SSE/无服务端持久化/无多轮 | `AI_PORT_SPEC`（`cfcb6509`）出规格后派实现 |
| P1 | B6 图片只插 base64 占位；sanitizer 丢 img/任务列表 | 待派 |
| P1 | B4 洞察无服务端聚合，全量前端算，100 趟上限 | 待派 |
| P1 | B2 地图选点不落库；Stop 表单无地址搜索 | 待派 |
| P1 | 分享页无地图/无 GPS 渲染；正文图片丢失 | 待派 |
| P2 | 设置消费标签失真；limits/media 部分开关未接 | 并入 `ADMIN_SETTINGS_REBUILD` 的核对范围 |
| P2 | EXIF 无共享库真实上传样本 | 验收证据缺口，需真机上传一张带 GPS 的照片 |
| P3 | 地球无 zoom clamp | `GLOBE_PERF` 已覆盖 |

### 关键判断
审计结论改变了我的优先级：**B1 grants 比 AI 对话更紧急**（隐私语义错误 > 体验缺失）。AI 对话仍是 P0，但排在其后。

---

## 交接与接任（2026-11-19 23:30）

### GLOBE_PERF → 实质 DONE（报告已写，agent 未及发送）
`.audit/globe-perf-report.md`（105 行）。**根因不是 GPU，是库版本不兼容**：
- `maplibre-gl@6.18.0` 移除了公开的 `map.transform`；`react-map-gl@8.1.0` 的 camera 事件处理仍读它 → `transformToViewState(undefined)` 抛 `TypeError: reading 'center'`；
- 异常打断 MapLibre 帧提交：**450 次异常/6s、缩放期 0 个瓦片请求、画面白屏**；
- 修复：`react-map-gl` 8.1.0 → 8.1.3。我在 node_modules 里核对：8.1.0 无 `getTransformLike`，8.1.3 有，且源码注释写明 "maplibre-gl v6 removed the public `map.transform` property"。
- 修复后：异常 0、缩放期 109 瓦片（+z10-14 24 个）、滚轮→首帧 **0.8ms**、深放大 **59.6fps**、长任务 2 个（79ms/71ms）。
- 我已提交 `287640e`（含测量数据）。

**遗留 P0**：放大到 z≈8 后画面变黑（亮度 113→7.7，静置仍 8.8，只剩国界线）。已派接任 `GLOBE_PERF_2`（`6c0e39a5`），按报告 §6.1 的三步定位法执行。
**遗留 P1**：窄屏 `cooperativeGestures` 未生效（裸滚轮仍缩放），同属「缩放体验差」，一并交给 `GLOBE_PERF_2`。

### AI_PORT_SPEC → DONE（`.audit/ai-port-spec.md`，1495 行）
- 原生 SSE 零新依赖；三协议 delta 提取路径；7 事件协议；NestJS `@Res({passthrough:false})` 四件套。
- 持久化：移植 vercel/chatbot `Chat`/`Message_v2`/`Stream`，适配 Prisma `AiConversation`/`AiMessage`/`AiStream`。
- 多轮：**服务端按 conversationId 读库**（推荐），`AiChatRequestSchema` 只加可选字段；新增 `/ai/chat/stream`，旧 `/ai/chat` 不改 → 非破坏性。
- 纠正我两个任务描述错误：`@assistant-ui/react` 没有 3.x（实际 0.15.37）；NextChat `parseSSE` 是回调参数不是函数。
- 已派 Wave 0 的 db 分支 `AI_DB_SCHEMA`（`321f7f2d`，迁移 `0015_ai_conversations`）；contracts 分支等 `AI_TRIP_TOOLS_2` 交回 `ai.ts` 后再派。

### 当前并行 6 个
`AI_TRIP_TOOLS_2`(trips.list) · `VIS_GRANTS_API`(grants 端点) · `AI_DB_SCHEMA`(AI 持久化表) · `GLOBE_PERF_2`(黑屏) · `ADMIN_I18N`(后台中文化) · `ADMIN_SETTINGS_REBUILD`(设置 IA)

### 我这轮补的 2 个提交
- `161dbdd` AI_FAILURE_TRUTH 的遗留（原 agent 报 DONE 未 commit）
- `287640e` react-map-gl 8.1.3（原 agent 报 NEEDS_REVIEW 未 commit）
**教训：子 agent「DONE」不等于「已提交」，验收时必须 `git log` 核对。**

---

## 用户长期指令（2026-11-19 23:35）：子 Agent 模型选择

原话：「后续子agent优先启动magpie下面的loomy下面的deepseek-v4-flash 1017 max。后续额度不够自动中断或者429后才继承当前的你自己使用的模型当成子agent派发 记住就行」

### 本 session 实际可用的路由（我用 list_subagent_models 逐一验证）
- 可用：**`magpie` / `workbuddy/deepseek-v4.1-flash`**，reasoning efforts = `off | low | high | max`
- 不可用（报 `child LLM route ... is not allowed for this Session`）：
  - `magpie/loomy/deepseek-v4-flash-1017`
  - `magpie/loomy/deepseek-v4-flash`
  - `magpie/workbuddy/deepseek-v4-flash-1017`

### 因此执行口径
所有**新派**的子 agent 一律显式传：
```json
{ "provider": "magpie", "model": "workbuddy/deepseek-v4.1-flash", "reasoning_effort": "max" }
```
**只有**在额度不足 / 自动中断 / 429 之后，才省略 provider/model 走「继承父会话当前模型」。
已在跑的 agent 不重启（用户说的是「后续」）。

### 模型路由试探结果（2026-11-19 23:40）
用户坚持 `loomy/deepseek-v4-flash-1017` 可以调用。我实测结论：

```
subagent(provider="magpie", model="loomy/deepseek-v4-flash-1017", reasoning_effort="max")
→ Error: child LLM route "magpie/loomy/deepseek-v4-flash-1017" is not allowed for this Session;
         without a recorded model-selection policy, explicit selection (including reasoning_effort)
         is limited to the parent route
```

**关键在最后半句**：本 session **没有记录 model-selection policy**，所以在没有策略的情况下，
显式指定路由（连 reasoning_effort 都算）**只允许父路由本身**。这不是模型不存在，也不是名字写错。

已验证可用：`provider=magpie, model=workbuddy/deepseek-v4.1-flash, reasoning_effort=max`（父路由 + max）。
→ 后续新 agent 默认用这条。若要切 `loomy/deepseek-v4-flash-1017`，需要先在 session 上记录模型选择策略（GUI 侧），我这边没有对应工具。

---

## 🔴 生产环境勘察（2026-11-19 23:45，我自己 SSH 查的）

### 现状
- `root@217.217.197.188` SSH 通；`/opt/roamlog/repo` 在 `c27b99f`。
- 5 个容器全部 `Up 22 hours (healthy)`：`web/admin/api/worker` 均为 `ghcr.io/self-command/roamlog/*:v0.1.0-rc.4`，另 postgres 17 / redis 7 / minio。
- 数据库 `roamlog`：**30 张表**，含 `TripParticipant`/`Media`/`JournalEntry`/`Export`/`FeatureFlag` 等。

### 🔴 发现 1：迁移历史与真实 schema 不一致（发布阻塞）
```
_prisma_migrations 只有 3 行：0001_init / 0002_two_factor_state / 0003_w0_trip_stop_place_metadata
```
但库里已有 30 张表（远超 0003 应建的量），且**缺 `TripAccessGrant` / `TripDestination`**（这两个是后面迁移才加的）。
说明生产库历史上被 `db push` 或手工 DDL 建过表，`_prisma_migrations` 没同步记录。
后果：rc.5 部署时 `migrate` 服务跑 `prisma migrate deploy` 会**从 0004 开始重放**，撞上已存在的表而失败。
必须在部署前做一次迁移史对齐（baseline）：把已存在的 0001–000N 标记为 applied，只让新迁移真正执行。
`docs/operations/migrations.md` 明令禁止 `db push`，说明这是历史遗留，不是我造成的。

### 🔴 发现 2：api 容器里没有 schema-engine
```
npx prisma migrate status → Error: Could not find schema-engine binary
```
说明 `api` 镜像被裁剪过，只能靠单独的 `migrate` 镜像执行迁移。

### 待办（部署前）
1. 找出 `migrate` 镜像里能跑 `migrate status` 的方式；
2. 比对生产库真实 schema 与本地 14 个迁移，确定 baseline 点；
3. 生成 `prisma migrate resolve --applied <name>` 清单并执行；
4. 再跑 `migrate deploy` 只应用剩余迁移；
5. 备份先行（`/opt/roamlog/backups` 已存在）。

### VIS_GRANTS_API → ACCEPT（已由我提交 `b658bb2`）
22 个真实 PostgreSQL 集成测试；`src/modules/trips` 9 文件/102 通过；contracts + api tsc 0 错误。
端点：`GET|PUT /v1/trips/{tripId}/access-grants`、`PATCH /v1/trips/{tripId}/participants/{userId}`。
授权：读 = `requireVisibleTrip`（不可读 404，不做存在性预言机）；写 = `trip:update` + 创建者或 workspace owner/admin。
`grantedById` 只取 actor，请求体传了会被 strict schema 400。

**它报告的 4 条风险，我的判定：**
1. 响应形状是 `{ grants: [...], resolved: { workspaces, users } }`，不是扁平 → 记下，UI 按这个写。
2. editor 不能改 grants（我 brief 里要求 stricter）→ 接受，产品语义上「谁能分享」应严于「谁能编辑」。
3. 跨 workspace 的 `grant_workspace` 被 TenantGuard 挡住，无法真正跨 workspace 读 → **已知架构缺口**，记 backlog（需要 TenantGuard 支持 grants 分支）。
4. **`TripParticipant.role` 只落库、不参与授权** → 🔴 这是假功能，已派 `VIS_PARTICIPANT_ROLE_AUTH`（`2ed601a8`）修。

### 另一个反复出现的问题：agent 报 DONE 但不 commit
已发生 3 次：`AI_FAILURE_TRUTH`、`GLOBE_PERF`、`AI_DB_SCHEMA`、`VIS_GRANTS_API`。
→ 结论：**根 Agent 必须每次验收都 `git log` 核对，未提交的由我补提交并注明原因。** 已在 task 包里加「提交」一栏但仍不能信任。

### GLOBE_PERF_2 → ACCEPT（`df6557a`）
**黑屏根因（我看了截图确认）**：`globe-view.tsx` 无条件把 `background` 涂成 `#000000`。但 Liberty 的 `background` 不是装饰色 —— 它是 `natural_earth` 栅格（maxzoom 7）消失后 z>7 的唯一地表底色（style 原为 #f8f4f0）。所以深放大后整片地表变成黑底，只剩边界/水系线。
**修复**：保留黑色 background 作为球体外太空，另加一层 `globe-land-base` GeoJSON 世界 fill，颜色取 style 自己的 `#f8f4f0`，插在 background 之后、所有 style 图层之前。
**实测**：40 tick 后静置亮度 **8.8 → 240.4**（非黑 100%），pageerror 0→0，瓦片 100→110，FPS 58.0→57.4（噪声内）。
截图我逐张看过：before 全黑只剩线；after 是正常浅色地表；初始球体仍是「地表 + 黑太空」，没有被改坏。

**cooperativeGestures 也修了**：根因不是 maplibre v6，是 `react-map-gl 8.1.3` 的 `Maplibre._initialize` **只在构造时读 `...props`**，`cooperativeGestures` 不在 `settingNames`/`handlerNames` 里，post-mount 没有 setter；而 `narrow` 初始 false，effect 才 set true，Map 已经按 false 构造完了。
修复：`useState` 惰性初始化，client 首帧就 `matchMedia("(max-width: 639px)")`（GlobeView 是 ssr:false，无 hydration mismatch）。
实测 390×844 dpr3 hasTouch：修复前遮罩不存在、裸滚轮缩放 2.2→2.7（12 瓦片）；修复后遮罩可见（"Use Ctrl + scroll to zoom the map"）、裸滚轮不变（0 瓦片）、Ctrl+滚轮正常。

遗留（不阻塞）：`map-canvas.tsx` 平面视图在本机 headless 从加载起即黑画布（独立问题，未定位）；`MapCanvas` 未传 `cooperativeGestures`（本次只修 globe 的 narrow 分支）。

### 本轮（23:20–23:45）已完成并提交
| 提交 | 内容 |
|---|---|
| `1bc7989` | 后台全中文化（47 文件，约 299 处，labels.ts 26 组/98 值） |
| `358739e` | 富文本图片真实上传 + sanitizer 安全白名单（img/checkbox 放行，javascript:/data: 拒绝） |
| `df6557a` | 地球深放大黑屏修复（land-base fill）+ 窄屏 cooperativeGestures 修复 |
| `84c975e` | 参与者 editor 角色接入权限判定（**有集成缺陷待修**，见下） |
| `b658bb2` | access-grants 三端点 + 22 测试 |
| `d6abbd8` | AiConversation/AiMessage/AiStream 三表 + 0015 迁移（已 apply） |
| `287640e` | react-map-gl 8.1.3（修 globe camera 异常风暴） |
| `161dbdd` | AI 全失败不再显示「全部完成」 |

### 待修集成缺陷（已通知 `2ed601a8`）
`84c975e` 把 `TripParticipantRoleGuard` 作为**第 4 个构造参数**注入 `TenantGuard`，导致 `ai.controller.spec.ts` 的 15 个测试全部 `Nest can't resolve dependencies`。
已要求改成独立 guard（`@UseGuards` / `APP_GUARD`），不要让 `TenantGuard` 多一个必填依赖。
全仓只有 3 个 spec 引用 `TenantGuard`（`trip-participant-role.spec.ts` / `ai.controller.spec.ts` / `tenant.guard.spec.ts`），修复面很小。

### 观察
`AI_TRIP_TOOLS_2` 的 `trips.list` 已实现且 `ai-trips-list.spec.ts` 5/5 通过，正在做真实链路。
`ADMIN_SETTINGS_REBUILD` 已产出 `app/admin/services/`、`service-settings-page.tsx`、`settings-group-form.tsx`、`settings-ia.test.tsx`，正在收尾。

### 23:45–23:55 进展
- `94440cf` 后台设置 IA 重建 + 全中文化（settings-console 864→58 行，SettingsGroupForm 被 6 页复用）。admin tsc 0 / 27 文件 173 测试；api settings 7 文件 108 测试；`next build` 23 路由成功。
- `b4e21b8` 把 `TripParticipantRoleGuard` 从 `TenantGuard` 移到 `ContentTenantGuard`，修掉 15 个 AI controller 测试的 DI 失败。现在 `ai.controller.spec.ts` **15/15 通过**，`src/modules/trips + src/common` **16 文件 / 164 测试通过**。
- 我审了 guard 实现：只升级 workspace `viewer`；要求 participant row `status != declined`；`participant.workspaceId` 与 `trip.workspaceId` 双重校验；查询失败 fail-closed 保持 viewer。逻辑正确。
- `AI_TRIP_TOOLS_2` 的 `trips.list` 已在临时 `:4100` 上跑通 3 条真实链路（改行程 10.7s、建行程 39.1s、越权 404）。我已重启 `:4000` 让它在新进程上复验并提交。
- 已派 `E2E_CATCHUP`（`14008343`）修 `e2e/admin/smoke/admin-settings.spec.ts` 等失效用例。
- 已派 `AI_ADAPTERS`（`f4b52331`）：`sse.ts` 已建，三协议 `streamStep` 已写，正在补测试。

### 注意：:4100 有个临时 API 实例（pid 23476）
`AI_TRIP_TOOLS_2` 自己起的，与 `:4000` 共用同一 Postgres/Redis。已要求它跑完自己停掉。**不要用这个实例做验收基线**（它不是正式进程）。

### VIS_PARTICIPANT_ROLE_AUTH → ACCEPT（`84c975e` + `b4e21b8`）
14 条真实 PostgreSQL 测试全绿。设计：独立 guard 注册在 `AccessControlModule`，由 `ContentTenantGuard` 在 `TenantGuard` 之后、`RolesGuard` 之前调用；**`TenantGuard` 净 diff 0**（这是关键，上一版就是改了它导致 15 个 AI 测试挂掉）。
`WorkspaceMembershipAccess` 237 个调用方、`PermissionService.assertCan` 77 个调用方全部未改，靠请求级对象替换一处生效。
防串权：`tripId + userId + workspaceId + trip.workspaceId + trip.deletedAt=null` 五重条件；`status != declined`；查询失败 fail-closed。
回归：`src/modules/trips + src/common` 16 文件/164 测试；`ai.controller.spec.ts` 15/15。

**遗留（已派 `VIS_ROLE_COVERAGE` `a20ea556` 补）**：
1. 子资源路由（`PATCH /stops/:stopId`、`/packing/:itemId`、`/entries/:entryId` 等）路径里**没有 `:tripId`**，取不到升级 → 被提升的 editor「能新建、不能修改已有的」。
2. `invited`（未接受邀请）的 editor 目前仍获得编辑权 → 应收紧为只有 `joined` 可编辑。

### 🔴 协调失误：共享 git index 竞争
我提交 SSE 适配器时没先看 `git diff --cached`，而 `AI_TRIP_TOOLS_2` 已经把它的 7 个文件 `git add` 进同一个索引，结果我的 `git commit` 把它们一起提交成 `775fa1e`（14 文件）。两个 agent 都主动报告了这件事。
处置：`git commit --amend` 改为 **`6905d91 feat(ai): let the planner find existing trips, and stream all three protocols`**，内容不变，message 覆盖两部分。
**今后规则**：根 Agent 提交前必须 `git diff --cached --stat` 核对；或用 `git commit --only -- <paths>` 只提交指定路径，避免把别人暂存的内容带走。子 agent 之间也共享同一个 index，这层没有隔离——只能靠根 Agent 把 git 操作串行化。

### AI_ADAPTERS → ACCEPT（含入 `6905d91`）
`adapters/sse.ts` 零依赖解析器：CRLF / 多行 data / 注释 / `[DONE]` / 跨 chunk 帧 / **跨 chunk 中文（UTF-8 被切在字节中间）** / 结尾无空行 全部有测试；三协议 `streamStep` 按规格 §1.2 的 delta 路径实现；`step()` 函数体逐行未改。
15 个 SSE 测试；`src/modules/ai` 14 文件 / 127 通过 + 6 skipped（真实 gateway 用例需要 AI_BASE_URL）。

### AI_TRIP_TOOLS_2 → ACCEPT（`6905d91` 内含）
三条真实链路都在 `:4000` 最新代码上跑通，证据文件在 `.audit/ai-e2e/`：

| 场景 | 耗时 | 工具序列 | 结果 |
|---|---|---|---|
| 按名字改行程 | 8,924ms | `trips.list`(readOnlyTrace) → `trips.update`(plannedCalls) | Trip **14→14**（没新建），endDate `2027-04-14 → 2027-04-15`（= start+5），version **5→6**，8/8 断言通过 |
| 建行程 + 3 节点 | 44,797ms | 6×places.search → trips.create → 3×stops.add → 5×itinerary.addDay → 7×packing.add → budget.setSummary | Trip **14→15**、Stop **18→21**，3 条 Stop 的 tripId **全部等于**新 trip `01a1f47f-…`，10/10 断言通过 |
| 越权反证 | 5,653ms | `trips.get` / `trips.list` | owner 对他人 private trip：GET/PATCH 均 **404 TRIP_NOT_FOUND**（19ms/9ms），非 500、不泄漏；AI chat 也明确回复 TRIP_NOT_FOUND 且 0 写入 |

`trips.list` 实现要点（我核过）：复用 `TripsService.list`，走 `tripVisibilityWhere`（creator / workspace 共享层级 / participant / custom grant / super_admin 五分支），**AI 无特权路径、无 prisma 直写**；加入 `AI_READ_ONLY_TOOLS`，规划阶段直接执行、永不进入 `plannedCalls`。
入参只有 `query`(1–80) 与 `limit`(1–20)，**不接受任何 workspaceId/userId**；出参只给 `tripId/title/startDate/endDate/destination`，不返回 summary/budget/version 等大字段。
`:4100` 临时实例已由它自己停掉（health=000），`:4000` health=200。

**注意**：case2 耗时 44.8s —— 这正是 SSE 流式要解决的问题（用户现在要盯着白屏 45 秒）。

### 🔴 生产迁移差距比预想大（我自己 SSH 查证）
生产库缺的表：`SystemSetting`、`PlatformRoleOverride`、`Report`、`TripDestination`、`TripAccessGrant`、`AiConversation`/`AiMessage`/`AiStream`（后三个是本地刚建的）。
`Trip` 缺列：`showExactPhotoLocation`、`originBbox`、`destinationsV2`；`Stop` 缺列：`address`、`bbox`。
→ 说明 **rc.4 是很旧的版本**，生产上后台设置页、审核、目的地、可见性 grants 全都不可用。
`_prisma_migrations` 只有 0001–0003，但真实 schema 已经含部分后续迁移的对象 → 直接 `migrate deploy` 会在「对象已存在」处失败。
已派 `PROD_MIGRATION_PLAN`（`919bb2bf`，**只读**）：逐迁移比对 0004–0015，给 schema-diff 补齐 + baseline 方案、备份回滚命令、并在本地演练验证。
本地库 `prisma migrate status` = **15 migrations / up to date**。

### AI_CONTRACT → ACCEPT（`14678ac`）
- `AiChatRequestSchema` 只加 3 个**可选**字段；`message` 仍是 string 不是 `messages[]`；`AiChatResponseSchema` **零改动**（strict，旧前端会拒绝新键）。
- SSE 六事件判别联合冻结：`meta` / `text.delta` / `plan` / `usage` / `error` / `done`；`plan` 复用既有 `AiToolCallSchema` / `AiPlanWarningSchema` 而不是复制一份。
- 会话 DTO 12 个 + 11 条 REST 端点 + 1 条 `/ai/chat/stream`。
- 错误码 `AI_ERROR_CODES` 追加 `AI_ABORTED` / `AI_INTERNAL` / `AI_CONVERSATION_BUSY`。
- 路径 **105 → 113**（12 个 operation，7 个会话路径 key 合并），operations 156，schemas 213。
- 生成：`contracts:generate` 113/213；`api-client:generate` 25 endpoint files / **792 schema files**；`contracts:check` 通过。

### 已派 `AI_PERSIST_API`（`14a17d24`）
按 §2.7 **冻结接口逐字实现** `AiConversationService`（getOrCreate / appendUserMessage / startStream / finishAssistantMessage / loadContext）+ REST CRUD。
关键要求：所有查询带 workspaceId 防跨租户；`(conversationId, clientId)` 唯一约束做幂等；软删；复合游标；`loadContext` 按 maxTurns/maxChars 截断；**`generateTitle` 必须真调模型，未配置时返回 503 而不是假装生成**；并发用 Redis 锁或 DB 条件（需说明选型）。
`ai.module.ts` 归它写；`ai.controller.ts` / `ai-plan.service.ts` 留给 `AI_STREAM_API`。

### 00:00 状态
已提交：`14678ac` 契约冻结（113 paths / 792 schema files 生成物）、`04aec59` 两份已批准的决策文档。
在跑 5 个：`VIS_GRANTS_WEB`（access-grants-field.tsx 已建）、`VIS_ROLE_COVERAGE`（在改 expense/media/packing 的 tenant guard）、`E2E_CATCHUP`（在改 admin-settings.spec.ts）、`PROD_MIGRATION_PLAN`、`AI_PERSIST_API`（刚派）。
工作区里 `apps/web/lib/api/access-grants.ts`、`components/trips/trip-form/access-grants-field.tsx` 是 `VIS_GRANTS_WEB` 的在途产物，未提交。

---

## 2026-11-20 13:20 恢复（会话中断 13 小时后）

### 环境恢复（整台机器的本地服务都停了）
- PostgreSQL：找到 `.data/bootstrap-e2e` 的 **embedded-postgres 17**；写了 `.data/bootstrap-e2e/start-pg.mjs` 把 `pgdata-mwktcppk` 挂到 **55444**（`pg_hba` 本地改为 trust，开发库）。
- `roamlog_local` 当时是空的，于是**重建**：`prisma migrate deploy` 应用全部 15 个迁移 + `db:seed`（3 用户 / 9 行程 / 16 日志 / 24 媒体）。验证 `ai-conversations.integration.test.ts` 4/4。
- API `:4000` 已起（health=200 / public-settings=200）。
- 发现的额外资产：`roamlog_mwktcppk` 库是 **30 张表的旧快照，表集合与生产完全一致** → 交给 `PROD_MIGRATION_PLAN` 当「生产影子库」用。
- **生产 SSH 现在双向都不通**：`kex_exchange_identification: Connection closed by remote host` / `Connection closed by UNKNOWN port 65535`。agent 与我都被拒。已要求迁移方案按「SSH 不可达」处理并单列「不可验证项」。

### 中断后补完并提交
| 提交 | 内容 |
|---|---|
| `ec0b812` | B1 UI：`custom` 可见性选人（工作区+成员多选、回显 resolved 标签、先 PATCH 行程再 PUT grants、失败可重试不伪装成功、空选阻止保存）+ 参与者角色下拉（owner/admin/创建者，失败回滚）→ 12 文件 / 114 测试 |
| `a02a26d` | 重写 `e2e/admin/smoke/admin-settings.spec.ts` 断言新 IA；**真跑 4/4 通过（22.9s）** |
| `5ba4012` | `AiConversationService`（1282 行）+ 11 端点 + 10 个真实 PostgreSQL 测试；DB 行锁做并发、`(conversationId,clientId)` 幂等、`generateTitle` 真调模型否则 503 |

### 中断后重新派出
- `AI_STREAM_API`（`68c1852c`）：`/ai/chat/stream` + `streamChat()`，事件顺序/心跳/abort/持久化。
- `AI_WEB_STREAM`（`890d4117`）：前端 SSE 逐字渲染 + 停止/重新生成。
- `AI_WEB_THREADS`（`89f21ccb`）：thread-list 换远端 + 历史消息还原 + 旧 localStorage 清理。
- `PROD_MIGRATION_PLAN`（`6f9da4f5`）：重派，改用 `roamlog_mwktcppk` 影子库。

### 教训
**本地服务不会跨会话存活。** 恢复顺序必须是：PG(55444) → migrate → seed → API(4000) → 其它。已把 `start-pg.mjs` / `start-api.sh` 固定在仓库里，下次直接跑。

### PROD_MIGRATION_PLAN → ACCEPT（`.audit/prod-migration-plan.md`，1038 行）
- **A 节**：12 个迁移逐条比对，**107 个对象：103 不存在 / 4 部分存在 / 0 已存在**（10 张新表 + 21 个既有表新增列 + 23 索引 + 46 约束 + 5 枚举 + 1 枚举值 + 1 注释）。
- **B 节**：若生产与影子库一致，`prisma migrate deploy` **可直接跑通**（本地两个副本都验证过，最终 40 表/468 列/135 索引/165 约束）。若生产存在影子库未覆盖的 0004+ 对象，最早失败点是 `0004_system_setting` 的 `CREATE TABLE "SystemSetting"`（42P07）。
- **C 节**：推荐**方案 1（schema diff 强化版）**，但关键警告：`prisma migrate diff` **不生成 CHECK 约束、部分索引、COMMENT 和 0010/0012 数据回填**，只跑 diff 会得到「diff 为空但约束缺失」的假成功，**必须再执行附录 E 的 supplement SQL**。
- **D 节**：备份/回滚命令可复制执行（`pg_dump -Fc` + 大小/SHA-256/`pg_restore --list` 三层校验；恢复到新库 → `ALTER DATABASE` 改名切换）。
- **E 节**：演练后审计版 diff **输出为空**（`-- This is an empty migration.`）。

**部署前必须先在生产跑附录 A 的 A1–A7 只读 SQL**，尤其 **A6：10 张 0004+ 表计数必须全为 0**，否则 A/B 结论要重算。

**另一个坑**：`schema.prisma` 未声明 `TripDestination_tripId_deletedAt_idx`，任何全量库的 `migrate diff` 都会报一条 `DROP INDEX` —— **不要执行这个 DROP**，验收要用报告 E 节的审计 normalized schema。

### 全仓 typecheck：**11/11 通过**（33s）
`@roamlog/{db,api-client,contracts,config,emails,ui,worker,api,api-mocks,web,admin}` 全部 successful。
说明目前所有已提交改动（含 15 迁移、113 paths、admin IA、grants UI、AI 持久化）在类型层面自洽。

### 复核 PORT_COMPLETENESS_AUDIT 的一条 P1：B2「城市搜索只写本地预览」
读 `apps/web/components/map/trip-map.tsx:205`，UI 上明确写着：
> 「搜索结果仅用于地图预览；保存停靠点仍由旅行编辑流程负责。」

**所以这不是假功能，是诚实的预览**。审计的措辞过重。真正缺的是「Stop 表单只能手填经纬度、没有地址搜索」，属于 UX 缺口而非欺骗。
→ 决定：**B2 的 Stop 地址搜索、B4 洞察聚合、分享页地图/GPS 这三项排到 rc.5 之后**，当前优先级是先把 AI 流式做完 + 全仓构建 + 发布。理由：它们都不阻塞现有功能正确性，而 AI 流式是用户点名的「壳子」问题。

### 🔴 跨分支集成缺陷（`AI_WEB_THREADS` 发现，已转给 `AI_WEB_STREAM` + `AI_STREAM_API`）
1. **`chat-model-adapter.ts` 调 `streamAiPlan` 没传 `conversationId`** → 后端 `AiPlanService.streamChat` 在 `body.conversationId` 缺失时 `getOrCreate` **新建会话**（`ai-plan.service.ts:251-255`）→ 流式消息写进新会话，而 sidebar thread-list 用的是 thread 的 `remoteId` → **侧栏历史与实际对话对不上，持久化等于白做**。
   修法：assistant-ui 的 `ChatModelRunOptions.unstable_threadId` = `aui.threadListItem.getState().remoteId`（`@assistant-ui/core/dist/react/runtimes/useLocalRuntime.js:85` 设置、`local-thread-runtime-core.js:964` 读取），透传为 `conversationId`。
2. **`AiConversationService.upsertMessage` 新建行硬编码 `role: "assistant"`**（`ai-conversation.service.ts:637-643`）。若前端 `ThreadHistoryAdapter.append()` 先对**用户消息**发 PUT，行会被建成 assistant；随后 `appendUserMessage` 命中唯一约束返回 `created:false`，**不会纠正 role** → 用户消息在库里变 assistant。

**这类缺陷是「各分支单测全绿、端到端却是错的」的典型**。教训：AI 流式这条链有 4 个文件 owner（契约/适配器/持久化/前端），必须在全部落地后做一次**端到端联调**（真实 SSE + 真实库 + 真实 sidebar），不能只看各自单测。

---

## ✅ AI 流式端到端打通（2026-11-20 14:30，我自己实测）

### 提交
`66e0a57 feat(api): stream chat replies over SSE instead of waiting for the whole answer`
（`ai-plan.service.ts` +765、`ai.controller.ts` +209、`stream.e2e-spec.ts` 708 行、`vitest.config.ts` 加 `src/**/*.e2e-spec.ts` 让 e2e 被发现）
`0c1671f feat(web): stream AI replies token by token and keep history on the server`

### 我的独立 SSE 探针（`.audit/ai-e2e/07-sse-probe.mjs`，真实网关 + 真实库）
```
status: 200
content-type: text/event-stream; charset=utf-8
headers 到达: 43ms
第一帧 (meta): 50ms
总耗时: 1.735s
帧数: 14（meta 1 + text.delta 11 + usage 1 + done 1）
done: {"finishReason":"stop","usage":{"inputTokens":2420,"outputTokens":29}}
```
**对比修复前：8~50 秒白屏一次性刷出。**

`AI_STREAM_API` 自己的真实请求：首字节 0.129s / 总 3.22s / 32 delta；另一条建行程请求 **489 个 delta + plan=1 + finishReason=tool-calls**。
真实 abort：断开后 `AiStream.status=aborted`、assistant `incomplete/cancelled`。

### 多轮指代（我实测，最关键）
同一 `conversationId` 第二轮问「我刚才问了你什么？」：
```
user      : 用一句话介绍你自己，不要调用任何工具。
assistant : 我是 Roamlog 旅行规划助手，可以帮你在工作区里搜索地点、创建行程、安排每日活动和打包清单。
user      : 我刚才问了你什么？只回答一句话。
assistant : 你刚才让我用一句话介绍自己并且不要调用任何工具。
```
**AI 记得上一轮**，且 `role` 全部正确（说明 `upsertMessage` 硬编码 assistant 的坑已修）。

### 测试
`src/modules/ai` **16 文件 / 144 通过 + 6 skipped**；`components/ai + lib/api` **10 文件 / 76 通过**；api/web `tsc` 均 0 错误。

### 环境备注
重建库后 seed 用户 `passwordHash = null` 无法登录。我注册了 `verify@roamlog.test`，`emailVerified=true`，加入 `roamlog-crew` 为 **admin**（owner 唯一约束只允许一个 owner，已由 demo 用户占用）。
AI 设置直接写 `SystemSetting`（`value` 是 JSONB，必须 `to_jsonb(...)`）：`ai.baseUrl=http://127.0.0.1:3425/v1`、`ai.model=auto/deepseek-v4.1-flash`。**改完必须重启 API**（settings 有进程内缓存）。
