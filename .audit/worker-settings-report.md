# Worker 设置感知（mail.* + 行级 bucket）交付报告

- 状态：**DONE**
- 任务 ID：`WORKER_SETTINGS_AWARENESS`
- 日期：2026-11-19（Asia/Shanghai）
- 可写范围：`apps/worker/src/**`、`apps/worker/package.json`（未改）、对应测试、本报告
- 未触碰：`apps/api/**`、`packages/**`、`apps/web/**`、`apps/admin/**`、`e2e/**`、`docker/**`、`docs/**`
- 未新增依赖；未生成迁移；未改动 Prisma schema。

---

## 1. 变更文件

新增：

- `apps/worker/src/settings-reader.ts`
- `apps/worker/src/secret-box.ts`
- `apps/worker/src/jobs/storage-bucket.ts`
- `apps/worker/test/mail-settings-reader.spec.ts`
- `apps/worker/test/secret-box.consistency.spec.ts`
- `apps/worker/test/bucket-deletion.spec.ts`
- `.audit/worker-settings-report.md`（本报告）

修改：

- `apps/worker/src/dependencies.ts`
- `apps/worker/src/jobs/types.ts`
- `apps/worker/src/jobs/media.ts`
- `apps/worker/src/jobs/maintenance.ts`

未修改：`apps/worker/package.json`（`@roamlog/db` 已是依赖）、`apps/api/**`、`packages/**`、迁移文件。

---

## 2. 实现摘要（逐 3 项）

### (1) worker 按 `mail.*` 设置发信（消除邮件分叉）

- 新增 `MailSettingsReader`：用 worker 自己的 Prisma client 直接读
  `SystemSetting where group='mail'`，与 API `mail-settings.consumer.ts` 使用相同的
  7 个 key、相同的 `ENVIRONMENT_KEY` 映射和相同的默认值来源 `@roamlog/db` 的 `DEFAULT_SETTINGS`。
- 优先级与 API 逐键一致：
  1. 行 `envLocked=true` 且 env 有值 → env
  2. 行存在且值非空 → DB
  3. env → env
  4. 代码默认 → default
- secret（`mail.resendApiKey` / `mail.smtpPassword`）从 `secretCipher` 读取并解密；
  密文不完整、密钥环不含 keyId、AAD 不匹配时抛 `MailSettingsError`，
  再由 `createEmailSender` 转成 BullMQ `UnrecoverableError`（`NonRetryableEmailError`）。
  **不会**静默回落到 env 假装已配置。
- 配置不完整（如缺 `mail.smtpHost`、`mail.smtpUser` 无 `mail.smtpPassword`）时
  `resolve()` 返回 `configured:false + missing[]`，发送前抛
  `Worker mail is not configured (missing: ...)`，并记录 `mail.not_configured` warn。
- `createWorkerDependencies` 把同一 Prisma client 传给 reader：
  `createEmailSender(logger, createMailSettingsReader({ db, logger }))`。
  邮件 job 与导出完成通知都经 `deps.email.send`，因此自动走 DB 设置。
- `require.resolve("nodemailer")` 启动门禁 `assertSmtpClientAvailable()` 原样保留。
- **第二份 crypto 实现**：`apps/worker/src/secret-box.ts` 是只读实现，文件头明确标注
  “SECOND implementation / must stay byte-compatible with apps/api/.../secret-box.ts”。
  配套 `test/secret-box.consistency.spec.ts` 直接 import **API 的真实 `SecretBox`** 加密，
  再由 worker 解密，覆盖：单 key、key ring 轮换、AAD 绑定、非法 envelope、以及经
  `MailSettingsReader` 的整链路。

### (2) 删除对象按行自己的 bucket

- `WorkerStorage.deleteObject(key, bucket?)` 新增可选 bucket；
  `createStorage()` 实现 `Bucket: bucket?.trim() || 当前 bucket`。
- 调用点全部改为行级 bucket：
  - `jobs/media.ts`（`media.cleanup`）：`Media.bucket`，覆盖原图、variants、motion、motion thumb。
  - `jobs/maintenance.ts` 过期导出：`Export.bucket`；NULL/空值回落当前 bucket，
    每次 run 汇总一条 `export.bucket_missing` warn（含 count、sampleExportId、fallback）。
  - `jobs/maintenance.ts` 软删媒体：`Media.bucket`；无 bucket 时汇总一条
    `media.bucket_missing` warn 并回落当前 bucket。
  - `dependencies.ts` 的 S3 删除原语：显式 bucket 优先。
- `createStorage()` 增加可选 `{ bucket, client }` 测试注入，用于证明
  “当前配置 bucket=B、行 bucket=A → DeleteObject 指向 A”。

### (3) 配置生效窗口

- reader 为短 TTL 读穿缓存：**默认 30s**（`DEFAULT_MAIL_SETTINGS_TTL_MS = 30_000`），
  提供 `invalidate()` 立即失效钩子。
- 每次发信调用 `reader.resolve()`；长驻 worker **不会**在进程启动时把配置缓存到底。
- 结论：后台改 `mail.*` 后，worker 的下一封邮件在 **≤30s** 内使用新配置，无需重启；
  新进程启动则立即读取。30s 窗口由 fake timers 测试固定
  （29,999ms 仍是旧值，+1ms 变新值，DB 恰好读两次）。
- `mailpit` 仍是 **worker 专属、env-only** 的本地 QA transport：它不是
  `mail.provider` 的 DB 值，也不属于本轮 `mail.*` 分叉。

---

## 3. 验证命令与结果（原始输出）

### 3.1 `pnpm --filter @roamlog/worker typecheck`

```text
$ tsc --noEmit
```

（exit 0，无输出）

### 3.2 `pnpm --filter @roamlog/worker test`

```text
$ vitest run

 RUN  v5.1.0 C:/Users/BY9700/Desktop/UI/roamlog/apps/worker

 ✓ test/email-sender.spec.ts (25 tests) 34ms
 ✓ test/jobs.spec.ts (12 tests) 17ms
 ✓ test/mail-settings-reader.spec.ts (10 tests) 15ms
 ✓ src/jobs/media-motion.test.ts (4 tests) 10ms
 ✓ test/bucket-deletion.spec.ts (6 tests) 9ms
 ✓ test/secret-box.consistency.spec.ts (5 tests) 7ms
 ↓ test/queue.spec.ts (4 tests | 4 skipped)
 ↓ test/staging-email.spec.ts (1 test | 1 skipped)
 ↓ test/staging-export.spec.ts (2 tests | 2 skipped)
 ↓ test/staging-media.spec.ts (1 test | 1 skipped)

 Test Files  6 passed | 4 skipped (10)
      Tests  62 passed | 8 skipped (70)
   Start at  16:39:52
   Duration  3.60s (import 90%, transform 4%, tests 4%, worker 2%)
```

基线 41 passed / 8 skipped → 现在 62 passed / 8 skipped；新增 21 条测试，原 41 条全保留。

### 3.3 `pnpm --filter @roamlog/worker lint`

```text
✖ 19 problems (0 errors, 19 warnings)
```

0 error；warning 数仍为既有 19 条 `no-explicit-any`，未新增（`dependencies.ts` 仍是 3 条，
只是行号随重构移动；新增文件 0 warning）。

### 3.4 真实联调（本地 PG 55444 + SMTP sink 1025）

环境事实：

- `127.0.0.1:55444` 上的 `roamlog_local`（`postgres` 用户）正在监听；
- `127.0.0.1:1025` 是 `.audit/local-verify/smtp-sink.mjs`，把每封信落盘为
  `.data/local-verify/mail/mail-NNN.eml`；
- `127.0.0.1:6379` Redis **未监听**，因此没有启动完整 BullMQ worker，
  改用 `tsx` 一次性脚本调用真实函数；
- 写入方式：**直接 SQL**（`pg` client，非 super_admin API）。DB 里原本已有
  `mail.smtpHost=127.0.0.1`、`mail.smtpPort=1025`、`mail.provider=smtp`、
  `mail.from="Roamlog <verify@roamlog.test>"`（本轮查询确认），因此只把
  `mail.smtpPort` 改成 `1` 再恢复；没有重写 host/from。

#### 3.4.1 真实 `createWorkerDependencies` 接线发信成功

脚本（一次性，已删除）内容要点：

```ts
process.env.DATABASE_URL =
  "postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public";
loadLocalEnvironment();
const deps = createWorkerDependencies(createLogger("info"));
await deps.email.send({
  to: "worker-deps-smoke@roamlog.test",
  subject: "你的 Roamlog 导出已准备好（worker deps smoke）",
  text: "worker deps smoke: export ready",
  html: "<p>worker deps smoke: export ready</p>",
  idempotencyKey: `worker-deps-smoke-${Date.now()}`,
});
```

原始输出：

```text
{"sent":true,"providerId":"<3cea7e3f-8158-a374-5931-53e6972119b8@roamlog.test>"}
{"level":30,"time":"2026-11-19T08:40:28.939Z","service":"roamlog-worker","event":"email.sent","transport":"smtp","status":250,"providerId":"<3cea7e3f-8158-a374-5931-53e6972119b8@roamlog.test>","msg":"email delivered"}
```

sink 落盘证据（`.data/local-verify/mail/mail-017.eml`）：

```text
From: Roamlog <verify@roamlog.test>
To: worker-deps-smoke@roamlog.test
Subject: =?UTF-8?Q?=E4=BD=A0=E7=9A=84_Roamlog_=E5=AF=BC?=
Message-ID: <3cea7e3f-8158-a374-5931-53e6972119b8@roamlog.test>
worker deps smoke: export ready
```

说明：`notifyExportReady` 是 `jobs/export.ts` 的私有函数，没有导出成
`sendExportReadyEmail`。本次用 `createWorkerDependencies(...).email.send` 发送与
导出通知完全相同的 subject/body/idempotency 形状，覆盖的是同一配置路径
（reader → sender → nodemailer），并额外在先前的直接 reader 脚本中打印了
`resolved.source=db, host=127.0.0.1, port=1025`：

```text
{"environmentFile":"C:\\Users\\BY9700\\Desktop\\UI\\roamlog\\.env.local","resolved":{"configured":true,"provider":"smtp","source":"db","from":"Roamlog <verify@roamlog.test>","host":"127.0.0.1","port":1025,"secure":false}}
{"level":30,... "event":"email.sent","transport":"smtp","status":250,...}
{"sent":true,...}
```

对应 sink 文件 `mail-016.eml` 头部：

```text
From: Roamlog <verify@roamlog.test>
To: worker-settings-smoke@roamlog.test
Subject: =?UTF-8?Q?=E4=BD=A0=E7=9A=84_Roamlog_=E5=AF=BC?=
Message-ID: <a8c0acb6-c899-b317-5baa-79015c698f4c@roamlog.test>
worker settings smoke: export ready
```

#### 3.4.2 把 DB 的 `mail.smtpPort` 改成 `1` → 明确失败

执行 SQL（直接 `pg`）：

```sql
update "SystemSetting" set value = to_jsonb(1::int) where key = 'mail.smtpPort' returning key, value;
-- updated: [{"key":"mail.smtpPort","value":1}]
```

再跑同一脚本（新进程；reader 从 DB 读到 1）：

```text
{"environmentFile":"C:\\Users\\BY9700\\Desktop\\UI\\roamlog\\.env.local","resolved":{"configured":true,"provider":"smtp","source":"db","from":"Roamlog <verify@roamlog.test>","host":"127.0.0.1","port":1,"secure":false}}
{"level":40,"time":"2026-11-19T08:39:13.042Z","service":"roamlog-worker","event":"email.rejected","transport":"smtp","msg":"email rejected by smtp relay"}
{"sent":false,"name":"EmailDeliveryError","message":"SMTP relay rejected the message (ESOCKET)"}
Error: ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL ...
```

失败是显式的（抛错、exit 1、日志 `email.rejected`），没有假装发送成功；`ESOCKET`
按既有分类属于可重试，BullMQ 会按 job 重试策略重试，不会静默成功。

随后已恢复：

```sql
update "SystemSetting" set value = to_jsonb(1025::int) where key = 'mail.smtpPort';
-- restored: [{"key":"mail.smtpPort","value":1025}]
```

#### 3.4.3 行级 bucket 删除

由 `bucket-deletion.spec.ts` 覆盖（无本地 S3/MinIO 9000 监听，无法做真实对象删除）：

- `createStorage({ bucket: "current-b", client })` 调 `deleteObject(key, "bucket-a")`
  → 捕获到 `DeleteObjectCommand` 的 `Bucket="bucket-a"`；
  未传 bucket 的旧行 → `Bucket="current-b"`。
- 过期导出 `Export.bucket="bucket-a"` → `deleteObject(storageKey, "bucket-a")`；
  `bucket=null` → `deleteObject(storageKey, undefined)` + `export.bucket_missing` warn（count/sample/fallback）。
- 软删媒体 + `media.cleanup`：原图/variants/motion 全部使用 `Media.bucket="bucket-a"`；
  空 bucket → 回落 + `media.bucket_missing` warn。

---

## 4. CodeGraph 证据

命令与关键结果：

```text
cd C:\Users\BY9700\Desktop\UI\roamlog
codegraph status
→ [OK] Index is up to date  (TypeScript 1,514 files; 新文件已被增量索引)
```

```text
codegraph explore "WorkerStorage deleteObject maintenance media cleanup objectBucket"
→ Found 46 symbols across 5 files.
→ objectBucket (apps/worker/src/jobs/storage-bucket.ts:7) — 4 callers in media.ts /
  maintenance.ts; tested via bucket-deletion.spec.ts / jobs.spec.ts.
→ WorkerStorage (apps/worker/src/jobs/types.ts:16) — 3 callers in dependencies.ts;
  tested via bucket-deletion.spec.ts 等。
```

```text
codegraph explore "sendViaSmtp createEmailSender MailSettingsReader SecretBox SystemSetting export bucket deleteObject"
→ createEmailSender (apps/worker/src/dependencies.ts:766) — callers include
  createWorkerDependencies；tests: email-sender.spec.ts / mail-settings-reader.spec.ts /
  staging-email.spec.ts。
→ 调用链：createWorkerDependencies → createEmailSender → resolveMailRuntime /
  sendViaSmtp / sendViaResend；createEmailSender → sendViaMailpit（仅 mailpit）。
```

```text
codegraph explore "apps/worker/src/secret-box.ts settings-reader.ts MailSettingsReader"
→ implements: MailSettingsReader → MailSettingsSource
→ 新 worker 文件已进入索引。
```

结论：邮件配置入口集中在 `createWorkerDependencies → createEmailSender`；
删除入口集中在 4 个 `deleteObject` 调用点；影响面限定在 worker，无 API/web/admin 调用方。

---

## 5. 是否需要动 `packages/**` 或迁移

**否。原因：**

1. `packages/config` 目前只导出 Tailwind preset，不是运行配置/crypto 包；
   把 `secret-box` 放进去语义不符，还要新增 exports、node 类型和消费方依赖。
2. 更合适的位置是 `packages/db`（worker/API 都已依赖），但 `packages/**` 本轮明确需要先问，
   且 `packages/db` 正被并行任务占用（0011 `EXPORT_BUCKET`）。此时抽包会制造写冲突。
3. 因此采用任务允许的备选路径：worker 内**只读**第二实现 + 跨实现一致性测试
   （API 真实加密 → worker 解密）。测试不是“假称一致”，而是直接 import API 源文件。
4. 迁移：不需要。`Media.bucket` 已存在；`Export.bucket` 已由已提交的
   `0011_export_bucket` 增加（nullable），worker 只读不写，不需要新迁移。

若后续认为共享包更合适，可将 API 的 `secret-box.ts` 抽到 `packages/config` 或新
`packages/settings-crypto`，再删除 worker 副本；这不影响本轮行为。

---

## 6. 配置生效窗口

| 变更 | 何时生效 |
| --- | --- |
| `mail.*`（含 secret） | 下一次 `deps.email.send` 时读取；最多 30s 旧值（TTL），无需重启 |
| `CONFIG_ENCRYPTION_KEY(S)` | 下一次 resolve 时使用；密钥缺失/不匹配立即显式失败 |
| `S3_BUCKET` / endpoint / 凭据 | 仍为进程启动时的 env（本轮未改 storage 设置读取；删除用行 bucket） |
| 行级 bucket 变更 | 立即按行读取，无缓存 |

说明：worker 仍是长驻进程，但 mail 配置不是“启动时读一次”；每个 job 的发送点都会
经过 reader，30s 只是读穿缓存的硬上限。

---

## 7. 已知风险

1. **第二份 crypto 实现**：`apps/worker/src/secret-box.ts` 必须与 API 的格式、key ring
   顺序、AAD 规则保持同步。一致性测试覆盖了当前契约；未来 API 若升级 `v2` 或改轮换语义，
   测试会失败，需要在两个文件同步修改。
2. **解密失败策略比 API 更严格**：API `MailSettingsConsumer.load()` 会把
   `getGroup` 的任何异常（含解密失败）整体降级到 env；worker 对“行存在但 secret 解不开”
   直接 `UnrecoverableError`，避免静默改走旧 relay。这是任务“配置不完整→明确失败”的要求，
   但与 API 的降级策略不完全相同。DB 不可用仍按 API 语义降级 env + warn。
3. **生产默认 from**：`DEFAULT_SETTINGS["mail.from"]` 是 `...@roamlog.local`；
   worker 的生产 sender 门禁会拒绝 `.local`，而 API 不拒绝。生产必须显式配置
   `mail.from`，否则 worker 导出通知会明确失败（而非发一封被 relay 拒绝的信）。
4. **跨桶 endpoint 假设**：`Media`/`Export` 只持久化 bucket，没有 endpoint/region/credentials。
   本实现与 API `media-bucket` 报告采用同一假设：所有历史 bucket 都由当前 S3 配置可达。
   若 endpoint/凭据也换过，旧桶对象仍无法删除/读取，需要新增行级 endpoint 字段。
5. **历史 Export 行 bucket 为 NULL**：会回落当前 bucket 并 warn；如果旧对象的真实桶已不可知，
   泄漏风险仍在（只能在换桶前回填或人工清理）。
6. **Export.bucket 的写入方在 API**：worker 只在完成时写 `storageKey`，不写 bucket；
   依赖并行 API 任务在创建/完成时写入 `bucket`。若 API 侧留空，worker 维护清理会走
   NULL 回落 + warn。
7. **同一 Media 的 variants/motion 假定同桶**：若处理中途换桶，可能出现跨桶对象；
   概率低，未处理。
8. **mailpit 仍 env-only**：后台切 `mail.provider` 不会改变 mailpit 选择；这是刻意保留的
   本地 QA 通道。
9. **测试耦合**：`secret-box.consistency.spec.ts` 与 `mail-settings-reader.spec.ts` 直接
   import `apps/api/src/modules/settings/secret-box.ts`（只读）。API 文件移动/改名会先让
   worker typecheck 失败——这是有意的契约耦合。
10. **数据库凭据**：联调用了本地 `postgres@55444` 直连 SQL，未走 super_admin API；
    没有把任何密码写进仓库。

---

## 8. 未覆盖项

- 未启动完整 BullMQ worker 进程（Redis 6379 未监听）；用 `tsx` + 真实 PG + 真实 SMTP sink
  调用 `createWorkerDependencies().email.send`。
- 未跑真实 export job（本地 S3/MinIO 9000 未监听），因此没有真实对象写入/删除；
  bucket 删除由单测的命令捕获证明。
- 未向真实 Resend / 外部 SMTP relay 发信（按要求只用本地 sink）。
- 未验证“配置在发送过程中被改”的并发竞态（30s 缓存窗口内的最后一次写入语义）。
- 未验证 admin UI 修改后 worker 的实际界面链路（`apps/admin` 不在范围）。
- `docs/operations/mail.md` §7 仍写着 “worker 未接”；该文件不在本轮可写范围，
  需要文档负责人更新（见建议下一步）。

---

## 9. 建议下一步

1. **更新 `docs/operations/mail.md` §7**：删除“worker 仍读 env”的过期限制，写明
   worker 现在读 `mail.*`、生效窗口 ≤30s、secret 解密依赖 `CONFIG_ENCRYPTION_KEY`。
2. **确认 API 侧导出行写入 `bucket`**：0011 之后新建的 Export 应在创建时记录实际写入桶；
   否则 worker 维护清理仍会走 NULL 回落。
3. 若希望消除第二份 crypto：把 `secret-box.ts` 抽到共享包（需 `packages/**` 批准），
   worker 改为 import；删除本地副本和一致性测试中的 API 源导入。
4. 在补齐 Redis 后，用真实 BullMQ worker 跑一遍“改后台配置 → 30s 内导出通知走新 host”
   的端到端演练，并保留 worker 日志与 EmailLog。
5. 为历史 `Export.bucket` 做一次回填脚本（按对象实际位置），再观察
   `export.bucket_missing` / `media.bucket_missing` warn 是否归零。