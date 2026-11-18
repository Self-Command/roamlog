# 根 Agent 验收记录 — G3_UI_JOURNEYS

任务 ID: G3_UI_JOURNEYS
验收结论: **ACCEPT（证据充分、结论诚实）；由此暴露 3 个真实产品缺陷，已派 FORM_RESILIENCE**
时间: 2026-11-18 23:58
环境: web dev :3000（mock 模式）+ Playwright 1.65 Chromium，**真实点击/键盘**
规模: 23 个 spec 用例 → **19 PASS / 4 FAIL**
证据: `.audit/evidence/g3-ui/`（29 张截图 + run-1..4 / focus-order / detail-tabs / overflow / submit 观测日志）

## 逐旅程结论

| # | 旅程 | 结论 | 断言 |
|---|---|---|---|
| 1 | 创建全字段 | **FAIL** | 38：31 通过 / 7 失败 |
| 2 | combobox 五态 | **PASS** | 22 |
| 3 | 日期选择器键盘 | **PASS** | 18 |
| 4 | 编辑页 | **FAIL** | 13：11 通过 / 2 失败 |
| 5 | 详情工作台 | **FAIL** | 7：5 通过 / 2 失败 |
| 6 | 响应式 390/820/1440 | **PASS** | 3（测 6 组，`scrollWidth === clientWidth`） |
| 7 | 键盘可达 | **PASS** | 3（40 次 Tab / 29 控件，全部 `:focus-visible` + ring 非 none） |
| 8 | reduced motion | **PASS** | 11（日历与 tab 切换不依赖动画，无 `opacity:0` 残留） |

**创建页实测通过的关键点**（这些是产品真的做对了）：日历选期、天数派生（2026-11-20→24 = 共 5 天 4 晚）、目的地顺序/去重/删除、预算 CNY、标签去重、同行人、**无裸 `input[type=date]`**。
**键盘顺序实测**：`trip-title → summary → status → visibility → 封面 → start-date → end-date → origin → dest-search → dest-manual → budget → currency → tags → guests → 取消/创建`。

## 4 个 FAIL 的根因（诚实归因：mock 能力缺口，非脚本缺陷）

**一条链路**：`packages/api-mocks/src/handlers.ts` **只有 GET**。`POST /v1/workspaces/:id/trips`、`PATCH /v1/trips/:id`、`/v1/places/search` 全部 unhandled → bypass → `next.config` rewrite → 未启动的 `:4000` → **500**。
→ 创建/编辑提交显示「网络异常，未能保存」并停留原页；起点搜索 500 且降级行被隐藏；详情在 mock 下按 `DATA_MODE === "api"` 门禁渲染 legacy 详情（8 tab）。**这不是产品 bug，是 mock 缺 handler。**

## 由此暴露的 3 个**真实产品缺陷**（我已逐一读代码确认，非推测）

| # | 缺陷 | 代码位置 | 我的判定 |
|---|---|---|---|
| 1 | **搜索失败时无法手动填写地点** | `searchable-combobox.tsx:377` `{status === "ready" ? options.map(...) : null}` | **P0 确认**。`manualOption` 已生成，但整个列表只在 `ready` 渲染。搜索 500 → 起点**完全无法填写** → 创建旅行被迫中止。直接违反「无外部源时支持手动地点」 |
| 2 | **错误文案泄露底层异常** | 同文件 `errorMessage \|\| errorLabel` | **P1 确认**。实测出现 `Unexpected token 'I', "Internal S"...` 与 `API request /v1/places/search failed with status 500` —— 把 URL、状态码、JSON 解析错误直接暴露给用户 |
| 3 | **日期默认值使"未来出发"不可选** | `trip-form-state.ts:104-105` + `trip-form.tsx:591` | **P1 确认**。默认 `start=end=today`，而开始 picker `max={endDate}` → 未来日期全 disabled，用户必须先改结束日期。典型交互陷阱 |

已派 `FORM_RESILIENCE` 修这三条，要求：
- 错误/限流态**仍渲染 manual 降级行**且键盘可达
- 错误文案**固定且不含** HTTP 码/URL/`Unexpected token`；原始错误只进 logger
- 默认 `endDate = start + 6 天`，并**成对自动修正**（start 超过 end 时自动推 end；end 早于 start 时自动回退 start），修正后重新校验

## 附加发现（记录，不阻断）

- `allowManual` 恒 true 使 `emptyLabel`「没有匹配的结果」**永不渲染**（空结果态被 manual 行取代）→ 语义上可接受，但与设计意图不符。
- 真实写持久化、7-tab 工作台、封面上传 presign/complete、真实 provider 搜索 → **必须 api 模式或 staging 才能验**，转 `G3_API_JOURNEYS` 与 G5。

## 端口纪律

dev server 已停；3000/3100/4100 全部 free（未触碰 3100/4100）。

## 备注

该 Agent 使用证据目录内的独立 `playwright.g3.config.ts`（`testDir=e2e/g3`），**未改仓库 `playwright.config.ts`**；新增 8 个 spec 在 `e2e/g3/`，未改既有 e2e。边界干净。