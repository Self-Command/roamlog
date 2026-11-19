# ATTR_GEOAPIFY — 地点数据归属（Geoapify / Photon / OSM）

状态：DONE（截图与全量 lint/build 有并行阻塞，见 §6）
任务 ID：ATTR_GEOAPIFY
日期：2026-11-19

## 1. 变更文件

新增：

- `apps/web/lib/places-attribution.ts` — 单一事实来源
- `apps/web/lib/places-attribution.test.ts`
- `apps/web/components/map/places-attribution.tsx` — 归属渲染组件 + `usePlacesSearchAttribution`
- `apps/web/components/map/places-attribution.test.tsx`
- `apps/web/components/map/map-canvas.test.tsx`
- `apps/web/components/trips/trip-form/__tests__/places-attribution.test.tsx`
- `.audit/attr-report.md`、`.audit/evidence/attr/*`

修改：

- `apps/web/components/map/map-canvas.tsx` — 底部归属换成 `placesAttribution(placesProvider)`；底衬改 `bg-black/85`、文字 `text-white/70`
- `apps/web/components/map/trip-map.tsx` — 地图页 provider 由实际 geocoder 推导；fallback 也展示归属
- `apps/web/components/map/atlas-map.tsx` — Atlas 的 fallback 展示 OSM 归属
- `apps/web/components/map/geo.ts` — `geocoderPlacesProvider()`（按 `NEXT_PUBLIC_GEOCODER_URL` 主机名判定 photon/geoapify/null）
- `apps/web/components/share/share-article.tsx` — 公开分享页页脚归属（默认保守 OSM，可传 provider）
- `apps/web/components/share/share.test.tsx` — 新增归属测试 + 修复 HEAD 已存在的 `PublicStop.address` fixture 漂移
- `apps/web/components/forms/searchable-combobox.tsx` — 可选 `listFooter`（`role="listbox"` 的兄弟节点 + `aria-describedby`）
- `apps/web/components/forms/__tests__/searchable-combobox.test.tsx` — footer 契约测试
- `apps/web/components/trips/trip-form/origin-field.tsx`、`destinations-field.tsx` — 追踪每次搜索结果的实际 provider，只有有结果时才挂 footer
- `apps/web/components/trips/trip-form/trip-form.tsx` — provider 透传（计划外但必需）
- `apps/web/components/trips/new-trip-shell.tsx`、`edit-trip-page.tsx` — 页面级 adapter 透传 provider（计划外但必需）

## 2. 实现摘要（逐 5 项）

1. **单一事实来源**：`placesAttribution(provider)` 返回 `{ text, href, short }`。geoapify = `Powered by Geoapify · © OpenStreetMap contributors`（链接 geoapify.com）；photon = `Search by Photon · © OpenStreetMap contributors`（photon.komoot.io）；local = `手动录入`（`href: null`，不借第三方归属）；null/未知 = `© OpenStreetMap contributors`（OSM copyright）。短文案：`Geoapify · © OSM contributors` / `Photon · © OSM contributors` / `手动录入` / `© OSM contributors`。
2. **三处展示**：搜索下拉 footer（仅 `status=ready && count>0`，无结果不占位，`local` 不出现链接）；地图页（`MapCanvas` 底部署名，provider 来自 `geocoderPlacesProvider()`；`TripMap`/`AtlasMap` 的 fallback 同样展示）；公开分享页页脚（默认 OSM，`ShareArticle` 支持传入 provider）。
3. **视觉与可达性**：`text-[10px] leading-4`；canvas 用 `text-stone`，地图覆盖层用 `text-white/70` + `bg-black/85` 底衬；移动端 `sm:hidden` 短文案 + `hidden sm:inline` 全文，`whitespace-nowrap` + `truncate`；链接 `target="_blank" rel="noopener noreferrer"`、真实 anchor、`focus-visible:ring-2`；归属节点无 `aria-hidden`。
4. **测试**：见 §4；含 provider 互不串台断言、`rel/target`、footer 不在 listbox 内、↑↓ 索引不被 footer 影响、adapter→field→combobox→footer 全链路。
5. **不写死文案**：所有 surface 均调用 `placesAttribution()`；地图页 provider 由 geocoder host 推导；下拉 provider 由 API 响应 `provider` 经三层 adapter 透传。

## 3. 对比度实测（真值，脚本 `.audit/evidence/attr/contrast.txt`）

| 前景 / 背景 | 对比度 | 判定 |
| --- | --- | --- |
| `text-stone #7a8083` / canvas `#000000` | **5.24:1** | PASS |
| `text-stone` / surface-1 `#0a0a0c` | **4.94:1** | PASS |
| `text-stone` / surface-2 `#101012`（下拉面板） | **4.75:1** | PASS（余量仅 0.25） |
| `text-white/70` / `bg-black/85` 叠白色瓦片（≈`rgb(38,38,38)`） | **8.14:1** | PASS |
| `text-white/60`（OpenFreeMap 瓦片署名）同底 | **6.36:1** | PASS |

## 4. 验证命令与结果

```text
pnpm --filter @roamlog/web typecheck          → exit 0（15:10 一次通过）
pnpm --filter @roamlog/web exec vitest run \
  lib/places-attribution components/map \
  components/trips/trip-form components/share → 12 files / 99 tests passed
pnpm --filter @roamlog/web exec vitest run \
  lib/places-attribution components/map \
  components/trips/trip-form components/share components/forms
                                                → 12 files / 99 tests passed
pnpm --filter @roamlog/web test                → 38 files / 317 tests passed（15:54）
pnpm --filter @roamlog/web build               → exit 0（15:00，早于并行 contracts 改动）
```

并行阻塞（非本任务文件，未改动）：

- 15:57 起 `packages/contracts/src/api/media.ts` TS6133（live-photo 并行改动）导致 build 失败；同期 `components/moderation/api.ts` lint `no-useless-assignment` 导致全量 lint 失败。对本任务 20 个文件单独跑 eslint：exit 0。

## 5. 截图证据

- `.audit/evidence/attr/trip-form-dropdown-desktop.png`（1440×900）：真实登录 + 真实 `/v1/places/search`（degraded → Photon），下拉底部 `Search by Photon · © OpenStreetMap contributors`
- `.audit/evidence/attr/trip-form-dropdown-mobile-390.png`（390×844）：短文案 `Photon · © OSM contributors`，`docScrollWidth = 390`，无横向溢出
- `.audit/evidence/attr/map-atlas-desktop.png`（1440×900）：地图页左下 `© OpenStreetMap contributors · OpenFreeMap`

截图限制：API `GET /v1/workspaces/{id}/trips` 自 14:58 起持续 500（`INTERNAL_SERVER_ERROR`，并行 API 工作），旅行表单/地图页因此无法加载。为拿到真实 UI 证据，Playwright 只 stub 了该 GET（trip 列表，空页/一条 fixture），登录、workspace、地点搜索均走真实 API；`trip-map-desktop`、`map-mobile-390` 因移动端 atlas 不挂载归属节点/登录限流未取到。

## 6. 计划外但必需（须记入验收记录）

1. `components/forms/searchable-combobox.tsx`：新增可选 `listFooter`；footer 是 `role="listbox"` 的兄弟节点，`aria-describedby` 关联，不参与 activeIndex；不传时 DOM 完全无变化。
2. `trip-form.tsx`、`new-trip-shell.tsx`、`edit-trip-page.tsx`：三层 search adapter 透传 `provider`。缺任一层，真实页面都会把 Geoapify 结果写成 OSM（比不写更危险）。
3. `share.test.tsx`：修复 HEAD 已存在的 `PublicStopSchema.address` fixture 漂移（一行 `address: null`），否则 `components/share` 在基线就是红的。

## 7. 已知风险

- **瓦片与搜索来源不同**：瓦片是 OpenFreeMap（OSM 派生），地图页城市搜索是 Photon；`placesAttribution()` 按搜索 provider 追加 `Search by Photon`，OSM 始终在。Atlas 无搜索，只显示 OSM。
- **下拉面板 4.75:1**：`text-stone` 在 `surface-2` 上仅高出 0.25；若后续调亮面板需重测（脚本已留在 evidence）。
- **公开分享页**：`PublicTripResponse.stops` 无 provider 字段，页面只能保守显示 OSM；等契约加 provider 后可传 `placesAttribution` 的真实前缀。
- **Geoapify live 路径**：本机 API 当前降级到 Photon（响应 `provider: "photon"`），Geoapify 的 “Powered by Geoapify” 只在单测/`MapCanvas` 注入 provider 时验证；需在有 key 的环境复测一次。
- 塔尖图标不在归属行；未加 `aria-label`，避免 label-content-name-mismatch。

## 8. 未覆盖项

- 未截到 trip-map 页面与 390px 地图页（API 500 + 登录限流）。
- 未做真实屏幕阅读器（VoiceOver/NVDA）走查；仅 jsdom 语义断言。
- 未改分享 API payload；分享页 provider 仍为保守 OSM。
- 未改搜索逻辑、未触碰 trip-workspace/ai/moderation/packages。

## 9. 建议下一步

1. 等 API `GET /trips` 500 修复后，用 `.audit/evidence/attr/capture.mjs` 重跑真实无 stub 截图（表单 + trip map + 390 map）。
2. 契约 `PublicStopSchema` 增加 `provider`，分享页即可展示真实来源。
3. 把 `placesAttribution` 作为 UI 文案唯一入口，后续新增 provider 只改这一处 + `PlacesProvider` 联合类型。
4. 在 staging（有 `GEOAPIFY_API_KEY`）复测下拉 “Powered by Geoapify”，并存档。