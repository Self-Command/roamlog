# SHARE_BUCKET_PROPAGATION — 匿名分享页按行 bucket 签名

- 任务 ID：`SHARE_BUCKET_PROPAGATION`
- 角色：backend_api
- 状态：**DONE**
- 日期：2026-11-19（Asia/Shanghai）
- 范围：只改 `apps/api/src/modules/share-links/**` 与 `apps/api/src/modules/share-links/__tests__/**`，另加本报告。
- 并行约束：未触碰 `apps/api/src/modules/{trips,packing,money,exports,media,storage,settings,admin}/**`、`apps/web/**`、`apps/admin/**`、`apps/worker/**`、`packages/**`、`e2e/**`、`docs/**`；未改 Prisma schema、未生成迁移、未改公开 payload 字段集合。

---

## 1. 变更文件

修改：

- `apps/api/src/modules/share-links/share-links.service.ts`
  - `publicMediaList()`：构造 `MediaUrlSource` 时带上该行的 `bucket`
  - `coverMediaSources()`：构造 `CoverMediaSource` 时带上该行的 `bucket`
  - 新增私有辅助 `rowBucket(value: unknown): string | null`

新增：

- `apps/api/src/modules/share-links/__tests__/public-bucket.spec.ts`（9 条单测，含换桶回归）
- `apps/api/src/modules/share-links/__tests__/share-public-bucket-http.e2e.mts`（4330 端口真实 HTTP harness，非单测）
- `.audit/share-bucket-report.md`（本报告）

未修改：`share-links.repository.ts`（其 `include: { media: { include: { motion: true } } }` 已是整行读取，`bucket` 本来就到达 service，无需改查询）、controller/module/guard、`MediaUrlService`、`StorageService`、worker、exports、web/admin、contracts、packages。

---

## 2. 实现摘要

### 2.1 两处传播（本次修复）

`publicMediaList()`（`share-links.service.ts:284-334`）在把数据库行收窄成 `MediaUrlSource` 时补：

```ts
bucket: rowBucket(record.bucket),
```

`coverMediaSources()`（`share-links.service.ts:550-582`）在把候选封面行收窄成 `CoverMediaSource` 时补：

```ts
bucket: rowBucket(row.bucket),
```

辅助函数（`share-links.service.ts:596`）：

```ts
function rowBucket(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
```

- 类型安全：`unknown` 进、`string | null` 出，无 `as`、无隐式 any；`CoverMediaSource extends MediaUrlSource`，`bucket?: string | null` 已由 `media-url.service.ts:18-30` 定义。
- 不改签名/URL 生成逻辑：`MediaUrlService.signMany()` 用 `record.bucket` 决定签名 bucket（已在 `MEDIA_BUCKET_P0` 修好），本次只是把数据传对。
- 空 / `null` / 纯空白 bucket：`rowBucket` 返回 `null`，`MediaUrlService.bucketFor()` 回落到当前配置 bucket 并发一条节流 `media.bucket_missing` warn；没有改这套既有的降级语义。
- 公开 payload 字段集合未动：`PublicMedia` 仍是严格的 `id/url/thumbUrl/expiresAt/width/height/blurhash/caption/date/location/livePhoto/motion`；`bucket` 只进了签名器，没进响应。

### 2.2 第三、第四处：签名 URL 构造点全表

命令：

```text
rg -n "createSignedReadUrl|signKeys|signedReadUrl|MediaUrlSource|mediaUrlService|signMany" apps/api/src --glob '!**/*.test.*'
rg -n "\.sign\(|\.signMany\(|\.signKeys\(" apps/api/src --glob '!**/*.test.*'
rg -n "createSignedReadUrl|createPresignedUpload|deleteObject|MediaUrlSource|mediaUrlService" apps/worker/src
```

| 文件:行 | 用途（登录页 / 公开页 / worker / export） | 是否带 bucket | 本次是否修改 |
| --- | --- | --- | --- |
| `apps/api/src/modules/media/media-url.service.ts:92-95`（`sign`） | 单行签名，登录页 media 详情 / motion 读取的入口 | 是（转调 `signMany` → `bucketFor`） | 否（`MEDIA_BUCKET_P0` 已修） |
| `apps/api/src/modules/media/media-url.service.ts:102-165`（`signMany`） | 批量签名核心；每个对象以 `record.bucket` 为签名 bucket，按 `bucket+key` 去重 | 是（`entry.bucket`，:129） | 否 |
| `apps/api/src/modules/media/media-url.service.ts:175-186`（`signKeys`） | 一行媒体所有 variant + motion 同批签名（登录页列表/完成/更新投影） | 是（`bucketFor(media)`，:183） | 否 |
| `apps/api/src/modules/media/media-url.service.ts:212-219`（`signedReadUrl`） | 真正调用 `StorageService.createSignedReadUrl(key, undefined, bucket)` | 是（显式第 3 参） | 否 |
| `apps/api/src/modules/storage/storage.service.ts:276-299` | 签名原语，`bucket` 可选，空则当前配置 | n/a（消费方决定） | 否 |
| `apps/api/src/modules/media/media.service.ts:437` | 登录页 `GET /media/:id`（`sign(media)`，`MediaRecord` 含 bucket） | 是 | 否 |
| `apps/api/src/modules/media/media.service.ts:659` | 登录页 media 投影（`signKeys(record, keys)`，含所有 variant + motion） | 是 | 否 |
| `apps/api/src/modules/media/media.service.ts:699` | 登录页 motion 写入后的读取（`sign(withMotion)`） | 是 | 否 |
| `apps/api/src/modules/media/trip-cover.service.ts:88` | 封面投影器，登录页与公开页共用；bucket 取决于 loader 传入的行 | 是（当 loader 把行原样传入时） | 否（改的是公开页 loader，见下两行） |
| **`apps/api/src/modules/share-links/share-links.service.ts:312`**（`signMany(sources)`） | **公开页图库**；源在 **:303** 现在带 `bucket: rowBucket(record.bucket)` | **修复后：是** | **是** |
| **`apps/api/src/modules/share-links/share-links.service.ts:575`**（`coverMediaSources` push） | **公开页封面 loader**；`bucket: rowBucket(row.bucket)` | **修复后：是** | **是** |
| `apps/api/src/modules/exports/exports.service.ts:160` | **export 下载**（登录页）：`createSignedReadUrl(record.storageKey ?? "")`，未传 bucket；`Export` 模型也没有 bucket 列（`packages/db/prisma/schema.prisma:918-941`） | **否** | **否（不在本任务范围）** |
| `apps/worker/src/dependencies.ts:97` | worker 删除对象：`DeleteObjectCommand({ Bucket: bucket })`，bucket 来自 `S3_BUCKET` 环境变量 | **否（当前/环境 bucket）** | 否（禁止触碰） |
| `apps/worker/src/jobs/media.ts:355` | worker 媒体清理：`deps.storage.deleteObject(key)`，无 bucket | **否** | 否（禁止触碰） |
| `apps/worker/src/jobs/maintenance.ts:42` | worker 过期导出清理：`deleteObject(record.storageKey)`，无 bucket | **否** | 否（禁止触碰） |
| `apps/worker/src/jobs/maintenance.ts:71` | worker 软删媒体对象清理：`deleteObject(key)`，无 bucket | **否** | 否（禁止触碰） |
| `apps/api/src/modules/exports/exports.service.ts:181` | export 历史删除：`deleteObject(record.storageKey)`，无 bucket | **否** | 否（不在范围） |
| `apps/api/src/modules/storage/storage.service.ts:301-311` | `deleteObject(key)` 不含 bucket 参数，固定用当前 bundle bucket | **否** | 否 |

结论：

- **公开页两处（图库 + 封面）是仅有的缺口，已修复。**
- **worker 没有“签名”调用**（只有 `deleteObject`）；**exports 有签名调用且确实没带 bucket**，是本次发现的真实第三处，但按并行约束未改。
- 登录页三条签名路径（media detail / media presenter / motion read）都通过 `MediaUrlService` 拿到整行 `MediaRecord.bucket`，无缺口。

---

## 3. 验证命令与结果（原始输出）

### 3.1 `pnpm --filter @roamlog/api typecheck`

```text
$ tsc --noEmit
[exit 0]
```

过滤本模块：

```text
pnpm --filter @roamlog/api typecheck 2>&1 | grep -E "modules/share-links"
NO share-links errors
```

（含新增的 `.spec.ts` 与 `.e2e.mts` 一起过了 `tsc --noEmit`。）

### 3.2 `pnpm --filter @roamlog/api exec vitest run src/modules/share-links`

```text
 RUN  v5.1.0 C:/Users/BY9700/Desktop/UI/roamlog/apps/api

 ✓ src/modules/share-links/__tests__/public-bucket.spec.ts (9 tests) 29ms
 ✓ src/modules/share-links/__tests__/share-links.module.spec.ts (1 test) 248ms
 ✓ src/modules/share-links/__tests__/public-payload.spec.ts (10 tests) 24ms
 ✓ src/modules/share-links/__tests__/public-cover.spec.ts (11 tests) 22ms
 ✓ src/modules/share-links/__tests__/public-trip-bundle.spec.ts (11 tests) 16ms

 Test Files  5 passed (5)
      Tests  42 passed (42)
```

原有 33 条（9+1+10+11+11 中的既有部分 = 1+10+11+11+? 见下）全绿；新增 9 条后共 42 条。匿名可访问性由 `readPublic()` 既有用例（无密码 / 带密码 / 过期 / 撤销 / 跨租户）继续覆盖，未被改动。

新增 9 条覆盖：

1. 图库 media 的签名 URL path 含行 bucket A，不含当前 bucket B；
2. Live Photo motion URL 同样用行 bucket A；
3. 封面 URL/thumbUrl 用封面行自己的 bucket A；
4. 无 bucket 行回落当前 bucket B，且产生 `MEDIA_BUCKET_MISSING` warn（不抛）；
5. `it.each([null, "", "   "])` 三种空值都回落当前 bucket；
6. **换桶回归**：行 bucket=A、当前配置=B（写入后切 B）→ 图库/封面/封面缩略图全部指向 A，且整个 payload 不含 `/roamlog-bucket-b/`；
7. 公开 payload 结构边界：`PublicMedia` 键集合严格等于 12 个允许键，`bucket/storageKey/variants/moderatedAt/workspaceId/key` 均不出现在对象上，`storageKey` 字段值不出现在序列化结果中。

### 3.3 回归保险的“删除即红”证明（变异测试）

临时删掉两行传播（备份后 `sed` 删除，跑完 `trap` 恢复），只跑回归用例：

```text
--- mutation: bucket propagation lines removed ---
(no propagation left in mutated file)

Expected: "/roamlog-bucket-a/"
Received: "/roamlog-bucket-b/ws/2026/11/media/large.webp"

 ❯ src/modules/share-links/__tests__/public-bucket.spec.ts:282:42
 Test Files  1 failed (1)
      Tests  1 failed | 8 skipped (9)
[restored]
```

恢复后 `git diff` 仅剩预期 20 行新增，`rg -n "bucket: rowBucket"` 命中 :303 与 :575，测试重新全绿（见 3.2）。

### 3.4 真实 HTTP（独立端口 4330）

本机没有 PostgreSQL / Redis / MinIO / Docker（5432、6379、9000 均无监听，无 `psql`/`pg_isready`），无法用真实 schema 播种；因此按任务允许的替代方案：**真实 Nest HTTP 栈**（`PublicShareController` + `ShareLinksService` + 真实 `StorageService` 真实 SigV4），只把 Workspace 仓库换成内存实现，`bucket` 由 storage client provider 动态切换（与 admin 保存 `storage.bucket` 后 `StorageClientFactory` 的取法一致）。

命令：

```text
cd apps/api && node --import tsx src/modules/share-links/__tests__/share-public-bucket-http.e2e.mts
```

原始输出（URL 保留 host、bucket path 与签名查询串）：

```text
Public-share bucket harness listening on http://127.0.0.1:4330

## step 1 — public share while the configured bucket is A
{
  "mediaUrl": "https://media.example.test/roamlog-bucket-a/ws/2026/11/media/large.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=access%2F20261119%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261119T080729Z&X-Amz-Expires=900&X-Amz-Signature=59dcf18402087c8040ce6336d2557a9bbbedf0024776f4dbcd59f8d58ce8b5fb&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject",
  "coverUrl": "https://media.example.test/roamlog-bucket-a/ws/2026/11/media/large.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=access%2F20261119%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261119T080729Z&X-Amz-Expires=900&X-Amz-Signature=59dcf18402087c8040ce6336d2557a9bbbedf0024776f4dbcd59f8d58ce8b5fb&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject"
}
  path prefix OK: /roamlog-bucket-a/
  path prefix OK: /roamlog-bucket-a/

## step 2 — switch the configured bucket
{
  "bucket": "roamlog-bucket-b"
}

## step 3 — public share after the switch
{
  "mediaUrl": "https://media.example.test/roamlog-bucket-a/ws/2026/11/media/large.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=access%2F20261119%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261119T080729Z&X-Amz-Expires=900&X-Amz-Signature=59dcf18402087c8040ce6336d2557a9bbbedf0024776f4dbcd59f8d58ce8b5fb&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject",
  "coverUrl": "https://media.example.test/roamlog-bucket-a/ws/2026/11/media/large.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=access%2F20261119%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261119T080729Z&X-Amz-Expires=900&X-Amz-Signature=59dcf18402087c8040ce6336d2557a9bbbedf0024776f4dbcd59f8d58ce8b5fb&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject",
  "quotedBucketField": false
}
  path prefix OK: /roamlog-bucket-a/
  path prefix OK: /roamlog-bucket-a/
  path prefix OK: /roamlog-bucket-a/
  no URL falls back to /roamlog-bucket-b/

## step 4 — legacy row without a bucket falls back to B
{
  "mediaUrl": "https://media.example.test/roamlog-bucket-b/ws/2026/11/media/large.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=access%2F20261119%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261119T080729Z&X-Amz-Expires=900&X-Amz-Signature=ffc65c2645a69ff12bcf60d0674af70c842510680fb24bff5c8176805375aab5&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject"
}
  path prefix OK: /roamlog-bucket-b/
  path prefix OK: /roamlog-bucket-b/

ALL FOUR PUBLIC-SHARE BUCKET STEPS PASSED
```

要点：

- `GET /v1/public/trips/{token}` 走真实路由、全局前缀、controller、`PublicShareResponseSchema` 严格解析；
- 换桶后响应里 media/thumb/cover 全部是 `/roamlog-bucket-a/`，没有一条 URL 回落 `/roamlog-bucket-b/`；
- 响应对象没有 `bucket` 字段（`quotedBucketField: false`）；
- 历史行（无 bucket）仍回落当前 B，符合既有降级。

限制：该 harness 用内存仓库替代 PostgreSQL（本机无 DB），stub 仅替换仓库与 storage client provider；签名是真实 SigV4，未连接 MinIO（无 MinIO）。

### 3.5 `pnpm --filter @roamlog/api test`（全量）

```text
 Test Files  1 failed | 118 passed | 7 skipped (126)
      Tests  2 failed | 925 passed | 16 skipped (943)
```

失败仅 `test/trip-origin.e2e-spec.ts` 两条（`expected 500 to be 201`），与 `MEDIA_BUCKET_P0` 报告中记录的并行 `trips`/`DESTINATIONS_UPGRADE`（`packages/contracts`、`packages/db` 迁移 0010）在途改动一致，与本任务无关。`apps/api/src/modules/share-links` 全绿。

---

## 4. CodeGraph 证据

```text
cd roamlog && codegraph status
→ [OK] Index is up to date （1,773 files / 27,826 nodes / 63,869 edges）

codegraph_explore("share-links publicMediaList coverMediaSources MediaUrlSource bucket",
                  projectPath=C:\Users\BY9700\Desktop\UI\roamlog)
→ publicMediaList (share-links.service.ts:284)，1 caller（publicPayload），
  tests: public-cover.spec.ts / public-payload.spec.ts / +1
→ coverMediaSources (share-links.service.ts:546)，1 caller（resolveCover），
  修复前 “no tests found within 3 caller hops”
→ MediaUrlSource (media-url.service.ts:18)，10 callers，含 share-links.service.ts
→ noteMissingBucket (media-url.service.ts:197)，1 caller，由 media-url.service.spec.ts 覆盖
→ 关系图确认 publicMediaList → mediaUrlSigner().signMany，coverMediaSources → CoverMediaSource
```

CodeGraph 直接指出 `coverMediaSources` 当时无任何测试覆盖；本次为其补了封面 bucket 传播与换桶回归。

---

## 5. 已知风险（交给根 Agent 的待办）

1. **worker 删除仍用当前/环境 bucket → 旧桶对象不会被清理（泄漏，不是坏链）**
   - `apps/worker/src/dependencies.ts:97` 的 `deleteObject` 固定 `S3_BUCKET`；
   - `jobs/media.ts:355`、`jobs/maintenance.ts:42,71` 不传 bucket；
   - `StorageService.deleteObject()` 也不接受 bucket 参数；
   - 后果：换桶后软删媒体/过期导出在旧桶留下的对象永远删不掉，无 404、无用户可见错误，只是存储泄漏。
   - 修复需要 `DeleteObject(key, bucket?)` + worker 读取行的 `bucket`（media 有列），属 worker/storage 任务，本次按约束未改。

2. **export 下载/删除仍用当前 bucket**
   - `exports.service.ts:160` 签名未带 bucket，`Export` 模型也没有 bucket 列；
   - 后果：换桶前生成的导出文件，换桶后下载 404（坏链），删除也删不到旧桶对象；
   - 修复需要 `packages/db` 迁移加 `Export.bucket`，属 exports/db 任务。

3. 公开页 URL 的路径里必然出现 bucket 名（path-style S3）。这是签名 URL 的固有属性，不是字段泄漏；安全边界仍是“响应对象不出现 `bucket/storageKey/variants` 字段”，由 3.2 的结构断言与严格 schema 保证。

4. 匿名分享页仍依赖 `MediaUrlService` 的节流 warn 发现历史空 bucket 行；本次新增测试已断言该 warn 会触发。

---

## 6. 未覆盖项

- 未在真实 PostgreSQL schema + 真实 MinIO 上跑匿名分享页（本机无 DB/MinIO/Docker），以 4330 端口真实 Nest HTTP + 真实 SigV4 代替，仓库层为内存实现。
- 未覆盖非 media 的其它签名对象（export）的换桶行为；已列入待办。
- 未改公开 payload 字段集合（任务要求），因此 `bucket` 不会暴露给访客，也无法从响应判断对象所在桶——只能从 URL path 观察，符合既有安全边界。

## 7. 建议下一步

1. 开一个 worker/storage 任务：`StorageService.deleteObject(key, bucket?)` + worker 用行的 `bucket` 删除（修泄漏）。
2. 开一个 exports/db 任务：`Export.bucket` 列 + 下载签名传行 bucket（修坏链）。
3. 在合并窗口用真实 PostgreSQL + MinIO 重跑 3.4 的四个步骤，作为发布前最终证据。