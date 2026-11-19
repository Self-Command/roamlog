# SETTINGS_SAVE_PROBE — 敏感设置保存前先探测，失败不落库

状态: DONE
任务 ID: SETTINGS_SAVE_PROBE
角色: backend_api
日期: 2026-11-19（Asia/Shanghai）
范围: 只改 `apps/api/src/modules/settings/**` 与本报告；未改 `modules/storage/**`、`modules/email/**`、`modules/settings/{mail,limits}-settings.consumer.ts`、`apps/web/**`、`apps/admin/**`、`packages/**`、`settings.registry.ts`、`settings.service.ts`。

---

## 1. 变更文件

新建：

- `apps/api/src/modules/settings/settings-save-probe.service.ts`（探测判定/合并配置/调用既有 probe 实现）
- `apps/api/src/modules/settings/__tests__/settings-save-probe.service.spec.ts`（17 个用例）

修改：

- `apps/api/src/modules/settings/admin-settings.controller.ts`（PATCH 接入探测闸门、422 契约、逃生阀）
- `apps/api/src/modules/settings/settings.module.ts`（**必要的 1 个 provider 注册**，见 §7 风险 8；未改既有 providers/exports）
- `apps/api/src/modules/settings/__tests__/admin-settings.controller.spec.ts`（新增 9 个 save-probe 网关用例，原 12 个保持通过）

新增报告：`.audit/settings-save-probe-report.md`（本文件）

**未修改** `settings.service.ts`：确认无需改动。原因见 §2.6。

---

## 2. 实现摘要（逐 5 项）

### 2.1 探测服务的判定规则（`SettingsSaveProbeService.probeForUpdate`）

`probeForUpdate(updates): Promise<ProbeOutcome>`，`ProbeOutcome = {required:false} | {required:true; ok:true; targets[]} | {required:true; ok:false; target; code; message; checks[]}`。

- `storage.*` 连通性键（`endpoint / publicEndpoint / bucket / region / accessKey / secretKey / forcePathStyle`）任一出现 → `target: "storage"`。
- `mail.*` 连通性键（`provider / from / resendApiKey / smtpHost / smtpPort / smtpUser / smtpPassword`）任一出现 → `target: "mail"`。
- 只改无关键（`site.title`、`media.maxEdge` 等）→ `{required:false}`，**不触发任何网络调用**。
- 一次 PATCH 同时含 storage 与 mail 键 → 依次探测（storage 先）；任一步失败立即返回该步失败，**不写库**。
- 更新体在校验层先判：未知键/重复键/envLocked（env 有值）/schema 不合法 → `{required:false}`，把权威的 `422 SETTINGS_INVALID` 留给 `SettingsService.update`，避免用坏值打网络、也避免 422 语义被探测失败抢占。
- 探测自身抛异常（含合并配置读取失败、内部实现抛错）→ `{required:true, ok:false, code:"PROBE_UNAVAILABLE"}`，**fail-closed**。

### 2.2 “合并后的配置”：DB 当前值 + 本次 updates + env 回退

- **storage**：复用既有 `StorageSettingsConsumer.resolve()`（`invalidate()` 后读取，绕过 5s 缓存）得到当前生效配置（DB / env / default，含 secret 解密），在**内存中**覆盖本次 updates 的 7 个键后作为探测输入。绝不先落库。
- **mail**：按 `MailSettingsConsumer` 的同一优先级在探测服务内重建合并值（env 回退、DB 行存在性、默认值、secret 解密），再覆盖本次 updates。`MailSettingsConsumer.ts` 属于其它 Agent 的可写范围，**未改动**；合并逻辑因此在本服务内镜像实现，风险见 §5。
- secret 语义：本次未提供新 secret 时，使用 `SettingsService.getGroup("mail"|"storage")` 解密出的库值；库值不存在时使用 env 回退；两层都没有 → `MISSING_CREDENTIALS`（不发起网络调用）。见 §5 风险 3 的边界说明。

### 2.3 接进保存流程

`PATCH /v1/admin/settings`（`admin-settings.controller.ts`）：

1. 先 `probeForUpdate`；
2. `required && !ok` → **422**，body 用 `@Res({ passthrough: true })` 直接写出：
   ```json
   {"type":"https://roamlog.app/errors/settings-probe-failed","title":"Configuration rejected",
    "status":422,"code":"SETTINGS_PROBE_FAILED","detail":"...",
    "probe":{"target":"storage|mail","code":"...","checks":[...]}}
   ```
   之所以不走全局 `ProblemDetailsFilter`：该 filter 只保留 `type/title/status/code/detail/instance/errors`，会丢掉 `probe` 字段（与 `StorageAdminController` 现有做法一致）。
3. `ok`（或 `required:false`）→ 原样调用 `SettingsService.update(actor, body)`，**事务 + 审计 `admin.settings.updated` + 缓存失效 + 版本号递增语义完全不变**。
4. 失败路径不写 `SystemSetting`、不写 `AuditLog`、不 bump 版本；只写一条 warn 日志（`settings.save_probe_unavailable`，仅错误类名，不含配置/密钥）。
5. 探测异常在 controller 还有最后一道 `try/catch` 兜底：仍返回 422 `PROBE_UNAVAILABLE`，**不会放行**。

### 2.4 逃生阀

选择 **请求头 `x-skip-settings-probe: true`**（不选 body 字段的原因：`UpdateAdminSettingsRequestSchema` 是 `.strict()`，`skipProbe` 会让整个请求变成 400，等于破坏既有契约）。

- 仅 `super_admin`：`AdminGuard` 已把 `admin:settings:write` 限制为 super_admin；controller 内再做一次 `actor.user.platformRole !== "super_admin"` 防御性检查（403 `SETTINGS_PROBE_SKIP_FORBIDDEN`）。
- 审计 `admin.settings.probe_skipped`，`metadata: { keys }`（只含键名，不含值）。
- 审计写失败 → `503 SETTINGS_AUDIT_UNAVAILABLE`，**拒绝绕过**（无审计的逃生阀不成立）。

### 2.5 探测复用现有实现（不改 storage/mail）

- storage：`new StorageProbeService(readPort, logger)`，`readPort.resolve()` 返回合并配置的 `ResolvedStorageConfig`（含 `storageConfigVersion`），`readPort.invalidate()` 为 no-op；因此 `StorageProbeService.run()` 内部仍是既有的 HeadBucket → PutObject → GetObject 字节比对 → presigned GET 可达 → DeleteObject 全流程，**未改 `modules/storage/**` 一行**。
- mail：`new MailService({ resolve: async () => mergedRuntime }, logger)`，再 `send()`；即走既有 nodemailer/Resend、错误分类与固定文案，**未改 `modules/email/**` 一行**。探测收件人取 `mail.from` 中的地址（不可解析时 `probe@localhost`）；SMTP 发送用 `withTimeout(…, 10s)` 兜底（nodemailer 自身连接超时最长 2 分钟，不能拖住保存请求）。

### 2.6 明确不做的 / 为什么没改 `settings.service.ts`

- 未在 `SettingsService.update` 内加钩子：本任务要求失败 422 必须携带 `probe` 明细，而该服务抛出的 `HttpException` 会被全局 filter 过滤掉 `probe`；同时 controller 已先探测，若 service 再探测会对每个保存请求打两次网络。
- 未改 registry（不新增 envLocked）、未改迁移、未改 OpenAPI/contracts（本 422 与 `POST /settings/storage/test` 一样是绕过 filter 的端点级契约）。

---

## 3. 验证命令与结果（原始输出）

### 3.1 `pnpm --filter @roamlog/api typecheck`

```text
$ pnpm --filter @roamlog/api typecheck
$ tsc --noEmit
[exit code: 0]
```

（无输出 = 0 错误。）

### 3.2 `pnpm --filter @roamlog/api exec vitest run src/modules/settings`

```text
 RUN  v5.1.0 C:/Users/BY9700/Desktop/UI/roamlog/apps/api

 ✓ src/modules/settings/__tests__/admin-settings.controller.spec.ts (21 tests)
 ✓ src/modules/settings/__tests__/settings.service.spec.ts (24 tests)
 ✓ src/modules/settings/__tests__/settings-save-probe.service.spec.ts (17 tests)
 ✓ src/modules/settings/__tests__/limits-settings.consumer.spec.ts (11 tests)
 ✓ src/modules/settings/__tests__/settings.registry.spec.ts (10 tests)
 ✓ src/modules/settings/__tests__/mail-settings.consumer.spec.ts (13 tests)
 ✓ src/modules/settings/__tests__/secret-box.spec.ts (7 tests)

 Test Files  7 passed (7)
      Tests  103 passed (103)
   Duration  5.34s
```

覆盖重点：

- 只改无关键 → `probeForUpdate` 返回 `required:false`，`executeStorageProbe/executeMailProbe` **零调用**（服务级 + HTTP 级各一条）。
- `storage.endpoint` 改动 → 探测收到**合并后**的 endpoint，且未在请求里出现的 secret 使用库中解密值；outcome 的 JSON 不含该 secret。
- 探测失败 → 422，`probe.target/code/checks` 正确；**`systemSetting.upsert` 未调用、`audit.record` 未调用**（关键断言）。
- `mail.smtpHost` 改动 → 探测；失败 422 `CONNECTION_FAILED`。
- 无关键 + 两层都没有 storage 凭证 → HTTP 422 `probe.code=MISSING_CREDENTIALS`，且 `executeStorageProbe` 未被调用（无凭证不打网络）。
- secret 未提供但库里有 → 探测参数里的 `password` 等于解密后的库值；响应 JSON 不含明文。
- secret 两层都没有 → 422 `MISSING_CREDENTIALS`，且未发起发送。
- 探测实现抛异常 → 422 `PROBE_UNAVAILABLE`，异常原文不回显，且不落库/不审计。
- 逃生阀：super_admin → 200 + 审计 `admin.settings.probe_skipped`（keys 列表）+ 探测未被调用；platform admin → 403，探测/写/审计均未发生。
- 回归：成功 PATCH 仍返回 200/version 递增、`systemSetting.upsert` 调用 1 次、审计 `admin.settings.updated` 元数据不变。
- “库里有 secret、请求只改 host” 用例同时覆盖 storage（`secretKey`）与 mail（`smtpPassword`）。

### 3.3 `pnpm --filter @roamlog/api test`（全量）

**第一次全量（15:34，并行 trips 改动尚未落地）——全绿：**

```text
 Test Files  113 passed | 7 skipped (120)
      Tests  883 passed | 16 skipped (899)
   Duration  147.03s
```

（其中 `settings-save-probe.service.spec.ts` 17 tests、`admin-settings.controller.spec.ts` 20 tests 全绿；该次运行后 controller spec 又补了 1 个 `MISSING_CREDENTIALS` HTTP 用例，见 3.2 的最终 103/103。）

**最终全量（15:45，被并行改动污染）——仅 1 个无关套件失败：**

```text
 FAIL  test/trip-origin.e2e-spec.ts > trip origin normalization > creates a trip with a normalized origin when the optional field is omitted
       AssertionError: expected 500 to be 201
 FAIL  test/trip-origin.e2e-spec.ts > trip origin normalization > trims a supplied origin before storing it
       AssertionError: expected 500 to be 201

 Test Files  1 failed | 113 passed | 7 skipped (121)
      Tests  2 failed | 893 passed | 16 skipped (911)
   Duration  144.98s
```

污染归属证据：

```text
$ git status --short apps/api/src/modules/trips
 M apps/api/src/modules/trips/__tests__/trips-origin-address.spec.ts
 M apps/api/src/modules/trips/__tests__/trips-origin-location.spec.ts
 M apps/api/src/modules/trips/content-presenters.ts
 M apps/api/src/modules/trips/content-records.ts
 M apps/api/src/modules/trips/trips.repository.ts
 M apps/api/src/modules/trips/trips.service.ts
?? apps/api/src/modules/trips/__tests__/trips-destinations.spec.ts
```

- 这些 `modules/trips/**` 改动**不在我的提交里**（本任务未触碰 trips），且第一次全量（我的代码已包含）时该套件是绿的；
- 单独重跑 `vitest run test/trip-origin.e2e-spec.ts` 仍稳定 2 failed（500），与 settings 无关；
- 失败输出按任务要求过滤：`... 2>&1 | grep -cE "modules/settings"` → **0**；
- 同一最终全量中 7 个 settings 套件全部通过；随后单独重跑 `src/modules/settings` 为 **103/103 green**（见 3.2）。

7 个 skipped 为需要 `ROAMLOG_TEST_DATABASE_URL` 的集成套件（与本次改动无关，原本即 skip）。

### 3.4 真实联调（PG 55444 + SMTP sink 1025 + 独立 API 4260）

环境：`DATABASE_URL=postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public`；Redis 用仓库自带 `e2e/live-support/redis-stub.ts` 起在 `46398`；API 用 `tsx src/main.ts` 起在 **4260**（未使用 4000）；登录账号为**临时**本地 super_admin（仅存在于本地 DB，验证后已删除，密码不写入本报告）。`SMTP_HOST=127.0.0.1`、`SMTP_PORT=1025`、`S3_ENDPOINT=http://127.0.0.1:19999`（不可达，用于真实 storage 失败路径）。

#### 步骤 1：PATCH `mail.smtpPort=1` → 422，旧值保留（关键证据）

PATCH 前 GET（旧值 1025，行 `updatedAt=2026-11-19T07:10:45.454Z`）：

```json
{"key":"mail.smtpPort","value":1025,"updatedAt":"2026-11-19T07:10:45.454Z","updatedById":"01a1f246-d4a5-775b-b48f-97faa107b53e"}
HTTP:200
```

PATCH：

```text
PATCH /v1/admin/settings {"updates":[{"key":"mail.smtpPort","value":1}]}
HTTP:422
{"type":"https://roamlog.app/errors/settings-probe-failed","title":"Configuration rejected","status":422,
 "code":"SETTINGS_PROBE_FAILED",
 "detail":"Could not reach the mail relay. Check the SMTP host and port.",
 "probe":{"target":"mail","code":"CONNECTION_FAILED","checks":[]}}
```

失败后立即 GET（**仍是旧值、`updatedAt` 未变**）：

```json
{"key":"mail.smtpPort","value":1025,"updatedAt":"2026-11-19T07:10:45.454Z","updatedById":"01a1f246-d4a5-775b-b48f-97faa107b53e"}
HTTP:200
```

DB 直查同样未变（`value=1025`、`updatedAt=2026-11-19T07:10:45.454Z`）。该临时账号的 `AuditLog` 行数在失败后为 **0**：

```json
[]
count: 0
```

API 日志中的失败探测（有连接尝试、无写库）：

```json
{"level":"warn","time":"2026-11-19T07:39:01.915Z","event":"mail.rejected","provider":"smtp","code":"ESOCKET","retryable":true,"msg":"mail.rejected"}
```

#### 步骤 2：PATCH `mail.smtpPort=1025` → 200；GET 确认已变

```text
PATCH /v1/admin/settings {"updates":[{"key":"mail.smtpPort","value":1025}]}
HTTP:200
{"updated":[{"key":"mail.smtpPort","secret":false,"updatedAt":"2026-11-19T07:39:20.974Z"}],"version":1,"generatedAt":"2026-11-19T07:39:20.986Z"}
```

GET：

```json
{"key":"mail.smtpPort","value":1025,"updatedAt":"2026-11-19T07:39:20.974Z","updatedById":"<temp-admin-id>"}
HTTP:200
```

探测确实通过真实 SMTP 投递（sink 落盘）：

```text
X-Roamlog-Idempotency-Key:
From: Roamlog <verify@roamlog.test>
To: verify@roamlog.test
Subject: Roamlog settings save probe

This message proves the mail configuration saved by Roamlog can deliver.
```

API 日志：

```json
{"level":"info","time":"2026-11-19T07:39:20.966Z","event":"mail.sent","provider":"smtp","latencyMs":13,"toDomain":"roamlog.test","providerId":"<...>@roamlog.test","msg":"mail.sent"}
```

成功后的审计（该账号）：

```json
[
 {"action":"admin.settings.updated","metadata":{"keys":["mail.smtpPort"],"secrets":[false]},"createdAt":"2026-11-19T07:39:20.981Z"},
 {"action":"admin.settings.updated","metadata":{"keys":["site.title"],"secrets":[false]},"createdAt":"2026-11-19T07:40:38.905Z"}
]
```

#### 步骤 3：PATCH `site.title`（无关键）→ 200，日志无 probe 调用

```text
PATCH /v1/admin/settings {"updates":[{"key":"site.title","value":"Roamlog 验收"}]}
HTTP:200
{"updated":[{"key":"site.title","secret":false,"updatedAt":"2026-11-19T07:40:38.901Z"}],"version":2,...}
```

为不改变既有站点标题，写入值与 PATCH 前 GET 相同（`Roamlog 验收`），仅 `updatedAt/updatedById` 变化。

探测相关日志行计数（`mail.sent|storage.probe_*|settings.save_probe`）：

```text
=== before === 1
=== new log lines after patch ===
(no probe-related log lines)
=== after === 1
```

#### 附加证据 A：真实 storage 探测失败 → 422，`storage.endpoint` 保持未配置

```text
GET storage.endpoint  {"value":"http://localhost:9000","updatedAt":null}  HTTP:200
PATCH storage.endpoint=http://127.0.0.1:19999
HTTP:422
{"type":"https://roamlog.app/errors/settings-probe-failed","title":"Configuration rejected","status":422,
 "code":"SETTINGS_PROBE_FAILED",
 "detail":"The endpoint could not be reached (ECONNREFUSED). Check the endpoint, DNS, TLS and the container network.",
 "probe":{"target":"storage","code":"STORAGE_ENDPOINT_UNREACHABLE",
          "checks":[{"name":"HeadBucket","ok":false,"ms":117}]}}
GET storage.endpoint  {"value":"http://localhost:9000","updatedAt":null}  HTTP:200
```

#### 附加证据 B：super_admin 逃生阀真实可用且审计

```text
PATCH /v1/admin/settings (header x-skip-settings-probe: true) {"updates":[{"key":"site.title","value":"Roamlog 验收"}]}
HTTP:200 {"updated":[...],"version":3,...}
```

审计（同一账号）新增：

```json
{"action":"admin.settings.probe_skipped","metadata":{"keys":["site.title"]}}
```

#### 联调收尾

- 临时 super_admin 账号已从本地 DB 删除；其审计行保留（`actorId` 按 schema `onDelete: SetNull` 变为 null，属本地测试数据）。
- API 4260 与 Redis stub 46398 已停止；临时脚本/日志/cookie/响应文件已删除（cookie 会话令牌未落报告）。
- 未动 4000/3001 等共享进程；未写入任何密钥/令牌到仓库。

---

## 4. CodeGraph 证据

`codegraph status`（`roamlog/`）→ `[OK] Index is up to date`（1,731 files / 26,986 nodes / 61,473 edges）。

MCP `codegraph_explore`（`projectPath: C:\Users\BY9700\Desktop\UI\roamlog`）：

1. `"AdminSettingsController SettingsService update SettingsSaveProbe StorageProbeService MailService send probe"`
   - 明确返回 **`SettingsSaveProbe` 不在索引中**（本次首次引入）；
   - blast radius：`SettingsService` 23 个调用方、`MailService` 11 个调用方；
   - 确认 `StorageProbeService.run()` 的调用方只有 `StorageAdminController`，`MailService.send()` 调用方为 auth/invitations/mail-test；结论：新增网关只接在 controller，不碰既有调用链。
2. `"StorageSettingsConsumer resolve StorageSettings storage.config StorageProbeService run buildStorageClients resolveSigningEndpoint"`
   - `StorageProbeService.run()` 仅消费 `StorageSettingsConsumer.resolve()` 的结果，且构造函数允许注入自定义 builder；`StorageSettingsConsumer.resolve()` 是唯一读取 `storage.*` 合并层的位置；
   - `resolve` 3 个调用方（storage-client.factory / storage-probe / storage-settings.consumer 测试），`buildStorageClients` 3 个调用方；确认无需修改 storage 模块即可通过“自定义 read port + `new StorageProbeService`”注入模拟配置。
   - 该查询还给出 `StorageSettings` 的 37 个引用点与 `resolveSigningEndpoint` 的 8 个引用点，用于确认合并配置字段没有遗漏。

结论：改动落点在 `AdminSettingsController → SettingsSaveProbeService →（既有）StorageProbeService / MailService`，storage/email 模块零修改；`SettingsService` 的既有调用方与语义不受影响。

---

## 5. 已知风险

1. **探测耗时**：storage 失败路径最坏约 8s(Head) + 8s(Put) + 8s(Get) + 5s(presign fetch) + 8s(Delete) ≈ 37s，实际失败通常 1 个 RTT 即返回；mail 最坏 10s（本服务 `withTimeout`）。保存请求是同步等待，运维页面需容忍该延迟；若需要，可后续改为“后台预检 + 保存令牌”模式。
2. **逃生阀滥用**：`x-skip-settings-probe: true` 会让坏 storage/mail 配置落库（正是迁移期需要的），但只限 super_admin 且强制审计；若审计写失败则 503 拒绝。没有按 key/时间/次数的额外限制（每次绕过都留 `admin.settings.probe_skipped` 证据）。
3. **secret 语义**：合并配置包含 env 回退，因此“DB 里没有 secret、但 env 有”时会用 env 值探测并放行——这是“保存后实际生效配置”的正确语义；`MISSING_CREDENTIALS` 只在 DB + env 都没有时返回。若要求“必须由 DB 保存 secret 才允许改其它键”，需要产品明确，当前未这样做。
4. **mail 合并逻辑镜像**：因 `mail-settings.consumer.ts` 不在本任务可写范围，`SettingsSaveProbeService` 复制了其 7 键优先级（含 envLocked / 空值回落 / 默认值）。若该 consumer 后续修改优先级，本服务可能漂移；建议后续把“合并解析”抽成共享只读 resolver（需该文件 owner 协作）。
5. **探测与写入之间的竞态**：探测用的是“读取 + 本次 updates”快照；两个并发 PATCH 之间仍可能互相覆盖（与既有 `SettingsService.update` 的 last-writer-wins 语义一致，未加锁）。探测通过后被其它请求改坏配置的窗口存在，但每次保存本身都被验证。
6. **mail 探测的 transport 生命周期**：`new MailService` 每次探测新建实例；成功时 nodemailer 会自行关闭连接，超时（10s）时底层 socket 可能短暂滞留到 OS 超时。没有泄漏句柄到进程退出，但极端情况下会占用一个连接。
7. **真实联调未覆盖 storage 成功路径**：本机无 MinIO，storage 保存探测成功路径只有单测（mock `executeStorageProbe`）；真实失败路径（ECONNREFUSED + HeadBucket check）已验证。mail 成功路径是真实的（SMTP sink 落盘）。
8. **`settings.module.ts` 一行注册超出“只碰”清单**：新增 provider 必须注册到 SettingsModule 才能被 controller 注入；只加 `SettingsSaveProbeService` 一个 provider 并保留 `SettingsService`/registry provider 与 exports 原样。若必须严格，可改为在 `AppModule`/独立模块注册，但会引入额外文件改动。

---

## 6. 未覆盖项

- 未接 admin/web UI：保存失败时后台如何展示 `probe` 明细不在本任务范围（`apps/admin/**` 禁改）。
- 未做真实 S3/MinIO 成功路径与真实 Resend API 探活（无凭据/无外网）。
- 未测 storage 与 mail 同时被改且 storage 成功、mail 失败的组合真实网络路径（单测覆盖了“同时探测、mail 失败即停”的逻辑分支）。
- 未加保存探测的速率限制（仅 super_admin 可写，量低）；若被滥用可复用 `MailTestRateLimitGuard` 模式。
- 未对并发 PATCH 做串行化（见风险 5）。

---

## 7. 建议下一步

1. 由 admin UI owner 在 422 `SETTINGS_PROBE_FAILED` 时用 `probe.target/code/checks` 渲染具体失败步骤与修复建议（storage 的 `publicEndpointUnreachable` 需明确“服务端不可达，浏览器 CORS 未验证”）。
2. 由 storage/mail consumer owner 评估把“合并配置解析”抽成共享函数，消除 mail 优先级镜像（风险 4）。
3. 在真正生产 relay + MinIO 上各跑一次保存探测，保存 `checks` 与 `mail.sent` 证据（本任务只验证了失败 storage + 成功 SMTP）。
4. 若同步探测延迟不可接受，后续可改为“预检 token”：`POST /settings/probe` 返回短时 token，PATCH 携带 token 且校验配置指纹，避免在保存请求里同步等待。