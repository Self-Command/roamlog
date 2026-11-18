# 根 Agent 验收记录 — API_TRIP_MEDIA

任务 ID: API_TRIP_MEDIA
验收结论: **ACCEPT（条件：422 契约缺口、公开分享 Workspace 级封面）**
时间: 2026-11-18 22:30

## 通过

### A. Trip 位置字段持久化
- `originLat/originLng/originCountryCode/timeZone` 在 create/update/duplicate 全部落库；`timeZone` 走 `IanaTimeZoneSchema`。
- **坐标成对校验**：单边 → 422 `VALIDATION_ERROR` + `errors[0].code=INVALID_COORDINATE_PAIR`；`create` 在 `parseRequest` **之前**校验（避免变成 400）——这个细节处理得体。
- update 语义正确：缺键不改、显式 `null` 清空；duplicate 复制 Stop 的 `provider/providerPlaceId/timeZone`。

### B. TripCoverService 投影
- 产出条件严格：同 Workspace + `status=ready` + （`media.tripId` 为空或等于该 Trip）→ 否则 `cover: null`，**绝不伪造 URL**。
- list/detail/create/update/duplicate 与公开分享**统一投影**；`MediaUrlModule` 独立提供 `MediaUrlService`+`TripCoverService`，`TripsModule` 与 `MediaModule` 引用，`MediaModule` 再导出给 share-links → **模块图无环**。

### C. `GET /v1/media/:mediaId`
- `MediaTenantGuard` + `RolesGuard` + `media:read`；返回 `MediaReadSchema`，**彻底不含 bucket/key/variants**。
- 跨 Workspace/不存在 → 404 `MEDIA_NOT_FOUND`；私有 Trip 不可见 → 404 `TRIP_NOT_FOUND`（正确，不泄露存在性）；非 ready → 200 且三个 URL 全 null。

### D. `POST /v1/trips/:tripId/cover` 收紧
- 非 ready → **409 `MEDIA_NOT_READY`（不写库）**；他 Trip 媒体 → **422 `MEDIA_TRIP_MISMATCH`（不写库）**；Trip/媒体缺失 → 404；成功后返回带投影 cover 的 Trip。
- `PATCH coverMediaId` 仍为 null-only。

### E. 测试
- 新增 32 条单测；`vitest run src` → 44 files / **338 passed**。
- 断言响应 JSON 不含 bucket/key/variants（正向覆盖了最敏感的信息泄漏点）。

## 根 Agent 独立验证

```
真实 PostgreSQL 全量: 66 passed | 4 skipped (70) / 443 passed | 6 skipped (449) / exit 0
```

## 条件项 / 风险

1. **422 未进 OpenAPI**：Trip 路由契约无 422，前端生成客户端不知道 `INVALID_COORDINATE_PAIR` 分支。需契约任务补 Trip 写操作 422 + 错误码，再重新生成 api-client（我已记录，属下一批）。
2. **公开分享的 Workspace 级封面为 null**：`share-links.repository.loadPublicTrip` 只取挂在 Trip 上的 ready 媒体，所以「Workspace 级封面」在公开页为 null、登录态可见。属仓储层，超出其可写范围 → 记为后续修复项（会造成登录态/匿名态不一致，属产品可见缺陷）。
3. 新依赖参数用「可选 + 默认回退」，仅为兼容可写范围外的手工构造测试；Nest 运行时按 token 注入。**建议后续把 `collab-share.e2e-spec.ts` 的 5 参构造补全后收紧为必填**（此债已记两次）。
4. duplicate 复制 `coverMediaId` 但媒体不属于新 Trip → 新 Trip cover 投影为 null（数据一致，不泄露 URL）。可接受，但产品上应决定「复制旅行是否连封面一起复制」。
5. 为接线改了 `share-links.module.ts` / `media.module.ts` / `trips.module.ts` 的 imports/exports（各 1–5 行，无业务逻辑）——**批准**，属必要接线。

## 未覆盖

- 真实 S3/MinIO 签名联调（URL 形状靠契约 + 桩）→ G5/G6。
- Workspace 级封面的公开分享路径无自动化覆盖 → 随第 2 条一起修。