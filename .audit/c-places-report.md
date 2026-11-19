# C_PLACES_GEOAPIFY — Geoapify 主源接入报告

状态: DONE
任务 ID: `C_PLACES_GEOAPIFY`
角色: backend_api + web_frontend
时间: 2026-11-19（Asia/Shanghai）

## 1. 变更文件

### 契约

- `packages/contracts/src/api/places.ts`
  - `Place` 新增 `address: string | null`、`bbox: [number, number, number, number] | null`、`importance: number | null`；`timeZone` 保持已有字段并明确「Geoapify 会填，Photon 为 null」。
  - 新增 `PlaceBboxSchema`（GeoJSON 顺序 `[west, south, east, north]`，并校验 west ≤ east、south ≤ north）。
  - 新增 `PlaceSearchProviderSchema = "geoapify" | "photon" | "local"`，`Place.provider` 与 `PlaceSearchResponse.provider` 使用它。
- `packages/contracts/src/__tests__/entities.test.ts`
  - 新字段可空、bbox 顺序/越界、`importance` 范围、`.strict()` 拒绝未知键、`provider: "geoapify"` 契约测试。

> 关于 provider 枚举：`entities/stop.ts` 的 `PlaceProviderSchema` **保持 `"photon" | "local"` 不变**。任务明确「不要改 Stop schema」，且 Stop 还没有 `address`/`bbox` 落库字段；现在把 `"geoapify"` 塞进 Stop 枚举只会让 Orval 生成物与契约暂时不一致。因此 Place 使用独立的 `PlaceSearchProviderSchema`。等 Stop 补 address/bbox 时再把两者统一（见「未覆盖项」）。

### API（`apps/api/src/modules/places/**`）

- 新增 `geoapify.client.ts`：`v1/geocode/autocomplete`，只发 `text/lang/limit/bias/apiKey`，`AbortController` 1.2s，失败分类 `timeout | http_error | network_error | invalid_payload | invalid_url | not_configured`，无重试、无用户身份、无 cookie。
- 新增 `geoapify-normalizer.ts`：映射 `place_id → providerPlaceId`、`name/formatted/address_line1*/country/country_code/city/lat/lon/timezone.name/bbox/rank.importance/result_type`；缺 `place_id` 或坐标整条丢弃。
- 新增 `places-quota.service.ts`：Redis `INCR` + TTL 到下一个 UTC 零点；计数在请求前消费，超限不再打 Geoapify；Redis 不可用 fail-open；`GEOAPIFY_DAILY_LIMIT=0` 关闭上限。
- `places.settings.ts`：新增 `provider`（`PLACES_PROVIDER`，默认 `geoapify`）、`geoapifyBaseUrl`、`geoapifyApiKey`（`GEOAPIFY_API_KEY`，只在服务端）、`geoapifyTimeoutMs`（默认 1200）、`geoapifyDailyLimit`（默认 3000）、`fallbackToPhoton`（`PLACES_FALLBACK_TO_PHOTON`，默认 true）。
- `places.service.ts`：主源选择、Geoapify→Photon 降级、双失败 `200 + items: [] + degraded: true`、限额跳过、日志不含 query/key。
- `places-cache.service.ts`：键改为 `places:v3:{provider}:{sha256}`；读取时只接受 `photon/geoapify` 响应且拒绝任何 `local` item。
- `places.module.ts`：注册 `GeoapifyClient`、`PlacesQuotaService`。
- `photon-normalizer.ts`（既有缺陷修复）：把 `street/housenumber/postcode/city/state` 拼进 `address`；`extent` 从 `[west, north, east, south]` 重排为 `[west, south, east, north]`；映射 `importance`。
- 测试（逐条、未合并）：
  - 新增 `geoapify-normalizer.spec.ts`（完整字段、缺 place_id、缺坐标、坐标回退、bbox 顺序/属性 bbox/反向 bbox、13 个 type 分支、importance 缺失/越界、timezone 非法、address 回退/为空、缺 name/country/code、payload 保留/丢弃/抛错）。
  - 新增 `geoapify.client.spec.ts`（参数最小集、无 lang/bias、超时、429、500、合法响应、坏 JSON、非 FeatureCollection、缺 key、非法 URL、网络错误）。
  - 新增 `places-quota.service.spec.ts`（未超限、超限、日期键+UTC 午夜 TTL、UTC 秒数、Redis fail-open、limit=0）。
  - 扩展 `places.service.spec.ts`（Geoapify 优先且字段完整、主源超时→Photon+degraded、双失败空结果、每日上限不再请求、超限降级 Photon、换 provider 不命中旧键、缓存命中、校验错误、缓存 local 拒服务、limit 截断）。
  - 扩展 `photon-normalizer.spec.ts`（完整地址拼装、部分地址、只有 country/state 时 null、extent 重排、非法 extent、importance）。
  - 更新 `place-fixtures.ts`（真实 Geoapify/Kyoto fixture、Photon street/postcode/extent 覆盖）、`photon.client.spec.ts`、`places.module.spec.ts`、`places.controller.spec.ts`。

### Web

- `apps/web/components/trips/trip-form/trip-form.tsx`
  - combobox option `description` 改为 `place.address ?? place.country`。
  - 起点选中时记录真实 `place.provider`，并把 `address` 放进表单态（仅展示，Trip 不持久化）。
- `apps/web/components/trips/trip-form/origin-field.tsx`
  - 非 `local` 一律显示「地点库」；选中后显示完整 `address`（无 address 时退回 countryCode）。
- `apps/web/components/trips/trip-form/trip-form-state.ts`
  - `TripFormOrigin.provider: Place["provider"]`，新增 `address: string | null`；`valuesFromTrip` 明确回填 `address: null`（Trip 无该列）。
- `apps/web/lib/api/trip-form.ts`：**无需修改**。它已原样返回 `parsed.data.items`（`Place[]`），没有裁剪；新增 `apps/web/lib/api/trip-form.test.ts` 证明 `address/timeZone/bbox/importance` 原样穿过适配层。
- 更新 `trip-form.test.tsx`（选中后显示完整地址与「地点库」）、`trip-form-state.test.tsx`（origin 增加 `address`）。
- 未改 `destinations-field.tsx`：目的地当前只存 `string[]` 名称（country code 也只存在表单态），没有 Place 对象可展示/落库地址；不伪造临时地址。
- 未改 `searchable-combobox.tsx` 交互逻辑。

### 报告

- `.audit/c-places-report.md`

## 2. 实现摘要（逐 5 项）

1. **契约扩展**：`Place` 增加 `address`、`bbox`、`importance`，保留可空；`timeZone` 现在由 Geoapify 真正填充；`provider` 增加 `geoapify`。`PlaceSearchResponse` 保持 `{ items, provider, degraded, cached }` 不变。
2. **Geoapify 客户端 + 归一化**：端点、参数、1.2s 超时、错误分类、字段映射、`[west, south, east, north]` 顺序、缺 id/坐标丢弃全部实现；Photon 的 `street/housenumber/postcode` 不再丢弃，并修正 `extent` 顺序。
3. **Provider 选择与降级**：`PLACES_PROVIDER` 默认 geoapify；失败/超时/429/配额超限按 `PLACES_FALLBACK_TO_PHOTON` 降级 Photon 且 `degraded: true`；双失败 200 空结果；缓存键 `places:v3:{provider}:...`；每日配额 Redis 计数。
4. **Web 接线**：新字段进入 `Place`；option 描述用 `address ?? country`；起点展示完整地址与 provider；Stop/Trip 没有 `address` 列，未改 schema（见第 7 节）。
5. **测试**：8 个 API 测试文件 119 条 + 契约 65 条 + Web 5 个文件 37 条，全部逐条独立。

## 3. 真实外网验证（2026-11-19，key 仅从 `GEOAPIFY_API_KEY` 读取，未落库）

命令（key 由环境变量注入，输出不含 key）：

```bash
curl -s "https://api.geoapify.com/v1/geocode/autocomplete?text=%E4%BA%AC%E9%83%BD&lang=zh&limit=3&apiKey=$GEOAPIFY_API_KEY" | head -c 500
curl -s "https://api.geoapify.com/v1/geocode/autocomplete?text=%E6%B8%85%E6%B0%B4%E5%AF%BA&lang=zh&limit=3&apiKey=$GEOAPIFY_API_KEY" | head -c 500
```

原始输出（`head -c 500`）：

```
=== curl 京都 | head -c 500 ===
{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"datasource":{"sourcename":"openstreetmap","attribution":"© OpenStreetMap contributors","license":"Open Database License","url":"https://www.openstreetmap.org/copyright"},"name":"京都市","other_names":{"name:af":"Kioto",...

=== curl 清水寺 | head -c 500 ===
{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"country":"日本","country_code":"jp","city":"東大和市","district":"清水四丁目","suburb":"清水","other_names":{"name":"清水四丁目","name:en":"Shimizu 4",...
```

`head -c 500` 会被 `other_names` 截断，因此另做字段提取证明 bbox/timezone 真实存在与顺序：

```
{"name":"京都市","type":"city","timezone":"Asia/Tokyo","bbox_feature":[135.6081441,34.8515754,135.9281441,35.1715754],"rank":{"importance":0.18667666666666663,"confidence":1,...},"formatted":"京都市, 京都府, 日本","lat":35.0115754,"lon":135.7681441}
{"name":"京都府","type":"county","timezone":"Asia/Tokyo","bbox_feature":[134.8513426,34.705754,136.055476,36.1500281],"rank":{"confidence":1,...},"formatted":"京都府, 日本","lat":35.242552,"lon":135.454601}
{"name":"京都町","type":"city","timezone":"Asia/Tokyo","bbox_feature":[130.8807209,33.6591694,130.9607209,33.7391694],"rank":{"importance":0.16000999999999999,...},"formatted":"京都町, 京都郡, 日本","lat":33.6991694,"lon":130.9207209}
```

**bbox 顺序判读**：京都 feature bbox `[135.6081441, 34.8515754, 135.9281441, 35.1715754]`，而坐标点是 `lat=35.0115754, lon=135.7681441`。纬度 35.01 落在 `34.85`（第二项）与 `35.17`（第四项）之间，说明第二项是 south、第四项是 north → `[west, south, east, north]`，**不是** GeoJSON `[west, south, east, north]` 之外的 `[minLon, maxLat, maxLon, minLat]`。因此归一化直接原序保留；`properties.bbox` 的 `{lon1, lat1, lon2, lat2}` 也按同一顺序映射。

**映射依据**：

- `timezone.name = "Asia/Tokyo"` → `timeZone`，经 `IanaTimeZoneSchema` 校验。
- `rank.importance` 只出现在 city 命中（0.1866），county 命中没有 → `importance: null`，不猜测。
- `result_type`: `city → city`；`county → region`（京都府确实是 `county`）；`amenity → poi`（清水寺第二条）；`street → poi`（契约暂无 street 类型，街道级命中仍是可搜索地点，选择归 `poi`）。
- `formatted` 优先作为 `address`；缺失时拼 `address_line1, address_line2`。
- `country_code` 上游是小写 `jp`，归一化后大写 `JP`。
- Photon `extent` 实测：`[135.559006, 35.3212207, 135.878442, 34.874916]`（`[west, north, east, south]`），归一化后 `[135.559006, 34.874916, 135.878442, 35.3212207]`。

## 4. 验证命令与结果

### 4.1 `pnpm --filter @roamlog/contracts test`

```
 ✓ src/__tests__/entities.test.ts (20 tests) 44ms
 ✓ src/__tests__/openapi.test.ts (10 tests) 921ms

 Test Files  8 passed (8)
      Tests  65 passed (65)
```

### 4.2 `pnpm --filter @roamlog/api typecheck`

```
$ tsc --noEmit
[exit code: 0]
```

### 4.3 `pnpm --filter @roamlog/api exec vitest run src/modules/places`

```
 ✓ src/modules/places/__tests__/places.controller.spec.ts (8 tests) 369ms
 ✓ src/modules/places/__tests__/places.module.spec.ts (3 tests) 226ms
 ✓ src/modules/places/__tests__/places.service.spec.ts (19 tests) 85ms
 ✓ src/modules/places/__tests__/photon.client.spec.ts (13 tests) 74ms
 ✓ src/modules/places/__tests__/geoapify.client.spec.ts (11 tests) 63ms
 ✓ src/modules/places/__tests__/geoapify-normalizer.spec.ts (33 tests) 15ms
 ✓ src/modules/places/__tests__/photon-normalizer.spec.ts (26 tests) 14ms
 ✓ src/modules/places/__tests__/places-quota.service.spec.ts (6 tests) 8ms

 Test Files  8 passed (8)
      Tests  119 passed (119)
```

### 4.4 `pnpm --filter @roamlog/web typecheck`

```
$ next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully
[exit code: 0]
```

（期间并行 workstream 的 `apps/web/lib/settings.test.ts` 曾短暂报 `TS6133`，该文件不在本任务范围；对方修好后最终复跑通过。）

### 4.5 `pnpm --filter @roamlog/web exec vitest run components/trips/trip-form lib/api/trip-form.test.ts`

```
 ✓ components/trips/trip-form/__tests__/trip-form.test.tsx (8 tests) 2362ms
 Test Files  5 passed (5)
      Tests  37 passed (37)
```

### 4.6 真实外网验证

见第 3 节（两条 `curl` 原始输出 + 字段提取）。

## 5. CodeGraph 证据

查询：

```bash
codegraph explore "GeoapifyClient PlacesQuotaService PlacesService search"
```

关键结果：

- `PlacesService`（`places.service.ts:37`）→ 7 callers（`places.controller.ts`、`places.module.ts`），测试覆盖 `places.controller.spec.ts` / `places.module.spec.ts` / `places.service.spec.ts`。
- `GeoapifyClient`（`geoapify.client.ts:54`）→ 8 callers（`places.module.ts`、`places.service.ts`），测试覆盖 `geoapify.client.spec.ts` / `places.controller.spec.ts` / `places.service.spec.ts`。
- `normalizeGeoapifyPayload`（`geoapify-normalizer.ts:215`）→ 3 callers in `geoapify.client.ts`；`normalizeGeoapifyFeature → PlaceSchema`。
- 调用链：`PlacesService.search → GeoapifyClient.search → normalizeGeoapifyPayload → normalizeGeoapifyFeature → PlaceSchema`。
- `codegraph status`：`Files 1,547 / Nodes 23,821 / Edges 52,607`，索引已包含新增文件。

## 6. 已知风险

1. **配额**：Geoapify 免费额度 3000/天；计数键按 UTC 日期，TTL 到 UTC 00:00（不是本地 23:59）。Redis 不可用时 fail-open，可能短暂超配额；这是可用性优先的既有策略。
2. **条款**：Geoapify 返回 OSM 派生数据，当前响应/UI 尚未展示 `© OpenStreetMap contributors` 归属；上线前需确认 Geoapify 套餐的缓存/存储条款与归属要求。现有 Redis 只缓存归一化结果 15 分钟（空/降级 30 秒），不做长期落库。
3. **bbox 顺序**：Geoapify 已实测 `[west, south, east, north]`；Photon `extent` 已实测 `[west, north, east, south]` 并在 normalizer 重排。若未来换其它源，必须按契约注释重新验证，不能假设 GeoJSON。
4. **provider 语义**：`PlaceSearchResponse.provider` 表示实际产出 items 的源；主源失败但 Photon 兜底时返回 `provider: "photon" + degraded: true`；两者都失败时返回配置的主源 + 空数组。前端已有 `degraded` 分支不受影响。
5. **API key**：只在 `GEOAPIFY_API_KEY` 环境变量；代码/测试只用假 key，未写入仓库。手工 curl 的 key 未出现在本报告。
6. **管理后台开关**：`settings.registry.ts` 已存在 `places.provider`（另一 workstream），本模块仍只读 `PLACES_PROVIDER`；后台修改不会实时影响 PlacesModule，需后续接线。

## 7. 未覆盖项 / 明确未做

1. **Stop/Trip 没有 `address` 字段**：`StopSchema` 只有 city/country/coordinates/provider/timeZone，`TripSchema` 只有 origin + originLat/originLng/originCountryCode/timeZone。按任务要求未改 schema，因此选中地点后地址**没有写入停止点/旅行**，只在起点表单内展示；刷新/编辑后消失。需要后续迁移（design §6 也列了 Stop.address/bbox）。
2. **目的地地址**：`Trip.destinations` 是 `string[]`，只保存名称；`destinationCountryCodes` 仅存在表单态。没有 Place 对象可展示地址，未改 `destinations-field.tsx`。
3. **未运行** `contracts:generate` / `api-client:generate`（任务禁止，根 Agent 串行执行）。因此 `packages/contracts/openapi.json` 与 Orval 生成物尚未包含新字段；后端运行时已使用新 Zod，Web 适配层用 `PlaceSearchResponseSchema` 解析原始响应所以不受生成物影响。根 Agent 生成后需复查 `PlaceSearchResponseItemsItem` 新字段与 `PlaceSearchProviderSchema`。
4. **未做真实 Geoapify→Photon 降级的外网演练**：单测已覆盖超时/500/429/配额；外网只验证了正常返回。
5. **未做缓存命中率的观测仪表**：只保留现有结构化日志字段（provider/fallback/reason）。

## 8. 建议下一步

1. 根 Agent 串行执行 `pnpm contracts:generate` + `api-client:generate`，确认 OpenAPI/Orval 发布 `address/timeZone/bbox/importance` 与 `geoapify` provider。
2. 单独排期给 `Stop`/`Trip` 增加 `address`/`bbox`（一条迁移），然后 Web 在创建/编辑停靠点时真正落库地址；在此之前不要宣称「地址已保存」。
3. 在 UI 增加 Geoapify/OSM 归属文案（`© OpenStreetMap contributors`），并确认 Geoapify 套餐的缓存条款。
4. 把 `GEOAPIFY_API_KEY`、`PLACES_PROVIDER`、`GEOAPIFY_DAILY_LIMIT` 补进 `.env.example` 与部署密钥清单（本任务未改 env 示例，避免与 devops 冲突）。
5. 将 admin `places.provider` 设置接到 PlacesModule（或明确保留 env-only），避免两个开关语义不一致。
6. 给每日配额加监控告警（达到 80% 时提醒），并考虑 Redis 故障时的 fail-closed 降级策略。