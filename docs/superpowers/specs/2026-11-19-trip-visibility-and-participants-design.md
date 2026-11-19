# 设计：行程可见性（custom）与同行人重设计

状态: **已批准并实施**（2026-11-19 用户拍板；实现见 `b658bb2` access-grants 端点、`84c975e`/`b4e21b8` 参与者 editor 权限、`94440cf` 之前的参与者状态展示）
作者: 根 Agent
前置: 用户已拍板三点——①同行人可被提升为 editor；②分享链接保留且与可见性独立；③工作区级授权对该工作区全体成员生效（并记审计）。

---

## 1. 现状（已核实，非推测）

| 项 | 事实 |
|---|---|
| `Trip.visibility` | Postgres 枚举 `workspace \| private \| public_link`，默认 `workspace` |
| 同行人 | `TripParticipant(id, workspaceId, tripId, userId, joinedAt)` —— **无状态、无角色**，`workspaceId` 必填（只能加工作区成员） |
| 可见性判断 | **三处各写一遍**：`trips/content-values.ts:256 assertTripVisible`（多数模块共用）、`media/media.service.ts:703 visibilityFilter`（**SQL 层独立实现**）、`ai/ai-tools.ts:84`（工具参数的 `z.enum(["private","workspace"])`） |
| 同行人 UI | 详情页只显示「创建者 · 1 位参与者」，无添加/移除/状态。接口存在但无入口 → **空壳** |

**结论**：这不是"加一个字段"，是**把三个漂移的判定收敛成一个**，再在其上扩展。

## 2. 数据模型（迁移 `0012_visibility_and_participants`）

```prisma
enum TripVisibility { workspace  private  public_link  custom }   // 增 custom

model TripAccessGrant {
  id          String   @id @default(uuid(7)) @db.Uuid
  tripId      String   @db.Uuid
  workspaceId String?  @db.Uuid        // 授权给整个工作区
  userId      String?  @db.Uuid        // 授权给具体某人
  grantedById String   @db.Uuid
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  @@unique([tripId, workspaceId])
  @@unique([tripId, userId])
  @@index([tripId])
}
```

```prisma
// 扩展现有模型，不改列名
model TripParticipant {
  ...既有字段...
  status      ParticipantStatus @default(invited)   // invited | joined | declined
  role        ParticipantRole   @default(viewer)    // viewer | editor
  invitedById String?           @db.Uuid
  respondedAt DateTime?         @db.Timestamptz(3)
}
```

约束（CHECK）：
- `TripAccessGrant`：`workspaceId` 与 `userId` **恰好一个非空**
- `status` / `role` 值域

**迁移的数据动作**
- 枚举加值：PG 17 允许 `ALTER TYPE ... ADD VALUE`（新值不在同事务内使用即可）；若 Prisma 事务包裹出问题，改为「新枚举 + 列转换」两步。**这一步要单独验证，不能想当然。**
- 既有 `TripParticipant` 行：回填 `status = joined`、`role = viewer`（它们本来就是被加进来的人）
- 既有 trip：`visibility` 值不变；`custom` 仅由用户显式选择

## 3. 判定：一个函数，三处复用

新增 `apps/api/src/modules/trips/trip-access.ts`：

```ts
export type TripAccessDecision = { allowed: true } | { allowed: false; reason: "not_found" | "hidden" };
export async function resolveTripAccess(
  actor: WorkspaceMembershipAccess,   // 含 platformRole / userId / workspaceId / role
  trip: TripAccessRecord,             // 含 createdById / visibility / workspaceId
  grants: ReadonlyArray<{ workspaceId: string | null; userId: string | null }>,
  participation: { status: string } | null,
): Promise<boolean>
```

判定顺序（**顺序即语义，写进测试**）：
1. `actor.platformRole === "super_admin"` → 允许（审计记 `platform_override`）
2. `trip.createdById === actor.userId` → 允许
3. `trip.workspaceId === actor.workspaceId && trip.visibility === "workspace"` → 允许
4. `participation?.status` ∈ (`invited`, `joined`) → 允许（**被加为同行人即有访问权**，与可见性档位无关）
5. `visibility === "custom"`：
   - 存在 `userId === actor.userId` 的授权 → 允许
   - 存在 `workspaceId` 的授权，且 **actor 是该工作区成员** → 允许
6. 其余 → 拒绝

**三处统一**
| 位置 | 改法 |
|---|---|
| `content-values.ts::assertTripVisible` | 改为调用 `resolveTripAccess`（需要 grants + participation，**由调用方注入加载器**，避免 N+1） |
| `media.service.ts::visibilityFilter` | 不能直接用函数（列表是 SQL）。改为生成**同一个语义**的 Prisma `where`：`OR[ createdBy, {workspaceId,visibility:workspace}, {participants:{some:{userId}}}, {accessGrants:{some:{userId}}}, {accessGrants:{some:{workspaceId:{in: myWorkspaceIds}}}} ]`。**并加一致性测试**：同一批数据下 SQL 过滤结果 == 逐条 `resolveTripAccess` 结果 |
| `ai-tools.ts` 的 `visibility` 枚举 | 加 `custom`；但 AI **禁止**自行设置 `custom`（工具只允许 `private\|workspace`），因为 AI 不该决定谁能看 |

**为什么强调一致性测试**：这两个实现（函数 vs SQL）必然漂移，而漂移的后果是"列表里消失但直接访问能进"或反向泄漏。测试必须**对拍**。

## 4. 契约

```ts
TripVisibilitySchema   // 增 "custom"
TripAccessGrantSchema = { id, targetType: "workspace"|"user", targetId, label, sublabel?, createdAt }
TripAccessGrantsResponse = { grants: TripAccessGrant[], resolved: { workspaces: [...], users: [...] } }
SetTripAccessGrantsRequest = { workspaces: UuidV7[], users: UuidV7[] }   // 整组替换
ParticipantSchema      // 增 status, role, invitedAt, respondedAt, user 基本信息
CreateParticipantRequest = { userId? , email? , role? }
UpdateParticipantRequest = { role?, status? }
```

`resolved` 里带 `label`（工作区名 / 用户显示名 + 邮箱域）**由服务端解析**，避免前端逐条查询。

## 5. API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/v1/trips/{id}/access-grants` | 可查看者 | 返回解析后的 chip 数据 |
| PUT | `/v1/trips/{id}/access-grants` | creator 或 editor+ | 整组替换；写审计 `trip.access_grant.updated` |
| GET | `/v1/trips/{id}/participants` | 可查看者 | 含 status/role |
| POST | `/v1/trips/{id}/participants` | creator 或 editor+ | `userId` 或 `email`（外部邀请） |
| PATCH | `/v1/trips/{id}/participants/{pid}` | creator 或 admin+ | 改 role / status（**不能把自己提升为 editor** 之外越权） |
| DELETE | `/v1/trips/{id}/participants/{pid}` | creator 或 admin+ | 移除即撤销该 trip 访问权（评论/日志保留） |

**授权上限**：任何人不能通过"加同行人/加授权"绕过自己在工作区里的角色上限。Editor 不能授予别人 Editor 之上；Viewer 不能授予任何东西。

**审计**：`trip.participant.added / role_changed / removed / responded`、`trip.access_grant.updated`（metadata 只含 id 与角色，不含邮箱明文）。

## 6. UI

### 6.1 可见性选择器（行程编辑页）
- 四档：`工作区可见 / 仅自己 / 指定可见 / 公开链接`
- 选 `指定可见` 时展开两个**搜索式多选**（复用现有 `SearchableCombobox` + `ChipsInput`）：
  - **可见工作区**：范围 = 我加入的所有工作区；显示「工作区名 · N 人」
  - **可见成员**：范围 = 我在所有共同工作区的成员去重；显示「名字 · 邮箱域 · 来自哪个工作区」
- 已选显示为 **chip**（可单个删除），列表内部滚动 + `max-h`，**不撑破页面**
- 空状态：`还没有指定任何人`；搜索无结果：`没有匹配的人`（**不提供手动输入兜底**——按你的规矩）
- 保存前显示摘要：`这趟旅行将对这些对象可见：2 个工作区（共 14 人）、3 位指定成员`

### 6.2 同行人面板
- 列表：头像 + 名字 + 状态徽标（`待确认` 灰 / `已加入` 绿 / `已拒绝` 描边）+ 角色下拉（`可查看` / `可编辑`）+ 移除
- 添加：搜索框（工作区成员）+ 「邀请邮箱」次级入口
- 顶栏头像堆叠：**只显示 `joined`**
- 详情「同行人」区：显示 `已加入 N · 待确认 M`，点开进面板
- 权限：Viewer 可见但只读；非 creator 的 editor 可加人但不能改自己的角色

## 7. 迁移与兼容

- 老 trip 全部保持现档位，**不回填**（按你的要求）
- 老 `TripParticipant` 行回填 `joined`/`viewer`
- `public_link` 与分享链接：**完全不动**，仍是"匿名可看"的唯一途径
- 回滚：迁移纯 additive（除枚举加值），可安全保留

## 8. 风险

| 风险 | 处置 |
|---|---|
| **函数判定 vs SQL 过滤漂移** | 必须"对拍"测试：同一数据集两种实现结果一致 |
| 枚举 `ADD VALUE` 在事务内 | 单独验证；不行就两步迁移 |
| 列表查询 N+1（每条 trip 查 grants） | SQL 过滤一次完成；单条读取才走函数 |
| 权限提升绕过 | 加"不能授予高于自己的角色"校验 + 测试 |
| AI 工具 | 只允许 `private/workspace`，禁止 `custom` |
| 分享链接误泄漏 custom 内容 | 分享 payload 仍只由 token 决定，**不读 grants** |

## 9. 分阶段

1. **P1**：迁移 + 契约 + `resolveTripAccess` + 三处统一与对拍测试（**不含 UI**）
2. **P2**：API（grants + participants 状态/角色）+ 审计
3. **P3**：UI（可见性选择器 + 同行人面板）
4. **P4**：分享页/顶栏/回归（含移动端）

每阶段独立验收，P1 必须先把"三处统一"做完，否则 P2/P3 建立在漂移之上。