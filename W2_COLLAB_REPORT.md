# W2-API-COLLAB Delivery Report

状态: DONE_WITH_CONCERNS
任务 ID: W2-API-COLLAB

## 变更文件

- `apps/api/src/modules/comments/**`
- `apps/api/src/modules/notifications/**`
- `apps/api/src/modules/realtime/**`
- `apps/api/src/modules/search/**`
- `apps/api/src/modules/share-links/**`
- `apps/api/test/collab-comments.e2e-spec.ts`
- `apps/api/test/collab-notifications.e2e-spec.ts`
- `apps/api/test/collab-realtime.e2e-spec.ts`
- `apps/api/test/collab-search.e2e-spec.ts`
- `apps/api/test/collab-share.e2e-spec.ts`

未修改 `app.module.ts`、`package.json`、`packages/**`、web/admin/worker、原型或设计文档。现有 `activities` 实现已满足只追加、Workspace/Trip 过滤和通用事件记录，因此未改动。

## 实现摘要

- Comments：list/create/patch/delete/resolve/unresolve；一层回复校验；同一 target 校验；Viewer 可评论；作者或 Owner/Admin 可编辑删除；正文 `SanitizeService` 清洗；评论、mentions、activity 和 notification intent 在同一事务内写入，事务后发布实时事件。
- Mentions：先归一化去重，再校验所有被提及用户都是当前 Workspace 活跃成员；Mention 通知自身去重，且不会给评论作者自己发通知。
- Notifications：当前用户列表、单条已读、全部已读、偏好列表和偏好更新；通知归属只按认证用户过滤；按类型尊重 inApp/email 偏好；邮件意图以 `EmailLog.status=queued` 入库，实时 `notification.created` 在提交后发布；提供 assignment notification helper。
- Realtime：Socket.IO namespace `/v1/ws`、cookie session 认证、`user:{id}` / `workspace:{id}` / `trip:{id}` rooms、presence join/leave/disconnect 清理、缓存失效事件发布器、可选 Redis adapter 接线；没有 Socket.IO 包时开发态降级为告警而不是崩溃。
- Search：Workspace 强制过滤 trips/entries/comments/people；private trip 对非 Owner/Admin 按现有可见性规则过滤；HTML 去标签后生成纯文本 snippet 和 highlight，不向客户端返回存储 HTML；people 不返回 email。
- Share links：32-byte 随机 token、数据库仅存 SHA-256 token hash、scrypt 密码 hash、过期/撤销/密码门禁、原子访问计数；创建时仅返回一次明文 token；公开读取只返回 public DTO，不返回 comment/email/token/hash/workspace/internal 字段；公开 HTML 再次清洗。
- Activity：评论和 share-link 事件在同一事务内写入；现有上传、分账、打包等模块已复用 `ActivitiesService`。

## 需 root 注册/依赖

### AppModule 注册

在 `apps/api/src/app.module.ts` 注册：

```ts
import { CommentsModule } from "./modules/comments/comments.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { RealtimeModule } from "./modules/realtime/realtime.module.js";
import { SearchModule } from "./modules/search/search.module.js";
import { ShareLinksModule } from "./modules/share-links/share-links.module.js";
```

建议导入顺序：

```ts
RealtimeModule,
NotificationsModule,
CommentsModule,
SearchModule,
ShareLinksModule,
```

### API 依赖

`apps/api/package.json` 需要加入：

- `socket.io`（设计基线 4.8.x）
- `@socket.io/redis-adapter`（设计基线 8.3.x）

`ioredis` 已存在。缺 Socket.IO 包时实时网关会告警并跳过启动，单测和 REST 不受影响，但生产实时不可用。

### 跨模块接线

- 行程项/打包项分配时应调用 `NotificationsService.notifyAssignment(tx, input)`，再在事务提交后调用 `publishCreated(result)`；本次不允许修改 itinerary 文件，未直接接线。
- 其他 mutation 模块应在事务提交后向 `RealtimePublisher` 发布对应 `*.changed` 事件；Publisher 已支持 contracts 中的事件族。

## 验证命令与结果

- `pnpm --filter @roamlog/api test -- collab`
  - 5 test files passed；19 tests passed。
  - 覆盖一层回复、回复回复拒绝、mention 去重、通知归属、Workspace 跨租户 404、share token hash、撤销/过期/密码、XSS、presence room 隔离、search 可见性和安全 snippet。
- `pnpm --filter @roamlog/api test`
  - 35 test files passed；186 tests passed。
- `pnpm exec eslint <本任务模块与 5 个 collab 测试>`
  - 通过，无错误。
- `pnpm --filter @roamlog/api typecheck`
  - 通过。
- `pnpm --filter @roamlog/api build`
  - 通过。

## 未覆盖/风险

- AppModule 尚未注册本任务模块，因此当前端到端路由需等 root 接线后验证。
- Socket.IO 和 Redis adapter 包尚未加入 `apps/api/package.json`，实时功能需 root 安装依赖后才真正启动。
- Search 当前使用 Prisma `contains` / list `has` 兜底，未新增 PostgreSQL `tsvector`/GIN migration；本任务不允许改 `packages/db/**`。中文 trigram/FTS 性能需后续数据库任务补齐。
- 公开 share 的 `showBudget` 使用静态近似汇率生成 summary；接上 Task 12 的 budget/money 服务后应替换。
- 邮件目前是 `EmailLog` queued intent，不是 BullMQ job；worker 任务需要消费该 intent。
- 未做真实数据库 + Socket.IO 双客户端 E2E；现有共享数据库/端口由其他任务占用，本次以服务级测试和全包测试为证据。
- Assignment notification helper 已实现但未接入 itinerary/packing mutation。

## 建议下一步

1. root 注册五个模块并加入 `socket.io`、`@socket.io/redis-adapter` 依赖。
2. 让 itinerary/packing 接线 assignment notifications，其他 mutation 模块发布实时失效事件。
3. 修复其他并行任务导致的 typecheck/build 错误，然后重跑 API typecheck/build。
4. 在真实 DB 上验证 comments → notification intent → realtime event、share 创建/密码读取/撤销，以及两个 Workspace 的跨租户探测。
