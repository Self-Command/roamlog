# STORAGE_SETTINGS_WIRED — 存储设置接入对象存储客户端 + 测试连接

- 任务 ID：`STORAGE_SETTINGS_WIRED`
- 角色：backend_api + devops
- 状态：DONE（代码、单测、真实失败路径探测均完成；全量测试受并行改动污染，见 §5）
- 日期：2026-11-19（Asia/Shanghai）
- 范围：只改 `apps/api/src/modules/storage/**`、新增 `apps/api/src/modules/settings/storage-settings.consumer.ts`、对应测试与本报告。

---

## 1. 变更文件

新增：

- `apps/api/src/modules/settings/storage-settings.consumer.ts`
- `apps/api/src/modules/storage/storage-clients.ts`
- `apps/api/src/modules/storage/storage-client.factory.ts`
- `apps/api/src/modules/storage/storage-probe.service.ts`
- `apps/api/src/modules/storage/storage-admin.controller.ts`
- `apps/api/src/modules/storage/storage-settings.consumer.spec.ts`
- `apps/api/src/modules/storage/storage-client.factory.spec.ts`
- `apps/api/src/modules/storage/storage-probe.service.spec.ts`
- `apps/api/src/modules/storage/storage-admin.controller.spec.ts`

修改：

- `apps/api/src/modules/storage/storage.service.ts`（双 client 改为可由 factory 动态提供；静态构造路径保留）
- `apps/api/src/modules/storage/storage.service.spec.ts`（新增动态 public endpoint 测试）
- `apps/api/src/modules/storage/storage.module.ts`（导入 Settings/Audit、注册 controller/factory/consumer、provider 别名）

未修改（按要求只读）：`settings.service.ts`、`settings.registry.ts`、`media/**`、`apps/web/**`、`packages/**`。

---

## 2. 实现摘要（逐 4 项）

### 2.1 配置来源与优先级

`StorageSettingsConsumer.resolve()` 读取 `SettingsService.getGroup("storage")` 的 7 个键：`endpoint / publicEndpoint / bucket / region / accessKey / secretKey / forcePathStyle`。

逐键优先级：

1. `envLocked`（registry 定义或 DB 行标记）且 env 变量存在 → env；
2. DB 行存在且值非空 → DB；
3. env（含 `AppConfigService.storageSettings` 基线）→ env；
4. registry `defaultValue`（缺失时用本地兜底常量）→ default。

- 用 `SettingsService.listAdminSettings()` 的 `updatedAt` 判断“DB 行是否真的存在”，避免把 registry 默认值误当成 DB 值而压过 env（否则 rollout 时 `storage.bucket` 默认值会覆盖 `S3_BUCKET`）。
- DB/Redis/解密失败：整组回落 env，`warn storage.settings_unavailable`，不抛错、不阻塞启动。
- 存储值为空（含 secret 行已清空）：回落 env，`warn storage.setting_empty_fallback`（每个键每个进程只 warn 一次）。
- 解析结果缓存 5s（与 `SettingsService` 的进程缓存一致），`invalidate()` 供测试与探测调用。
- 版本号：`SettingsService` 没有公开版本读取方法且本任务禁止修改它，因此版本由解析后的有效值做 SHA-256（截 16 hex）得到。值不变 → 版本不变 → 复用 client；任一 endpoint/凭证/桶/region/path-style/TTL 变化 → 新版本 → 重建。跨实例无需 pub/sub，行为等价于 settings 版本号。

### 2.2 客户端按版本重建

`StorageClientFactory`：

- 持有 `{ version, internal, public, bucket, forcePathStyle, signingEndpoint, settings }`；
- 版本变化 → 先完整构建新 internal/public（真实 S3Client），成功后才赋值 `this.active`（原子替换）；
- 旧 bundle 延迟 **60s** 后 `destroy()`，`unref()` 防止拖住进程；`onModuleDestroy` 立即销毁 active + 所有待销毁 client；
- 构建失败（URL 非法、桶/region 空、accessKey/secretKey 缺失、builder 抛错）→ `warn storage.client_build_failed_keeping_previous`，继续使用旧 bundle；同一失败版本不重复重试，直到 settings 再次变化；
- 启动时若根本没有旧 client（DB 配置不可用），回退到 env 基线 client（`storage.clients_fallback_to_environment`），避免系统无桶可用；
- `StorageService` 在 Nest 下注入 factory：`createPresignedUpload` / `createSignedReadUrl` 每次取**当前** public client 与 bucket；`signingEndpoint` getter 返回当前 public endpoint。静态构造（测试/脚本）保持原行为；
- S3 client 统一 `requestChecksumCalculation: "WHEN_REQUIRED"` / `responseChecksumValidation: "WHEN_REQUIRED"`，规避 R2/旧 MinIO/B2 的 CRC32 兼容问题。

### 2.3 测试连接

`POST /v1/admin/settings/storage/test`（controller 在 storage 模块，`@UseGuards(SessionGuard, PlatformTwoFactorGuard, AdminGuard)`，`@RequireAdminAction("admin:settings:write")`，`super_admin`）。

成功 200：

```json
{ "ok": true, "checks": [{"name":"HeadBucket","ok":true,"ms":12}, ...], "bucket": "...", "endpoint": "...", "publicEndpoint": "..." }
```

失败 422（controller 用 `@Res({ passthrough: true })` 写状态，绕过 ProblemDetails 过滤器以保持该契约）：

```json
{ "ok": false, "checks": [...], "failedAt": "HeadBucket", "code": "STORAGE_ENDPOINT_UNREACHABLE", "message": "...", "bucket": "...", "endpoint": "...", "publicEndpoint": "...", "publicEndpointUnreachable": true }
```

步骤（任一步失败即停，响应不外泄密钥）：

1. `HeadBucket`
2. `PutObject` 写 `_probe/{uuid}.txt`（`text/plain`，小内容）
3. `GetObject` 读回并逐字节比对
4. 用**当前 public endpoint** 签 60s presigned GET，服务端 `fetch` 验可达（并校验 URL host == publicEndpoint）
5. `DeleteObject`；中途失败也在 `finally` 尝试清理

审计 `admin.storage.probe`，metadata 仅 `{ ok, bucket, endpoint }`；`targetId` 用随机 UUID（`AuditLog.targetId` 是 UUID 列）。审计写失败只 warn，不影响探测结果。

**publicEndpoint 不可达语义（我的判断）**：返回 `ok: false` + `code: STORAGE_PUBLIC_ENDPOINT_UNREACHABLE` + `publicEndpointUnreachable: true`。理由：设计文档 §7 要求“验签名 URL 可达”，服务端都取不到时不能给出绿色结论；代价是 split-horizon 部署（浏览器可达、API 不可达）会被误判为失败，message 已明确说明这是服务端可达性、浏览器 CORS 不在此步验证，运维可据此判断。HTTP 403 等则区分成 `STORAGE_SIGNED_READ_FAILED`，不标 unreachable。

### 2.4 明确不做

- 不迁移已有对象；不改 media 签名 URL 路由语义。
- 未改 `settings.service.ts` / `settings.registry.ts` / media 模块 / web。

---

## 3. 验证命令与结果（原始输出摘录）

### 3.1 `pnpm --filter @roamlog/api typecheck`

存储相关文件 **0 错误**；整体命令失败，错误全部来自并行改动的文件（email/reports，共 21 条）：

```text
12 src/modules/email/__tests__/mail.service.spec.ts
 5 src/modules/reports/__tests__/admin-reports.service.spec.ts
 4 src/modules/email/__tests__/mail-test.controller.spec.ts
total: 21
--- storage errors above (empty=clean) ---
```

（过滤命令：`pnpm --filter @roamlog/api typecheck 2>&1 | grep -E "modules/storage|modules/settings/storage"` → 空。）

### 3.2 `pnpm --filter @roamlog/api exec vitest run src/modules/storage`

```text
 ✓ src/modules/storage/storage-client.factory.spec.ts (5 tests)
 ✓ src/modules/storage/storage-probe.service.spec.ts (9 tests)
 ✓ src/modules/storage/storage.service.spec.ts (15 tests)
 ✓ src/modules/storage/storage-settings.consumer.spec.ts (8 tests)
 ✓ src/modules/storage/storage-admin.controller.spec.ts (3 tests)

 Test Files  5 passed (5)
      Tests  40 passed (40)
```

覆盖：DB 覆盖 env；envLocked env 胜出；DB 挂回落 env + warn；空值回落；版本不变复用 / 版本变化新 client；旧 client 用 fake timers 60s 后 destroy；构建失败保留旧 client（断言旧 client 仍在用）；无旧 client 回退 env；探测全绿 / HeadBucket 失败 / PutObject 失败 / GetObject 内容不符 / presigned fetch 不可达 / presigned 403；审计 metadata；签名 URL host == 当前 publicEndpoint；sentinel 检测 accessKey/secretKey 不出现在响应与日志。

### 3.3 `pnpm --filter @roamlog/api test`（全量）

```text
 Test Files  3 failed | 102 passed | 7 skipped (112)
      Tests  772 passed | 45 skipped (817)
```

3 个失败 suite 与本任务无关，均为并行改动中的 `AuthModule` 依赖：

```text
FAIL test/admin-routes.e2e-spec.ts
FAIL test/admin-two-factor.e2e-spec.ts
FAIL test/trip-origin.e2e-spec.ts
Error: Nest can't resolve dependencies of the AuthController (AuthService, AppConfigService, ?, PinoLoggerService).
Please make sure that the argument MailService at index [2] is available in the AuthModule module.
```

同一时间 `apps/api/src/modules/settings/mail-settings.consumer.ts`、`__tests__/mail-settings.consumer.spec.ts` 为另一 Agent 的新增未跟踪文件，`modules/email/**` 也在改动中。存储相关 5 个 suite 全绿。

### 3.4 真实探测（失败路径）

本机没有 MinIO/Docker；用专用临时数据库 + Redis stub 启动真实 API（端口 4100），`S3_ENDPOINT=S3_PUBLIC_ENDPOINT=http://127.0.0.1:19999`（无监听），以 `super_admin` 会话调用真实路由：

```text
POST /v1/admin/settings/storage/test
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/json; charset=utf-8

{"bucket":"roamlog-probe","endpoint":"http://127.0.0.1:19999","publicEndpoint":"http://127.0.0.1:19999","ok":false,"checks":[{"name":"HeadBucket","ok":false,"ms":42}],"failedAt":"HeadBucket","code":"STORAGE_ENDPOINT_UNREACHABLE","message":"The endpoint could not be reached (ECONNREFUSED). Check the endpoint, DNS, TLS and the container network."}
```

- sentinel 检查：`S3_ACCESS_KEY=AKIA_SENTINEL_ACCESS`、`S3_SECRET_KEY=SENTINEL_SECRET_VALUE`，响应与日志均无这两个值（`secretInResponse=false` / `secretInLogs=false`）。
- 审计行（数据库实测）：

```json
{
  "action": "admin.storage.probe",
  "targetType": "storage",
  "targetId": "237daa25-898f-47e0-906b-e68649a21993",
  "metadata": { "ok": false, "bucket": "roamlog-probe", "endpoint": "http://127.0.0.1:19999" },
  "actorType": "admin"
}
```

- 该 API 的 `/v1/ready` 同时显示 `storage: down`，但进程正常服务（优雅失败）。
- 成功后清理：临时数据库 `storage_probe` 已 DROP，API/Redis stub 进程已停止，临时脚本已删除。
- 未做 MinIO 成功路径（本机无 Docker/MinIO，任务标注可选）。

---

## 4. CodeGraph 证据

1. `codegraph status`（`roamlog/`）→ `[OK]`：1,632 files / 25,182 nodes / 56,458 edges，索引 up to date。
2. `codegraph_explore "StorageModule StorageClientFactory S3 client internal public endpoint presign MediaUrlService"`：
   - 明确返回 `StorageClientFactory` **不存在**于索引（“Not in the index”）——本任务首次引入；
   - `StorageModule`（`apps/api/src/modules/storage/storage.module.ts:19`，5 个 AppModule 调用方）；
   - `StorageService`（`storage.service.ts:128`，27 个调用方，含 `MediaUrlService`、`MediaService`、`ReadinessService`、`AdminSystemService`、`ExportsService`）；
   - `presign` 调用链（`media.service.ts:69` → `storage.service.ts:158`），确认双 client 与 `publicEndpoint` 的现状。
3. `codegraph_explore "SettingsService getGroup settings registry version cache envLocked storage keys"`：
   - `getGroup`（`settings.service.ts:183`）、`SETTINGS_CACHE_VERSION_KEY`（`:44`）、`bumpCacheVersion`（`:676`）、`readCacheVersion`（`:632`，private，无公开版本 API）；
   - registry 7 个 `storage.*` 定义（`settings.registry.ts:329-405`，全部 `envLocked:false`，无 `envVar`）；
   - `StorageSettings`（`config/storage-settings.ts`）与双 endpoint 注释。

这两条查询直接决定了：新增 factory 而非改 `StorageService` 调用方、用 `listAdminSettings().updatedAt` 识别 DB 行、以及用内容派生版本而不再依赖 settings 版本 API。

---

## 5. 已知风险

1. **换桶对旧对象的影响（重要，超出本任务可写范围）**：`media.service.ts:99` 在创建 Media 行时写的是 **env** 的 `config.storageSettings.bucket`；`MediaUrlService` 对所有行都用**当前** bucket 签名，没有把 `Media.bucket` 传下去。结果是：后台把桶改成 DB 值后，新上传签名到新桶，但 Media 行仍记录 env 桶；旧对象签名也指向新桶（404），而不是各自的 `Media.bucket`。这需要 media 模块后续改动（本任务只允许 storage 目录，未越权）。本次改动已让 `StorageService` 使用当前配置，但端到端“旧对象仍按各自 Media.bucket 读”尚未接线。
2. **publicEndpoint 不可达采用 fail-closed**（见 §2.3）：split-horizon 部署可能被误判；message 已解释服务端可达性与 CORS 边界。
3. **5s 解析缓存**：保存后最多 5s 才切新 client（探测会先 `invalidate` 立即生效）。多实例下每实例各自 5s 内切换，窗口内可能短暂不一致。
4. **registry 的 storage 键目前 `envLocked:false`**：env 锁定机制已实现并有测试，但生产上不会触发；若要“迁移期 S3_* 仍优先”，需 settings 负责人在 registry 把对应键改成 `envLocked:true` 并补 `envVar`（本任务禁改）。
5. **DB 行显式清空 publicEndpoint 时会回落 env**（按“值为空 → env”规则）；若 `S3_PUBLIC_ENDPOINT` 已配置，管理员无法用“清空”把 public endpoint 恢复为“复用内部 endpoint”，只能删除 env。
6. **旧 client 60s 销毁**：超过 60s 的在途请求（大文件流式上传/下载）可能用到已 destroy 的 client。当前 API 的 presign 是短请求，风险低；长流式传输后续应改为引用计数。
7. **探测无请求体覆盖**：只测“当前生效配置”，不支持“保存前用未落库的值试连”。真正的“保存失败则保留旧配置”还需要 settings 更新端点先调用本探测（该端点不在本任务可写范围）。
8. 探测第 4 步服务端 fetch 不能验证浏览器 CORS；设计文档要求的浏览器侧第 5/6 步未在本端点内实现。

## 6. 未覆盖项

- 无真实 MinIO/R2/B2/Wasabi 成功路径（本机无 Docker/MinIO，任务标注可选）。
- 未做浏览器侧 presigned PUT + CORS 预检（需要 admin UI 配合；web/admin 不在范围）。
- 未做 `Media.bucket` 读取接线（media 模块不在范围）。
- 未改 settings registry / settings update 流程（禁止）。

## 7. 建议下一步

1. media 模块：`MediaService.presign` 用 `StorageService` 的当前 bucket 落库；`MediaUrlService.sign` 把 `Media.bucket` 传入 `createSignedReadUrl(key, ttl, bucket)`，并给 `StorageService` 增加可选 bucket 参数（本任务已保留静态/动态双路径，易于扩展）。
2. settings 更新流程：在写入 `storage.*` 前调用 `StorageProbeService.run()`，失败返回 422 且不落库，真正实现“失败保留旧配置”。
3. 在后台 UI 接 `/v1/admin/settings/storage/test`，按 check 列表逐步展示；publicEndpoint 失败时明确提示“服务端不可达，可能仍可用浏览器验证”。
4. 有 MinIO 的环境补一次成功路径（5 checks 全绿）与 R2/B2/Wasabi 的 `forcePathStyle`/`WHEN_REQUIRED` 实测。