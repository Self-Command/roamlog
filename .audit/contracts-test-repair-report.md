# CONTRACTS_TEST_REPAIR — 交付报告

状态: DONE
任务 ID: CONTRACTS_TEST_REPAIR
角色: backend_api / 契约 owner
完成时间: 2026-11-18 22:38 (Asia/Shanghai)

## 变更文件

1. `packages/contracts/src/__tests__/openapi.test.ts`
2. `packages/contracts/src/__tests__/admin.test.ts`
3. `.audit/contracts-test-repair-report.checkpoint.md`（checkpoint）
4. `.audit/contracts-test-repair-report.md`（本报告）

未修改：`packages/contracts/src/api/**`、`packages/contracts/scripts/**`、`packages/contracts/openapi.json`、`packages/api-client/**`、`apps/**`、lockfile、其它 `.audit`。未执行 `git reset/clean/checkout/stash`，未提交，未运行 `contracts:generate` / `api-client:generate`。

## 实现摘要

### 失败 1 — openapi.test.ts（92 → 实际 94）

**选择的策略**：任务书给出的「二选一」中采用**第一种**——精确断言关键路径集合 + 总条数下界，不保留精确 94。

- 用 39 条「域锚点」路径做 `expect(paths).toContain(required)` 精确断言，覆盖 auth / me / workspace / members / invitations / audit / trips / participants / stops / itinerary / entries / comments / media / places / cover / expenses / budget / packing / share-links / public trip / exports / search / admin（metrics、users/export、workspaces/export、audit/export、flags、flags/{key}、jobs、system）/ health / ready / ws。任务书点名的 7 条全部包含；新增的 `/v1/media/{mediaId}`、`/v1/places/search` 也在内。
- 总条数改为 `expect(paths.length).toBeGreaterThanOrEqual(94)`。
- 保留原有 method 断言，并补充 `/v1/admin/users/export`、`/v1/admin/workspaces/export`、`/v1/admin/flags`、`/v1/admin/flags/{key}`（patch）、`/v1/trips/{tripId}/cover`（post）的 verb 断言。

**为什么不选精确 94**：

- 本次失败的根因就是「每加一个端点就红」。再写死 94 只是把同一个问题推迟到下一个端点。
- 误删端点的防护并没有丢失：`packages/contracts/scripts/check-openapi.ts` 会把内存生成的完整文档与已提交的 `openapi.json` 做逐字段、逐数组长度的深度 diff；`pnpm contracts:check` 已纳入本任务验收且当前 fresh。任何路径被删/增而未重新生成都会在那里失败。
- 单测层保留 39 条精确断言，足以在「域入口被误删」时给出比 `expected length 93` 更可读的失败信息。
- 若未来确实需要「任何路径变化都必须评审」，正确做法是让生成物 diff 进入 review（`contracts:check` 已经做到），而不是在单测复制总数。

### 失败 2 — admin.test.ts 的 AdminSystemSchema 样本

按 `packages/contracts/src/api/admin.ts:462-532` 的真实形状重写，未使用 `as any`、未放宽 schema、未 `.partial()`。新增 3 个用例：

1. **healthy**：`worker` 8 字段齐全，`status: "up"`、`signal: "consumer-clients"`、`blockedConsumers: 2`、`lastJobAt/Status/Queue` 有值；`buildTime` 有值；并断言解析后的 `buildTime`、`migration`、`worker.*`、`checks.storage.latencyMs`、`queues[0].paused` 具体值。
2. **unavailable**：`status: "degraded"`、`signal: "unavailable"`、`lastJobAt/Status/Queue` 均为 `null`、`buildTime: null`、`migration: { version: null, appliedAt: null }`、`queues: []`；逐个断言 null / 空值，验证「不伪造 build time / 不伪造 worker 健康」。
3. **status 与 signal 分离**：用合法完整快照把 `worker.signal` 设为 `"up"`，断言 `safeParse(...).success === false`。

**与任务书的一处事实纠正（重要）**：任务书写「`worker.signal = "up"`」。真实枚举 `AdminWorkerSignalSchema`（`admin.ts:455-459`）只有 `"consumer-clients" | "activity-derived" | "unavailable"`；`"up" | "degraded" | "down"` 属于 `worker.status`（`admin.ts:464`）。`apps/api/src/modules/admin/admin-queue.service.ts:392-439` 也证明：`blocked > 0` 时返回 `status: "up", signal: "consumer-clients"`；`CLIENT LIST` 失败时返回 `status: "degraded", signal: "unavailable"`。因此 legal shape 用 `status: "up"` + `signal: "consumer-clients"`，未把非法枚举写进样本；并新增第 3 个用例锁死二者不可混用，避免未来有人把 status 值塞进 signal。

## 验证命令与结果

1. `pnpm --filter @roamlog/contracts test`
   ```
   Test Files  7 passed (7)
        Tests  54 passed (54)
   ```
   （修复前为 `2 failed | 50 passed (52)`；新增 2 个 admin 用例后共 54。）

2. `pnpm --filter @roamlog/contracts lint` → exit 0（`$ eslint .`，无告警输出）

3. `pnpm --filter @roamlog/contracts typecheck` → exit 0（`$ tsc --noEmit`）

4. `pnpm contracts:check` → exit 0
   ```
   OpenAPI contract is fresh: 94 paths, 203 schemas.
   Generated API client is fresh: 23 endpoint files, 614 schema files.
   ```
   说明：该脚本的 `api-client:check` 会在 `packages/api-client/.orval-check-*` 临时目录内重新生成并逐文件对比，finally 中删除；属于只读校验路径，**未**执行 `api-client:generate`，未改动已提交生成物（`packages/api-client/src/generated/**` 与 `packages/contracts/openapi.json` 的 mtime 均为 22:31，早于本会话 22:34 开始时间）。

边界复核：`git status --porcelain` 确认本会话只新增/修改了上述 2 个测试文件与 2 个 `.audit` 报告；工作区其它 170+ 个改动在本会话开始前已存在（含 `openapi.json`、api-client 生成物、`entities.test.ts`），非本任务产生。

## CodeGraph 证据

1. `codegraph status`（在 `roamlog/` 执行）：
   `[OK] Index is up to date`，Files 1,459 / Nodes 22,423 / Edges 49,126。
2. MCP `codegraph_explore`，query `"openapi.test.ts admin.test.ts AdminSystemSchema AdminSystem OpenAPI document builder"`，projectPath `C:\Users\BY9700\Desktop\UI\roamlog`：
   - 命中 `packages/contracts/src/api/admin.ts:462-474`（`AdminSystemWorkerSchema`，8 字段）、`admin.ts:476-482`（migration nullable）、`admin.ts:484-532`（`AdminSystemSchema`，`buildTime` nullable、`queues` 数组）；
   - 命中 `packages/contracts/scripts/generate-openapi.ts:22-98`（12 个 `register*Paths`，文档装配点）与 `packages/contracts/src/__tests__/openapi.test.ts`、`admin.test.ts`；
   - blast radius：`AdminSystemSchema` 被 `apps/api/src/modules/admin/admin-system.service.ts` 3 处调用，测试引用方为 `admin.test.ts`。
3. 二次 explore，query `"AdminQueueService workerHealth AdminSystemService.get AdminSystemSnapshot admin-system.service.ts"`：
   - `apps/api/src/modules/admin/admin-queue.service.ts:392-439` `workerHealth` 的真实 signal 语义（`consumer-clients` / `activity-derived` / `unavailable`）；
   - `apps/api/src/modules/admin/admin-system.service.ts:61-112` `get()` 的 fallback（`status: "degraded", signal: "unavailable"`）与 `buildTime: timestamp(process.env.ROAMLOG_BUILD_TIME)`（缺省 null）。
4. 生成物核对（CodeGraph 不覆盖生成文件内容，按 AGENTS.md 用 shell 读取）：`packages/contracts/openapi.json` 的 `Object.keys(paths).length === 94`，逐条确认 39 条关键路径及 method 全部存在；总 operation 数 129（原断言 `>= 120` 仍成立）。

## 已知风险

- 下界的局限：若同时新增一个端点并删除一个**非**关键路径，总数仍 ≥ 94 时单测不会报警。该场景依赖 `contracts:check` 的深度 diff（快照级保护），而不是本单测。
- 关键路径清单需要人工维护：新域（如未来新增 billing）若未加入清单，删除该域入口不会被单测捕获，但仍会被 `contracts:check` 捕获。
- `AdminSystemSchema` 的 worker 字段与 admin Web 的 `AdminSystemSnapshotDetail`（`apps/admin/lib/admin-data-source.ts:947-959`）仍有 optional 兼容层；本任务不改 apps，仅按契约测试验证 API 形状。
- 任务书关于 `signal = "up"` 的描述与实现不符，已按真实 schema 纠正；如果产品方坚持 `signal` 接受 `"up"`，那属于 schema 变更，需另开契约任务（本次禁止改 schema）。

## 未覆盖项

- 未验证 API 运行时 `workerHealth()` 在 Redis 各种失败模式下的真实输出（单元测试仅覆盖契约形状；API 侧已有 `admin-queue.service.spec.ts`）。
- 未改 `packages/contracts/openapi.json` 与 api-client 生成物；它们当前已 fresh，无需重新生成。若根 Agent 的串行生成流程会重写，需再跑一次 `pnpm contracts:check`。
- 未运行 `apps/**` 的测试/构建（不在本任务边界）。

## 建议的下一步

1. 根 Agent 直接采纳本交付，将 `pnpm --filter @roamlog/contracts test/lint/typecheck` 与 `pnpm contracts:check` 保留在 CI quality gate；当前四项全绿，可继续打镜像。
2. 若希望「任何路径增删都必须评审」，无需改本测试，只要确保 CI 中 `contracts:check` 是必需步骤（它做全量文档 diff）。
3. 后续若新增业务域，请把该域的 1-2 条入口路径补进 `openapi.test.ts` 的 required 清单，维持误删保护的可读性。