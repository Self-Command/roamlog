# API_READ_SHAPE report — API runtime reads now satisfy the new read contract

- 状态: DONE (with one contract-vs-runtime gap reported as uncovered)
- 任务 ID: API_READ_SHAPE
- 仓库: `C:\Users\BY9700\Desktop\UI\roamlog`
- 时间: 2026-11-18

## 变更文件

| 文件 | 类型 |
|---|---|
| `apps/api/src/modules/trips/content-presenters.ts` | 修改 |
| `apps/api/src/modules/trips/__tests__/content-presenters.spec.ts` | 新增 |
| `apps/api/src/modules/media/media-url.service.ts` | 新增 |
| `apps/api/src/modules/media/media.module.ts` | 修改（provider + export） |
| `apps/api/src/modules/media/__tests__/media-url.service.spec.ts` | 新增 |
| `apps/api/src/modules/share-links/share-links.service.ts` | 修改 |
| `apps/api/src/modules/share-links/share-links.module.ts` | 修改（import MediaModule） |
| `apps/api/src/modules/share-links/__tests__/public-payload.spec.ts` | 新增 |
| `.audit/api-read-shape-report.checkpoint.md` / `.audit/api-read-shape-report.md` | 报告 |

没有触碰：`packages/contracts/**`、`packages/api-client/**`、`packages/db/**`、`apps/web/**`、`apps/admin/**`、`app.module.ts`、`apps/api/test/**`、compose/deploy、lockfile、其他 `.audit` 文件。
（工作区里 `apps/api/src/app.module.ts`、`apps/api/src/modules/places/**`、`apps/api/test/admin-audit-uuid-compat.e2e-spec.ts` 的改动是其他 Agent 的，不是我改的。）

`git diff --stat`（仅我的已跟踪文件）：

```
 apps/api/src/modules/media/media.module.ts           |   5 +-
 apps/api/src/modules/share-links/share-links.module.ts |   3 +-
 apps/api/src/modules/share-links/share-links.service.ts | 121 +++++++++++++++++----
 apps/api/src/modules/trips/content-presenters.ts     |  46 +++++++-
 4 files changed, 147 insertions(+), 28 deletions(-)
```

## 实现摘要

### 1. `content-presenters.ts`（Trip / Stop 读投影）
- `presentTrip` 用契约自带的 `tripDurationDays(startDate, endDate)` 计算 `durationDays`（含首尾，与 `TripSchema.superRefine` 的校验完全同源，不存在第二个算法）。
- 新增可选输入 `originLat? / originLng? / originCountryCode? / timeZone?`，输出缺省 `null`：W0_DB 的 `0003` 迁移落地、Prisma client 重新生成后，`presentTrip(prismaTrip)` 自动透传，不需要再改一次 presenter；迁移未落地时是诚实的 `null`，不填假坐标。
- `cover: null`。真实封面投影需要签名封面媒体，属于后续独立任务；`coverMediaId` 保留存储引用，不伪造 `url/thumbUrl`。
- `presentStop` 新增可选 `provider? / providerPlaceId? / timeZone?`，缺省 `null`；有值则原样透传，非法 provider（如 `"manual"`）会被契约枚举拒绝而不是被猜测成 `photon`。
- 输入类型导出为 `PresentTripInput` / `PresentStopInput`，测试与调用方不再需要 `as never`。

### 2. `MediaUrlService`（可复用的签名读取服务）
- 复用既有能力：CodeGraph 先查了 `signedUrl|presign|getSigned`，命中 `apps/api/src/modules/storage/storage.service.ts:createSignedReadUrl`（`@aws-sdk/s3-request-presigner`，配置来自 `AppConfigService.storageSettings` + `EXPORT_SIGNED_URL_TTL`）。**没有新建 S3 client、没有新配置项**。
- `sign()` / `signMany()` 只签两个 key：`url` 优先 `large` → `original` → 存储原始 key；`thumbUrl` 优先 `thumb` → 显示 key。整批按 object key 去重（同一张图同时出现在 trip gallery 和 entry 里只签一次）。
- 返回值只有 `{ url, thumbUrl, expiresAt }`：**不带 bucket、object key、raw variants**。`expiresAt` 取两条 URL 中最早的过期时间（保守且真实）。
- 非 `ready` 或没有 object key 的行返回 `{url:null,thumbUrl:null,expiresAt:null}`；签名失败（S3 不可用、非法 key）直接抛出，不降级成“没有图片”。
- `MediaModule` 增加 provider 与 export，供 share-links 注入。

### 3. `share-links` 公开读响应
- `publicPayload` 变为异步：先批量签名 `bundle.media`，再投影。
- `trip` 增加 `durationDays`（`tripDurationDays`）与 `cover: null`（未引入假封面）。
- `publicMedia` 重写为契约形状 `{id,url,thumbUrl,expiresAt,width,height,blurhash,caption,date,location}`，删除 `variants/bucket/key`。
- **未 ready / 无 URL / 无 object key 的媒体在进入响应前被过滤**（entry 内嵌 media 与顶层 media 同一份投影，entry 随顶层过滤结果裁剪），视频/待处理图不会以空字符串或假链接出现在公开页。
- 无媒体时 `media: []` 正常返回，不再调用签名。
- 鉴权/错误码未变：`SHARE_LINK_NOT_FOUND`、`SHARE_PASSWORD_REQUIRED`、`SHARE_PASSWORD_INVALID` 的逻辑与顺序原样保留；没有新增 try/catch 吞错。

### 4. 一处刻意的构造签名取舍（需要 root 知悉）
`apps/api/test/collab-share.e2e-spec.ts` 用 5 个参数 `new ShareLinksService(...)`，该文件不在本任务可写范围。为了让 `tsc --noEmit`（会编译 `test/**`）保持绿色，第 6 个参数 `mediaUrls` 在 **TypeScript 层面声明为可选**，但装饰器仍是 `@Inject(MediaUrlService)`，Nest 会按 token 注入并在缺少 provider 时于启动期失败；若真的拿不到实例而又有媒体需要签名，会抛出明确错误（不是返回假 URL）。真正修法是给该 e2e spec 补第 6 参，属于测试 owner 的后续工作。

## 验证命令与结果

### `pnpm --filter @roamlog/api typecheck`
最终结果（本任务收尾时复跑）：
```
$ tsc --noEmit
TYPECHECK_EXIT=0
```
零错误、退出码 0，包含 `test/**`（也就是 5 参构造的 `collab-share.e2e-spec.ts`）与新增的 3 个 spec。

过程中出现过的一条错误与我的改动无关，仅作留痕：第一次跑时 `src/modules/places/__tests__/place-fixtures.ts(6,17): error TS2742`（`makeLogger` 推断类型引用了 vitest 内部 chunk）。`git ls-files apps/api/src/modules/places` 为空、`git status` 显示 `?? apps/api/src/modules/places/`，是另一 Agent 当时未提交的 places 模块；其 owner 修好后已消失。除那条外全程零错误。

### `pnpm --filter @roamlog/api exec vitest run src/modules/trips src/modules/share-links src/modules/media`
```
 ✓ src/modules/media/__tests__/media-url.service.spec.ts (8 tests)
 ✓ src/modules/share-links/__tests__/public-payload.spec.ts (5 tests)
 ✓ src/modules/trips/__tests__/content-presenters.spec.ts (8 tests)
 ✓ src/modules/media/__tests__/media-rules.spec.ts (4 tests)

 Test Files  4 passed (4)
      Tests  25 passed (25)
```

### 回归：既有 share-links e2e（纯 fake，不需 DB）
```
pnpm --filter @roamlog/api exec vitest run test/collab-share.e2e-spec.ts
 Test Files  1 passed (1)
      Tests  4 passed (4)
```
（该 spec 的 fake media 没有 `key/status`，正好走到“无 URL → 过滤”的分支，仍然通过，说明过滤逻辑没有把响应搞崩。）

### Lint（只跑我改的文件）
```
eslint src/modules/trips/content-presenters.ts src/modules/trips/__tests__/content-presenters.spec.ts \
  src/modules/media/media-url.service.ts src/modules/media/media.module.ts \
  src/modules/media/__tests__/media-url.service.spec.ts \
  src/modules/share-links/share-links.service.ts src/modules/share-links/share-links.module.ts \
  src/modules/share-links/__tests__/public-payload.spec.ts
→ (no output, exit 0)
```

## 截图/日志/接口证据（脱敏，真实代码输出）

用 `tsx` 直接实例化 `ShareLinksService` + `MediaUrlService`（fake repository、fake storage，签名 URL 用 `cdn.example.test` 占位），公开读响应：

```json
{
  "trip": {
    "id": "01942f30-1200-7000-8000-000000000003",
    "title": "Seoul, slowly",
    "summary": "A week of food, trains, and rain.",
    "status": "active",
    "startDate": "2026-11-10",
    "endDate": "2026-11-18",
    "durationDays": 9,
    "coverMediaId": null,
    "cover": null,
    "origin": "Shanghai",
    "destinations": ["Seoul"],
    "countryCodes": ["KR"],
    "tags": ["food"]
  },
  "media": [
    {
      "id": "01942f30-1200-7000-8000-000000000010",
      "url": "https://cdn.example.test/ws/2026/11/media/large.webp?X-Amz-Signature=REDACTED",
      "thumbUrl": "https://cdn.example.test/ws/2026/11/media/thumb.webp?X-Amz-Signature=REDACTED",
      "expiresAt": "2026-11-18T12:00:00.000Z",
      "width": 1200,
      "height": 800,
      "blurhash": "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
      "caption": "Euljiro at dusk",
      "date": "2026-11-11",
      "location": "Seoul"
    }
  ]
}
```
同一 bundle 里的 `status: "processing"` 媒体被过滤掉；`variants/bucket/key` 已不在响应中。

`GET /v1/trips/:id` 侧（`presentTrip` 直接输出）：

```json
"durationDays": 9,
"coverMediaId": "01942f30-1200-7000-8000-000000000010",
"cover": null,
"originLat": null, "originLng": null, "originCountryCode": null, "timeZone": null
```
（`coverMediaId` 已设置时 `cover` 仍为 `null`：这是诚实投影，不是“封面丢失”。）

`GET /v1/trips/:id/stops` 侧：

```json
"provider": null, "providerPlaceId": null, "timeZone": null
```

## CodeGraph 证据

1. `codegraph status` → `[OK] Index is up to date`（1,339 files / 19,718 nodes / 41,594 edges），满足强制前置门禁。
2. `codegraph_explore "presentTrip presentStop publicPayload publicMedia"` → 命中 48 symbols / 7 files，给出 blast radius：`presentStop` 5 callers（`stops.service.ts`）、`publicMedia` 1 caller（`share-links.service.ts`）、`publicPayload → PublicTripBundle → PublicTripResponse`；并直接读到 `content-presenters.ts:20-84`、`share-links.service.ts:189-247`、`share-links.repository.ts:22-28` 的当前源码。
3. `codegraph explore "signedUrl presign getSignedUrl S3Client media variants"` → 命中 `StorageService.createSignedReadUrl` / `createPresignedUpload`（`storage.service.ts:144`）与 `MediaService.presign`，据此决定**复用** `StorageService`，未新建 S3 客户端（避免重复造签名能力）。
4. `codegraph explore` 结果中 `instantiates: setup → ShareLinksService` 直接暴露出 `apps/api/test/collab-share.e2e-spec.ts:65` 的 5 参构造，这是第 4 节取舍的依据。

## 已知风险

1. **构造签名取舍**：`ShareLinksService` 第 6 参在 TS 层可选（原因见上）。生产 DI 正常；只有绕过 Nest 手工 `new` 的代码可能缺少 signer，此时会显式抛错。修法：给 `apps/api/test/collab-share.e2e-spec.ts` 补一个 `new MediaUrlService(fakeStorage)`。
2. **presenter 仍用 `...record` 展开整行 + `.strict()`**：W0_DB 计划新增的列（originLat/originLng/originCountryCode/timeZone、provider/providerPlaceId/timeZone）已全部在契约内，安全；但未来任何**未进契约**的新 Trip/Stop 列都会让 `parse` 抛错。建议后续把 presenter 改成显式取字段。
3. **公开页每次请求签 N 个 URL**（每媒体 2 个，按 key 去重）。当前量级可接受；若分享页媒体很多，后续考虑短期缓存签名结果。
4. **签名失败即 500**：这是刻意选择（不吞错、不给假链接），但公开页在 S3 故障时会整页失败；如需“图片降级、文字可读”，那是产品决策，需要显式的 `cover/url` 可空策略，而不是静默吞异常。

## 未覆盖项

1. **`GET /v1/media/{mediaId}` 路由不存在**（契约 `GetMediaResponseSchema = MediaReadSchema`、OpenAPI 有 `getMedia` operation，审计 11.3 也把它列为新增端点；`media.controller.ts` 只有 presign/complete/list/update/delete/setCover）。这是契约与运行时的真实缺口，但**加路由不在本任务包**，我没有擅自加。`MediaUrlService` 已经可以直接支撑它（返回 `url/thumbUrl/expiresAt`）。
2. **媒体列表/完成/更新仍返回 `Media`（含 bucket/key/variants）**：这是当前这些端点自己的契约（`MediaPageSchema = CursorPageSchema(MediaSchema)`、`CompleteMediaResponse`），不属于本次公开读契约缺陷；若要统一改成 `MediaRead`，需要契约同步变更（不是本任务）。
3. **`Trip.cover` 真实投影**（签名封面、`cover.status`）未做，按要求先 `null`。
4. **`PublicTrip.trip` 没有 `originLat/originLng/timeZone` 字段**（契约未开放），公开页仍只有 `origin` 文案；若产品要公开地图起点，需先改契约。
5. 未跑 e2e（需要 Postgres/S3）与全仓 build（按要求禁止）；未连任何远端/生产环境。

## 建议的下一步

1. 让 W0_DB 合并 `0003` 后跑一次 `pnpm --filter @roamlog/db ... prisma generate`，然后只需确认 `presentTrip`/`presentStop` 的输出（代码已就绪，不需要改 presenter）。
2. 派一个 media 读端点任务新增 `GET /v1/media/:mediaId`（直接注入 `MediaUrlService`，返回 `MediaRead`），并统一 `complete/update/list` 的媒体读投影。
3. 派独立任务做 `Trip.cover` 投影（用 `MediaUrlService` 签封面），同时替换本任务的 `cover: null`。
4. 让 test owner 给 `collab-share.e2e-spec.ts` 补第 6 个构造参数，之后把 `ShareLinksService` 第 6 参收紧为必填。
