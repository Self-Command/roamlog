# MEDIA_BUCKET_P0 — 每个对象用自己的 bucket 签名，换桶后旧链接不再 404

- 任务 ID：`MEDIA_BUCKET_P0`
- 角色：backend_api
- 状态：DONE（代码、单测、真实 SigV4 换桶证明均完成；全量测试被并行改动污染，见 §3.4）
- 日期：2026-11-19（Asia/Shanghai）
- 范围：只改 `apps/api/src/modules/media/**`、`apps/api/src/modules/storage/**` 及对应测试，另加本报告。
- 并行约束：未触碰 `apps/web/**`、`apps/admin/**`、`packages/**`、`apps/worker/**`、`docker/**`、`e2e/**`、`docs/**`；未改 Prisma schema、未生成迁移。

---

## 1. 变更文件

修改：

- `apps/api/src/modules/media/media-url.service.ts`
- `apps/api/src/modules/media/media.service.ts`
- `apps/api/src/modules/media/trip-cover.service.ts`（仅注释：`bucket` 不再“故意缺失”）
- `apps/api/src/modules/media/__tests__/media-url.service.spec.ts`
- `apps/api/src/modules/media/__tests__/media-read.spec.ts`（构造参数随 `AppConfigService` 移除）
- `apps/api/src/modules/media/__tests__/media-motion.spec.ts`（同上 + 断言 motion 用行 bucket）
- `apps/api/src/modules/media/__tests__/media-rules.spec.ts`（同上）
- `apps/api/src/modules/storage/storage.service.ts`（向后兼容的可选 `bucket` 参数 + `currentBucket()`）
- `apps/api/src/modules/storage/storage.service.spec.ts`

新增：

- `apps/api/src/modules/media/__tests__/media-bucket.spec.ts`（换桶四步 + 完成回调 HEAD）
- `apps/api/src/modules/media/__tests__/media-bucket-http.e2e.mts`（4280 端口 HTTP 验证 harness，非单测）
- `.audit/media-bucket-report.md`（本报告）

未修改：`Media` schema、`packages/db/**`、`packages/contracts/**`、worker、web/admin、share-links、exports。

---

## 2. 实现摘要（逐 4 项）

### 2.1 读取：按每一行自己的 bucket 签名

- `MediaUrlSource` 增加可选 `bucket`；`MediaUrlService.signMany()` / `sign()` / 新增的 `signKeys()` 对每一行使用 `record.bucket` 作为签名 bucket。
- 批量去重键从“仅 key”改为“bucket + key”（`objectIdentity`），同一 key 出现在不同 bucket 时不会被错误复用签名。
- `Media.bucket` 为空/null/纯空白（历史行）→ 调用 `StorageService.createSignedReadUrl(key)`（即当前配置 bucket），并记 `media.bucket_missing` warn：
  - 每进程 60s 最多一条，聚合 `count` 与 `sampleMediaId`，避免历史行刷爆日志；
  - 只有“真正要签名的行”才触发 warn（未 ready 且无 motion 的行不告警）；
  - `PinoLoggerService` 为可选注入，手写实例/旧测试不受影响。
- `MediaService.presentWithUrls()`（list / complete / update 的投影）改为走 `MediaUrlService.signKeys()`，不再直接 `storage.createSignedReadUrl(key)`；motion 对象与所有 variant 同批签名，全部使用该行 bucket。
- `MediaService.getOne()` / `presentReadWithMotion()` 原本就走 `MediaUrlService.sign()`，随其修复。
- 封面投影 `TripCoverService` 继续复用 `MediaUrlService.signMany()`，`MediaRecord` 自带 `bucket`，因此 trip cover 也按行 bucket 签名。

**endpoint 处理（按任务约束不过度设计）**：`Media` 只存 `bucket`，没有 `endpoint`，所以只把 bucket 参数化；签名 endpoint 仍是 `StorageService` 当前的 `publicEndpoint`（`StorageClientFactory.signingEndpoint`）。假设与失效条件见 §5。

### 2.2 写入：新上传落“当前生效”的 bucket

- `MediaService` 不再读 `AppConfigService.storageSettings.bucket`（env 基线），改为 `await this.storage.currentBucket()`：
  - Nest 运行时即 `StorageClientFactory` 每次从 `StorageSettingsConsumer` 解析出的当前配置 bucket（DB 优先、env 兜底）；
  - 静态构造（测试/脚本）返回 `settings.bucket`，语义不变。
- 落库与签名使用**同一个捕获值**：`createMedia({ bucket })` 后调用 `createPresignedUpload(key, mime, undefined, bucket)`。即使两次调用之间设置又变化，行记录与 PUT URL 仍指向同一 bucket。
- `complete()` / `completeMotion()` 的 HEAD 使用 `media.bucket`（`bucketOf(media)`），所以换桶后完成一条旧 pending 上传仍去旧桶 HEAD，不会误判“对象不存在”。
- `presignMotion()` 使用 `media.bucket`：motion 与 still 必须同桶，否则换桶后 motion URL 会 404。
- `Media.bucket` 为空的行：写入路径回落当前 bucket 并同样记节流 `media.bucket_missing` warn。

`StorageService` 的改动保持向后兼容：

- 新增 `currentBucket(): Promise<string>`；
- `createPresignedUpload(key, contentType, expiresInSeconds?, bucket?)`；
- `createSignedReadUrl(key, expiresInSeconds?, bucket?)`；
- `completeUpload(key, bucket?)`；
- 既有 2/3 参数调用与返回结构不变（`PresignedUpload`/`SignedReadUrl` 未加字段）；
- 空/纯空白 bucket 视为“用当前 bucket”，等价旧行为；
- `deleteObject()` / `checkHealth()` 未改（仍当前配置），见风险。

### 2.3 换桶的可操作性

- 新上传 → 当前解析 bucket（已证明）；
- 旧对象读取 → 各自 `Media.bucket`（已证明，URL path 前缀为旧桶）；
- 完成回调 / motion → 行 bucket（已证明 HEAD 命令的 `Bucket` 为旧桶）；
- 端到端证明：`media-bucket.spec.ts`（真实 `StorageService` + 真实 SigV4，可切换 bucket 的 `StorageClientProvider`）与 `media-bucket-http.e2e.mts`（127.0.0.1:4280 HTTP harness）四步：
  1. bucket=A 上传一条 media，行记录 A，PUT URL path `/A/`；
  2. 切换配置为 B；
  3. 旧 media 的签名 URL 仍 `/A/`（且不含 `/B/`）；
  4. 新上传行记录 B，URL `/B/`。

### 2.4 明确不做

- 不迁移已有对象（不跨桶复制）；
- 不改 `Media` schema（不加 `endpoint` 列、不生成迁移；schema 正被并行任务占用）；
- 不改 web/admin、worker、share-links、exports；
- 不改 `SettingsService` / `StorageSettingsConsumer` / registry；
- 不改 `deleteObject` 语义（避免扩大存储 API 影响面）。

---

## 3. 验证命令与结果

### 3.1 `pnpm --filter @roamlog/api typecheck`

```text
$ tsc --noEmit
[exit 0]
```

并且：

```text
pnpm --filter @roamlog/api typecheck 2>&1 | grep -E "modules/(media|storage)"
（空）
```

任务开始时 typecheck 曾因并行 Agent 的 `apps/api/src/modules/exports/export.presenter.ts`（未跟踪 spec）出现 1 条错误；本任务完成前该并行改动已修复，最终全量 0 错误。

### 3.2 `pnpm --filter @roamlog/api exec vitest run src/modules/media src/modules/storage`

```text
 ✓ src/modules/storage/storage-probe.service.spec.ts (9 tests)
 ✓ src/modules/storage/storage.service.spec.ts (21 tests)
 ✓ src/modules/media/__tests__/media-bucket.spec.ts (2 tests)
 ✓ src/modules/media/__tests__/media-motion.spec.ts (8 tests)
 ✓ src/modules/media/__tests__/media-read.spec.ts (11 tests)
 ✓ src/modules/storage/storage-settings.consumer.spec.ts (8 tests)
 ✓ src/modules/storage/storage-client.factory.spec.ts (5 tests)
 ✓ src/modules/media/__tests__/media-url.service.spec.ts (11 tests)
 ✓ src/modules/media/__tests__/media-rules.spec.ts (4 tests)
 ✓ src/modules/media/__tests__/trip-cover-projection.spec.ts (8 tests)
 ✓ src/modules/storage/storage-admin.controller.spec.ts (3 tests)

 Test Files  11 passed (11)
      Tests  90 passed (90)
```

覆盖点：

- 旧行用自身 bucket 签名（`media-url.service.spec.ts` “signs every row against its own bucket…”）；
- 缺 bucket 回落当前 + warn（同一文件，fake timers 验证 60s 节流）；
- 新上传落当前 bucket、PUT URL 用同一 bucket（`media-bucket.spec.ts` 四步）；
- 换桶后旧行读 / `presentWithUrls` / 完成回调 HEAD 仍用旧桶；
- 签名 URL host 与 `publicEndpoint` 一致（`storage.service.spec.ts` 既有用例 + 新增显式 bucket 用例，host=`media.example.com`）；
- 内部字段不泄漏：`media-read.spec.ts` 既有断言 + `media-bucket.spec.ts` 断言响应对象无 `bucket`/`storageKey` 字段（URL path 中带桶名是 path-style S3 的必然结果，不是响应字段泄漏）；
- `StorageService` 显式 bucket 覆盖对 read/upload/HEAD 生效；空值回落；`currentBucket()` 动态/静态两条路径。

### 3.3 换桶 HTTP 端到端（独立端口 4280）

本机没有 Docker、MinIO（9000 无监听）、PostgreSQL/psql，也没有 Redis；因此按任务允许的“桩”方案：真实 `MediaService` + 真实 `MediaUrlService` + 真实 `StorageService`（真实 SigV4 签名），`StorageClientProvider` 可切换 bucket，媒体仓库为内存实现。命令：

```text
node --import tsx src/modules/media/__tests__/media-bucket-http.e2e.mts
```

原始输出（保留四步与断言行）：

```text
Bucket-switch media harness listening on http://127.0.0.1:4280

## step 1 — presign with bucket=A
{
  "storedBucket": "roamlog-bucket-a",
  "uploadUrlPrefix": "/roamlog-bucket-a",
  "uploadUrl": "https://media.example.test/roamlog-bucket-a/01942f30-.../2026/11/.../original.jpg?...&X-Amz-Signature=1004d4de...&x-id=PutObject"
}
  path prefix OK: /roamlog-bucket-a/

## step 2 — switch configured bucket
{
  "bucket": "roamlog-bucket-b"
}

## step 3 — GET old media after the switch
{
  "mediaId": "01a1f2cd-bc8a-715f-85de-8e7693f830c4",
  "url": "https://media.example.test/roamlog-bucket-a/01942f30-.../2026/11/.../original.jpg?...&X-Amz-Signature=86eeec86...&x-id=GetObject",
  "quotedBucketField": false
}
  path prefix OK: /roamlog-bucket-a/

## step 4 — presign after the switch
{
  "storedBucket": "roamlog-bucket-b",
  "uploadUrlPrefix": "/roamlog-bucket-b",
  "uploadUrl": "https://media.example.test/roamlog-bucket-b/01942f30-.../2026/11/.../original.jpg?...&X-Amz-Signature=3e9fae91...&x-id=PutObject"
}
  path prefix OK: /roamlog-bucket-b/

ALL FOUR STEPS PASSED
```

（完整 URL 太长，报告中仅把 `X-Amz-Signature` 等查询串中间部分缩写为 `...`；签名值、host、bucket path 均来自真实输出，测试内使用 `node:assert` 断言，未通过则进程非 0。）

限制说明：该 harness 为“真实签名 + 真实服务层 + 独立 HTTP 端口”，不是完整 API（缺 auth guard、真实 PostgreSQL schema、MinIO 读回）。原因见 §7。

### 3.4 `pnpm --filter @roamlog/api test`（全量）

```text
 Test Files  1 failed | 117 passed | 7 skipped (125)
      Tests  2 failed | 910 passed | 16 skipped (928)
```

失败仅来自 `test/trip-origin.e2e-spec.ts`，与本任务无关，是并行 `trips` / `packages/contracts` / `packages/db`（DESTINATIONS 0010 迁移）改动造成：

```text
FAIL test/trip-origin.e2e-spec.ts > creates a trip with a normalized origin when the optional field is omitted
AssertionError: expected 500 to be 201
FAIL test/trip-origin.e2e-spec.ts > trims a supplied origin before storing it
AssertionError: expected 500 to be 201
```

单独重跑该文件同样失败（2 failed），期间工作区存在其他 Agent 的未提交改动：

```text
 M apps/api/src/modules/trips/trips.service.ts
 M apps/api/src/modules/trips/trips.repository.ts
 M packages/contracts/src/entities/trip.ts
 M packages/contracts/src/api/trips.ts
 M packages/db/prisma/schema.prisma
?? packages/db/prisma/migrations/0010_trip_destinations/
```

该 e2e 只用 `StorageModule`/`TripsModule`，并 override `StorageService`、`PrismaService`、`RedisService`、`TripsRepository`；本任务未改 trips/contracts/db，且 `media`/`storage` 相关 11 个 suite 全绿。其余 `media`/`storage` 用例在全量中同样通过。

---

## 4. CodeGraph 证据

1. `codegraph status`：索引已同步，`[OK] Index is up to date`；1,772 files / 27,822 nodes / 63,825 edges。中途一次 `codegraph sync` 因另一进程持有 `.codegraph` 锁（PID 18668）失败；未执行 `codegraph unlock`（避免干扰并行 Agent），稍后重试成功。
2. 查询 `codegraph_explore "MediaUrlService media.service.ts StorageService StorageSettingsConsumer presign"`（改动前）：
   - `StorageService` 30 个调用方（含 `MediaUrlService`、`MediaService`、`ReadinessService`、`AdminSystemService`、`ExportsService`）；
   - `presign` 链 `media.service.ts:80` → `storage.service.ts`；确认 `media.service.ts:110` 用 `config.storageSettings.bucket`、`media-url.service.ts:135` 调 `createSignedReadUrl(key)` 不带 bucket。
3. 查询 `codegraph_explore "StorageService currentBucket normalizedBucket createSignedReadUrl bucket argument MediaUrlService signKeys media.bucket_missing"`（改动后）：
   - 调用链：`signKeys` (`media-url.service.ts:175`) → `signedReadUrl` (`:212`) → `createSignedReadUrl` (`storage.service.ts:276`) → `normalizedBucket` (`:103`)；
   - blast radius：`StorageService` 35 个调用方；`createSignedReadUrl` 4 个调用方（`media-url`、`exports`）；`currentBucket` 2 个调用方（均在 `media.service.ts`）；`signKeys` 1 个调用方；
   - `StorageService` 单测/集成测试覆盖包含新增的 `media-bucket.spec.ts`、`media-bucket-http.e2e.mts`。
4. 结论：签名入口集中在 `StorageService.createSignedReadUrl`/`createPresignedUpload`，因此把 bucket 作为可选参数放在该层，既覆盖 media 读路径，又保持 `exports`/worker 等现有调用不变；`MediaUrlService` 是 media URL 的唯一生成点（`media.service.presentWithUrls` 之前绕过它，本次收回）。

---

## 5. 我采用的假设（bucket 共用 endpoint）与失效条件

**假设**：所有可能出现在 `Media.bucket` 里的桶都由**当前配置的同一 `endpoint` / `publicEndpoint` / region / accessKey 对**提供。

依据：`Media` 只持久化 `bucket`，没有 `endpoint`；`StorageSettingsConsumer` 只有一套 `internal/public` client；此前所有签名都用当前 client，本就隐含这个假设。

**失效条件**（出现任一即 URL 仍会 404/403，需要 `Media.endpoint` 或 bucket→endpoint 映射）：

1. 把桶迁到**不同 provider / 账号 / region**（例如 MinIO → R2）后保留旧桶读取；
2. 同一个部署内不同 bucket 配不同 `publicEndpoint`（split-horizon、按桶 CDN）；
3. 旧桶使用不同 accessKey/secretKey（签名校验失败 → 403，而非 404）；
4. `forcePathStyle` 不一致（虚拟主机式 vs path-style URL 结构不同）。

**边界**：换桶但两个桶仍在同一 endpoint、同一凭证下（本次修复目标场景）→ 旧链接可用。旧桶必须继续存在且可读；本任务不复制对象。

---

## 6. 已知风险

1. **public share-link 读取仍未带 bucket（超出可写范围，重要）**：
   - `apps/api/src/modules/share-links/share-links.service.ts` 的 `publicMediaList()`（约 :284-303）显式构造 `MediaUrlSource` 时只放 `id/key/status/variants/motion`，`coverMediaSources()`（约 :546-575）同样未放 `bucket`；
   - 结果：匿名分享页上，换桶前上传的图片/封面会走“缺 bucket 回落当前 + warn”，换桶后仍会 404；登录态 media/trip/cover 已修复；
   - 该文件不在本任务允许修改列表（`apps/api/src/modules/media/**`、`storage/**`），未越权。
2. **worker / exports 仍按当前 bucket 删除或签名**：`apps/worker` 的 media maintenance、`exports.service.ts` 的 `deleteObject`/`createSignedReadUrl` 不带 bucket；换桶后旧桶对象不会被清理（泄漏），但不会导致新 404（exports 不是 media URL）。worker 不在可写范围。
3. **节流 warn 的代价**：历史行大量存在时，60s 内只留一条聚合 warn，排障时无法看到全部 mediaId（单条带 `sampleMediaId` 与 `count`）。这是为避免日志风暴的刻意取舍。
4. **设置切换的 5s 缓存**：`StorageSettingsConsumer` 解析缓存 5s，换桶保存后新上传最多 5s 内仍可能落旧桶；此时行记录的正是旧桶，读签名一致，不会坏链，只是生效延迟。
5. **路径包含桶名**：path-style S3 的签名 URL path 一定包含 bucket（`/bucket/key`）。这是 URL 结构而非响应字段；API 响应对象仍无 `bucket` 字段。若未来改为 virtual-host 风格，URL host 会变为 `<bucket>.<endpoint>`。
6. **`deleteObject(key, bucket?)` 未加**：为避免扩大存储 API 影响面；worker 需要时再加可选参数即可。

---

## 7. 未覆盖项

- **真实 MinIO/PostgreSQL 的全量 HTTP API e2e**：本机无 Docker（`docker: command not found`）、9000 无监听、无 psql/`pg_isready`、Redis 6379 不可达；无法跑 `ROAMLOG_TEST_DATABASE_URL` 型 e2e。已用真实 SigV4 + 独立 4280 HTTP harness 代替，未做“PUT 到 MinIO 再 GET 读回”。
- public share-link（匿名）media/cover 的 bucket 传播，见 §6.1。
- worker 删除/处理链路按 `Media.bucket` 操作。
- `Media.endpoint` 列与跨 endpoint 签名。
- 旧桶对象跨桶迁移/回填（任务明确不做）。

---

## 8. 建议下一步

1. **P0 补口（建议立刻派给 share-links 负责人）**：在 `publicMediaList()` 的 `sources.push({...})` 和 `coverMediaSources()` 的 `sources.push({...})` 各加 `bucket: typeof row.bucket === "string" ? row.bucket : null`，并加一条“public share 旧 media 换桶后 URL 指向旧桶”的测试。改动 < 5 行，但决定匿名分享页是否也修好。
2. **worker**：`media`/`maintenance` 任务的 `deleteObject` 传 `Media.bucket`；需要在 `apps/worker` 的 storage 依赖接口加可选 bucket。
3. **跨 endpoint 的下一步（非本任务）**：若产品要支持“换 provider 不迁移旧对象”，加 `Media.endpoint`（需迁移）或 settings 的 bucket→endpoint 映射，并让 `StorageService` 按 bucket 选 client；当前显式 bucket 参数已为这一步留好扩展点。
4. **staging 回归**：有 MinIO/R2 的环境跑 `staging-storage.e2e-spec.ts` + 本报告的 4280 harness，并补一次“真实 PUT → 换桶 → 旧 URL GET 200”的读回证明。