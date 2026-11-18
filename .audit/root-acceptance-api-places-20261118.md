# 根 Agent 验收记录 — API_PLACES

任务 ID: API_PLACES
验收结论: **ACCEPT（条件：环境变量进配置校验、E2E 后续补）**
时间: 2026-11-18 20:20
交付: `.audit/api-places-report.md`

## 通过

- `GET /v1/places/search` 真实落地：SessionGuard + VerifiedEmailGuard + 专用限流 guard；query 走 `parseRequest(PlaceSearchQuerySchema)`，响应 `PlaceSearchResponseSchema.parse()`。
- Photon 代理：只发 q/limit/lang/可选 bbox，2.5s AbortController，不传身份；字段缺失丢弃，不伪造。
- 降级：4xx/5xx/超时/网络/JSON 异常 → 200 + `degraded:true` + `items:[]`；日志只含 reason/status/durationMs/queryLength，无 query 原文。
- Redis：key 为 sha256(归一化 q|limit|lang)，正常 900s、空/降级 30s；命中 `cached:true`；读取时二次契约校验并拒绝 provider!=="photon"；Redis 异常 500ms 超时后跳过缓存，不 500。
- 限流：user+IP 30/min 固定窗口，超限 429 + Retry-After；Redis 故障 fail-open。
- 手动地点：search 永不返回 local；手动地点仍由 Stop `provider:"local"` 承担。
- 测试：`src/modules/places` 5 files / 57 tests 通过；AppModule DI 编译通过；未登录 401 真实 guard 验证。
- 实测：`lang=zh` 上游 400，已改为 zh 不转发（使用上游默认名）；en 正常。

## 条件项 / 风险

1. `PHOTON_URL`、`PHOTON_TIMEOUT_MS`、`PLACES_*` 直接读 `process.env`，未进 `environment.ts` 校验；需 config owner 在 W0_STORAGE/发布前补。
2. 公共 Photon 无 SLA，生产建议自托管并设 `PHOTON_URL`。
3. zh 无本地化，返回 OSM 本地名；Web 不要假设 zh 英文名。
4. 慢查询（0.9–2.0s）接近 2.5s 预算，会降级为空；依赖 30s 空缓存防击穿。
5. 未跑 places e2e（无 PG+Redis 栈）；G5 staging 补。
6. 限流 policy 是封闭联合，本模块自建限流器（记录，后续可统一）。

## 未覆盖

`apps/api/test/places*.e2e-spec.ts`、Web PlaceCombobox 接入（已并入 `WEB_TRIP_FORM`）、OpenAPI 无变更（契约已存在）。
