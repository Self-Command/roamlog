# 根 Agent 验收记录 — API_READ_SHAPE

任务 ID: API_READ_SHAPE
验收结论: **ACCEPT（条件：全量 API suite 复跑）**
时间: 2026-11-18 20:00
交付: `.audit/api-read-shape-report.md`

## 通过

- `presentTrip`：`durationDays` 用契约 `tripDurationDays()` 派生；`originLat/originLng/originCountryCode/timeZone` 可选透传，缺省 null；`cover: null`（诚实，不伪造）。
- `presentStop`：`provider/providerPlaceId/timeZone` 透传，缺省 null。
- 新增 `MediaUrlService`：复用 `StorageService.createSignedReadUrl`，只签 `url`（large→original）与 `thumbUrl`（thumb→display），按 key 去重，返回 `{url,thumbUrl,expiresAt}`，不含 bucket/key/variants；非 ready 不签。
- `share-links.publicPayload` 改异步：补 `durationDays`、`cover`；`PublicMedia` 严格形状；未 ready/无 URL 的媒体在响应前过滤；无媒体返回 `[]`；鉴权/错误码不变，无吞错。
- 验证：API typecheck exit 0；`trips + share-links + media` 4 files / 25 tests 通过；`collab-share.e2e` 4 passed；改动 8 文件 eslint 无输出。
- 接口证据：公开读 `durationDays=9`、`cover=null`、1 条 ready 媒体带签名 URL（已脱敏）、processing 被过滤；presenter 输出新字段全 null。

## 条件项

1. **全量 API suite 尚未复跑**（交接时 8 failed）。`API_TRIP_MEDIA` 落地后由根 Agent 统一跑 `ROOT`/G1 复验，必须 8 项转绿。
2. `GET /v1/media/{mediaId}` 路由未实现（契约已声明），已并入 `API_TRIP_MEDIA`。
3. Trip `cover` 仍为 null；真实投影并入 `API_TRIP_MEDIA`。
4. `collab-share.e2e-spec.ts` 用 5 参 new `ShareLinksService`，导致第 6 参在 TS 上只能声明可选；装饰器仍强制注入，缺 provider 会在启动期失败。后续由测试 owner 补 `new MediaUrlService(fakeStorage)` 后收紧为必填（记录，不阻塞）。
5. `...record` + `.strict()` 意味着未来任何未进契约的列会让 parse 抛错；需与 DB owner 保持同步。

## 风险

- 公开页每请求签 N 个 URL（已去重）；S3 签名失败会整页 500（刻意不吞错，符合要求）。
