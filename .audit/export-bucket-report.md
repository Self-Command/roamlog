# EXPORT_BUCKET — 导出文件下载按行 bucket 签名（第三处换桶坏链）

- 任务 ID：`EXPORT_BUCKET`
- 角色：data_worker + backend_api
- 状态：**DONE**
- 日期：2026-11-19（Asia/Shanghai）
- 范围：`packages/db/prisma/**`（schema + `0011_export_bucket`）、`packages/db/src/__tests__/**`、`apps/api/src/modules/exports/**`、`apps/api/src/modules/storage/storage.service.ts`（任务明确要求的 `deleteObject` 可选尾参）、`apps/api/test/staging-export-download.e2e-spec.ts`（仅补 2 行 fixture 的 `bucket` 字段以通过 typecheck）、本报告。
- 未触碰：其它 api 模块、`apps/worker/**`、`apps/web/**`、`apps/admin/**`、`packages/contracts/**`（bucket 是存储内部字段，契约无变化）、`e2e/**`。

---

## 1. 变更文件

### DB（已单独提交 `9db6dd9`，便于共享库先应用迁移）

- `packages/db/prisma/migrations/0011_export_bucket/migration.sql`（新增）
- `packages/db/prisma/schema.prisma` — `Export.bucket String?`
- `packages/db/src/__tests__/migration.0011.test.ts`（新增，静态契约）
- `packages/db/src/__tests__/migration.0011.integration.test.ts`（新增，真实 PG）

### API

- `apps/api/src/modules/exports/exports.service.ts`
  - `create()`：落库 `bucket = await storage.currentBucket()`
  - `get()`：`createSignedReadUrl(key, undefined, this.bucketFor(record))`
  - `remove()`：`deleteObject(key, this.bucketFor(record))`
  - 新增 `bucketFor()` / `noteMissingBucket()`（`export.bucket_missing`，60s 节流）
- `apps/api/src/modules/exports/exports.repository.ts` — `ExportCreateData.bucket: string`，随 create 写入
- `apps/api/src/modules/exports/export-records.ts` — `bucket: string | null`
- `apps/api/src/modules/storage/storage.service.ts` — `deleteObject(key, bucket?)`，与 `createSignedReadUrl(key, ttl?, bucket?)` 同模式：`normalizedBucket(bucket) ?? bundle.bucket`
- `apps/api/src/modules/exports/__tests__/export-bucket.spec.ts`（新增，8 条）
- `apps/api/src/modules/exports/__tests__/export-presenter.spec.ts`（fixture 补 `bucket`）
- `apps/api/src/modules/exports/__tests__/export-bucket-http.e2e.ts`（新增，4350 真实 HTTP + 独立 schema）
- `apps/api/test/staging-export-download.e2e-spec.ts`（**仅 2 行 fixture**补 `bucket`，否则 `ExportRecord` 必填字段令 typecheck 红；该文件与 exports 下载直接对应）
- `.audit/export-bucket-report.md`（本报告）

### 迁移号（已单独发消息给根 Agent）

**`0011_export_bucket`** — 纯 additive：`ALTER TABLE "Export" ADD COLUMN "bucket" TEXT;` + `Export_bucket_check`（NULL 合法，空串/超长拒绝）。历史行保持 NULL，不做回填（无法可靠推断旧桶）。

---

## 2. 实现摘要

### 2.1 语义

- **写入**：`create()` 在插入 `Export` 前调用 `StorageService.currentBucket()`，把返回值随行写入。它走的是 admin 设置 → `StorageClientFactory` 的当前生效配置，**不是** `process.env.S3_BUCKET`（单测专门把 `process.env.S3_BUCKET` 改成另一个值证明不会读取它）。
- **读取**：下载签名用行的 `bucket`；`NULL`/空串/纯空白 → 回落当前 bucket，并发一条节流的 `logger.warn({code:"EXPORT_BUCKET_MISSING", count, sampleExportId}, "export.bucket_missing")`，60s 窗口内最多一条（与 `media.bucket_missing` 同手法）。
- **删除**：`deleteObject(key, rowBucket)`。换桶后旧导出对象会在旧桶被清理（此前用当前桶删，既漏删旧对象也误删新桶同名对象——顺带修掉泄漏面）。
- **契约**：`bucket` 不出现在 `Export`/`ExportDetail` 响应里；单测断言响应无 `bucket` 键。没有改 `packages/contracts/**`。
- **兼容**：`ExportRecord.bucket` 是 DB 行字段（0011 后恒存在）；`ExportCreateData.bucket` 必填，避免漏写。

### 2.2 写入时点说明

API 在**建任务入队时**捕获 bucket（`currentBucket()`），worker 在该配置下上传。若管理员在“入队 → worker 上传”之间切桶，行值可能与实际上传桶不一致——这是本任务禁触 `apps/worker/**` 导致的已知窗口，见 §6 风险。

---

## 3. 变异测试前后输出（原始）

变异手法：把 `createSignedReadUrl` 调用的第三个实参 `this.bucketFor(record)` 替换成 `undefined`（即删除传播），只跑回归用例，跑完从备份恢复。

变异点（变异后）：

```text
176:    const signed = await this.storage.createSignedReadUrl(
177-      record.storageKey ?? "",
178-      undefined,
179-      undefined,
180-    );
```

变异前（全绿）：

```text
 RUN  v5.1.0 C:/Users/BY9700/Desktop/UI/roamlog/apps/api

 ✓ src/modules/exports/__tests__/export-bucket.spec.ts (8 tests | 7 skipped) 9ms

 Test Files  1 passed (1)
      Tests  1 passed | 7 skipped (8)
```

变异后（回归用例变红）：

```text
 ❯ src/modules/exports/__tests__/export-bucket.spec.ts (8 tests | 1 failed | 7 skipped) 20ms
   ❯ export bucket propagation (8)
     ↓ stores the effective StorageService bucket when the task is created
     ↓ does not read process.env.S3_BUCKET: the value comes from currentBucket()
     × signs a download against the row bucket after the configured bucket switches 18ms
     ↓ falls back to the current bucket and warns once for bucket=null
     ↓ falls back to the current bucket and warns once for bucket=""
     ↓ falls back to the current bucket and warns once for bucket="   "
     ↓ deletes the object in the row bucket, so old exports are cleaned up after a switch
     ↓ deletes a legacy row (NULL bucket) from the current bucket and warns

 FAIL  src/modules/exports/__tests__/export-bucket.spec.ts > export bucket propagation > signs a download against the row bucket after the configured bucket switches
AssertionError: expected [ [ …(3) ] ] to deeply equal [ [ …(3) ] ]

- Expected
+ Received

  [
    [
      "exports/0199f090-0000-7000-8000-000000000002/export.zip",
      undefined,
-     "roamlog-bucket-a",
+     undefined,
    ],
  ]

 Test Files  1 failed (1)
      Tests  1 failed | 7 skipped (8)
[exit 1]
```

恢复后（全绿，源码回到传播版本）：

```text
 ✓ src/modules/exports/__tests__/export-bucket.spec.ts (8 tests) 14ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
[exit 0]
```

恢复后的调用（与变异前一致）：

```text
176:    const signed = await this.storage.createSignedReadUrl(
177-      record.storageKey ?? "",
178-      undefined,
179-      this.bucketFor(record),
180-    );
```

---

## 4. 验证命令与结果（原始输出）

### 4.1 `pnpm --filter @roamlog/db test`（真实 PG，schema `expbucket`）

```text
$ prisma validate && vitest run
Prisma schema loaded from prisma\schema.prisma.
The schema at prisma\schema.prisma is valid 🚀

 RUN  v5.1.0 C:/Users/BY9700/Desktop/UI/roamlog/packages/db

 ✓ src/__tests__/migration.0011.test.ts (5 tests)
 ✓ src/__tests__/migration.0011.integration.test.ts (4 tests) 1112ms
   ✓ 0011_export_bucket against PostgreSQL (4)
     ✓ applies the whole migration series to an empty database
     ✓ keeps 0010 rows and values intact and leaves their bucket NULL
     ✓ records a bucket on an old row and reads it back
     ✓ accepts a second bucket and rejects empty or oversized values
 ...
 Test Files  21 passed (21)
      Tests  99 passed (99)
[db test exit 0]
```

（`ROAMLOG_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=expbucket`；该 schema 上的 `_prisma_migrations` 已由本任务 `migrate deploy` 建好，属隔离测试库。）

### 4.2 `pnpm --filter @roamlog/db exec prisma generate`

```text
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma\schema.prisma.
✔ Generated Prisma Client (7.10.1) to .\src\generated\prisma in 493ms
[generate exit 0]
```

### 4.3 `pnpm --filter @roamlog/db typecheck`

```text
$ tsc --noEmit
[db typecheck exit 0]
```

### 4.4 `pnpm --filter @roamlog/api typecheck`

```text
$ tsc --noEmit
[api typecheck exit 0]
```

### 4.5 `pnpm --filter @roamlog/api exec vitest run src/modules/exports`

```text
 ✓ src/modules/exports/__tests__/export-bucket.spec.ts (8 tests) 14ms
 ✓ src/modules/exports/__tests__/export-presenter.spec.ts (3 tests) 9ms
 ✓ src/modules/exports/__tests__/job-queue.service.spec.ts (2 tests) 6ms
 ✓ src/modules/exports/__tests__/export-rules.spec.ts (3 tests) 3ms

 Test Files  4 passed (4)
      Tests  16 passed (16)
[exports vitest exit 0]
```

新增 8 条覆盖：
1. 创建任务落库 `bucket = currentBucket()`；
2. `process.env.S3_BUCKET` 改值不影响落库值；
3. 换桶后旧导出 URL 指向行 bucket A，绝不含 B；
4. `null`、`""`、`"   "` 三种旧行回落当前 bucket B；
5. 上述回落只发一条 `export.bucket_missing`（两次读取仍一条，验证节流）；
6. 删除对象用行 bucket A（换桶后清理旧对象）；
7. 旧行删除回落当前 bucket 并 warn；
8. 契约响应不含 `bucket`（每次 create/download 都会校验）。

### 4.6 真实 HTTP（独立端口 4350 + 独立 schema `expbucket_http`）

命令：

```text
cd apps/api && node --import tsx src/modules/exports/__tests__/export-bucket-http.e2e.ts
```

harness 自建 schema（`prisma migrate reset`，只作用于 `expbucket_http`），使用真实 PostgreSQL、真实 `ExportsService`/`ExportsRepository`、真实 `StorageService` SigV4；仅 actor / access / permission / audit / queue / logger 是替身。

原始输出：

```text
Export bucket harness listening on http://127.0.0.1:4350

## step 1 — create an export while the effective bucket is A
{"id":"01a1f2ea-1aea-768d-b4ac-2d1057f94aa8","rowBucket":"roamlog-bucket-a","responseKeys":["completedAt","createdAt","error","expiresAt","format","id","includeComments","includeExpenses","includeMedia","requestedById","scope","status","storageKey","tripId","workspaceId"]}

## step 2 — the worker finishes and the first download uses A
{"bucketInUrl":"/roamlog-bucket-a/","downloadUrl":"https://media.example.test/roamlog-bucket-a/exports/0199f0a0-0000-7000-8000-000000000002/01a1f2ea-1aea-768d-b4ac-2d1057f94aa8/export.zip?X-Amz-Algorithm=AWS4-HMAC-SHA256&...&X-Amz-Signature=..."}

## step 3 — switch the effective bucket and re-download the old export
{"configuredBucket":"roamlog-bucket-b","downloadUrl":"https://media.example.test/roamlog-bucket-a/exports/0199f0a0-0000-7000-8000-000000000002/01a1f2ea-1aea-768d-b4ac-2d1057f94aa8/export.zip?X-Amz-Algorithm=AWS4-HMAC-SHA256&...&X-Amz-Signature=..."}

## step 4 — a legacy row (bucket NULL) falls back to B and warns
{"configuredBucket":"roamlog-bucket-b","downloadUrl":"https://media.example.test/roamlog-bucket-b/exports/0199f0a0-0000-7000-8000-000000000002/0199f0a0-0000-7000-8000-000000000011/export.zip?X-Amz-Algorithm=AWS4-HMAC-SHA256&...&X-Amz-Signature=...","warnings":["export.bucket_missing"]}

ALL EXPORT BUCKET HTTP ASSERTIONS PASSED
[http exit 0]
```

断言要点：创建响应无 `bucket` 键；`row.bucket = roamlog-bucket-a`；切到 B 后旧导出 URL 仍为 `/roamlog-bucket-a/` 且不含 `/roamlog-bucket-b/`；NULL 旧行回落 B 并只产生一条 `export.bucket_missing`（payload `{code:"EXPORT_BUCKET_MISSING",count:1,sampleExportId}`）。

---

## 5. CodeGraph 证据

- `codegraph status` → `[OK] Index is up to date`
- `codegraph_explore("exports.service createSignedReadUrl deleteObject currentBucket Export model", projectPath=roamlog)` →
  - `ExportsService`（`apps/api/src/modules/exports/exports.service.ts:36`），blast radius：4 callers（controller/module）、staging-export-download e2e
  - `get` 的 `createSignedReadUrl` 恰在 `exports.service.ts:160`（与 `.audit/share-bucket-report.md` 指认一致）
  - `StorageService.currentBucket` 文档明确要求“持久化对象位置（`Media.bucket`）必须先捕获”，`createSignedReadUrl(key, ttl?, bucket?)` 已支持每对象 bucket；`deleteObject` 当时只接受 `key`
  - `exports.repository.ts:26` `createExport(data)` 直接 `{...data,status:"queued"}`；`export-records.ts:7` 手写行类型
- `codegraph_explore("media-url.service bucketFor MEDIA_BUCKET_MISSING warn throttle")` → 复用 `BUCKET_MISSING_WARN_INTERVAL_MS=60_000` + `noteMissingBucket` 的节流手法
- `codegraph_explore("worker export job export.generate storageKey upload")` 未命中 worker job（源码在 `apps/worker/src/jobs/export.ts`，人工读取确认 `putObject` 后才写 `storageKey`；worker 禁改，见风险）

---

## 6. 已知风险

1. **worker 写桶窗口**：API 在入队时捕获 bucket；worker 在 `apps/worker/src/jobs/export.ts:68` 用当时配置 `putObject`，随后只更新 `storageKey`。若在“入队→上传”间切桶，行 bucket 与实际对象桶可能不一致 → 该导出可能 404。修复需 worker 在上传完成时把 `deps.storage.currentBucket()` 一并写入（本任务禁止触碰 worker）。
2. **worker 清理仍不带 bucket**：`apps/worker/src/jobs/maintenance.ts` 的过期导出清理仍 `deleteObject(record.storageKey)`，换桶后旧桶对象不会被 worker 清理。API `DELETE /v1/exports/:id` 已修。
3. **`ExportRecord.bucket` 必填**导致 staging e2e fixture 需要补字段；已只改 2 行，但该文件属于 `apps/api/test/**`（并行区），合并时请优先保留本改动。
4. **不做回填**：历史 `Export` 行 bucket=NULL，只能回落当前桶；这是需求规定的历史行为，但意味着“迁移前已存在、且已换过桶”的导出仍可能 404，除非人工按旧桶回填。
5. CHECK 上限用 255（S3 规范 63，但兼容自建/长名 provider），比 S3 宽松。

## 7. 未覆盖项

- 未跑 staging e2e（`ROAMLOG_STAGING_SERVICES=1` 需要真实 MinIO）；HTTP harness 只验证真实 SigV4 签名，不验证对象实际 GET。
- 未改 worker（任务禁止），因此“worker 上传落桶”与“worker 过期清理按行桶”没有测试。
- 未对共享库执行迁移（等待根 Agent 应用 `0011_export_bucket`）；只在隔离 schema `expbucket` / `expbucket_http` 验证。
- 契约 / OpenAPI 无变化，未跑 contracts 生成（bucket 非客户端字段）。

## 8. 建议下一步

1. 根 Agent 立即在共享库应用 `0011_export_bucket`（`pnpm db:migrate`），再合并 API 提交（API 代码写入 `bucket` 依赖该列）。
2. 单开 worker 任务：`export.generate` 上传完成时写 `bucket: await deps.storage.currentBucket()`；`maintenance`/`media` 清理改为按行 bucket 删除。
3. 如需覆盖历史数据，按运维记录回填 `Export.bucket`（`UPDATE "Export" SET bucket='<old>' WHERE ...`），再观察 `export.bucket_missing` 告警归零。