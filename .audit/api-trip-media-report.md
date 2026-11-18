# API_TRIP_MEDIA 交付报告

状态: DONE
任务 ID: API_TRIP_MEDIA
范围: Trip 位置/时区字段持久化、真实 cover 投影、`GET /v1/media/{mediaId}`、cover 设置收紧、相关单测。

## 变更文件

新增:

- `apps/api/src/modules/media/media-url.module.ts`
- `apps/api/src/modules/media/trip-cover.service.ts`
- `apps/api/src/modules/media/media-url.service.ts`（本 Wave 新增的签名服务，由本次任务接线使用）
- `apps/api/src/modules/media/__tests__/trip-cover-projection.spec.ts`
- `apps/api/src/modules/media/__tests__/media-read.spec.ts`
- `apps/api/src/modules/trips/__tests__/trips-origin-location.spec.ts`
- `apps/api/src/modules/share-links/__tests__/public-cover.spec.ts`

修改:

- `apps/api/src/modules/trips/content-records.ts`、`content-values.ts`、`content-presenters.ts`
- `apps/api/src/modules/trips/trips.repository.ts`、`trips.service.ts`、`trips.module.ts`
- `apps/api/src/modules/trips/stops.repository.ts`、`stops.service.ts`
- `apps/api/src/modules/media/media.service.ts`、`media.controller.ts`、`media.presenter.ts`、`media.module.ts`
- `apps/api/src/modules/share-links/share-links.service.ts`、`share-links.module.ts`

`git diff --stat`（仅本次相关模块）：14 files changed, 536 insertions(+), 48 deletions(-)；另有 7 个新增文件未跟踪。

## 实现摘要

A. Trip 字段持久化
- `TripRecord`/`TripCreateData`/`TripUpdateData` 增加 `originLat/originLng/originCountryCode/timeZone`；create/update/duplicate 全部写入。
- `timeZone` 使用 `IanaTimeZoneSchema` 校验；坐标成对校验 `assertOriginCoordinatePair`：一侧缺失 → 422 `VALIDATION_ERROR` + `errors[0].code = INVALID_COORDINATE_PAIR`（`create` 在 `parseRequest` 之前做，保证 422 而非 400）。
- update 语义：键缺失 = 不修改；显式 `null` = 清空；`originLat`/`originLng` 成对出现才合法。
- 复制 Trip 时 stop 的 `provider/providerPlaceId/timeZone` 一并复制；Stop create/update 已持久化这三个字段。

B. 真实 `cover` 投影
- 新增 `TripCoverService.resolve(trips, loadMedia)`：同一 Workspace、`status === "ready"`、媒体 `tripId` 为空或等于该 Trip；否则 `cover: null`。签名 URL 来自 `MediaUrlService`。
- `TripCover {mediaId,status,url,thumbUrl,width,height,blurhash,expiresAt}`；无 cover 或不合格时不下发伪 URL。
- list/detail/create/update/duplicate 与公开分享 payload 均走同一投影。
- `MediaUrlModule` 单独提供 `MediaUrlService` + `TripCoverService`，由 `TripsModule`、`MediaModule` 引入并再导出；模块图无环：`MediaModule → TripsModule → MediaUrlModule`。

C. `GET /v1/media/{mediaId}`
- 控制器：`@Get("media/:mediaId")`，`MediaTenantGuard + RolesGuard`，权限 `media:read`。
- 返回 `MediaReadSchema`：仅 `url`/`thumbUrl`/`expiresAt` 与媒体元数据，**不含 `bucket`/`key`/`variants`**。
- 仅有权限且可见者能读；跨 Workspace / 不存在 → 404 `MEDIA_NOT_FOUND`；私有 Trip 的媒体按既有 `assertTripVisible` 返回 404 `TRIP_NOT_FOUND`。
- 未就绪（`processing`/`failed`）→ 200，`status` 真实，`url/thumbUrl/expiresAt` 全 `null`。

D. `POST /v1/trips/{tripId}/cover` 收紧
- 权限 `trip:set-cover`；Trip 不存在 → 404 `TRIP_NOT_FOUND`；媒体不存在/跨 Workspace → 404 `MEDIA_NOT_FOUND`。
- 非 `ready` → 409 `MEDIA_NOT_READY`（不写库）。
- 媒体属于其他 Trip → 422 `MEDIA_TRIP_MISMATCH`（不写库）。
- 成功后返回的 Trip 直接带投影 cover；`PATCH /v1/trips/{id}` 的 `coverMediaId` 仍只允许 `null`。

E. 测试（新增 4 个 spec，共 32 条用例）
- `trip-cover-projection.spec.ts`：ready 同 Trip、Workspace 级媒体、processing/failed、他 Trip 媒体、行缺失、无 cover 跳过 loader、去重单次加载。
- `media-read.spec.ts`：GET 就绪/未就绪、跨 Workspace/未知 → 404、私有 Trip → 404；setCover 成功、Workspace 级、409、422、404×2；并断言响应无 `bucket`/`key`/`variants`。
- `trips-origin-location.spec.ts`：4 字段持久化、缺省为 null、`cover: null`、单边坐标 422 且不开事务、显式 null 清空、未提供的键不出现在 update data、patch 半边坐标 422。
- `public-cover.spec.ts`：公开分享同一 Trip ready cover 出签名 URL、Workspace 级媒体、他 Trip/非 ready/不在 bundle → `cover: null`。

## 验证命令与结果

```
pnpm --filter @roamlog/api typecheck
$ tsc --noEmit
[typecheck exit: 0]
```

```
pnpm --filter @roamlog/api exec vitest run src
 Test Files  44 passed (44)
      Tests  338 passed (338)
```

```
pnpm --filter @roamlog/api exec vitest run src/modules/trips src/modules/media src/modules/share-links src/modules/stops
 Test Files  8 passed (8)
      Tests  57 passed (57)
```

```
pnpm --filter @roamlog/api exec vitest run src/modules/media
 Test Files  4 passed (4)
      Tests  31 passed (31)
```

## 接口证据

- `GET /v1/media/:mediaId` → 200 `MediaRead`（无 bucket/key/variants；非 ready 时 URL 为 null）；404 `MEDIA_NOT_FOUND`；私有 Trip 404 `TRIP_NOT_FOUND`。
- `POST /v1/trips/:tripId/cover` → 200 Trip + `cover`；409 `MEDIA_NOT_READY`；422 `MEDIA_TRIP_MISMATCH`；404 `TRIP_NOT_FOUND`/`MEDIA_NOT_FOUND`。
- `PATCH /v1/trips/:tripId` 的 `coverMediaId` 仍为 null-only。
- 公开分享 `GET /v1/public/share-links/:token` → `trip.cover` 为真实签名投影或 `null`。

## CodeGraph 证据

- `codegraph status` → `[OK] Index is up to date`（本次改动后执行 `codegraph sync`，再次 status 仍 up to date）。
- `codegraph explore "TripsService createTrip updateTrip presentTrip MediaService MediaUrlService media.controller cover"` → 命中 `trips.service.ts`、`trips.repository.ts`、`content-presenters.ts`、`media.service.ts`、`media.controller.ts`、`share-links.service.ts`，确认 `presentTrip` 的所有调用点与 `setCover` 的唯一调用链（controller → service → repository），据此确定 cover 投影必须下沉到 `content-presenters.ts` 与 `share-links.service.ts` 两处。

## 已知风险

1. 服务层坐标 422 尚未写入 OpenAPI（Trip 路由契约里没有 422），前端生成客户端不知道该分支；属契约侧后续工作，本任务被禁止改 `packages/**`。
2. `MediaService` / `TripsService` 的新依赖参数保留为「可选 + 默认回退」，仅为兼容既有手工构造的测试（`apps/api/test/**` 不在可写清单）；Nest 运行时仍按 token 注入，不影响生产 DI。
3. 复制 Trip 会复制 `coverMediaId`，但封面投影要求媒体属于该 Trip，因此复制出的 Trip `cover` 投影为 `null`（数据一致、不泄露 URL），属已知行为。
4. `share-links.repository.loadPublicTrip` 目前只取「挂在该 Trip 上」的 ready 媒体；Workspace 级（`tripId = null`）封面在公开分享里投影为 `null`，而登录态接口能看到。仓储层修复超出本任务可写范围。
5. 除任务单允许的 `share-links.service.ts` 外，为了让新服务可注入，额外改了 `share-links.module.ts`、`media.module.ts`、`trips.module.ts` 的 imports/exports（各 1–5 行，无业务逻辑），已在此声明。

## 未覆盖项

- 未运行 `apps/api/test/**`（e2e）与真实 PostgreSQL 全量套件；本任务只跑了 `src` 单测。
- 未做真实 S3/MinIO 签名联调，URL 形状由 `StorageService` 契约与测试桩校验。
- Workspace 级封面的公开分享路径（见风险 4）无自动化覆盖。
- 未跑 `apps/web`、MSW 或 API client 回归（禁止改契约/生成物）。

## 建议的下一步

1. 根 Agent 用真实 PostgreSQL 跑 `pnpm --filter @roamlog/api test` 做最终门禁（含 e2e）。
2. 契约任务：为 Trip 写操作补 422 响应与 `INVALID_COORDINATE_PAIR` 描述，并重新生成 OpenAPI/api-client。
3. 分享链接仓储任务：让 `loadPublicTrip` 同时加载该 Workspace 的 Workspace 级 ready 媒体，使公开封面与登录态一致。
4. 可选：为 `GET /v1/media/:mediaId` 增加一条 e2e（真实 DB + MinIO 桩）覆盖鉴权头与 404 语义。
