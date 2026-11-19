# RESEARCH_PLACE_DB — Roamlog 全球地点/地址库技术调研

任务 ID：`RESEARCH_PLACE_DB`（只做调研，未修改 `apps/`、`packages/` 下任何文件）
调研时间：2026-11-19（Asia/Shanghai）
调研对象：`apps/api/src/modules/places/`（Photon 代理）+ `packages/contracts/src/api/places.ts`

> 证据标注约定：
> **[实测]** 本次在调研机上真实运行的网络请求/命令输出；
> **[官方]** 官方文档/许可页原文（附链接）；
> **[推断]** 基于架构或数字的推论，未直接验证；
> **[未验证]** 未取得可信来源，需二次确认。

---

## 0. 结论与推荐

### 0.1 一句话结论

**在当前 8C/16G/剩余 23G 磁盘的机器上，任何"全球全量"自托管方案（Pelias / Nominatim / Photon planet）都跑不起来；现实可行的是"GeoNames 本地城市底座 + 外部 POI 源"的混合方案，而且当前 Photon 代理之所以"效果不佳"，主因不是缺数据源，而是公开实例既不支持 `zh`、TTFB 又已达 1.6s。**

### 0.2 明确推荐（按阶段）

| 阶段 | 推荐动作 | 理由（详见 §5/§7） |
| --- | --- | --- |
| **现在（0–2 周）** | **不自托管全量**。保留 Photon 作为 POI 兜底，新增 **GeoNames 全量本地库**（SQLite + FTS5，约 1–4GB）承担 `country/region/city` 与中文名、`timeZone`、`importance`；API 内做"先本地、后远端"的两段式搜索 | 23G 磁盘 / 16G 内存是硬约束；GeoNames 是 CC BY 4.0，**可以永久落库**，中文名与 timezone 都在数据里 |
| **短期（2–6 周）** | 把 `Place` 契约升到 v2（`id`/`address`/`bbox`/`names`/`category`/`attribution`），POI 检索增加 `countrycode`、位置偏置、`layer` 过滤；修掉"上游 1.6s + 现有 2.5s 超时"只剩 0.9s 裕度的问题 | 现有契约丢掉了 Photon 已经返回的 `street/housenumber/postcode/extent/osm_key`，等于白扔数据 |
| **中期（需要 POI 质量时）** | 二选一：① 商务接入一家**允许持久化**的 POI 源；② 自托管**区域** Photon（先东亚/东南亚），磁盘按"索引 ×2（更新要双份）"预算 | 公开 Photon 只支持 `default/de/en/fr`，给不了中文 POI |
| **长期（磁盘 ≥200GB、RAM ≥64GB）** | Nominatim planet（full style）→ Photon planet，才能同时拿到"全球 + 中文 + 稳定 OSM id + 可持久化" | 这是唯一不依赖商业条款的全量路径，但门槛见 §2.2 的官方数字 |

### 0.3 "现在这台机器能不能跑"——判断表

按任务给定：8 vCPU / 16GB RAM / 58GB 磁盘、**剩余 23GB**。

| 方案 | 官方最低要求 | 23G 可用 | 16G 内存 | 判定 |
| --- | --- | --- | --- | --- |
| Nominatim planet（full style） | **~900GB SSD、≥64GB RAM**；full 导入后 330GB（导入期 640GB），54h `[官方]` | ❌ 差 40× | ❌ 差 4× | **不可行** |
| Pelias planet | ES 索引 **~450GB**，导入集群建议 **≥600GB**；36 核约 16h `[官方]` | ❌ | ❌（导入机建议 72GB） | **不可行** |
| Photon planet（自建索引） | **~95GB 磁盘**（2026 年，年增 ~10%），建议 **≥64GB RAM**；全量导入约半天 `[官方]` | ❌ 差 4× | ❌ 差 4× | **不可行** |
| Photon 区域索引（单国/次区域） | 无官方数字；按 planet 比例估算，单国约 1–5GB `[推断]` | ✅ 勉强 | ⚠️ 需实测 | **可试点**，但不满足"全球" |
| GeoNames SQLite + FTS5（全量） | 压缩包 403MB；解压+索引约 1.5–4GB `[推断]` | ✅ | ✅ | **可行，推荐** |
| OSMNames TSV + Sphinx/SQLite FTS | 体积未公布 `[未验证]` | ⚠️ | ⚠️ | 可作为 GeoNames 的替代底座 |

**结论：23GB 之下唯一能落地的"全球"底座是 GeoNames（城市/地区/国家级），POI 必须外挂。**

---

## 1. 基线：当前实现与实测

### 1.1 当前实现事实（CodeGraph 证据）

```
codegraph_explore(projectPath=…\roamlog, query="Place contract places.service photon-normalizer places.settings")
→ packages/contracts/src/api/places.ts:10 PlaceSchema（.strict()）
→ apps/api/src/modules/places/photon-normalizer.ts:111 normalizePhotonFeature
→ apps/api/src/modules/places/places.settings.ts:14-20 默认值
```

- `PlaceSchema`：`provider / providerPlaceId / name / country / countryCode / lat / lng / timeZone / type`，`.strict()`。
- `PlaceSearchQuerySchema`：`q(1..120) / limit(1..10,默认6) / lang("zh"|"en")`。
- `photon.client.ts`：只转发 `q / limit / lang(仅 en) / bbox`；`zh` 直接不转发（因为公开实例 400）。
- `places.settings.ts`：`PHOTON_TIMEOUT_MS=2500`、`PLACES_CACHE_TTL_SECONDS=900`、`PLACES_EMPTY_CACHE_TTL_SECONDS=30`、`PLACES_RATE_LIMIT_MAX=30/60s`。
- `photon-normalizer.ts`：**主动丢弃** Photon 返回的 `street / housenumber / postcode / extent / osm_key / osm_value`；`timeZone` 恒为 `null`；缺少 `country` 或 `countryCode` 的 feature 直接丢弃。

### 1.2 实测：公开 Photon（komoot）

| 请求 | HTTP | TTFB | 总耗时 |
| --- | --- | --- | --- |
| `?q=beijing&limit=3` | 200 | 1.7365s | 1.7371s |
| `?q=beijing&limit=3&lang=en` | 200 | 1.5946s | 1.5951s |
| `?q=shanghai&limit=3` | 200 | 1.6159s | 1.6162s |
| `?q=shanghai&limit=3&lang=en` | 200 | 1.6307s | 1.6310s |
| `?q=beijing&limit=3&lang=zh` | **400** | — | 1.6110s |

响应体原文（`lang=zh`）：

```json
{"lang":[{"message":"Language is not supported. Supported are: default, de, en, fr","args":{},"value":"zh"}]}
```

**判读：** 4 次成功请求 TTFB 落在 **1.59–1.74s**，现有 2.5s 超时只剩约 **0.8–0.9s** 裕度；`lang=zh` 的 400 也要烧掉 1.6s。这解释了"2.5s 超时"为何经常触发降级——不是超时设小了，是上游本身已接近预算。`[实测]`（测量点：调研机，中国大陆出口到 komoot 欧洲节点；地理距离会放大 RTT，但这正是目标用户的实际链路）

### 1.3 实测：公开 Nominatim（用于确认政策不是纸面条款）

```
GET https://nominatim.openstreetmap.org/search?q=beijing&format=jsonv2&limit=3&accept-language=zh
→ HTTP 403，3.19s，"Access denied. See https://operations.osmfoundation.org/policies/nominatim/"
```

`[实测]` 说明：公开实例会按 User-Agent/来源直接拒绝非合规调用；**不能作为产品流量入口**（政策细节见 §3.5）。

---

## 2. A. 自托管数据源

### 2.1 OSM 原始数据规模（所有自托管方案的分母）

| 指标 | 数值 | 时间/来源 |
| --- | --- | --- |
| `planet-latest.osm.pbf` | **89 GB** | 2026-11-19 `[官方]` https://planet.openstreetmap.org/ |
| `planet-latest.osm.bz2`（XML） | 168 GB | 同上 |
| Nodes / Ways / Relations | **11,006,066,511 / 1,234,093,846 / 15,230,697** | 2026-11-19 00:00 UTC `[官方]` https://planet.openstreetmap.org/statistics/data_stats.html |
| `addr:housenumber` 对象 | **185,564,384**（nodes 92.6M / ways 92.7M / relations 262k） | taginfo 数据截至 2026-11-18 `[官方]` |
| `addr:street` 对象 | 174,622,519 | 同上 |
| `amenity=*` 对象 | 35,401,262 | 同上 |
| `shop=*` 对象 | 7,304,843 | 同上 |
| `tourism=*` 对象 | 4,138,230 | 同上 |
| `building=*` 对象 | 714,429,044 | 同上 |

> taginfo 查询：`https://taginfo.openstreetmap.org/api/4/key/stats?key=addr%3Ahousenumber`（`key=amenity`/`shop`/`tourism`/`building` 同构）`[实测]`

**这张表就是"全球完整地址库"的真实体量：1.86 亿个门牌号。** 任何声称"完整"的方案都要先解释怎么装下并索引这 1.86 亿条。

### 2.2 逐项评估

#### ① Pelias（OSM + 多源，Elasticsearch）

- **数据体积**：全量 **>6 亿文档 / ES 约 450GB**；导入集群建议 **≥600GB** `[官方]` https://raw.githubusercontent.com/pelias/documentation/master/full_planet_considerations.md
- **构建成本**：36 核约 **16 小时**（同一文档）；另需 libpostal **4GB** 数据、placeholder SQLite **~5GB**、PIP Who's-on-First SQLite **~30GB**、interpolation **50GB** `[官方]` https://raw.githubusercontent.com/pelias/documentation/master/requirements.md
- **内存**：ES heap 官方给全量 **8GB**（`-Xmx8g`）、12 shard；查询集群示例 **2 × m5.2xlarge（8C/32G）服务 250 RPS** `[官方]`
- **查询延迟**：官方只给吞吐（API 单实例 ≥500 RPS），未给 p50/p95 → **`[未验证]`**
- **语言**：支持多语言检索，但"某个具体语言的名称覆盖率"取决于导入的 OSM `name:*` → 中文可用性 **`[未验证]`**
- **POI 覆盖**：OSM（含 OA/OSM/Who's on First 等 importer），POI 质量≈OSM
- **许可**：代码 Apache-2.0；数据 ODbL（OSM）+ 各 importer 自身许可
- **运维复杂度**：**高**（Elasticsearch 集群、libpostal、PIP、interpolation、placeholder 五个服务）
- **Docker**：有，`pelias/*` 系列；`pelias/api` 镜像在 Docker Hub 存在（**20,216,863 pulls**，last_updated 2026-10-21）`[实测]` https://hub.docker.com/r/pelias/api

#### ② Nominatim（OSM，PostgreSQL）

- **数据体积**（2020 planet，`--drop` 后）：`admin` 20GB / `street` 185GB / `address` 260GB / **`full` 330GB** / `extratags` 340GB；导入期分别是 215/440/545/**640**/650GB `[官方]` https://nominatim.org/release-docs/latest/admin/Import/
- **内存**：全量"**至少 64GB RAM，约 900GB SSD**"；flatnode 文件需额外 **≥75GB** 空闲 `[官方]` 同上
- **导入时间**：full **54 小时**（同一张表）；"即使配置完美，全量导入也要约 2 天" `[官方]` 同上
- **索引方式**：osm2pgsql → PostgreSQL + 自有 rank 索引（30 个 rank）
- **语言**：按 OSM `name:*` 分词，语言支持由 tokenizer（ICU）与数据决定
- **POI**：full style 含 POI；`--reverse-only` 可省 5%
- **许可**：GPL-3.0（代码）；数据 ODbL
- **Docker**：`mediagis/nominatim`（HTTP 200 确认存在，Nominatim 5.3.3）`[实测]` https://github.com/mediagis/nominatim-docker
- **运维**：高（PostgreSQL 调优、osm2pgsql 导入、更新流水）
- **延迟**：官方未给 → `[未验证]`

#### ③ Photon（自托管，OpenSearch）

- **数据体积**：**planet 约 95GB 磁盘（2026 年，年增约 10%）**；**建议 ≥64GB RAM**；SSD/NVMe 强烈推荐 `[官方]` https://github.com/komoot/photon
- **导入**：全世界数据集"约半天"；可 `-country-codes` 裁国、`-languages` 选语言、`-reverse-only` 显著变小 `[官方]` https://raw.githubusercontent.com/komoot/photon/master/docs/usage.md
- **索引方式**：内嵌 OpenSearch（或外接 OpenSearch 3.x）；`photon_data` 目录
- **更新**：**只能从 Nominatim 库更新**（`update-init` / `update` / `-enable-update-api`）→ 想持续更新就必须同时运维 Nominatim
- **Dump 捷径**：GraphHopper 提供周更 dump（`photon-db-planet-1.0-latest.tar.bz2`）`[官方]` https://download1.graphhopper.com/public/ ——**但 dump "只含 English、German、French 和本地语言"，且无 full geometry** `[官方]`。**这条最关键：走 dump 路线拿不到中文 POI。**
- **语言**：`-languages` 决定"导入哪些翻译 + 之后能请求哪些语言"，默认 en/de/fr/it `[官方]` → **自托管可以用 `zh`，但必须自己从 Nominatim 导入**
- **许可**：Apache-2.0（代码）；数据 ODbL
- **Docker**：**无官方 Docker Hub 镜像**（`hub.docker.com/v2/repositories/komoot/photon/` 返回 **404**）`[实测]`；官方分发是 jar + dump
- **延迟**：官方未给数字 → `[未验证]`（架构上是本地 OpenSearch 查询，`[推断]` 10–100ms 量级）

#### ④ OpenSearch/Elasticsearch + 自写 OSM 导入

- 本质是"自己造一个 Photon/Pelias"：需要 osm2pgsql 或 osmium 解析 89GB PBF、清洗 1.86 亿门牌号、建多语言字段、做增量 diff。
- **体积**：取决于字段与副本数，全量文本索引通常 **≥200–400GB** `[推断]`，无权威数字 → `[未验证]`
- **延迟**：可控（本地 ES，通常 10–50ms）`[推断]`
- **许可/运维**：许可自由（ODbL + 自写代码），运维**最高**（自己承担全部正确性）
- **Docker**：无现成镜像（这正是 Photon/Pelias 存在的理由）
- **判断：本项目不应自研导入器**——同样的工程量，Photon 已经做完且 Apache-2.0。

#### ⑤ SQLite / 离线轻量方案

| 项目 | 形态 | 体积 | 说明 |
| --- | --- | --- | --- |
| **Nominatim → SQLite** | `nominatim convert -o mydb.sqlite` | 未公布；可用 `--without-reverse/--without-search/--without-details` 裁剪 | **官方标注 experimental**，且**必须先做一次完整 PostgreSQL 导入**才能转换 `[官方]` https://nominatim.org/release-docs/latest/customize/SQLite/ |
| **OSMNames** | TSV（`planet-latest_geonames.tsv.gz` + `housenumbers.tsv.gz`），含 hierarchy + bbox + importance | 未公布 → `[未验证]` | 提供 Docker 化的 Sphinx 搜索服务 `klokantech/osmnames-sphinxsearch`；数据源 OSM `[官方]` https://github.com/OSMNames/OSMNames |
| **GeoNames allCountries** | TSV（见 §4.1） | 压缩 **403MB** | 非 OSM，城市/地名级；**无街道门牌** |
| **Addok** | Redis + Python，法国 BAN 专用 | 未验证 | 国别专用，不适合全球 `[未验证]` |

> 注：`place-search` / `osm-express` 这类名字未能确认到可信的活跃项目 → **`[未验证]`，不推荐基于它们做决策**。

#### ⑥ 其它值得考虑

- **Typesense / Meilisearch + 自建 OSM 名称抽取**：引擎本身成熟（拼写容错、多语言），但**没有现成的 OSM 全球导入管线**，等价于 ④ 的自研路线 → `[推断]` 不建议现在做。
- **Addok**：法国 BAN 场景很强，全球不适用。

### 2.3 A 表：自托管方案横向对比

| 方案 | 全量体积 | 内存 | 查询延迟 | 语言 | POI 覆盖 | 许可 | 持久化 | Docker | 运维 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Pelias** | ES ~450GB（集群 ≥600GB） | 查询 2×8C/32G @250RPS；导入机 36C/72G | `[未验证]`（≥500 RPS/实例） | 多语言（取决于 `name:*`） | OSM + 多 importer，较全 | Apache-2.0 / ODbL | ✅ 自有库 | ✅ `pelias/*` | 高 |
| **Nominatim** | full 330GB（导入期 640GB） | ≥64GB | `[未验证]` | 取决于 `name:*` + tokenizer | full style 含 POI | GPL-3.0 / ODbL | ✅ | ✅ `mediagis/nominatim` | 高 |
| **Photon** | **95GB**（planet） | **建议 ≥64GB** | `[未验证]` | **导入时 `-languages` 决定**；dump 仅 en/de/fr/local | OSM POI | Apache-2.0 / ODbL | ✅ | ❌ 无官方镜像（404） | 中（更新需 Nominatim） |
| **ES/OS + 自研导入** | ≥200–400GB `[推断]` | 未验证 | 10–50ms `[推断]` | 自定 | 自定 | 自定 | ✅ | ❌ | 最高 |
| **Nominatim→SQLite** | 未公布 | 低 | `[未验证]` | 同 Nominatim | 取决于裁剪 | 同上 | ✅ | ❌ | 中（实验特性 + 需先全量导入） |
| **OSMNames TSV** | 未公布 | 低 | `[未验证]` | 取决于抽取 | 名称级（+门牌文件） | ODbL | ✅ | ✅（Sphinx 版） | 中 |
| **GeoNames** | **403MB 压缩** | <1GB | 本地 FTS，`[推断]` <10ms | **含 `zh*` alternate names** | ❌ 无 POI/街道 | **CC BY 4.0** | ✅ | 自建 | **低** |

---

## 3. B. 托管 API

> 价格单位统一为**美元 / 每 1000 次请求**（首档，即 0–100k/月区间）。

### 3.1 Google Maps Platform（价格 `[官方]` 实取）

来源：https://developers.google.com/maps/billing-and-pricing/pricing?hl=en（页面内 SKU 表，2026-11-19 抓取）

| SKU | 每月免费额度 | 首档 $/1000 | 100k–500k | 500k–1M | 1M–5M | 5M+ |
| --- | --- | --- | --- | --- | --- | --- |
| **Geocoding**（`BAC8-4E68-E261`） | 10,000 | **$5.00** | $4.00 | $3.00 | $1.50 | $0.38 |
| **Autocomplete Requests**（`4EF4-B17C-B31A`） | 10,000 | **$2.83** | $2.27 | $1.70 | $0.85 | $0.21 |
| **Places API Text Search Pro** | 5,000 | **$32.00** | $25.60 | $19.20 | $9.60 | $2.40 |
| Places API Text Search Enterprise | 5,000 | $35.00 | $28.00 | $21.00 | $10.50 | $2.63 |
| Places API Text Search Enterprise + Atmosphere | 1,000 | $40.00 | $32.00 | $24.00 | $12.00 | $3.40 |
| Places API Place Details Enterprise | 1,000 | $20.00 | $16.00 | $12.00 | $6.00 | $1.51 |
| Places API Place Details Essentials (IDs Only) | **Unlimited** | **$0** | — | — | — | — |
| Autocomplete Session Usage | Unlimited | $0 | — | — | — | — |

**持久化条款（决定性）** `[官方]`：

- Geocoding 政策原文：*"Content, except for the place ID, should not be pre-fetched, cached, or stored without agreement."*
  https://developers.google.com/maps/documentation/geocoding/policies
- 通用条款原文：*"(b) No Caching. Customer will not cache Google Maps Content except as expressly permitted under the Maps Service Specific Terms."*
  https://cloud.google.com/maps-platform/terms
- 例外原文：*"Customer may cache the Google ID values from the Services that return such field and allow caching… (a) place_id from Places API, Directions API, Geolocation API and Routes API…"*（MSSP 第 3 条 Google ID Caching）
  https://cloud.google.com/maps-platform/terms/maps-service-terms
- **place_id 可以长期存**：*"Place IDs are exempt from the caching restrictions stated in Section 3.2.3(b)… You can therefore store place ID values for later use."*，但同一页也写明 *"Because Place IDs may change due to updates on the Google Maps database…"*
  https://developers.google.com/maps/documentation/places/web-service/place-id

**结论：可以存 `place_id`，不能存名称/地址/坐标文本。** Stop 若要在离线/历史日志里渲染名称，只能存 place_id 后在展示时实时取（Place Details 是计费 SKU）。

### 3.2 Mapbox（Geocoding v6 / Search Box）

条款 `[官方]` https://docs.mapbox.com/api/search/geocoding/ ：

- *"Temporary results are not allowed to be cached, while Permanent results are allowed to be cached and stored indefinitely."*
- 永久化需要**有效信用卡或企业合同**，请求参数 `permanent=true`。
- **硬限制**：*"You may only use responses from the Geocoding API in conjunction with a Mapbox map."* → Roamlog 若不用 Mapbox 底图，**不能只用它的 geocoding**。
- **v6 不再提供 POI 数据**：*"The Geocoding v6 API no longer provides POI data (use the Search Box API for POI search)."* → 酒店/餐厅要走 Search Box，而本文只验证了 Geocoding 的存储条款。
- 速率限制：**默认 1000 req/min**，可调。
- `autocomplete` 默认开，**每次按键 = 1 次请求**（"Cali" = 4 次）。
- 语言：`language` 支持 IETF 标签，官方列出 **`zh` / `zh_Hans` / `zh_Hant` / `zh_TW` 属 "Local coverage"**（几乎总有，但非"Global coverage"）→ 中文可用性优于 Photon 公开实例。
- **每 1000 次价格：`[未验证]`** —— 官方定价页是 Next.js 客户端渲染，直接抓取与 Wayback 快照都只返回页面标题。链接：https://www.mapbox.com/pricing/#search

### 3.3 Foursquare Places

- 文档可达：https://docs.foursquare.com/ （Places API New / Autocomplete / Search & Data endpoints 均在列）`[官方]`
- **每 1000 次价格与持久化条款：`[未验证]`** —— `docs.foursquare.com/.../pricing` 404；`location.foursquare.com` 在本机 TLS/抓取均失败（`fetch failed`）。定价页快照存在但为 JS 渲染：https://foursquare.com/pricing/
- 判断：POI 品类（餐厅/酒店）覆盖是它的强项，但**在商务确认"允许持久化 + 单价"之前不能进入架构**。

### 3.4 HERE

- Base Plan 页面存在：https://www.here.com/get-started/pricing `[官方，页面可达]`
- **每 1000 次价格与持久化条款：`[未验证]`** —— 页面价格表由 JS 渲染，直取与 Wayback 快照均只得到导航壳。需登录/询价确认。

### 3.5 免费/开源友好实例的政策（关键合规约束）

**Nominatim 公开实例** `[官方]` https://operations.osmfoundation.org/policies/nominatim/ ：

- **绝对上限 1 req/s**；必须带可识别 `User-Agent`/`Referer`；必须显示 ODbL 归属。
- **明确禁止 auto-complete**：*"Auto-complete search — This is not yet supported by Nominatim and you must not implement such a service on the client side using the API."*
- 禁止系统性查询/批量抓取；脚本类任务限 **4 req/min**，且**结果必须缓存**。
- 新增条款：**禁止被 no-code/low-code/vibe-coding 平台当作通用地理编码服务内置**。
- 商业应用"应预期政策随时变化，并准备自建实例"。

→ **Roamlog 的搜索框是典型 type-ahead，政策上直接禁止用公开 Nominatim。**（本次实测 403 也印证了拦截是生效的）

**Komoot Photon 公开实例** `[官方]` https://github.com/komoot/photon ：

- *"You are welcome to use the API for your project as long as the number of requests stay in a reasonable limit. Extensive usage will be throttled or completely banned. We do not give guarantees for availability and reserve the right to implement changes without notice."*
- 无 SLA、无固定配额、随时可能限流/封禁；语言仅 `default/de/en/fr`（实测 400）。

**数据许可视角的重要区分**：Photon/Nominatim 的**服务**是 demo/受政策约束，但它们返回的是 **OSM 派生数据（ODbL）**——ODbL **允许**你存储与再分发，只要署名并以 ODbL 共享衍生数据库。所以"能不能落库"在开源侧不是问题；问题在**服务可用性**与**中文覆盖**。

### 3.6 B 表：托管 API 横向对比

| 提供方 | $/1000（首档） | 免费额度 | 速率限制 | 可否持久化结果 | 中文 | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| **Google Geocoding** | **$5.00** | 10,000/月 | 按配额（未列具体 QPS） | ❌ 仅 `place_id` 可长期存 | ✅ `language=zh` | 无地图也可展示，但需 Google 归属 |
| **Google Autocomplete** | **$2.83** | 10,000/月 | 同上 | ❌ | ✅ | 按键计费，需 debounce |
| **Google Text Search** | **$32.00** | 5,000/月 | 同上 | ❌ | ✅ | 单价最贵，避免做主力 |
| **Google Place Details (IDs only)** | **$0** | Unlimited | 同上 | — | — | 只回 ID，正好配 place_id 落库 |
| **Mapbox Geocoding** | `[未验证]` | `[未验证]` | **1000 req/min** | ✅ **Permanent**（需信用卡/企业合同）；Temporary ❌ | ✅ `zh/zh_Hans/zh_Hant` | **必须与 Mapbox 地图同用**；v6 无 POI |
| **Foursquare Places** | `[未验证]` | `[未验证]` | `[未验证]` | `[未验证]` | `[未验证]` | POI 强项，商务待确认 |
| **HERE** | `[未验证]` | `[未验证]` | `[未验证]` | `[未验证]` | `[未验证]` | 页面 JS 渲染 |
| **Nominatim 公开** | $0 | — | **1 req/s**，禁 autocomplete | ✅（ODbL，且政策**要求**缓存） | ✅（`accept-language`） | **不能做 type-ahead** |
| **Photon 公开** | $0 | — | "reasonable limit"，可封禁 | ✅（ODbL） | ❌ **400** | 实测 TTFB 1.6s |

---

## 4. C. 混合方案：GeoNames 底座 + 外部 POI

### 4.1 GeoNames 全量解剖 `[官方]`

来源：https://download.geonames.org/export/dump/（目录实取，2026-11-19）；https://www.geonames.org/about.html

| 维度 | 事实 |
| --- | --- |
| 规模 | **3,200 万+ 地名 / 1,300 万+ 独立要素**，其中 **520 万 populated places**、**1,900 万 alternate names** |
| `allCountries.zip` | **403 MB**（压缩）；解压后约 1.5GB 级 `[推断]` |
| `alternateNamesV2.zip` | **196 MB**（含 `isolanguage`，如 `zh` / `zh-CN` / `zh-Hant`） |
| `hierarchy.zip` | 2.0 MB（parentId/childId，ADM 层级） |
| `countryInfo.txt` | 31 KB（ISO、语言、bbox、首都） |
| `admin1CodesASCII.txt` / `admin2Codes.txt` | 148 KB / 2.3 MB |
| `cities500/1000/5000/15000.zip` | 13MB / 11MB / 5.5MB / 3.2MB（约 18.5万 / 13万 / 5万 / 2.5万 城市） |
| 主表字段 | `geonameid, name, asciiname, alternatenames, latitude, longitude, feature class, feature code, country code, cc2, admin1..admin4, population, elevation, dem, **timezone**, modification date` |
| 层级 | admin1–admin4 代码 + `hierarchy.zip`；`countryInfo.txt` 提供国家 |
| 中文 | `alternateNamesV2` 按 `isolanguage` 过滤 `zh%`；**覆盖率未量化 `[未验证]`**（中国城市很好，海外小镇/POI 可能缺） |
| 街道/门牌 | **没有**。GeoNames 是地名 gazetteer，不含 `addr:*` |
| 许可 | **CC BY 4.0**（readme 原文 + about 页脚）→ **可永久存储**，需署名 |
| 更新 | 每日 diff（`modifications-*.txt` / `deletes-*.txt` / `alternateNamesModifications-*.txt`） |
| 稳定 id | `geonameid`（整数，长期稳定） |

**关键判断：GeoNames 能解决"城市/地区/国家 + 中文 + 时区 + 稳定 id + 可持久化 + 体积小"，但完全解决不了"街道/酒店/餐厅"。**

### 4.2 成本模型（用已验证的 Google 单价算，量级假设标注）

假设：日均 3,000 次有效搜索（客户端 300ms debounce 后），月 **90,000** 次；其中 30% 需要"选中后取详情"。`[假设]`

| 方案 | 月请求拆分 | 月成本 |
| --- | --- | --- |
| Google Autocomplete 主力 | 90k → 10k 免费 + 80k × $2.83/1000 | **≈ $226** |
| Google Geocoding 主力 | 90k → 10k 免费 + 80k × $5.00/1000 | **≈ $400** |
| Google Text Search 主力 | 90k → 5k 免费 + 85k × $32.00/1000 | **≈ $2,720** |
| Google 详情（Place Details Enterprise） | 27k → 1k 免费 + 26k × $20/1000 | **≈ $520** |
| GeoNames 本地 | 90k 全本地 | **$0**（仅机器成本） |
| 自托管 Pelias/Photon 全量 | — | 机器成本（≥64GB RAM + ≥600GB/95GB NVMe）**`[未验证]`**，且当前机器直接排除 |

**读法：Google 的 Autocomplete + place_id 路线在小规模（<1 万/月）几乎免费；Text Search 一旦成为主力就是数量级差异。GeoNames 本地化后，城市级搜索的边际成本为 0。**

### 4.3 C 表：混合（GeoNames + 商业 POI）vs 全自托管（Pelias/Photon planet）

| 维度 | 混合：GeoNames 本地 + POI 托管 | 全自托管 Pelias planet | 全自托管 Photon planet |
| --- | --- | --- | --- |
| 磁盘 | **1.5–4GB** `[推断]` | ~450GB（≥600GB 导入） | **~95GB**（更新需 ×2） |
| 内存 | <2GB | 查询 2×32GB；导入 72GB | **≥64GB** |
| 冷启动/构建 | 分钟级 | 16h（36 核） | ~半天 + 前置 Nominatim |
| 查询延迟 | 本地 <10ms `[推断]` + 远端 POI 100–1600ms | 未验证 | 未验证 |
| 全球城市/地区 | ✅（1,300 万要素） | ✅ | ✅ |
| 全球街道/门牌 | ❌（需 POI 源） | ✅（1.86 亿门牌，覆盖不均） | ✅（同 OSM） |
| 酒店/餐厅 | ✅（取决于所选 POI 源） | ✅（OSM 质量） | ✅（OSM 质量） |
| 中文名 | ✅ 城市级（GeoNames `zh*`） | ⚠️ 取决于 `name:zh` 覆盖 | ⚠️ **dump 路线没有 zh**，需自建 |
| 稳定 id | ✅ `geonameid` + 商业 `place_id` | ✅ `N/W/R:id` | ✅ `N/W/R:id` |
| 可持久化 | ✅ CC BY 4.0 + 商业条款（分流存储） | ✅ ODbL | ✅ ODbL |
| 失败模式 | POI 源挂 → 退化为"只有城市"，`partial=true` | 磁盘满/ES 崩溃 → 全站搜索不可用 | 同左 + 更新断链 |
| 运维 | **低**（一个 SQLite + 一个 HTTP 客户端） | **高** | **中高** |
| 现在这台机器 | ✅ | ❌ | ❌ |

---

## 5. 推荐架构与数据流

### 5.1 文字图

```text
[Web 搜索框]
   │  q, lang, limit, near(lat,lng), country
   ▼
[API /v1/places/search]
   │
   ├─(1) 参数归一化 + 查询指纹 key = sha1(q|lang|limit|near|country|contract=v2)
   │
   ├─(2) Redis 缓存（key: places:v2:{fingerprint}）
   │      hit → 直接返回 {items, sources, cached:true, tookMs}
   │      miss ↓
   │
   ├─(3) 本地 GeoNames 索引（SQLite + FTS5，同步、超时 20ms）
   │      · 前缀/拼写容错匹配 name / asciiname / alternatename(zh)
   │      · 命中 country / region / city → 带 geonameid、timeZone、population、bbox
   │      · 结果立即可用（即使后续远端全挂，也有非空结果）
   │      ↓
   ├─(4) POI 主源（按开关选择：photon-public | photon-self | google | mapbox | foursquare）
   │      · 只查 POI/街道/门牌（GeoNames 不覆盖的部分）
   │      · 独立超时预算（建议 1.2s，不是 2.5s）与独立熔断器
   │      ↓
   ├─(5) 兜底源（仅当主源失败/超时/空结果）
   │      · Photon（本地名）或 Nominatim 自建实例
   │      · 仍然失败 → 返回 GeoNames 结果 + degraded:true + partial:true
   │
   ├─(6) 合并 + 去重（同名同国 + 距离 <2km 视为同一；OSM id 与 geonameid 建映射）
   ├─(7) 排序（importance/population + 距离衰减 + 类型优先级 city>region>poi）
   └─(8) 回填 Redis（正结果 TTL 15min，空/降级 TTL 30s）→ 返回

落库路径（Stop 写入）：
[用户选中] → 存 canonical id + provider + providerPlaceId + 坐标 + bbox + address + names + timeZone + attribution
             ↓（若 provider 是 Google）
             只存 place_id + 坐标 + 用户自定义 label；名称/地址在展示时实时取
```

### 5.2 关键设计点

1. **两段式返回**：GeoNames 命中先返回城市级结果（保证 <300ms 首屏），POI 结果后到再合并。这直接解决"上游 1.6s 就降级"的体验问题。
2. **超时预算重排**：本地 20ms + 主源 1200ms + 兜底 600ms，总预算仍 2s 内；不要用单一 2.5s 预算覆盖所有尝试。
3. **降级语义分层**：`degraded`（完全失败）之外新增 `partial`（部分源失败但仍有用结果），前端可显示"仅显示城市/地区"。
4. **中文双轨**：城市级用 GeoNames `alternateNamesV2(zh, zh-CN, zh-Hant)`；POI 级必须靠 `lang=zh` 的 POI 源（Google/Mapbox 支持，公开 Photon 不支持）。
5. **时间**：`timeZone` 由 GeoNames `timezone` 列直接给，不再依赖坐标猜测；POI 用最近城市回填。
6. **公平使用**：即使用 Photon 公开实例，也必须加服务端缓存（现有 15min 缓存是对的），并把 `User-Agent` 标识为 Roamlog。

---

## 6. 契约变更清单（字段级）

目标：**一次升级同时解决"稳定 id、完整地址、bbox、中文名、时区、归属"六件事**，且不破坏 Web 现有调用。

### 6.1 `Place`（`packages/contracts/src/api/places.ts`）

| 字段 | 类型 | 变更 | 理由 |
| --- | --- | --- | --- |
| `id` | `string` (UUIDv7) | **新增** | Roamlog 内部规范 id；用于 Stop 关联/去重，不随上游变化 |
| `provider` | enum 扩展 | **改** | 目前 Photon 硬编码；新增 `geonames` / `google` / `mapbox` / `foursquare` / `here` / `osm` |
| `providerPlaceId` | `string \| null` | 保持 | OSM 为 `N:123`/`W:123`；GeoNames 为 `geonames:123`；Google 为 `google:ChIJ…` |
| `name` | `string` | 保持 | **当前 `lang` 下的显示名** |
| `names` | `{ zh?, en?, local? } \| null` | **新增** | 一次搜索同时带回多语言，前端切换语言不用重查 |
| `address` | `{ formatted, street, houseNumber, postcode, city, region } \| null` | **新增** | Photon 已返回 `street/housenumber/postcode`，当前被 normalizer 丢弃；Google/Mapbox 也有结构化地址 |
| `country` / `countryCode` | 保持 | 保持 | — |
| `admin` | `{ level1?, level2? } \| null` | **新增** | GeoNames `admin1/admin2` + `admin1CodesASCII.txt` 可直接给"省/州 + 市" |
| `lat` / `lng` | 保持 | 保持 | — |
| `bbox` | `[number, number, number, number] \| null` | **新增** | **GeoJSON 顺序 `[minLon, minLat, maxLon, maxLat]`**。⚠️ Photon 的 `extent` 是 `[minLon, maxLat, maxLon, minLat]`，**必须重排** |
| `timeZone` | `string \| null` | **改语义** | 不再恒为 `null`：GeoNames `timezone` 列 / 最近城市回填 |
| `type` | enum 扩展 | **改** | 新增 `address`、`street`；保留 `city/region/country/poi/other`（Photon `layer` 参数可直出 `house/street/locality/district/city/county/state/country`） |
| `category` | `string \| null` | **新增** | `osm_key=osm_value`（如 `tourism=museum`）或商业源品类，用于图标与筛选 |
| `importance` | `number \| null` | **新增** | 排序权重（GeoNames `population` / Nominatim importance） |
| `attribution` | `string` | **新增** | 合规必需（ODbL / CC BY / Google）；也可放响应级 |
| `sourceLicense` | `string \| null` | **新增（可选）** | 落库时记录来源许可，便于导出/审计 |

### 6.2 `PlaceSearchResponse`

| 字段 | 类型 | 变更 | 理由 |
| --- | --- | --- | --- |
| `items` | `Place[]`（max 10） | 保持 | 可考虑提到 20 以支持地图视野 |
| `provider` | enum | 保持 | **主源** |
| `sources` | `string[]` | **新增** | 参与合并的源（如 `["geonames","photon"]`） |
| `degraded` | `boolean` | 保持 | 全部失败 |
| `partial` | `boolean` | **新增** | 部分源失败 |
| `cached` | `boolean` | 保持 | — |
| `tookMs` | `number` | **新增** | 便于前端/监控定位 |
| `attribution` | `string` | **新增** | 渲染必需的归属文本 |

### 6.3 `PlaceSearchQuery`

| 字段 | 现状 | 建议 |
| --- | --- | --- |
| `q` | 1..120 | 保持 |
| `limit` | 1..10，默认 6 | 保持或 20 |
| `lang` | `"zh" \| "en"` | 扩为 BCP-47（`zh-Hans`/`zh-Hant`/`ja`…），至少保留 `local` |
| `near` | 无 | **新增** `lat,lng,radiusKm`（Photon 的 `lat/lon/zoom/location_bias_scale`、Nominatim 的 viewbox 都能映射） |
| `country` | 无 | **新增** ISO-3166 过滤（Photon `countrycode`、GeoNames `country code`） |
| `types` | 无 | **新增** `city|region|country|poi|address|street` 过滤（Photon `layer`） |

### 6.4 兼容性注意

- `PlaceSchema` 当前是 **`.strict()`**：新增字段必须同步改 Zod + OpenAPI + Orval 生成物，否则旧客户端解析新响应会直接失败。
- 建议新增字段全部 `nullable`/`optional`，并保留 `contract` 版本开关（见 §7）。
- `cached`/`degraded` 的语义不要改，前端已有分支依赖。

---

## 7. 迁移路径（从当前 Photon 代理平滑切换）

### 7.1 原则

**一次只换一个变量**：先"加字段"，再"加本地源"，最后"换 POI 源"。任何一步都可独立回滚。

### 7.2 阶段与开关

| 阶段 | 动作 | 开关 | 回滚 |
| --- | --- | --- | --- |
| **P0（准备）** | 引入 `PlacesProvider` 抽象（`search(input) → {items, source}`）；现有 `PhotonClient` 实现该接口；**行为零变化** | 无 | 纯重构 |
| **P1（补字段）** | normalizer 开始映射 `street/housenumber/postcode/extent/osm_key`，`timeZone` 先仍 `null`；契约加**可选**字段；OpenAPI/Orval 同步 | `PLACES_CONTRACT=v2` | 关开关回 v1 响应 |
| **P2（本地底座）** | 导入 GeoNames → SQLite FTS5；新增 `GeonamesClient`（本地、同步、20ms 预算）；搜索先本地后 Photon | `PLACES_LOCAL_INDEX=on` | 关闭即回到纯 Photon |
| **P3（灰度 POI 源）** | 按 `lang`/`country` 路由：`zh` 走新源、其它走 Photon；**影子模式**先记录新源结果不返回 | `PLACES_POI_PROVIDER=photon\|google\|…` + `PLACES_SHADOW=1` | 切回 `photon` |
| **P4（切换）** | 按 5% → 25% → 100% 放量，比对 p95 延迟、空结果率、降级率 | 百分比开关 | 立即归零 |
| **P5（清理）** | 删除 v1 分支与 Photon-only 路径；保留一个 fallback provider | — | — |

### 7.3 缓存与键空间

- 现在：`places:<hash>`（15min）。**升级时必须换前缀** `places:v2:<hash>`，否则旧结构缓存会污染新契约。
- 灰度期间两套缓存并存，按 `contract` 版本分流。
- 空结果 TTL 保持 30s（防止上游被"查不到"的查询打爆）。

### 7.4 观测指标（决定是否可放量）

| 指标 | 目标 |
| --- | --- |
| 端到端 p95 | **<300ms**（本地命中）/ **<1s**（含远端） |
| 空结果率 | <5% |
| `degraded` 率 | <1% |
| `partial` 率 | <10% |
| 中文查询命中率（返回 `names.zh` 非空） | >95%（城市级） |
| 上游 4xx/5xx | <0.5% |
| 缓存命中率 | >60% |

### 7.5 数据回填

- 已有 Stop 若只存了名字/坐标：写一次性 job，用 `name + 坐标` 反查 GeoNames/OSM，补 `geonameid`/`osm id` 到 `providerPlaceId`；失败则标记 `legacy:true`，不阻塞产品。
- 不迁移 Google 结果到本地库（条款禁止）。

---

## 8. 风险与不可行点

### 8.1 "全球所有地点"在什么意义上做不到

1. **数据意义上的"完整"不存在**。OSM 有 1.86 亿门牌号，但分布极不均：欧美密集、部分国家/地区稀疏（中国区 OSM POI 覆盖显著低于商业库）；商业库同样有长尾缺口（新开的餐厅、乡村地址）。任何"全球完整"都应被重新表述为 **"主要城市 + 常见 POI 的高覆盖，长尾不保证"**。
2. **单一数据源不可能同时满足"全 + 中文 + 可持久化 + 稳定 id + 便宜"**：
   - OSM 系：可持久化、id 稳定，但中文覆盖依赖 `name:zh`，且全量自托管要 95–900GB；
   - 商业系：中文与 POI 好，但持久化被条款卡死（Google 只许 `place_id`；Mapbox 要"永久化 + 必须配 Mapbox 地图"）；
   - GeoNames：可持久化、中文好，但**没有街道/POI**。
3. **公开实例不能做产品后端**：Nominatim 公开政策**明文禁止 auto-complete**；Photon 公开实例无 SLA、随时限流、且 `lang=zh` 直接 400。二者只能作为开发期兜底。
4. **稳定 id 不是绝对的**：OSM 元素会被删除/合并（id 失效）；Google 明说 place_id "may change"。**必须有一层内部 canonical id + 映射表 + 软删除**，不能把上游 id 当主键。

### 8.2 具体风险清单

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 23GB 磁盘 + 16GB RAM | 无法自托管全量（最低 95GB/64GB） | 混合方案；磁盘扩容到 ≥200GB 再评估 |
| Photon 公开实例 1.6s TTFB | 现有 2.5s 预算经常打满 | 降超时到 1.2s + 本地先返回 + 熔断 |
| `lang=zh` 400 | 中文用户拿不到中文 | GeoNames 城市级中文 + 选支持 zh 的 POI 源 |
| Google 存储限制 | Stop 不能存名称/地址 | 只存 `place_id` + 用户 label；或换可持久化源 |
| Mapbox "必须配 Mapbox 地图" | 引入底图依赖 | 若选 Mapbox，需同时评估底图迁移成本 |
| ODbL share-alike | 衍生数据库需同许可 | 只做"Produced Work"展示 + 署名；不对外分发衍生库 |
| OSM id 失效/合并 | Stop 指向失效地点 | 内部 id + 映射 + 软删除 + 定期回填 |
| Nominatim 公开政策收紧 | 现有兜底随时断 | 自建实例或商业源；缓存 |
| 上游中文 POI 缺失 | 用户在海外搜不到中文名 | UI 显示"本地名 + 中文注记"，允许用户手填 label |

### 8.3 明确不建议做的事

- ❌ 在 23GB 磁盘上尝试 Photon planet dump（95GB，且更新要 2× 空间）。
- ❌ 把公开 Nominatim 接进搜索框（政策禁止 auto-complete，且实测 403）。
- ❌ 把 Google 的名称/地址写进 Stop 表（违反 No Caching）。
- ❌ 自研 OSM→ES 导入器（Photon/Pelias 已 Apache-2.0，重复造轮子且正确性风险极高）。
- ❌ 用 `place_id` 直接当 Stop 外键（会变、会失效）。

---

## 9. 未验证清单（交付前需二次确认）

| 项 | 状态 | 需要做什么 |
| --- | --- | --- |
| Mapbox 每 1000 次价格 | `[未验证]` | 打开 https://www.mapbox.com/pricing/#search 人工记录；确认 permanent 与 temporary 的差价 |
| Foursquare 价格 / 持久化条款 | `[未验证]` | 商务询价 + 开发者条款原文 |
| HERE 价格 / 持久化条款 | `[未验证]` | 登录 HERE 控制台看 Base Plan 单价 |
| Pelias / Nominatim / Photon 的 p50/p95 延迟 | `[未验证]` | 官方无数字；需在目标机器上实测（本次机器不具备条件） |
| Photon 区域索引的实际体积 | `[未验证]` | 用 `-country-codes` 导入单个国家实测 |
| GeoNames 中文覆盖率 | `[未验证]` | 抽样：中国 100 城市 + 海外 100 城市，统计 `alternateNamesV2(zh*)` 命中率 |
| OSM 在中国区的 POI 密度 | `[未验证]` | 用 taginfo 地理分布图或区域 extract 统计 |
| OSMNames TSV 体积 | `[未验证]` | 下载 `planet-latest_geonames.tsv.gz` 看实际大小 |
| `place-search` / `osm-express` 类项目 | `[未验证]` | 未找到可信活跃仓库，暂不作为候选 |

---

## 10. 参考链接（均为本次实际访问）

**OSM / 规模**
- https://planet.openstreetmap.org/ （PBF 89GB，2026-11-19）
- https://planet.openstreetmap.org/statistics/data_stats.html （nodes/ways/relations）
- https://taginfo.openstreetmap.org/api/4/key/stats?key=addr%3Ahousenumber （及 `amenity`/`shop`/`tourism`/`building`）
- https://www.openstreetmap.org/copyright （ODbL）

**自托管**
- https://github.com/pelias/documentation/blob/master/full_planet_considerations.md （600M 文档 / 450GB / 600GB / 36 核 16h）
- https://github.com/pelias/documentation/blob/master/requirements.md （libpostal 4GB / PIP 30GB / interpolation 50GB）
- https://hub.docker.com/r/pelias/api （20.2M pulls）
- https://nominatim.org/release-docs/latest/admin/Import/ （900GB / 64GB / 54h / style 表）
- https://nominatim.org/release-docs/latest/customize/SQLite/ （实验性 SQLite 转换）
- https://github.com/mediagis/nominatim-docker （`mediagis/nominatim` 5.3.3）
- https://github.com/komoot/photon （95GB / 64GB RAM / demo 政策）
- https://github.com/komoot/photon/blob/master/docs/usage.md （`-languages` / `-country-codes` / 更新）
- https://github.com/komoot/photon/blob/master/docs/api-v1.md （`extent` 顺序 / `layer` / `bbox` / `countrycode`）
- https://download1.graphhopper.com/public/ （Photon 周更 dump；仅 en/de/fr/local）
- https://github.com/OSMNames/OSMNames + https://osmnames.org

**托管 API**
- https://developers.google.com/maps/billing-and-pricing/pricing?hl=en （Geocoding $5 / Autocomplete $2.83 / Text Search $32）
- https://developers.google.com/maps/documentation/geocoding/policies （"except for the place ID… not cached or stored"）
- https://developers.google.com/maps/documentation/places/web-service/place-id （place_id 可长期存 + 会变）
- https://cloud.google.com/maps-platform/terms （No Caching）
- https://cloud.google.com/maps-platform/terms/maps-service-terms （Google ID Caching）
- https://docs.mapbox.com/api/search/geocoding/ （Permanent vs Temporary / 必须配 Mapbox 地图 / 1000 req/min / v6 无 POI）
- https://www.mapbox.com/pricing/#search （价格，JS 渲染，未验证）
- https://docs.foursquare.com/ （Places API New 文档可达）
- https://www.here.com/get-started/pricing （Base Plan，JS 渲染，未验证）
- https://operations.osmfoundation.org/policies/nominatim/ （1 req/s、禁 autocomplete、必须缓存）

**GeoNames**
- https://download.geonames.org/export/dump/ （403MB / 196MB / 字段表 / CC BY 4.0）
- https://www.geonames.org/about.html （32M 地名 / 13M 要素 / 5.2M 城市 / 19M 别名）

---

## 附：本次调研的复现命令

```bash
# 体积与规模
curl -s https://planet.openstreetmap.org/ | grep -E "PBF|GB"
curl -s "https://taginfo.openstreetmap.org/api/4/key/stats?key=addr%3Ahousenumber"

# 实测 Photon（TTFB）
curl -s -o /dev/null -w "http=%{http_code} ttfb=%{time_starttransfer}s\n" \
  "https://photon.komoot.io/api/?q=beijing&limit=3"
curl -s "https://photon.komoot.io/api/?q=beijing&limit=3&lang=zh"

# Google 价格（从渲染后的文本中抽取 SKU 行）
curl -sL "https://developers.google.com/maps/billing-and-pricing/pricing?hl=en" \
  | python -c "import sys,re;t=re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',sys.stdin.read()));print(re.findall(r'Geocoding \S+ 10,000[^A-Z]{0,60}',t))"
```