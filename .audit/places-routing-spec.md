# Roamlog 地点检索路由与置信度规格

- 任务 ID: `PLACES_ROUTING_RESEARCH`
- 日期: 2026-11-20
- 状态: DONE
- 性质: 调研 + 规格；**未修改任何产品代码**，本文件是唯一新增文件。
- 目标: 用「检索成熟实现 → 整块移植」解决 `北京 → 腾讯`、`东京 → 日本东京`、`京都 → 日本京都`、`建国路87号 → 北京`、`Paris → 法国`，禁止地名白名单，禁止自创排序算法。

移植来源: `pelias/pelias @ 878d4b1e1f736f64a0bed3fef0882d5addcbb300`（MIT）；`pelias/api @ 561e3e85f79b5388f88451cb1a49000764d29e35`（MIT）；`pelias/model @ 583b91a415b90fa3cfabdcc51604c26098ebe2ab`（MIT）；`pelias/query @ f144189f9f7711f43b9599ed1d423e4c0cc87fc3`（MIT）；`pelias/schema @ 41e4f4009a82f336fc4beef998e35852c2616420`（MIT）；`pelias/sorting @ 5eab078c6ad19039cc081bc087ac57f75549ff95`（MIT）；`pelias/parser @ 1cd1a23e631b6692fe45f8058362ff98ec670e44`（MIT）；`pelias/openstreetmap @ 9668925dcbb0a447698cf04161da7ffd2773e87a`（MIT）；`pelias/whosonfirst @ fc508c6c708e638dc186fc3a01009eebce7f463d`（MIT）；适配层 i18n 使用 `opencc-js @ 3261dce0f02a54d7a6bfc31bef77269e2bf16551`（MIT AND Apache-2.0）。

---

## 0. 结论摘要

1. **唯一移植主体是 Pelias**，不是把 Pelias / Nominatim / Photon 的排序各取一段拼起来。Pelias 本身就是一个完整的、生产级地理编码服务：多数据源 importers → 统一 Elasticsearch schema（`source` + `layer` 分区）→ `confidence` / `match_type` / `accuracy` / `layer` → `pelias-sorting` 消歧。许可证 MIT，符合本仓库 `AGENTS.md` 的移植许可证要求。
2. **不需要组合。** 我们的腾讯 / Geoapify / Photon 客户端只作为 Pelias `source` 的「数据适配器」，把各 provider 原始结果映射成 Pelias `Document` 形状；排序、置信度、层级、fallback 语义全部来自 Pelias。唯一额外库 `opencc-js` 只做「简体 → 繁体」查询变体，不参与排序，不是第二个地理编码项目。
3. **Pelias 的 confidence 模型本身不能区分「中文城市名 vs 日文汉字地名」**：`middleware/confidenceScore.js` 没有 language/script 字段，只检查名称、地址、州/邮编等文本匹配。Pelias 官方推荐的做法是 **`boundary.country` / `focus.point` / `layers` / `sources`** 这类地理/数据过滤，以及 `pelias-sorting` 的 **layer + population** 消歧；详见 §4.4。
4. 规格采用 Pelias 的 `confidenceScore.js` 公式 + `confidenceScoreFallback.js` 的 fallback 层级惩罚 + `pelias-sorting` 的歧义排序。`东京` / `京都` 能工作的前提是：对全球 provider 同时查询 `opencc-js` 生成的繁体变体（`东京 → 東京`），或自建 Photon 用官方 `-languages zh` 导入；否则公共 Photon 对 `东京` 只会返回中国同名地点（实测，见 §4.5）。
5. `北京` / `建国路87号` 走腾讯，`东京` / `京都` 走全球 provider 的日本结果，`Paris` 走 Geoapify/Photon 的法国结果；具体判定与排序见 §5.10。

---

## 1. 现状证据（Roamlog，CodeGraph）

CodeGraph 状态（`cd /c/Users/BY9700/Desktop/UI/roamlog && codegraph status`）：

```text
Project: C:\Users\BY9700\Desktop\UI\roamlog
Files: 2,004 / Nodes: 33,246 / Edges: 77,215
[OK] Index is up to date
```

CodeGraph 查询证据：

- `codegraph_explore("place search provider tencent geoapify photon map_pin geocoding fallback degraded", projectPath=...)`
  - 命中 38 个符号 / 7 个文件。
  - `PlacesService.search` `apps/api/src/modules/places/places.service.ts:166`（4 个 caller：`places.controller.ts`、`ai-tools.ts`）。
  - `TencentClient.suggest` `tencent.client.ts:38`；`isChinaQuery` `places.service.ts:75`；`allowsPhotonFallback` `places.service.ts:105`。
  - `normalizeTencentSuggestionPayload` `tencent-normalizer.ts:227`；`normalizeGeoapifyFeature` `geoapify-normalizer.ts:161`；`normalizePhotonFeature` `photon-normalizer.ts:166`。
- `codegraph_explore("PlacesService search tencent geoapify photon fallback ...", projectPath=...)`
  - `normalizePhotonPayload`：3 个 caller，测试 `photon-normalizer.spec.ts`。
  - `search`：4 个 caller，测试 `places.service.spec.ts`、`places.settings.spec.ts`。
  - blast radius：修改 `places.service.ts` 会影响 `places.controller.ts` 与 `ai-tools.ts`，必须同步回归。

现状代码事实：

- `apps/api/src/modules/places/places.service.ts:32-52`：`HAN_SCRIPT = /\p{Script=Han}/u`；`CHINA_ADDRESS_MARKERS` 只匹配 `省市区县镇乡村路街号弄巷栋室楼厦广场小区`。
- `places.service.ts:75-85`：`isChinaQuery()` 仅在 `country === "CN"` 或「含汉字 + 地址标记」时为真。
- `places.service.ts:105-107`：`allowsPhotonFallback()` 仅对「不含汉字」的 query 返回 true，**所有汉字查询被硬性排除在 Photon 之外**。
- `places.service.ts:170-171`：`china = isChinaQuery(query)`，`primary = china ? "tencent" : settings.provider`。
- `places.service.ts:213-305`：中国路由只调腾讯；全球路由先 Geoapify，失败才 Photon；汉字 query 失败直接 `map_pick`。
- `packages/contracts/src/api/places.ts:18-24`：provider 枚举 `geoapify | photon | tencent | local | map_pin`。
- `places.ts:60-80`：`Place` 已有 `provider`、`importance`（0–1）、`type`，**没有** `confidence` / `layer` / `matchType` 字段。
- `places.ts:96-110`：`PlaceSearchResponse` 已有 `provider`、`degraded`、`cached`、`fallback: "map_pick"`。

结论：当前实现是「按 query 形态硬路由一个 provider」，不是「多源召回 + 统一排序」。`北京` / `上海` / `京都` 走 Geoapify 返回 0，`东京` 的汉字又被 Photon 屏蔽，正是本任务要替换的部分。

---

## 2. 为什么选 Pelias 作为唯一移植主体

### 2.1 逐项打分

| 维度 | 分数 | 证据 |
|---|---:|---|
| 功能覆盖 | 5/5 | Pelias 官方 README 列出六种 importers（OpenStreetMap / OpenAddresses / Who's on First / GeoNames / Polylines / CSV），统一进一个 Elasticsearch index；`pelias/api` 提供 `confidence`、`match_type`、`accuracy`、`layer`、`sources`/`layers` 过滤；`pelias-sorting` 专门解决同名地点消歧。`pelias/pelias/README.md:71-87`。 |
| 许可证 | 5/5 | 所有 Pelias 核心包 LICENSE 均为 MIT；`pelias/pelias/README.md:43` 明确 “Completely open-source and MIT licensed”。符合本仓库允许的 MIT。 |
| 可嵌入性 | 4/5 | 完整 Pelias 服务需要 Elasticsearch + importers + Placeholder/PIP/libpostal（`pelias/pelias/README.md:84-97`），不适合直接塞进 NestJS；但 **模型层** 是普通 Node 包：`pelias-model`（Document/schema）、`pelias-parser`（查询解析）、`pelias-sorting`（歧义排序）都不要求 Elasticsearch。本机实测 `pelias-model@11.1.0` 可直接 `new Document(...)`，`pelias-sorting@2.0.0` 可直接作为 comparator 使用（见 §2.5 验证命令）。 |
| 移植工作量 | 3/5 | 需要移植 3 个 npm 包 + 2 个 middleware 公式 + dedupe/trim 两个辅助逻辑 + 3 个 provider adapter；预计 4–6 人日（见 §6）。 |
| 企业级观感 | 4/5 | Pelias 由 Geocode Earth 维护，源自 Mapzen，2013 年至今；`pelias/pelias/README.md:58-60`。 |

**结论：Pelias 覆盖「多源 + 统一 schema + 可解释 confidence + layer/match_type + 歧义排序」全部需求，选它作为唯一移植主体。**

### 2.2 是否必须组合？

**不需要组合，单一来源即可。**

- 排序 / 置信度 / layer / match_type / accuracy / fallback 全部来自 Pelias。
- 腾讯 / Geoapify / Photon 只是「数据源适配器」：它们把原始响应映射成 Pelias `Document`，不贡献自己的排序算法。这属于 `AGENTS.md` 允许的「适配层」。
- `opencc-js` 只做 query 的简繁转换，不参与 geocoding/ranking；如果团队不接受这个依赖，可改为自建 Photon 并用官方 `-languages zh` 导入，仍然只有 Pelias 一个排序主体。
- 没有使用 Nominatim 的 `importance` 或 Photon 的内部 score 来参与最终排序；它们只在 §3 作为对比证据出现，**C 节不使用**。

### 2.3 候选项目为何不选

| 候选 | 许可证 | 为什么不作为主体 | 证据 |
|---|---|---|---|
| `osm-search/Nominatim` | **GPL-2.0-only**（`COPYING` / `LICENSES/GPL-2.0-only.txt`） | 许可证不在本仓库允许的 MIT/Apache/BSD/ISC 列表；且完整服务依赖 PostgreSQL + PostGIS，改造成本高于 Pelias 模型层。`compute_importance` 公式很好，但只能作为研究对照，不移植代码。 | `nominatim/COPYING`、`nominatim/lib-sql/functions/importance.sql:146-205`。 |
| `komoot/photon` | Apache-2.0 | 单一 Nominatim/OSM 数据源，不是多源；HTTP 响应不返回 `score` / `importance`（`GeoJsonFormatter` 只写 `extent` 等字段），无法直接做统一置信度排序。 | `photon/src/main/java/de/komoot/photon/searcher/GeoJsonFormatter.java:95-133`；`photon/src/main/java/de/komoot/photon/searcher/PhotonResult.java:31-37`。 |
| `nchaulet/node-geocoder` | MIT | 一个实例只配置一个 provider（`provider: 'google'`），只提供 `geocode`/`reverse` 两个方法；没有多源合并、没有统一排序、没有 confidence/layer。 | `node-geocoder` README:15-30、163-185；commit `f66ea8db928d780b5d4268938909f86fba503eef`。 |
| `mapbox/geocoding` | 不适用 | 只是 Mapbox 单一 API 的客户端封装，不是多源 geocoder；不作为候选。 | 无多源/排序 API 文档可引，故不纳入。 |

### 2.4 整块移植文件清单（上游 → 我们）

> 只列目标路径，不在本任务写代码。

| 上游文件（repo + path） | 用途 | 我们的目标文件 |
|---|---|---|
| `pelias/model/Document.js:70-185`（commit `583b91a…`） | `Document` 字段：`source` / `layer` / `source_id` / `name` / `parent` / `address_parts` / `center_point` / `bounding_box` / `population` / `popularity` / `category`；`toESDocument` 字段顺序 | `apps/api/src/modules/places/ranking/pelias-document.ts`（直接用 `pelias-model@11.1.0` 的 `Document` 包装，不复制 642 行） |
| `pelias/api/middleware/confidenceScore.js:28-273`（commit `561e3e8…`） | 正向地理编码 confidence 公式 | `apps/api/src/modules/places/ranking/pelias-confidence.ts` |
| `pelias/api/middleware/confidenceScoreFallback.js:47-240`（commit `561e3e8…`） | fallback 的 `match_type` + layer 惩罚 | `apps/api/src/modules/places/ranking/pelias-fallback.ts` |
| `pelias/api/middleware/accuracy.js:38-54`（commit `561e3e8…`） | `accuracy` = point / centroid | `apps/api/src/modules/places/ranking/pelias-accuracy.ts` |
| `pelias/api/middleware/trimByGranularity.js:18-113`（commit `561e3e8…`） | fallback 时保留最细粒度 layer | `apps/api/src/modules/places/ranking/pelias-granularity.ts` |
| `pelias/api/middleware/dedupe.js:15-107` + `helper/diffPlaces.js:13-398`（commit `561e3e8…`） | 去重：邮编 > source > layer 偏好 | `apps/api/src/modules/places/ranking/pelias-dedupe.ts` |
| `pelias/sorting/index.js:1-187`（commit `5eab078…`） | 同名歧义排序 | 直接依赖 `pelias-sorting@2.0.0`，包装为 `apps/api/src/modules/places/ranking/pelias-sort.ts` |
| `pelias/parser/parser/AddressParser.js:42-140` + `parser/Parser.js:1-77` + `server/routes/parse.js:1-39`（commit `1cd1a23…`） | 生成 `parsed_text`（可选；中文 parser 可能无解，见 §5.5） | `apps/api/src/modules/places/ranking/pelias-query-parser.ts` |
| `pelias/schema/mappings/document.js:9-176`（commit `41e4f40…`） | 字段/索引规范：`source`/`layer` 分区、`population`/`popularity` multiplier | 只作为 `pelias-document.ts` 字段契约依据；**不建 Elasticsearch index** |
| `pelias/openstreetmap/stream/document_constructor.js:27-30` + `stream/tag_mapper.js:21-126`（commit `9668925…`） | OSM tag → layer / name 的参考 | 仅用于 §5.4 layer 映射表对照，不直接移植 OSM importer |
| `pelias/whosonfirst/src/peliasDocGenerators.js:72-150`（commit `fc508c6…`） | `record.population` → `setPopulation`；`record.popularity` → `setPopularity` | 仅作为 `population` 语义依据；我们的 provider 有 population 时才写 |
| `opencc-js/src/data-config.js:30-31` + `README.md:57-69`（commit `3261dce…`） | 简体 → 繁体 query 变体 | `apps/api/src/modules/places/ranking/query-variants.ts` |

### 2.5 可嵌入性验证（本机实测）

```bash
cd <temp>/places-routing-research/opencc-test
npm install pelias-model@11.1.0 pelias-sorting@2.0.0 pelias-parser@5.0.0
node -e "const {Document}=require('pelias-model'); const d=new Document('tencent','locality','110000'); d.setName('default','北京'); d.setPopulation(21893095); d.setCentroid({lat:39.9042,lon:116.4074}); console.log(d.getSource(),d.getLayer(),d.getName('default'),d.getPopulation())"
# 输出: tencent locality 北京 21893095
```

`pelias-sorting@2.0.0` 实测：

```text
东京(locality, pop=0) 排在 东京镇(localadmin, pop=0) 之前
Paris(locality, pop=2148000) 排在 Paris TX(locality, pop=25000) 之前
```

说明模型层可以在 Node 24 / NestJS 进程中直接使用，不需要 Elasticsearch。

---

## 3. A：置信度 / 排序的逐项目源码证据

### 3.1 Pelias

#### 3.1.1 `confidenceScore.js` 公式（正向地理编码）

源码：`pelias/api`，commit `561e3e85f79b5388f88451cb1a49000764d29e35`，`middleware/confidenceScore.js`。

> 说明：`pelias/model` 仓库当前**没有** `helper/confidence.js`（对该仓库 master `583b91a…` 做 `grep -Rni confidence` 无命中）；Pelias 的「结果 confidence」实现实际在 `pelias/api/middleware/confidenceScore.js`。`pelias/parser` 的 `classification/*.js` 里的 `confidence` 是**查询解析候选解**的置信度，不是最终地理编码结果分数（见 §3.1.4）。这一点必须按实际源码而非印象记录。

**触发条件与输入**（`confidenceScore.js:28-44`）：

- 仅当 `res.meta.query_type === 'search_pelias_parser'` 时执行；
- `scores = res.meta.scores` 是本次 ES 命中集合的 `_score` 数组（由 `service/search.js:39-47` 收集）；
- `mean = stats.mean(scores)`，`stdev = stats.stdev(scores)`，`stdev < 0.01` 时按 0 处理（`confidenceScore.js:266-269`）。

**公式**（`confidenceScore.js:58-83`）：

设：

- `s` = 当前结果的 `_score`
- `mean` / `stdev` = 本次结果集合的均值 / 标准差
- `relativeScores` = `peliasConfig.relativeScores`，默认 `true`（`confidenceScore.js:19-24`）
- `checkCount = 3 + 2 * I(relativeScores)`（默认 5）

则：

```text
D = 1  if (s - mean) > stdev else 0
Z = 0  if stdev < 0.01 else ((s - mean) / stdev + 10) / 16
N = 1  if name.default == parsed_text.name or name.default == raw text (case-insensitive)
     else 0.7
Q = 0  if parsed_text.housenumber exists and hit.address_parts.number is missing
     else 1
A = 1  if no parsed_text.housenumber or no parsed_text.street
     else mean(
       propMatch(housenumber, address_parts.number),
       propMatch(street, address_parts.street),
       propMatch(postalcode, address_parts.zip),
       propMatch(state, parent.region_a[0]),
       propMatch(country, parent.country_a[0])
     )

confidence = round((D + Z + N + Q + A) / checkCount, 3)
```

**Deal breakers**（`confidenceScore.js:93-108`）：如果 `parsed_text.state` 存在且 `hit.parent.region_a[0]` 不相等，或 `parsed_text.postalcode` 存在且 `hit.address_parts.zip` 不相等，直接 `confidence = 0.5`，不再计算上式。

**`propMatch` 的精确分支**（`confidenceScore.js:173-196`）：

| 条件 | 返回值 |
|---|---:|
| `textProp` 与 `hitProp` 都缺失，且 `expectEnriched` 非空（期待结果有 enrichment） | 0 |
| 两者都缺失，且不期待 enrichment | 1 |
| `textProp` 有、`hitProp` 无 | 0 |
| `textProp` 无、`hitProp` 有，且期待 enrichment | 1 |
| `textProp` 无、`hitProp` 有，不期待 enrichment | 0.5 |
| 两者都有且字符串（小写）相等 | 1 |
| 其他 | 0.7 |

**字段名**（`confidenceScore.js:132-235`）：`name.default`、`address_parts.number`、`address_parts.street`、`address_parts.zip`、`parent.region_a`、`parent.country_a`。这些字段来自 `pelias/model/Document.js:129-144` 的 `toESDocument()`。

**`confidenceScore.js` 的一个关键限制**：它只检查 `name.default`，不检查 `name.zh` / `name.ja` 等本地化字段；`checkName` 的精确匹配只认 `parsed_text.name` 或原始 `text`（`confidenceScore.js:132-146`）。这解释了为什么「中文城市名 vs 日文汉字地名」不能靠 confidence 本身解决（见 §4.4）。

#### 3.1.2 `confidenceScoreFallback.js` 公式（fallback / 无 parser 场景）

源码：`pelias/api`，commit `561e3e8…`，`middleware/confidenceScoreFallback.js`。

- 无 `parsed_text`：`confidence = 0.1`，`match_type = 'unknown'`（`confidenceScoreFallback.js:49-54`）。
- 有 `parsed_text`：`confidence = 1.0`，再乘以 `checkFallbackLevel(req, hit)`（`confidenceScoreFallback.js:56-65`）。
- `checkFallbackLevel()`（`confidenceScoreFallback.js:68-105`）：

| `hit.layer` | 惩罚系数 |
|---|---:|
| `venue`, `address`, `street`, `postalcode` | 0.8 |
| `localadmin`, `locality`, `borough`, `neighbourhood` | 0.6 |
| `macrocounty`, `county` | 0.4 |
| `region` | 0.3 |
| `country`, `dependency`, `macroregion`, default | 0.1 |

- 如果 `checkFallbackOccurred()` 为 false：`match_type = 'exact'`，`confidence = 1.0`（`confidenceScoreFallback.js:103-104`）。
- `fallbackRules` 完整定义在 `confidenceScoreFallback.js:124-185`：按 `venue` / `address` / `street` / `postalcode` / `neighbourhood` / `borough` / `city` / `county` / `state` / `country` 的 `notSet` / `set` / `expectedLayers` 规则判断是否发生 fallback。

**C 节采用这条公式作为 `match_type` / layer penalty / `degraded` 判定**；`confidenceScore.js` 作为 `Place.importance` 的主公式（见 §5.5）。它只需要 `parsed_text` + `hit.layer`，不依赖 Elasticsearch 的 `_score`，适合做 fallback 语义。

#### 3.1.3 `match_type` / `accuracy` / `layer` 语义

- `match_type`（`pelias/documentation/result_quality.md:6-22`，commit `b720f5f…`）：`exact` / `interpolated` / `fallback`；`exact` 表示精确找到；`interpolated` 表示地址插值；`fallback` 表示返回了相关但非精确的地点。文档明确 `match_type` 依赖 query 和 result，且只在 search/structured search 出现。
- `accuracy`（`pelias/api/middleware/accuracy.js:1-54`）：`venue` / `address` → `point`；其他 layer → `centroid`。`result_quality.md:56-62` 同样说明 `point` 是地址/venue/插值地址，`centroid` 是城市/国家等大区域。
- `layer`（`pelias/documentation/search.md:341-363`，commit `b720f5f…`）：按粒度列出 `venue` → `address` → `street` → `neighbourhood` → `borough` → `localadmin` → `locality` → `county` → `macrocounty` → `region` → `macroregion` → `country` → `coarse` → `postalcode`。`pelias/api/middleware/trimByGranularity.js:18-34` 给出同一顺序的代码数组，用于 fallback 时保留最细粒度结果。

#### 3.1.4 Pelias parser 的 confidence（注意：不是地理编码 confidence）

源码：`pelias/parser`，commit `1cd1a23e631b6692fe45f8058362ff98ec670e44`。

- `classification/Classification.js:1-16`：每个 `Classification` 有 `confidence`，默认 `1.0`（`constructor(confidence, meta) { this.confidence = confidence || 1.0 }`）。
- `classification/CountryClassification.test.js:10`：`CountryClassification` 的 confidence 是 `0.9`（不是 1.0）。
- `README.md:185`：每次 parse 可包含多个 `solutions`，每个 solution 有 `confidence`，按分数从高到低显示。
- **结论**：这是「查询解析候选解的置信度」，不是「某条地理编码结果的 confidence」。C 节只把它用于生成 `parsed_text`，不把它当最终结果分数。

#### 3.1.5 Pelias 的多 provider 架构（同 query 多源召回 + 统一排序）

- `pelias/pelias/README.md:71-82`：六个官方 importers（OpenStreetMap / OpenAddresses / Who's on First / GeoNames / Polylines / CSV）都做 `filter, normalize, ingest`，进入同一个 Pelias database。
- `pelias/pelias/README.md:84-87`：底层是 Elasticsearch，`pelias-schema` 负责建 index。
- `pelias/schema/mappings/document.js:9-14`：`source` 与 `layer` 是 data partitioning 字段（都是 `keyword_with_doc_values`）；`document.js:169-172` 有 `source_id`、`category`、`population`、`popularity`。
- `pelias/api/query/search_pelias_parser.js:20-48`：查询评分组件按顺序 `match` → `match_phrase` → `focus` → `popularity` → `population` → address/admin；硬过滤包括 `boundary_circle`、`boundary_rect`、`sources`、`layers`、`categories`、`boundary_country`、`boundary_gid`。
- `pelias/api/query/view/boost_sources_and_layers.js:1-33` 与 `97-114`：`customBoosts` 可对 `source` / `layer` 加权；`pelias/api/README.md:183-213` 说明 boost 是乘法因子，推荐 1–5。
- `pelias/documentation/search.md:289-339`：`sources` / `layers` 过滤；`sources` 的逗号顺序不影响排序，排序仍按文本匹配质量与 `focus` 距离。
- **可借鉴结构**：所有 provider 结果先归一化成同一种 `Document`（`source` + `layer` + `name` + `parent` + `address_parts` + `center_point` + `population` + `popularity`），再走同一套评分/排序。这正是 C 节的结构。

### 3.2 Nominatim `importance`

源码：`osm-search/Nominatim`，commit `2a09655a1d8210a67169f4dd07cd8e75d2903a05`。

- `lib-sql/functions/importance.sql:146-205`：`compute_importance(extratags, country_code, rank_search, centroid)`。
- 优先 Wikipedia/Wikidata 文章 importance：`importance.sql:158-185`；`get_wikipedia_match()` 在 `importance.sql:25-144`。
- 没有 Wikipedia/Wikidata 时的默认公式：`importance.sql:188`：

```text
importance = 0.40001 - (rank_search::float / 75)
```

- 再叠加 secondary importance（作为 tie-breaker）：`importance.sql:190-200`：

```text
importance = importance + secondary_importance / 655350000
```

- 在插入/更新 `placex` 时写入：`lib-sql/functions/placex_triggers.sql:1030-1031`。
- `docs/customize/Importance.md:10-20`：主 importance 来自 Wikipedia page ranking；无 Wikipedia 时用 search rank 推导静态 importance；secondary importance 作为非常接近的主 importance 之间的 tie-breaker。
- `docs/customize/Ranking.md:6-29`：`search rank` 越小越高：1–3 海洋/大陆，4 国家，5–9 州/省，10–12 县，13–16 城市/市镇，17–18 镇/borough，19 村/郊区，20 小村/农场/邻里，21–25 孤立住宅/街区。

**用途**：只作为研究对照。Nominatim 许可证 GPL-2.0-only，且 `importance` 依赖 Wikipedia 数据表与 PostgreSQL，不适合作为本仓库的移植主体；C 节不使用。

### 3.3 Photon 的 `extent` / `score`

源码：`komoot/photon`，commit `15ba33ebac4d6f5deae288a106b24daac30a5662`。

- `docs/api-v1.md:215-269`：Photon 返回 GeoJSON `FeatureCollection`；`properties` 遵循 GeocodeJSON，额外字段只有 `extra`。示例中 `extent` 是 `[13.23727, 52.5157151, 13.241757, 52.5135972]`，即 `[west, north, east, south]`（不是 GeoJSON 的 `[west, south, east, north]`）。
- `src/main/java/de/komoot/photon/searcher/GeoJsonFormatter.java:95-133`：HTTP 序列化只写 `osm_type`/`osm_id`、名称/地址字段、`extent`（`GeoJsonFormatter.java:121`）和 geometry；**不写 `score`，也不写 `importance`**。
- `src/main/java/de/komoot/photon/searcher/PhotonResult.java:31-37`：内部接口有 `getExtent()`、`getScore()`、`getImportance()`，但 `getScore`/`getImportance` 只用于内部排序/重排，不是 API 字段。
- `src/main/java/de/komoot/photon/opensearch/OpenSearchSearchHandler.java:22`：`IMPORTANCE_FACTOR = 30f`；`48-71`：`adjustScoreByImportance(IMPORTANCE_FACTOR * importanceWeight)` → 可选 `adjustScoreByLocationBias(...)` → `ResultScorer.adjustByNormalizedOpenSearchScore(...)` → 按 `getScore()` 降序。
- `ResultScorer.java:11-46`：`maxScore` 初始 10；若 `osScore >= maxScore`，`maxScore = osScore`，`score += 1.0`；若 `maxScore < 20`，`score += osScore / maxScore`；若 `osScore > maxScore - 20`，`score += (osScore - maxScore + 20) / 20`。
- `src/main/java/de/komoot/photon/nominatim/model/PlaceRowMapper.java:91-107`：`importance` 来自 Nominatim 列；为空时 `0.40001 - rank_search / 75`；对非空 importance 还按 `rank_search` 做上限压缩（`limit = 0.4 + 0.6 * (1 - rank/30)`）。

**结论**：Photon 的 HTTP 响应只能可靠使用 `properties.extent`（bbox）；`score` / `importance` 不对外暴露，不能作为跨 provider 的统一分数。C 节只把 `extent` 用于 bbox，不用于排序。

### 3.4 `node-geocoder` 的 provider 抽象

源码：`nchaulet/node-geocoder`，commit `f66ea8db928d780b5d4268938909f86fba503eef`，MIT。

- `README.md:15-30`：一个 `NodeGeocoder({ provider: 'google' })` 实例只对应一个 provider。
- `README.md:163-185`：扩展新 provider 只需实现 `geocode` 和 `reverse`；没有多 provider 合并、结果打分、layer、confidence、fallback 语义。
- 因此它只能作为「provider 客户端接口」的参考，不能作为「多源统一排序」的移植主体。

---

## 4. B：国内源 vs 国际源的消歧

### 4.1 script/language detection 库是否存在「先判语言再选 provider」的成熟实现？

**没有找到。** 我们检查了 Pelias / Nominatim / Photon 的源码与文档：

- `pelias/documentation/language-codes.md:1-21`：Pelias 的 `lang` 只控制 **返回结果的语言**；`BCP47` 目前只使用 language subtag，script/region subtag 尚未使用。它不是「输入语言检测」。
- `pelias/documentation/development/roadmap.md:36-51`：`Expanded input language support` 仍是 roadmap；文档明确说 “not all data importers currently add multiple names” 和 “not all our queries use these alternate names effectively”。
- 对 `pelias-api`、`pelias-parser`、`pelias-docs`、`nominatim`、`photon` 的源码做 `franc` / `cld3` / `whatlang` / `language detect` 检索，未发现用于 provider 选择的调用（仅有 San Francisco 等字符串误命中）。
- 因此，「用 script/language detection 选 provider」在本仓库会是**原创规则**，不符合「禁止自己设计」；本规格不采用。

三个库的客观能力/限制：

| 库 | 能力 | 关键证据 | 对本问题的限制 |
|---|---|---|---|
| `franc` | 82/187/419 种语言；`franc(text)` 返回 ISO 639-3 | `wooorm/franc` README:12-14、59-66；commit `398af8b77088974aff4f6c9e4bfd548ea4fb261e` | README:19-23 明确说「支持语言多，短文本容易混淆」；默认 `minLength: 10`，`franc('the') => 'und'`（README:65-66）。`东京` 只有 2 个汉字，会返回 `und`。 |
| `CLD3` | 神经网络语言识别；字符 n-gram；输出 BCP-47；部分语言按 script 区分 | `google/cld3` README:11-33；commit `b48dc46512566f5a2d41118c8c1116c4f96dc661` | 仍是语言识别，不是 geocoder 路由；短文本/专名不可靠；没有「中文 vs 日文汉字地名」的专用消歧。 |
| `whatlang` | 70 种语言；同时返回 `lang` 和 `script`；`detect(text)` 示例 `info.lang()` / `info.script()` / `info.confidence()` | `greyblake/whatlang-rs` README:34-53；commit `7ddb6bbd158a27844378dd6df0f33f473cd3d731` | `东京` / `京都` 都是 `Script::Han`；script 检测只能告诉你「汉字」，不能区分中文/日文。 |

**结论**：这三个库都只能作为「辅助信号」，不能作为 provider 选择规则；且使用它们会违反「禁止自己设计」。C 节不使用。

### 4.2 result-level scoring（行政级别、人口、importance）的成熟实现

**Pelias `pelias-sorting` 就是专门做这件事的成熟实现。**

源码：`pelias/sorting`，commit `5eab078c6ad19039cc081bc087ac57f75549ff95`，MIT。

- `index.js:5-10`：人口档位：

```text
mega   [4,000,000, Infinity]
large  [500,000, 4,000,000]
medium [5,000, 500,000]
small  [0, 5,000]
```

- `index.js:13-17`：popularity 档位：`very_popular [10,000, ∞)`、`popular [1,000, 10,000)`、`nonpopular [0, 1,000)`。
- `index.js:56-65`：同 layer 的两个结果按 population 降序；不是同 layer 时，属于目标 layer 的优先。
- `index.js:67-95`：大/中/小 locality/localadmin 以及 neighbourhood 的同 layer 比较，先按 `focus.point` 距离，再按 population / popularity。
- `index.js:143-171`：完整 fallback 顺序（按优先级）：

```text
mega locality → mega localadmin → continent → country → dependency
→ large locality → large localadmin → macroregion → region → borough
→ very popular neighbourhood → medium locality → medium localadmin
→ macrocounty → county → macrohood → venue
→ popular neighbourhood → small locality → small localadmin
→ non-popular neighbourhood → _score
```

- 注意：`pelias-sorting` 的 fallback 数组**没有 `address` / `street`**（只有 `venue`）；地址/街道 query 必须先由 §5.6 的 requested-layer 过滤保留 address/street，再进入排序。这是 Pelias API 本身用 `trimByGranularity` + `confidenceScoreFallback` 分工的结果，不能把 `pelias-sorting` 单独用在地址 query 上。
- `README.md:48-64`：明确用 `Paris` 做例子：`Paris, France` 应始终排在 `Paris, Texas` 之前，因为前者是 very large city（population > 4,000,000）；如果用户要后者，会自己补 state/country。
- `README.md:58-60`：同 layer 的 tie-break 默认用 population，人口大的优先。

**我们的适配**：腾讯 / Geoapify / Photon 的默认响应不返回 population；Photon 可通过官方 `-extra-tags population` 把 OSM 的 `population` 放进 `properties.extra.population`（`photon/docs/usage.md:163-170`）。C 节只在该字段存在时写入 `population`，绝不用 `rank.importance` / `extent` 伪造 population（那会是自创）。

**Nominatim `importance`**（§3.2）也是 result-level scoring，但许可证/架构不适合；只作为「行政级别 + Wikipedia 知名度」的对照。

### 4.3 国内 API 的判别字段与 adcode 规则

#### 腾讯位置服务

**返回字段**（官方文档 `https://lbs.qq.com/service/webService/webServiceGuide/webServiceSearch`，响应参数表）：

- `ad_info.adcode`：行政区划代码
- `ad_info.province`：省
- `ad_info.city`：市；省直辖县级区划时可能为空，由 `district` 返回
- `ad_info.district`：区/县
- `category`：POI 分类名
- `type`：POI 类型（`place/v1/suggestion` 文档：`0 普通POI / 1 公交车站 / 2 地铁站 / 3 公交线路 / 4 行政区划`；`https://lbs.qq.com/service/webService/webServiceGuide/webServiceSuggestion`）

**`geocoder/v1` 的 `level`（解析级别）**（官方文档 `https://lbs.qq.com/service/webService/webServiceGuide/address/Geocoder`，章节「level（解析级别）取值表」）：

| level | 含义 |
|---:|---|
| 0 | 无法判别，结果不可信 |
| 1 | 城市 |
| 2 | 区、县 |
| 3 | 乡镇、街道 |
| 4 | 村、社区 |
| 5 | 开发区 |
| 6 | 热点区域、商圈 |
| 7 | 道路 |
| 8 | 道路附属点（交叉口、收费站、出入口等） |
| 9 | 门址 |
| 10 | 小区、大厦 |
| 11 | POI 点 |
| 21+ | 等同于 POI 点 |

**adcode 的层级编码规则**（官方文档 `https://lbs.qq.com/service/webService/webServiceGuide/webServiceDistrict#6`，章节「行政区划代码（adcode）规则说明」）：

> 代码共 6 位，前两位代表省（一级）、中间两位为市/地区（二级），最后两位为区县（三级）。
> 1）省级：前两位有值，后 4 位置 0，如河北省：130000
> 2）市/地区：前 4 位有值，包含省代码与市代码，最后两位置 0，如河北省保定市：130600
> 3）区县：6 位全有值，包含前 4 位省市代码及区县代码，河北省保定市涿州市：130681
> 5）直辖县：第 3、4 位为 90 的，为省直辖县
> 7）东莞市、中山市、儋州市、嘉峪关市 因其下无区县级，因此增加了末位为 99 代码的同名子级，用于补齐到三级区划的结构

**关于「乡镇占哪几位」**：6 位 adcode **没有乡镇/街道独立段**。高德官方行政区划文档明确说明：

> 街道没有独有的 adcode，均继承父类（区县）的 adcode。
>
> — `https://lbs.amap.com/api/webservice/guide/api/district`，章节「行政区划查询」返回结果说明

因此：
- 省 = 第 1–2 位
- 市/地区 = 第 3–4 位
- 区县 = 第 5–6 位
- 乡镇/街道 = **无独立 adcode**，继承所属区县 adcode；若需要乡镇级代码，那是统计用区划代码体系，不是 adcode。

#### 高德

官方文档 `https://lbs.amap.com/api/webservice/guide/api/district`：

- `level` 取值：`province`（省份，直辖市会在 province 显示）、`city`（市，直辖市会在 province 显示）、`district`（区县）、`street`（街道）。
- 街道级别不能返回边界 `polyline`；乡镇街道级别返回的 `adcode` 是所属区县的 `adcode`。
- 行政区划级别包括「国家、省/直辖市、市、区/县、乡镇/街道多级数据」。

`https://lbs.amap.com/api/webservice/guide/api/search`：

- `city` 参数可接收 `citycode` 和 `adcode`；`citycode` 只能精确到城市，`adcode` 能精确到区县。
- 示例：北京 `citycode: 010`，`adcode: 110000`；北京-海淀区 `citycode: 010`，`adcode: 110108`。

#### 百度

- 官方地址解析页面 `https://lbsyun.baidu.com/index.php?title=webapi/guide/webservice-geocoding` 可访问，但本环境抓取到的是 JS 渲染页面，未能从 HTML 文本核实 `adcode` / `province` / `city` / `district` / `level` 字段。
- `https://lbsyun.baidu.com/index.php?title=webapi/guide/webservice-placeapi` 在本环境返回 404。
- 因此本规格**不依赖百度**；如果后续要接入，需用百度官方控制台实际响应补 fixture，再补字段证据。此点列为不确定性（§7）。

### 4.4 Pelias confidence 能不能处理「中文城市名 vs 日文汉字地名」？

**不能。**

原因（源码级）：

1. `pelias/api/middleware/confidenceScore.js:132-146` 的 `checkName()` 只比较 `hit.name.default` 与 `parsed_text.name` 或原始 `text`；没有 `language` / `script` / `country` 参数。
2. `confidenceScore.js:93-108` 的 deal breakers 只有 `state` 和 `postalcode` 两个字段，没有国家/文字体系检查。
3. `pelias/documentation/language-codes.md:1-21`：`lang` 只控制返回语言，且只使用 language subtag；不是输入语言检测。
4. `pelias/documentation/development/roadmap.md:36-51`：input language support 仍在 roadmap。

**Pelias 官方推荐的做法**（不是我们自创）：

- **`boundary.country` 硬过滤**：`pelias/documentation/search.md:72-115` 明确说明用 `boundary.country` 把结果限制在指定国家/国家列表；`search.md:389` 给出参数类型 `string`、默认 `none`、示例 `GBR,FRA`。
- **`focus.point` 邻近优先**：`search.md:203-233` 说明 `focus.point` 会让结果按距该点的距离参与排序，但重要结果仍可来自远处；`search.md:210` 明确用 `Paris` 示例：`focus.point` 在 Texas 时，Paris, TX 和 Paris, France 都可能返回。
- **`layers` / `sources` 过滤**：`search.md:289-339`；`search.md:330` 明确说 `sources` 的逗号顺序不影响排序。
- **`customBoosts`**：`pelias/api/README.md:183-213`，可按 `source` / `layer` 加权，但文档明确「不能完全控制排序，非常好的匹配仍可能排前」。
- **`pelias-sorting` 的 layer + population**：`pelias/sorting/README.md:48-64`，是 Pelias 官方对同名地点（Paris / Paris, Texas）的歧义解决方式。

**因此 C 节的设计是**：
- 有 `country` / `focus.point` 时，按 Pelias 官方 `boundary.country` / `focus.point` 处理；
- 没有时，用 `pelias-sorting` 的 layer + population 规则做 best-effort，并明确标记 `degraded` / 需要用户消歧，不假装 confidence 能理解语言。

### 4.5 真实 provider 样本（本机 2026-11-20 抓取）

**Photon 公共 API** `https://photon.komoot.io/api/`（无 `lang` 参数；公共实例只支持 `default/de/en/fr`，`lang=zh` 返回 `Language is not supported. Supported are: default, de, en, fr`）：

- `q=东京` → 返回中国境内同名地点：
  - `东京` / `中国` / `locality` / `osm_value=hamlet` / `29.1942668,118.9800309`
  - `东京城镇` / `中国` / `city` / `osm_value=town` / `44.1134353,129.2114111`
- `q=東京` → 返回日本东京：
  - `東京` / `日本` / `house` / `osm_value=station` / `35.6812546,139.766706`
  - `東京都` / `日本` / `city` / `osm_value=province` / `35.6768601,139.7638947`
- `q=京都` → 返回日本京都（station/stop，`country=日本`）。
- `q=Paris` → 第 1 条 `Paris / France / city`，第 3 条 `Paris / United States / city / osm_value=town`。
- `q=北京` → 第 1 条 `北京市 / 中国 / city / osm_value=city / extent [115.416849,41.059236,117.7371243,39.1707096]`。

**OpenCC 实测**（`opencc-js@1.4.2`，`Converter({from:'cn',to:'tw'})`）：

```text
东京 -> 東京
京都 -> 京都
建国路87号 -> 建國路87號
```

**结论**：`东京` 必须变成 `東京` 才能让公共 Photon 召回日本东京；`京都` 简繁同形，直接可用。这就是 §5.3 的 query variant 依据。

---

## 5. C：可移植的判定与排序规格

> 本节是算法规格，不是代码。标注 `【Pelias】` 的条目来自上述 Pelias 源码；标注 `【适配层，本仓库原创】` 的条目是把 provider 接到 Pelias 模型所必需、但 Pelias 本身没有的胶水，已说明为什么不能照搬。

### 5.1 输入与输出

**输入**：

```text
SearchRequest = {
  q: string,                 // 用户原始 query，1..120
  limit: 1..10,              // 默认 6
  lang?: "zh" | "en",        // 默认 zh
  country?: ISO3166 alpha-2, // 可选；CN/JP/FR...
  focus?: { lat, lon }       // 可选；对应 Pelias focus.point
}
ProviderRawResult = 每个 provider 的原始 JSON（腾讯 geocoder/suggestion、Geoapify FeatureCollection、Photon FeatureCollection）
```

**输出**（保持现有 `PlaceSearchResponse` 契约，不改字段）：

```text
SearchResult = {
  items: Place[],            // 已按 Pelias 规则排序、去重、截断到 limit
  provider: Provider,        // 第一条结果的 provider（现有契约）
  degraded: boolean,
  cached: boolean,
  fallback?: "map_pick"
}

Place = {
  provider, providerPlaceId, name, address, country, countryCode,
  lat, lng, timeZone, bbox,
  importance,                // 本规格写入 Pelias confidence（0..1），沿用现有字段
  type                       // 由 Pelias layer 映射到 city/region/country/poi/other
}
```

**不新增 API 字段**：`confidence` / `layer` / `match_type` / `accuracy` 只作为内部排序/日志字段；对外仍用现有 `importance`（0–1）表达「这条结果的置信度」。如果产品以后要展示 `layer`/`matchType`，再单独走契约变更。

### 5.2 Provider  eligibility（谁参与召回）

```text
eligible = []
if (country == "CN") eligible.push("tencent")
else if (country == null && HAN_SCRIPT.test(q)) eligible.push("tencent")
if (geoapifyApiKey != null) eligible.push("geoapify")
eligible.push("photon")
```

- `tencent` 只在中国大陆路由出现：显式 `country=CN`，或未给 country 且 query 含汉字。`country` 明确为 `JP` / `FR` 等非 CN 时**不调用腾讯**。这是【适配层，本仓库原创】，依据是腾讯 WebService 的中国大陆覆盖定位（`https://lbs.qq.com/service/webService/webServiceGuide/webServiceSearch`），不是 Pelias 规则。
- `geoapify` 在配置了 key 时始终参与；`photon` 始终参与。
- `lang` 原样传给 Geoapify/Photon；Photon 对不支持的 `lang` 已在 `photon.client.ts:102-108` 做一次「去掉 lang 重试」，本规格保留。
- 所有 eligible provider **并行**请求；每个 provider 单独超时/配额，不因为一个失败阻断其他。

### 5.3 Query variants（简繁变体）

```text
variants(provider, q):
  if provider == "tencent": return [q]
  if HAN_SCRIPT.test(q):
     t = openccS2T(q)          // opencc-js Converter({from:'cn', to:'tw'})
     return unique([q, t])
  return [q]
```

- `opencc-js` 的 `s2t` 配置见 `opencc-js/src/data-config.js:30-31`（`s2t: { from:'cn', to:'t', segmentation:'STPhrases', chain:[['STPhrases','STCharacters']] }`），用法见 `README.md:57-69`。
- 实测：`东京 -> 東京`、`京都 -> 京都`、`建国路87号 -> 建國路87號`（§4.5）。
- **为什么不能照搬 Pelias**：Pelias 本身不做简繁转换；它的多语言 name 依赖 importer 导入 `name:zh` / `name:ja`。我们的 provider 是运行时 API，没有 Pelias importer，所以必须由适配层生成 query variant。这是 i18n 适配，不是排序算法。
- 如果团队拒绝 `opencc-js` 依赖：把 `PHOTON_URL` 指向自建 Photon，导入时用官方 `-languages zh`（`photon/docs/usage.md:156-161`），并直接查 `q=东京`；此时可以删掉 `opencc-js`。但这要求运维重导入 Photon 数据。

### 5.4 归一化成 Pelias `Document`

对每个 provider 的每条原始结果，构造以下对象（字段名对齐 `pelias/model/Document.js:119-144`）：

| Pelias 字段 | 来源（腾讯） | 来源（Geoapify） | 来源（Photon） |
|---|---|---|---|
| `source` | `"tencent"` | `"geoapify"` | `"photon"` |
| `layer` | 见 §5.4.1 `level` 映射 | `properties.result_type` 映射，见 §5.4.2 | `properties.type` / `osm_value` 映射，见 §5.4.3 |
| `source_id` | `item.id` / `result` 无 id 用 `null` | `properties.place_id` | `osm_type + ":" + osm_id` |
| `name.default` | `result.title` 或 `item.title` | `properties.name` | `properties.name` |
| `name.zh` / `name.en` | 不伪造；只有 API 显式返回才写 | 不伪造 | `properties.name` 当前语言 + 可选翻译 |
| `parent.country` | `"中国"`（`ad_info`/`address_components` 国家） | `properties.country` | `properties.country` |
| `parent.region` | `ad_info.province` / `address_components.province` | `properties.state` | `properties.state` |
| `parent.locality` | `ad_info.city` / `address_components.city` | `properties.city` | `properties.city` |
| `parent.localadmin` | `ad_info.district` / `address_components.district` | `properties.county` / `district` | `properties.district` |
| `parent.neighbourhood` | `ad_info.district` 仅在 district 级 POI 时 | `properties.suburb` | `properties.district` / `locality` 的下级 |
| `address_parts.number` | `address_components.street_number` | `properties.address_line1` 拆分出的门牌 | `properties.housenumber` |
| `address_parts.street` | `address_components.street` | `properties.street` | `properties.street` |
| `address_parts.zip` | 腾讯无邮编时 `null` | `properties.postcode` | `properties.postcode` |
| `center_point` | `result.location` / `item.location`（GCJ-02 → WGS-84，沿用 `tencent-normalizer.ts:92-114`） | `geometry.coordinates` / `properties.lon`,`lat` | `geometry.coordinates` |
| `bounding_box` | `null`（腾讯不返回 bbox） | `feature.bbox` / `properties.bbox` | `properties.extent`（`[west,north,east,south]` 转 `[west,south,east,north]`，沿用 `photon-normalizer.ts:104-121`） |
| `population` | 无 → 不写 | 无 → 不写 | `properties.extra.population`（需要 Photon `-extra-tags population`） |
| `popularity` | 无 → 不写 | `properties.rank.importance` 只作 provider 内部 `_score`，**不写 popularity** | 无 → 不写 |
| `category` | `item.category` / `result.category` | `properties.result_type` | `properties.osm_key` / `osm_value` |
| `accuracy` | `level 9/10/11` → `point`，其余 → `centroid` | `result_type` 为 address/venue → `point`，否则 centroid | `type=house/street` → `point`，否则 centroid |

**Population 的硬规则**：只有 provider 明确返回 population 时才写 `population`；不得从 `rank.importance`、`extent` 面积、`adcode` 推断 population。Pelias 的 `field_value_factor` 对缺失字段使用 `missing: 1`（`pelias/query/view/population.js:28-35`），所以缺失时为 0 分，不会伪造大城市。

#### 5.4.1 腾讯 `level` → Pelias layer

按 `https://lbs.qq.com/service/webService/webServiceGuide/address/Geocoder` 的 `level` 表：

| 腾讯 `level` | Pelias `layer` |
|---:|---|
| 0 | 丢弃（官方「无法判别，结果不可信」） |
| 1 | `locality` |
| 2 | `localadmin` |
| 3 | `localadmin` |
| 4 | `neighbourhood` |
| 5 | `localadmin` |
| 6 | `neighbourhood` |
| 7 | `street` |
| 8 | `street` |
| 9 | `address` |
| 10 | `venue` |
| 11, 21+ | `venue` |

腾讯 `place/v1/suggestion` 的 `type=4`（行政区划）没有 `level`，按 `ad_info` 的 adcode 规则补判：

```text
if (type != 4) -> layer = "venue"
if (type == 4):
  if (province == city == title) -> "locality"       // 直辖市：北京/上海/天津/重庆
  else if (adcode % 10000 == 0) -> "region"           // 省级
  else if (adcode % 100 == 0) -> "locality"           // 市级
  else -> "localadmin"                                 // 区县/乡镇
```

这是【适配层，本仓库原创】的字段映射；`adcode` 规则来自腾讯官方 `webServiceDistrict#6`，不包含任何地名清单。

#### 5.4.2 Geoapify `result_type` → Pelias layer

| `properties.result_type` | Pelias `layer` |
|---|---|
| `country` | `country` |
| `state` | `region` |
| `county` | `county` |
| `city` | `locality` |
| `suburb`, `district` | `neighbourhood` |
| `street` | `street` |
| `postcode` | `postalcode` |
| `amenity`, `shop`, `tourism`, `building` | `venue` |
| 其他 | `other` |

依据：`apps/api/src/modules/places/geoapify-normalizer.ts:135-155` 现有 `placeType` 映射（只到 `PlaceType`），本表是把它细化到 Pelias `layer` 的【适配层，本仓库原创】；`result_type` 的官方含义见 Geoapify 文档 `https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/`。

#### 5.4.3 Photon `type` / `osm_value` → Pelias layer

| Photon `properties.type` / `osm_value` | Pelias `layer` |
|---|---|
| `country` | `country` |
| `state` | `region` |
| `county` | `county` |
| `city` | `locality` |
| `district` | `neighbourhood` |
| `locality` | `locality` |
| `street` | `street` |
| `house` + `housenumber` | `address` |
| `house`（无 housenumber） | `venue` |
| `other` | `other` |

依据：`photon/docs/api-v1.md:175-191` 的 layer 列表（`house`/`street`/`locality`/`district`/`city`/`county`/`state`/`country`/`other`），以及 `photon/src/main/java/de/komoot/photon/searcher/GeoJsonFields.java:15-34` 的字段定义。映射本身是【适配层，本仓库原创】。

### 5.5 Confidence 计算

**主路径（有 `parsed_text`）**：逐函数移植 `pelias/api/middleware/confidenceScore.js:58-273` 的 `computeConfidenceScore()`：

```text
computeConfidence(text, parsedText, hit, scores, relativeScores=true):
  if dealBreaker(parsedText, hit): return 0.5
  checkCount = 3 + (relativeScores ? 2 : 0)
  confidence = 0
  if relativeScores:
    confidence += checkDistanceFromMean(hit._score, mean(scores), stdev(scores))
    confidence += computeZScore(hit._score, mean(scores), stdev(scores))
  confidence += checkName(text, parsedText, hit)
  confidence += checkQueryType(parsedText, hit)
  confidence += checkAddress(parsedText, hit)
  return round(confidence / checkCount, 3)
```

- 所有子函数按 §3.1.1 的公式与分支一一对应；`checkName` 在 `parsedText` 为空时自动回退到 `text`（`confidenceScore.js:132-146`），因此中文 query 即使 parser 无解也能算出合理值。
- `parsed_text` 由 `pelias-parser` 的 `AddressParser` + `Tokenizer` 生成；映射规则来自 `pelias/parser/server/routes/parse.js:28-39`（`label` → 字段）与 `parser/AddressParser.js:42-140`。中文 parser 可能无解（本机测试 `北京/东京/京都/建国路87号` 均无 solution），此时 `parsed_text = undefined`，按 `confidenceScore.js` 的「无 parsed_text」分支退化，不报错。
- `_score` 的来源是【适配层，本仓库原创】：Pelias 的 `_score` 是 Elasticsearch BM25（`pelias/api/service/search.js:43-57`），我们无法在没有 ES index 的情况下复现。因此：
  - Geoapify：`_score = rank.confidence`（官方 0–1 字段，`https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/`）；
  - Tencent / Photon：`_score = 1 / (1 + providerRank)`（provider 返回顺序的倒数）；这是适配层，不是 Pelias 公式。
  - 该代理只影响 `confidenceScore.js` 的 `D`/`Z` 两项；`N`/`Q`/`A` 仍是 Pelias 原公式。

**Fallback 路径（无 `parsed_text` 或需要 layer 惩罚）**：逐函数移植 `pelias/api/middleware/confidenceScoreFallback.js:47-240`：

```text
if (!parsedText) { confidence = 0.1; match_type = "unknown"; return }
confidence = 1.0 * layerPenalty(hit.layer)   // 0.8/0.6/0.4/0.3/0.1，见 §3.1.2
match_type = fallbackOccurred ? "fallback" : "exact"
```

**采用哪条**：C 节推荐 **主路径 `confidenceScore.js`** 作为 `Place.importance`，因为现有 API 已经有 `importance` 0–1 字段；`confidenceScoreFallback.js` 用于 `match_type` 判定和 `degraded` 判定。两条都来自 Pelias，不混合 Nominatim/Photon 打分。

**关于 Pelias 原路由的 middleware 顺序**：`pelias/api/routes/v1.js:226-231` 同时挂载 `confidenceScore` 与 `confidenceScoreFallback`，后者在源码里会重置 `hit.confidence = 1.0`（`confidenceScoreFallback.js:56-65`）；本规格**不复刻这个 middleware 覆盖顺序**，而是把两个函数当纯函数分别调用：`computeConfidenceScore()` 只写 `importance`，`checkFallbackLevel()` 只写 `matchType`/layer penalty。这是【适配层，本仓库原创】的解耦，原因是我们不能直接运行 Pelias 的 Express middleware，也没有 ES `_score`；如果不解耦，最终 confidence 会被 fallback 覆盖。

### 5.6 Requested-layer 过滤（Pelias fallbackRules）

在排序前，按 Pelias `confidenceScoreFallback.js:124-185` 的 `fallbackRules` 做一次候选过滤：

1. 由 `parsed_text` 确定 `expectedLayers`：
   - `venue`：`parsed_text.query` 存在且无更细字段；
   - `address`：`parsed_text.housenumber` + `parsed_text.street`；
   - `street`：只有 `parsed_text.street`；
   - `postalcode`：`parsed_text.postalcode`；
   - `city`：`parsed_text.city`，expected `borough/locality/localadmin`；
   - `county` / `state` / `country` 对应 `county` / `region` / `country`。
2. 如果候选集中有任意一条 `layer ∈ expectedLayers`，丢弃不在 `expectedLayers` 的候选；如果一条都没有，保留全部，全部标 `match_type = "fallback"`。
3. 对于地址 query，额外使用腾讯 `level=9`（门址）作为 `expectedLayers = ["address"]` 的信号；这是【适配层，本仓库原创】，因为腾讯 `level` 是官方字段而 Pelias parser 对中文地址无解。

这个过滤对应 `pelias/api/middleware/trimByGranularity.js:61-107` 的「保留最细粒度匹配」意图；区别是 Pelias 用 ES 的 `_matched_queries`，我们用 `parsed_text`/腾讯 `level` 重建同一语义。**这是本规格唯一不能 1:1 照搬 Pelias 的地方**，因为 `_matched_queries` 是 Elasticsearch 产物（`trimByGranularity.js:36-44`）。

### 5.7 排序（`pelias-sorting` 精确移植）

**直接依赖 `pelias-sorting@2.0.0`（MIT）**，把归一化后的结果数组传入：

```text
const comparator = require('pelias-sorting')({
  'focus.point.lat': request.focus?.lat,
  'focus.point.lon': request.focus?.lon
});
results.sort(comparator);
```

排序规则完全按 `pelias/sorting/index.js:5-187`：

1. 人口档位：`mega [4M, ∞)`、`large [500k, 4M)`、`medium [5k, 500k)`、`small [0, 5k)`。
2. popularity 档位：`very_popular [10k, ∞)`、`popular [1k, 10k)`、`nonpopular [0, 1k)`。
3. 同 layer 且都是目标 layer：人口大的优先；大/中/小 locality/localadmin 与 neighbourhood 在有 `focus.point` 时先比距离，再比 population/popularity。`index.js:56-95`。
4. 不同 layer：按 `index.js:143-171` 的 fallback 顺序，目标 layer 在前者优先。完整顺序见 §4.2。
5. `_score` 只在最后兜底（`index.js:165-170`），不作为同 layer 小城市的主排序。

**初始顺序**：由于 `Array.prototype.sort` 是稳定排序（`pelias/api/middleware/sortResponseData.js:11-15` 明确 capture pre/post order），在 population/popularity 都为 0 且同 layer 时，保留适配层传入的 provider 顺序。适配层按 `tencent` → `geoapify` → `photon` 拼接（仅 eligible 的 provider）。这是【适配层，本仓库原创】的 tie-break，Pelias 本身没有 provider 顺序概念（`search.md:330` 明确说 `sources` 顺序不影响排序）。

### 5.8 去重

移植 `pelias/api/middleware/dedupe.js:15-107` + `helper/diffPlaces.js:13-398`：

- `isDifferent(item1, item2, lang)` 判断两条记录是否为同一地点（名称、地址、layer、距离等；`diffPlaces.js:252-394`）。
- `isPreferred(existing, candidate)`（`dedupe.js:67-103`）的优先级：有 postcode 的记录 > 无 postcode；非 canonical source > canonical source；`layerPreferences`（`country` → `locality` → `localadmin` → `county` → `region` → `neighbourhood` → `macrocounty` → `macroregion` → `empire`，见 `diffPlaces.js:13-23`）；最后按 source 的固定偏好。
- source 偏好映射（【适配层，本仓库原创】）：`tencent` 视为「CN 地址/POI 优先」，`photon` 视为「多语言地名优先」，`geoapify` 视为「全球地址 fallback」。具体映射在 `pelias-dedupe.ts` 的 `SOURCE_PREFERENCE` 常量中，必须写单元测试。
- 如果 v1 工期紧，可先只做「`source_id` 相同 + 名称归一化相同」的保守去重，但必须在规格里标注这是临时降级，不能宣称完整 Pelias 去重。

### 5.9 `degraded` 标志

Pelias 没有 `degraded` 字段；这是【适配层，本仓库原创】。定义：

```text
degraded =
  items.length == 0
  || eligible.every(p => p.failed)
  || items.every(i => i.matchType == "fallback" && i.confidence <= 0.4)
```

- 单个 provider 失败但其它 provider 返回高置信结果：`degraded = false`，但要写 `places.search_degraded` 日志（provider/reason/duration），保留可观测性。
- 全部 provider 失败或全部结果都是 fallback 且 confidence ≤ 0.4：`degraded = true`，客户端显示降级提示；如果 `items.length == 0` 再带 `fallback: "map_pick"`。
- 这样保留现有 `PlaceSearchResponse.degraded` 语义（`packages/contracts/src/api/places.ts:96-110`），不新增字段。

### 5.10 验收用例（必须逐条通过）

| Query | Eligible providers | 候选 layer（预期） | 决定规则 | 期望结果 |
|---|---|---|---|---|
| `北京` | Tencent（汉字）+ Geoapify + Photon | Tencent `locality`（level 1）；Photon `locality`（city） | 同 layer、population 都缺失 → 稳定排序保留 Tencent 在前 | `provider=tencent`，名称北京/北京市，坐标北京 |
| `东京` | Tencent + Geoapify + Photon | Tencent `localadmin`（level 3，东京镇）；Photon `locality`（東京，city） | `pelias-sorting` 的 `small locality` 先于 `small localadmin`（`index.js:155-163`） | 日本东京，`countryCode=JP`，`provider=photon` |
| `京都` | Tencent + Geoapify + Photon | Tencent 若无结果或 `venue/localadmin`；Photon `locality`（京都，city） | `locality` 先于 `venue/localadmin` | 日本京都，`countryCode=JP`，`provider=photon` |
| `建国路87号` | Tencent + Geoapify + Photon | Tencent `address`（level 9）；其他可能 `address`/`locality` | 地址过滤（`expectedLayers=["address"]`）保留 address；同层稳定 Tencent 在前 | 北京建国路87号，`provider=tencent`，`type=poi` |
| `Paris` | Geoapify + Photon（Tencent 不 eligible） | Photon `locality`（Paris, France）；Photon `locality`（Paris, TX）；Geoapify 类似 | `pelias-sorting` 的 `large locality` / population：Paris, France 优先；无 population 时 provider 原始顺序 Photon 已把 France 排第一 | 法国巴黎，`countryCode=FR` |

**必须说明的前提**：`东京` / `京都` 的全球召回依赖 §5.3 的 `opencc-js` 繁体变体，或自建 Photon `-languages zh`。公共 Photon `q=东京` 实测只返回中国同名地点（§4.5），所以**不配置 zh / 不做繁体变体，这两个用例不可能通过**。这是数据覆盖问题，不是排序公式能修复的。

### 5.11 来源标注总表（哪条来自哪里）

| 规格条目 | 来源 | 性质 |
|---|---|---|
| `source` / `layer` / `source_id` / `name` / `parent` / `address_parts` / `center_point` / `bounding_box` / `population` / `popularity` / `category` 字段 | `pelias/model/Document.js:70-185`；`pelias/schema/mappings/document.js:9-176` | 【Pelias】直接移植 |
| confidence 主公式 | `pelias/api/middleware/confidenceScore.js:58-273` | 【Pelias】逐函数移植 |
| fallback 的 layer 惩罚 / match_type | `pelias/api/middleware/confidenceScoreFallback.js:47-240` | 【Pelias】逐函数移植 |
| `accuracy` | `pelias/api/middleware/accuracy.js:38-54` | 【Pelias】直接移植 |
| layer 顺序 / fallback 过滤意图 | `pelias/api/middleware/trimByGranularity.js:18-113`；`pelias/documentation/search.md:341-363` | 【Pelias】移植意图；`_matched_queries` 用 `parsed_text` 重建（适配） |
| 歧义排序（layer/population/popularity/focus） | `pelias/sorting/index.js:5-187` | 【Pelias】直接依赖 npm 包 |
| 去重 | `pelias/api/middleware/dedupe.js:15-107`；`helper/diffPlaces.js:13-398` | 【Pelias】逐函数移植 |
| `population` 语义 / 来源 | `pelias/whosonfirst/src/peliasDocGenerators.js:103-111`；`photon/docs/usage.md:163-170` | 【Pelias】字段语义；population 由 provider 提供 |
| `sources` / `layers` / `boundary.country` / `focus.point` | `pelias/documentation/search.md:72-115,203-233,289-339`；`pelias/api/query/search_pelias_parser.js:41-48` | 【Pelias】官方过滤语义 |
| `customBoosts` | `pelias/api/README.md:183-213`；`pelias/api/query/view/boost_sources_and_layers.js:1-121` | 【Pelias】官方 boost 语义；本规格未强制使用 |
| `_score` 代理（Tencent/Photon 排名倒数；Geoapify `rank.confidence`） | 无上游；Pelias `_score` 是 ES BM25（`pelias/api/service/search.js:43-57`） | 【适配层，本仓库原创】无法照搬，因为没有 ES index |
| provider eligibility（腾讯只在中国路由） | 腾讯官方 `webServiceSearch` / `webServiceSuggestion`；`places.service.ts:75-85` 现状 | 【适配层，本仓库原创】业务路由策略，不是 Pelias |
| 简繁 query variant（`opencc-js`） | `opencc-js/src/data-config.js:30-31`；`README.md:57-69` | 【适配层，本仓库原创】Pelias 不做简繁转换 |
| `degraded` 标志 | 无上游；现有 `PlaceSearchResponse.degraded` | 【适配层，本仓库原创】Pelias 只有 per-result confidence/match_type |
| `Place.importance` = confidence | 现有契约 `packages/contracts/src/api/places.ts:75-77` | 【适配层，本仓库原创】把 Pelias confidence 接到现有字段 |

**本规格不含任何地名清单 / 白名单。** 所有判定只使用：query 的 Unicode script（是否为 Han）、provider 返回的 `level` / `result_type` / `type` / `osm_value` / `adcode` 结构、Pelias `layer` / `population` / `popularity` / `focus.point` / `boundary.country`。`北京`、`东京`、`京都`、`建国路87号`、`Paris` 只是验收样本，不写进代码常量。

---

## 6. D：落地成本评估

### 6.1 需要新增 / 修改的文件（只列，不写）

**新增（API）**

| 文件 | 说明 |
|---|---|
| `apps/api/src/modules/places/ranking/pelias-document.ts` | 用 `pelias-model` `Document` 包装 provider 结果；字段映射见 §5.4 |
| `apps/api/src/modules/places/ranking/pelias-confidence.ts` | 移植 `confidenceScore.js` 的 `computeConfidenceScore` 及子函数 |
| `apps/api/src/modules/places/ranking/pelias-fallback.ts` | 移植 `confidenceScoreFallback.js` 的 `fallbackRules` / layer 惩罚 |
| `apps/api/src/modules/places/ranking/pelias-accuracy.ts` | 移植 `accuracy.js` |
| `apps/api/src/modules/places/ranking/pelias-granularity.ts` | 移植 `trimByGranularity` 的 requested-layer 过滤（用 `parsed_text` 重建） |
| `apps/api/src/modules/places/ranking/pelias-dedupe.ts` | 移植 `dedupe.js` + `diffPlaces.js` |
| `apps/api/src/modules/places/ranking/pelias-sort.ts` | 包装 `pelias-sorting` 的 comparator |
| `apps/api/src/modules/places/ranking/pelias-query-parser.ts` | 可选：用 `pelias-parser` `AddressParser` 生成 `parsed_text`；中文可无解 |
| `apps/api/src/modules/places/ranking/query-variants.ts` | `opencc-js` 简繁 query variant |
| `apps/api/src/modules/places/places-merge.service.ts` | 并行召回 + 归一化 + 过滤 + 排序 + 去重 + degraded |

**修改（API）**

| 文件 | 说明 |
|---|---|
| `apps/api/src/modules/places/places.service.ts` | 删除 `isChinaQuery` / `allowsPhotonFallback` 的硬路由，改为 `eligible` 多源并行 + `PlacesMergeService`；保留缓存/配额/日志/`map_pick` |
| `apps/api/src/modules/places/places.module.ts` | 注入 `PlacesMergeService`、ranking 组件；注册 provider clients |
| `apps/api/src/modules/places/places.settings.ts` | 增加 provider eligibility / Photon languages / `sourceOrder` / `focus` 透传配置（不新增密钥） |
| `apps/api/src/modules/places/tencent.client.ts` | 增加 `geocoder/v1?address=` 的可选调用；保留 `suggest()` 供 autocomplete |
| `apps/api/src/modules/places/tencent-normalizer.ts` | 暴露 `level` / `ad_info` / `category` 给 ranking；保持 `Place` 契约输出 |
| `apps/api/src/modules/places/geoapify-normalizer.ts` | 暴露 `result_type` / `rank.confidence` / `rank.match_type`；保持 `Place` 契约 |
| `apps/api/src/modules/places/photon-normalizer.ts` | 暴露 `type` / `osm_value` / `extent` / `extra.population`；保持 `Place` 契约 |
| `apps/api/src/modules/places/places-cache.service.ts` | cache key 从 `provider` 改为 `route`（`cn` / `global` / `mixed`）+ query + lang + country + focus；或保留 provider 键并加 `route` |
| `apps/api/src/modules/places/__tests__/place-fixtures.ts` | 增加 §6.3 的真实 provider fixtures |
| `apps/api/src/modules/places/__tests__/places.service.spec.ts` | 替换「汉字 query 不调 Photon」等旧断言（当前 `places.service.spec.ts:584-660` 明确断言 Han query 只调 Geoapify） |
| `apps/api/src/modules/places/__tests__/tencent.client.spec.ts` | 增加 `geocoder/v1` level 1/3/9 用例 |
| `apps/api/src/modules/places/__tests__/geoapify-normalizer.spec.ts` | 增加 `rank.match_type` / `rank.confidence` 用例 |
| `apps/api/src/modules/places/__tests__/photon-normalizer.spec.ts` | 增加 `extra.population` / `extent` 用例 |

**契约 / 前端 / 配置**

| 文件 | 说明 |
|---|---|
| `packages/contracts/src/api/places.ts` | **建议不改**：`importance` 承载 confidence；若产品要展示 layer/matchType，才新增字段 |
| `packages/contracts/openapi.json` | 仅当 `places.ts` 变更时由生成脚本重新生成 |
| `packages/api-client/src/generated/**` | 仅当 OpenAPI 变更时由 Orval 重新生成 |
| `apps/web/lib/api/trip-form.ts` | 仅当 `PlaceSearchResponse` 形状变化时适配；当前不需要 |
| `apps/web/components/map/places-attribution.tsx` | 已用 `provider` 做 attribution，不需要改 |
| `apps/api/package.json` | 新增依赖（见 §6.2） |
| `pnpm-lock.yaml` | 锁文件 |
| `.env.example` | 如需新增 `PHOTON_LANGUAGES` / `PHOTON_EXTRA_TAGS` 说明（可选） |

**不新增数据库迁移**：`PlaceSearchResponse` / `Place` 不落库；`Stop` 的 `provider` 枚举不变。

### 6.2 新依赖

| 包 | 版本（npm） | 许可证 | 用途 | 是否必须 |
|---|---|---|---|---|
| `pelias-model` | `11.1.0` | MIT | `Document` 字段模型 | 是（或按 §2.4 移植字段对象，不推荐） |
| `pelias-sorting` | `2.0.0` | MIT | 歧义排序 comparator | 是 |
| `pelias-parser` | `5.0.0` | MIT | `parsed_text`（Latin query；中文可无解） | 可选；不装则 `parsed_text=undefined`，confidence 走退化分支 |
| `opencc-js` | `1.4.2` | MIT AND Apache-2.0 | `东京 -> 東京` 简繁 variant | 可选；如果不装，必须自建 Photon `-languages zh` |

**不需要**：Elasticsearch / OpenSearch / Redis 新组件 / PostgreSQL 扩展 / 新的地图 API key。`pelias-model` 会带 `pelias-config`、`lodash`、`glob`、`through2` 等传递依赖；如果团队拒绝这类依赖，可只移植 `Document` 的字段对象（§2.4 已标为适配层），但会失去与 Pelias 上游的 1:1 对照能力。

### 6.3 测试 fixture 清单与样本获取

| Fixture | 内容 | 获取方式 |
|---|---|---|
| `tencent-geocoder-beijing.json` | `geocoder/v1?address=北京`：`status:0`，`result.level=1`，`title=北京市`，`location` | `curl -sG 'https://apis.map.qq.com/ws/geocoder/v1/' --data-urlencode 'address=北京' --data-urlencode "key=$TENCENT_MAPS_KEY"` |
| `tencent-geocoder-tokyo.json` | `address=东京`：期望 `level=3`，`title=东京镇`，`address_components.province=黑龙江省`、`city=牡丹江市`、`district=宁安市` | 同上，`address=东京` |
| `tencent-geocoder-jianguolu.json` | `address=建国路87号`：`level=9`，`title=北京SKP` | 同上；现有 `place-fixtures.ts:268-350` 已有 `建国路87号` 的 suggestion/geocoder 形状，可复用 |
| `tencent-suggestion-beijing.json` | `place/v1/suggestion?keyword=北京`：`status:0`、`count:100`、`data[0]=北京天安门广场 39.90374,116.397827` | `curl -sG 'https://apis.map.qq.com/ws/place/v1/suggestion/' --data-urlencode 'keyword=北京' --data-urlencode "key=$TENCENT_MAPS_KEY"` |
| `geoapify-paris.json` | `text=Paris&lang=zh`：`FeatureCollection`，`features[0].properties.rank.importance/confidence/match_type`，法国 Paris 在前 | `curl -sG 'https://api.geoapify.com/v1/geocode/autocomplete' --data-urlencode 'text=Paris' --data-urlencode 'lang=zh' --data-urlencode "apiKey=$GEOAPIFY_API_KEY"` |
| `geoapify-beijing-empty.json` | `text=北京&lang=zh`：`features: []`（实测 0 条） | 同上，`text=北京` |
| `photon-paris.json` | `q=Paris&limit=5`：France city 第 1、France district 第 2、United States town 第 3 | `curl -sG 'https://photon.komoot.io/api/' --data-urlencode 'q=Paris' --data-urlencode 'limit=5'` |
| `photon-tokyo-simp.json` | `q=东京&limit=5`：中国 `东京` hamlet、`东京城镇` town（负样本） | 同上，`q=东京` |
| `photon-tokyo-trad.json` | `q=東京&limit=5`：日本 `東京` station、`東京都` city（正样本） | 同上，`q=東京` |
| `photon-kyoto.json` | `q=京都&limit=5`：日本京都 station/stop | 同上，`q=京都` |
| `photon-beijing.json` | `q=北京&limit=5`：`北京市` city，`extent` 见 §4.5 | 同上，`q=北京` |
| Pelias 上游单测 | `pelias/api/test/unit/middleware/confidenceScore.js`、`confidenceScoreFallback.js`、`pelias-sorting/test/index.js` | 直接从 upstream 复制测试用例并在我们的 `pelias-confidence.spec.ts` / `pelias-sort.spec.ts` 中逐条断言 |

**fixture 纪律**：

- 不在仓库提交任何真实 API key；fixture 中删掉 `key` / `apiKey` 字段。
- 每条 fixture 标注抓取日期、provider、endpoint、query、HTTP 状态。
- `tencent` fixture 保留 GCJ-02 原始坐标，normalizer 测试继续断言 `gcoord` 转 WGS-84（现有 `tencent-normalizer.ts:92-114`）。
- `photon` fixture 保留 `extent` 的 `[west, north, east, south]` 原始顺序，测试 `bboxFromExtent` 转为 `[west,south,east,north]`。

### 6.4 验证命令（实现后）

```bash
pnpm --filter @roamlog/api test -- places
pnpm --filter @roamlog/api typecheck
pnpm --filter @roamlog/contracts test
pnpm --filter @roamlog/api lint
```

新增测试至少覆盖：

1. `pelias-confidence.spec.ts`：直接用 Pelias 上游 fixture 的 input/expected，逐字段断言 `confidence` 与 `match_type`。
2. `pelias-sort.spec.ts`：`东京(locality) > 东京镇(localadmin)`、`Paris France > Paris TX`、`北京 Tencent locality` 在 stable tie 中保持。
3. `places-merge.service.spec.ts`：`北京` / `东京` / `京都` / `建国路87号` / `Paris` 五条验收用例；每个 provider 的 mock 响应来自 §6.3 fixture。
4. `places.service.spec.ts`：删除旧的「Han query 永不调 Photon」断言，改为「Han query 并行调 Tencent + Photon」；验证 `degraded` 三种分支。
5. 回归：`ai-tools.ts` 的 `searchPlaces` 仍能调用 `PlacesService.search`（CodeGraph 显示 4 个 caller）。

### 6.5 工作量估算

| 工作 | 人日 |
|---|---:|
| `pelias-model` / `pelias-sorting` 接入 + `pelias-document.ts` / `pelias-sort.ts` | 1.0 |
| `confidenceScore.js` + `confidenceScoreFallback.js` + `accuracy.js` 移植与单测 | 1.5 |
| `trimByGranularity` / `dedupe` / `diffPlaces` 移植 | 1.5 |
| 三个 provider adapter（含 `level` / `result_type` / `type` 映射） | 1.0 |
| `places-merge.service.ts` + `places.service.ts` 集成 + 缓存/配额/日志 | 1.0 |
| fixture 抓取、五条验收用例、回归 | 1.0 |
| **合计** | **7.0 人日**（不含 Photon 重导入运维） |

Photon 重导入（`-languages zh -extra-tags population`）需要单独运维窗口；如果不做，`东京` / `京都` 依赖 `opencc-js` 变体，`Paris` 依赖 provider 顺序。

---

## 7. 最大的 3 个不确定性

1. **Photon 的中文数据覆盖（最高风险）**：公共 `https://photon.komoot.io/api` 只支持 `default/de/en/fr`，`q=东京` 返回中国同名地点（§4.5 实测）。要满足 `东京 → 日本东京`，必须二选一：
   - 自建 Photon，导入时加 `-languages zh`（官方参数，`photon/docs/usage.md:156-161`）；
   - 或使用 `opencc-js` 生成 `q=東京` 再查公共 Photon（本规格的适配层方案）。
   如果两者都不做，`东京` 无法仅靠 Pelias confidence 修复。**这是数据覆盖问题，不是排序公式问题。**

2. **`_score` 代理与真实 Pelias confidence 的偏差**：Pelias `confidenceScore.js` 的 `D`/`Z` 依赖 Elasticsearch BM25 `_score` 分布（`pelias/api/service/search.js:43-57`）。我们没有 ES index，只能用 provider 排名倒数（Tencent/Photon）或 `rank.confidence`（Geoapify）代理。`confidence` 的绝对值会与真实 Pelias 部署不同，需要用 §6.3 fixture 校准；但 `N`/`Q`/`A`/`match_type` 的 Pelias 分支是 1:1 的。

3. **population 数据缺失导致 `pelias-sorting` 的人口 tie-break 失效**：腾讯 / Geoapify 默认响应没有 population；Photon 默认也不返回，除非自建实例加 `-extra-tags population`。没有 population 时，`pelias-sorting` 仍能靠 layer 顺序解决 `东京`/`京都`，但 `Paris, France vs Paris, Texas` 只能依赖 provider 原始顺序/`_score`；这需要在 fixture 中验证 Geoapify 的 Paris 顺序，并考虑是否接受 Photon 的 population 导入。**本规格不允许用 `rank.importance` / `extent` 伪造 population。**

补充不确定性（不算前 3，但需要实现时确认）：

- 腾讯 `geocoder/v1?address=东京` / `京都` 的真实响应未抓取（无 API key），`level=3` 是文档推断；需要 §6.3 fixture 验证。
- 百度官方文档在本环境返回 404/JS 渲染，未核实其 `adcode`/`level` 字段；本规格不依赖百度。
- `pelias-parser` 对中文 query 无解（本机测试 `北京/东京/京都/建国路87号` 均无 solution）；这符合其 Latin-centric 设计，不影响 `confidenceScore.js` 的退化分支，但意味着中文的 `parsed_text` 过滤主要靠腾讯 `level` 信号。

---

## 8. 参考来源索引（URL + commit）

### Pelias

- `https://github.com/pelias/pelias` @ `878d4b1e1f736f64a0bed3fef0882d5addcbb300`；`README.md:43,58-60,71-97`
- `https://github.com/pelias/api` @ `561e3e85f79b5388f88451cb1a49000764d29e35`；`middleware/confidenceScore.js:19-273`、`middleware/confidenceScoreFallback.js:29-240`、`middleware/accuracy.js:1-54`、`middleware/trimByGranularity.js:18-113`、`middleware/dedupe.js:15-107`、`helper/diffPlaces.js:13-398`、`service/search.js:39-57`、`README.md:183-213`、`query/view/boost_sources_and_layers.js:1-121`
- `https://github.com/pelias/model` @ `583b91a415b90fa3cfabdcc51604c26098ebe2ab`；`Document.js:70-185`、`post/popularity.js:1-33`
- `https://github.com/pelias/query` @ `f144189f9f7711f43b9599ed1d423e4c0cc87fc3`；`view/popularity.js:1-39`、`view/population.js:1-39`、`view/focus.js:1-50`
- `https://github.com/pelias/schema` @ `41e4f4009a82f336fc4beef998e35852c2616420`；`mappings/document.js:9-176`
- `https://github.com/pelias/sorting` @ `5eab078c6ad19039cc081bc087ac57f75549ff95`；`index.js:5-187`、`README.md:48-64`
- `https://github.com/pelias/parser` @ `1cd1a23e631b6692fe45f8058362ff98ec670e44`；`classification/Classification.js:1-16`、`README.md:185`、`parser/AddressParser.js:42-140`、`parser/Parser.js:1-77`、`server/routes/parse.js:1-39`
- `https://github.com/pelias/openstreetmap` @ `9668925dcbb0a447698cf04161da7ffd2773e87a`；`stream/document_constructor.js:27-30`、`stream/tag_mapper.js:21-126`、`stream/popularity_mapper.js:1-80`
- `https://github.com/pelias/whosonfirst` @ `fc508c6c708e638dc186fc3a01009eebce7f463d`；`src/peliasDocGenerators.js:72-150`
- `https://github.com/pelias/documentation` @ `b720f5fca86b04b18af68903d1b95c2a9aad7e2f`；`search.md:72-115,203-233,289-339,341-363,389`、`result_quality.md:6-64`、`language-codes.md:1-21`、`development/roadmap.md:36-51`

### 研究对照（不移植）

- `https://github.com/osm-search/Nominatim` @ `2a09655a1d8210a67169f4dd07cd8e75d2903a05`；`lib-sql/functions/importance.sql:146-205`、`lib-sql/functions/placex_triggers.sql:1030-1031`、`docs/customize/Importance.md:10-20`、`docs/customize/Ranking.md:6-29`；许可证 GPL-2.0-only（`COPYING`）。
- `https://github.com/komoot/photon` @ `15ba33ebac4d6f5deae288a106b24daac30a5662`；`docs/api-v1.md:175-191,215-269`、`docs/usage.md:156-170`、`searcher/GeoJsonFormatter.java:95-133`、`searcher/PhotonResult.java:31-37`、`opensearch/OpenSearchSearchHandler.java:22,48-71`、`opensearch/ResultScorer.java:11-46`、`nominatim/model/PlaceRowMapper.java:91-107`；许可证 Apache-2.0。
- `https://github.com/nchaulet/node-geocoder` @ `f66ea8db928d780b5d4268938909f86fba503eef`；`README.md:15-30,163-185`；许可证 MIT。

### 适配层依赖

- `https://github.com/nk2028/opencc-js` @ `3261dce0f02a54d7a6bfc31bef77269e2bf16551`；`src/data-config.js:30-31`、`README.md:57-69`；许可证 MIT AND Apache-2.0。

### 语言检测库（只作证据，不采用）

- `https://github.com/wooorm/franc` @ `398af8b77088974aff4f6c9e4bfd548ea4fb261e`；`README.md:12-14,19-23,59-66`；MIT。
- `https://github.com/google/cld3` @ `b48dc46512566f5a2d41118c8c1116c4f96dc661`；`README.md:11-33`；Apache-2.0。
- `https://github.com/greyblake/whatlang-rs` @ `7ddb6bbd158a27844378dd6df0f33f473cd3d731`；`README.md:34-53`；MIT。

### 国内 API 官方文档

- 腾讯地点搜索：`https://lbs.qq.com/service/webService/webServiceGuide/webServiceSearch`（响应参数：`ad_info.adcode/province/city/district`、`category`、`type`）
- 腾讯关键词输入提示：`https://lbs.qq.com/service/webService/webServiceGuide/webServiceSuggestion`（`type` 0–4）
- 腾讯地址解析：`https://lbs.qq.com/service/webService/webServiceGuide/address/Geocoder`（`level` 取值表）
- 腾讯行政区划：`https://lbs.qq.com/service/webService/webServiceGuide/webServiceDistrict#6`（adcode 6 位：2 省 + 2 市 + 2 区县；省级/市级/区县/省直辖县规则）
- 高德行政区划：`https://lbs.amap.com/api/webservice/guide/api/district`（`level`：province/city/district/street；街道无独立 adcode，继承区县）
- 高德搜索：`https://lbs.amap.com/api/webservice/guide/api/search`（`city` 接收 citycode/adcode；adcode 精确到区县）
- 百度地址解析：`https://lbsyun.baidu.com/index.php?title=webapi/guide/webservice-geocoding`（本环境仅能确认页面存在，字段未从 HTML 文本核实）
- 百度地点检索：`https://lbsyun.baidu.com/index.php?title=webapi/guide/webservice-placeapi`（本环境返回 404，未核实）

---

## 9. 最终建议（一句话）

**整块移植 Pelias 的 `Document` + `confidenceScore` + `confidenceScoreFallback` + `pelias-sorting` 模型，把腾讯/Geoapify/Photon 降为 `source` 适配器；不组合 Nominatim/Photon 的排序算法，不用地名白名单，不用 script classifier 自创路由。** 先做 Photon `-languages zh`（或 `opencc-js` 繁体 variant）与 population fixture，再按 §5.10 五条用例验收。
