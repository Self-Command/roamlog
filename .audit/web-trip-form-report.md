# WEB_TRIP_FORM_CLOSEOUT — 旅行创建/编辑表单收尾报告

- 任务 ID: `WEB_TRIP_FORM_CLOSEOUT`
- 角色: `web_frontend`
- 仓库: `C:\Users\BY9700\Desktop\UI\roamlog`
- 日期: 2026-11-18
- 结论: **DONE**（lint / typecheck / 定向测试 / 全量测试全绿）

---

## 0. 结论摘要

前手已把创建/编辑表单写到接近完成，本次**没有重写表单、没有换组件库、没有新增依赖**，只做了三件事：

1. 核实 lint：`currencies.ts` 的 `no-useless-assignment` 已在前手收尾中改为 `let name: string;`（第 86–91 行），工作区开局 `lint` 即 exit 0，本次未改任何产品源码。
2. 补齐测试：新增 5 个测试文件、37 个用例，覆盖表单校验、日期选择器键盘与 min/max、combobox 五态、创建/编辑 payload、封面两条路径、409 冲突、创建成功跳转。
3. 出本报告，逐条回答派工单中的 7 个问题，并列出已知风险与未覆盖项。

---

## 1. 逐条回答

### 1.1 封面挂载

| 需要的事实 | 事实 |
|---|---|
| 在 `trip-form.tsx` 哪一行？ | `<CoverUploader>` 挂载在 **`apps/web/components/trips/trip-form/trip-form.tsx:552`**（“02 / 封面”section 从 540 行开始）。第 26–27 行 import `CoverUploader` 与 `CoverChange / CoverUploadError / CoverUploadPhase` 类型。 |
| 新建路径怎么处理？ | `handleCoverChange`（`trip-form.tsx:313-322`）在 `mode === "create"` 时只把 `change.mediaId` 存进 `pendingCoverMediaId`，**不调用 setCover**（新建时还没有 tripId）。提交时 `handleSubmit`（`:396`）把它作为 `{ coverMediaId }` 传给 `onSubmit`。真正绑定点在 `new-trip-shell.tsx:38-45`：`createTrip.mutateAsync(input)` 成功后若 `context.coverMediaId` 存在，调用 `createCoverMediaClient().setCover(trip.id, mediaId)`，再 `queryClient.invalidateQueries([trip(trip.id), trips(workspaceId)])`。 |
| 编辑路径怎么处理？ | 同一个 `handleCoverChange` 在 edit 模式走另一分支：uploader 自己已经调用 `POST /v1/trips/{id}/cover`（或带版本的移除），把最新 `Trip` 通过 `change.trip` 回传；表单只 `setTripState(change.trip)` 以同步最新 `version`，**提交时不再重复 setCover**。`<CoverUploader trip={props.mode === "edit" ? tripState : null}>`（`:553-554`）把 trip 传下去，uploader 直接显示/替换/移除真实封面。 |
| `createTrip` 失败时已上传 media 是否保留？ | **保留**。`pendingCoverMediaId` 在失败后不清空；`new-trip-shell.tsx:32-35` 用 `createdTripRef` 记住已创建的 trip，重试时不会再建第二趟旅行。测试 `TripForm create > forwards the uploaded coverMediaId and keeps the media when create fails` 断言两次提交携带同一个 `COVER_MEDIA_ID`。代价：若用户放弃创建，该 media 会成为服务端孤儿（见风险 R1）。 |

### 1.2 日期选择器

| 需要的事实 | 事实 |
|---|---|
| 是否真日历（非裸文本）？ | **是**。`date-picker.tsx` 用 Radix `Popover` + 自绘 `role="grid"` 的 7 列月历（`:206-275`），`buildMonthWeeks()`（`date-utils.ts`）生成周一为首列、前后补 `null` 占位格；每格是 `role="gridcell"`，带 `aria-selected` / `aria-disabled` / `aria-current="date"`。不是 `<input type="date">`，也不是裸文本框。 |
| 键盘键位表 | `handleGridKeyDown`（`date-picker.tsx:126-160`）：<br>`←` −1 天、`→` +1 天、`↑` −7 天、`↓` +7 天、`Enter` / `Space` 选定并关闭、`Escape` 关闭不选定、`PageUp` 上个月、`PageDown` 下个月、`Tab` 移出（Radix 默认）。栅格 `role="grid"` 可聚焦（`tabIndex=0`），打开时通过 `onOpenAutoFocus` + rAF 自动聚焦，方向键无需额外 Tab。 |
| min/max 与不可选日期实现位置 | 判定函数 `isDateOutsideRange(value, min, max)`（`date-utils.ts:154-159`）。使用点三处：① 打开时初始焦点 `clampDateOnly`（`date-picker.tsx:101-102`）；② 键盘移动 `moveFocus` 再 clamp（`:103-107`），因此越界方向键会停在 min/max；③ 每个 `CalendarDay` 的 `disabled` 与 `commit()` 守卫（`:95`、`:261`），禁用格无 `onClick`，键盘 `Enter` 也不会提交越界日期。月份切换的日期保持用 `addMonths` + `daysInMonth` 处理月末回退（`:108-119`）。 |

对应测试：`components/trips/trip-form/__tests__/date-picker.test.tsx`（8 个）——“renders a real month grid…”、“moves with arrow keys, commits with Enter…”、“only commits an in-range day”、“clamps keyboard focus to the min/max bounds”、“closes on Escape…”、“switches months with the toolbar buttons”、“switches months with PageUp/PageDown…”、“disables days outside min/max and never commits a disabled day”。

### 1.3 combobox 五态

实现位置 `apps/web/components/forms/searchable-combobox.tsx`：

| 状态 | 组件行为 | 对应测试名（`components/forms/__tests__/searchable-combobox.test.tsx`） |
|---|---|---|
| **loading** | `status === "loading"` 时 listbox 顶部渲染 `role="status"` + spinner + “正在搜索…”（`:338-343`）；输入框右侧同步显示 spinner（`:311-313`）。 | `loading: announces progress while the search is in flight` |
| **空结果** | `status === "ready" && items.length === 0 && !showManualRow` 渲染 “没有匹配的结果”（`:369-373`）。有手动降级行时**不**显示空态，避免两条提示打架。 | `empty: explains that nothing matched` |
| **错误（可重试）** | 捕获非 abort 错误 → `status="error"`，渲染错误文案 + “重试”按钮；`retry()` 递增 `retryToken`，effect 重跑同一条 query（`:220-222`、`:345-352`）。429 单独走 `rate-limited` 态，用 `retryAfterSeconds` 文案。 | `error: shows the failure and retries the same query`（断言第二次调用后命中结果） |
| **degraded** | `result.degraded === true` 时在结果上方渲染 “搜索服务暂时降级，可手动填写。”（`:363-367`），结果仍可点选。 | `degraded: tells the person they can type the place manually` |
| **手工降级输入** | `allowManual` 且输入非空时，在结果末尾附加一条 `manual: true` 的选项（`:130-137`）；点选走 `onManual(trimmedValue)` 且不触发 `onSelect`（`:209-218`）。 | `manual fallback: offers the typed text as an option and reports it` |

另有补充用例 `does not query below the minimum length and supports keyboard selection`：1 个字符不发请求（`minQueryLength` 默认 2）、`ArrowDown`+`Enter` 选中。

### 1.4 提交字段

**CREATE payload（`trip-form-state.ts:303-331`，`buildCreateTripRequest`）** —— 字段精确为：

- 必有：`title`（trim）、`status`、`visibility`、`startDate`、`endDate`
- 可选且仅在非空/非 blank 时发送：`summary`（trim 后非空）
- 起点（`originPayload`，`:291-301`）：`origin`、`originLat`、`originLng`、`originCountryCode`、`timeZone`（无起点则整组省略；手动地点坐标为 `null`）
- `destinations`（trim，非空才发）
- `countryCodes`（`deriveCountryCodes`：起点国家码 + 目的地已知国家码去重，非空才发）
- `tags`、`guestNames`（trim，非空才发）
- 预算成对：`budgetAmountMinor` + `budgetCurrency`（`parseBudgetAmount` 转分，非空才发）

示例（测试 `captures the full CreateTripRequest from the real field components` 用真实字段组件走完交互后断言**完整对象**，无额外键）：
`{title,status,visibility,startDate,endDate,origin,originLat,originLng,originCountryCode,timeZone,destinations,countryCodes,tags,guestNames,budgetAmountMinor,budgetCurrency}`。

**EDIT 只发变更的实现方式** —— diff 算法在 **`trip-form-state.ts:333-404` `buildUpdateTripRequest(values, initialTrip)`**：

1. `const patch: UpdateTripRequest = { version: initialTrip.version }`（`:349`，`version` 永远带）。
2. 逐字段比较：`title / summary / status / visibility / startDate / endDate` 直接 `!==`。
3. 起点整组比较 `originName + originLat + originLng + originCountryCode + timeZone`，任一变化才一次性写 5 个字段；清空起点写契约哨兵 `origin: "未填写"` + 全 `null`（`:358-380`）。
4. `destinations` 用有序数组比较；`countryCodes` 用集合比较；`tags / guestNames` 用有序数组比较。
5. 预算比较 `(amountMinor, currency)` 对，变化才成对写。
6. `Object.keys(patch).length > 1` 才返回，否则 `null`（`:403`），UI 提示“没有检测到修改，未提交请求。”，不发请求。

测试 `TripForm edit > submits only the changed field plus version` 断言改标题后 payload **恰好** `{ version: 4, title: "冬季京都" }`，且 `not.toHaveProperty("destinations")` 等；`buildUpdateTripRequest` 另有 4 个纯逻辑用例（无变更→null、预算成对、清空起点、路线变更）。

### 1.5 版本冲突

- 编辑提交**带 `version`**：`buildUpdateTripRequest` 无条件写入 `initialTrip.version`（`trip-form-state.ts:349`）。
- 409 处理：`applyServerError`（`trip-form.tsx:331-339`）用 `isVersionConflict`（`lib/api/errors.ts:55-57`，`status === 409 || code === "VERSION_CONFLICT"`）→ 顶部 `role="alert"` 横幅“保存失败：旅行已被其他人更新（409 版本冲突）。请重新加载最新版本，再重新提交你的修改。”，并渲染“重新加载最新版本”按钮（`:440-444`），点击走 `EditTripPage.handleReload`（`edit-trip-page.tsx:35-38`）：refetch 后 `setFormKey` 重建表单。
- **是否走共享 `ConflictDialog`？否。** `components/app-shell/conflict-dialog.tsx` 存在，但被 `trip-workspace` / `journal-editor-sheet` 使用；旅行表单用自己的内联横幅 + 重载按钮。`app-shell/**` 在本次禁止名单内，未改动。
- 测试：`TripForm edit > turns a 409 into a conflict banner with a reload action`（用真实 `ApiError(409, …, "VERSION_CONFLICT")`）。

### 1.6 跳转

- 新建成功 → **`/w/<workspaceSlug>/trips/<tripId>`**：`new-trip-shell.tsx:47` `router.push(...)` + `:48` `router.refresh()`。若有封面，先 `setCover` 并 invalidate 缓存再跳。
- 编辑保存成功 → 同页详情 `/w/<slug>/trips/<tripId>`：`edit-trip-page.tsx:41-43`。
- 测试：`NewTripShell > creates the trip, binds the uploaded cover and navigates to the detail page` 断言 `router.push` 实参与 `setCover(TRIP_ID, mediaId)`；失败用例断言 create 抛错时不跳转、不 setCover。

### 1.7 未做项

见第 6 节“未覆盖项”，共 7 条，按优先级排列。

---

## 2. 变更文件

**仅新增测试文件，未改任何产品源码**（`git status` 确认）：

- `apps/web/components/trips/trip-form/__tests__/trip-form-state.test.tsx`（新增，14 tests）
- `apps/web/components/trips/trip-form/__tests__/date-picker.test.tsx`（新增，8 tests）
- `apps/web/components/trips/trip-form/__tests__/trip-form.test.tsx`（新增，7 tests）
- `apps/web/components/trips/trip-form/__tests__/new-trip-shell.test.tsx`（新增，2 tests）
- `apps/web/components/forms/__tests__/searchable-combobox.test.tsx`（新增，6 tests）
- `.audit/web-trip-form-report.md`、`.audit/web-trip-form-report.checkpoint.md`（本报告与检查点）

未触碰 `apps/api/**`、`apps/admin/**`、`packages/**`、`components/{trip-workspace,media,app-shell,legacy-mock}/**`、`lib/demo-store*`、compose/deploy/lockfile、其它 `.audit`；未执行 install / reset / clean / checkout / stash / commit。

---

## 3. 实现摘要（测试设计）

- **只 mock 网络/查询接缝**：`trip-form.test.tsx` 通过 `vi.mock("@/lib/api/media", …importOriginal)` 只替换 `createCoverMediaClient`，真实 `CoverUploader` + `useCoverUpload` 全流程跑通（presign → put → complete → poll → ready）；`new-trip-shell.test.tsx` mock 的是 `@/lib/api/trip-form`（查询接缝）、`next/navigation`（框架接缝）与 `@/components/media` 的 uploader 桩（shell 只负责编排，媒体管线已由 `components/media/**` 覆盖）；表单自身逻辑、真实字段组件、combobox、ChipsInput、DatePicker 均为真组件。
- 状态/校验/payload 用纯函数直测，DOM 只验证“组件把值正确接进 builder”。
- 断言方式：CREATE 用 `toEqual` 精确字段集（防多余字段）；EDIT 用 `toEqual` 精确 patch（防漏发/多发）；封面用 fake client 的 call log（`setCover` / `clearCover` 长度 0）证明“编辑不重复绑定”。

---

## 4. 验证命令与结果

| # | 命令 | 结果 |
|---|---|---|
| 1 | `pnpm --filter @roamlog/web lint` | `eslint -c ../../eslint.config.mjs .` → **exit 0**，无输出告警 |
| 2 | `pnpm --filter @roamlog/web typecheck` | `next typegen && tsc --noEmit` → **exit 0**，0 错误 |
| 3 | `pnpm --filter @roamlog/web exec vitest run components/trips components/forms` | **Test Files 6 passed (6) · Tests 41 passed (41)**（时长 5.68s） |
| 4 | `pnpm --filter @roamlog/web test` | **Test Files 31 passed (31) · Tests 178 passed (178)** → exit 0（时长 15.59s） |

定向 6 个文件明细：
`trip-form-state.test.tsx`(14) · `date-picker.test.tsx`(8) · `trip-form.test.tsx`(7) · `new-trip-shell.test.tsx`(2) · `searchable-combobox.test.tsx`(6) · `trips-library.test.tsx`(4，既有)。

---

## 5. CodeGraph 证据

```text
codegraph status
→ Project: C:\Users\BY9700\Desktop\UI\roamlog
  Files: 1,459  Nodes: 22,423  Edges: 49,128
  [OK] Index is up to date

codegraph explore "TripForm trip-form-state DatePicker SearchableCombobox CoverUploader EditTripPage NewTripPage"
→ 调用链：NewTripPage → NewTripShell → TripForm
  TripForm → OriginField → SearchableCombobox
  TripForm → DatePicker / CoverUploader / Select
  EditTripPage → TripForm；DestinationsField → SearchableCombobox
→ Blast radius：TripForm 5 callers（new-trip-shell / edit-trip-page / index.ts）；
  NewTripPage 2 callers；CoverUploader 7 callers，tests: components/media/cover-uploader.test.tsx
→ 关键结论：改前 TripForm / NewTripPage / TripFormOrigin / TripFormValues “no tests found within 3 caller hops”，
  正是本次补测的缺口。
```

---

## 6. 已知风险

- **R1 孤儿媒体**：新建流程里 createTrip 失败后已上传的 media 会保留（重试复用，避免重复建 trip），但用户放弃创建时没有清理调用，服务端会留下未被引用的 media。需要 media 清理任务或前端 `deleteMedia` 补偿（当前契约/客户端是否提供未在本任务范围内核实）。
- **R2 countryCodes 语义不对称**：`deriveCountryCodes` 会把起点国家码并入 `countryCodes`，而 `valuesFromTrip` 又把 trip 的 `originCountryCode` 与 `countryCodes` 分开读。对本表单创建的 trip 往返一致；但对“非本表单创建、`countryCodes` 不含起点国”的 trip，第一次编辑即使只改标题也可能触发一次 `countryCodes` patch（多一个起点码）。未修改，因为这是契约层面的既定行为，改动会影响 API 语义。
- **R3 409 未接共享 ConflictDialog**：现有内联横幅信息完整、可重载，但与工作区其它模块的冲突交互不一致。`components/app-shell/**` 属禁改区，留待后续 wave。
- **R4 起点坐标严格比较**：`originLat/originLng` 用 `!==` 比较浮点。JSON 往返对 IEEE 双精度是精确的，风险低；若未来服务端做坐标归一化（如四舍五入），每次保存都会误判“起点已改”。
- **R5 封面在创建成功后绑定失败**：`setCover` 抛错时 trip 已存在但无封面，`createdTripRef` 保证重试只重绑封面、不重复建 trip；但错误提示沿用上传组件的通用错误，用户可能以为 trip 没创建成功。属既有实现，未改文案。
- **R6 测试时区依赖**：`trip-form.test.tsx` 用 `todayDateOnly()` 动态取当天日期作为默认起止日期，不依赖固定时区；`date-picker.test.tsx` 的月份断言使用固定 `2026-03` 值。避免硬编码系统时间，但仍依赖测试机本地日历日。

---

## 7. 未覆盖项

1. **combobox 的 `rate-limited`（429）态**：实现存在（读 `status`/`retryAfterSeconds`），本次未加用例（该文案/退避策略可能还会调整，避免锁死）。
2. **422 `problem.errors[].field` 到表单字段的 UI 级链路**：`mapServerFieldErrors` 有纯函数用例覆盖字段映射（originLat→origin、countryCodes→destinations 等），但没有在 DOM 层用 mock 的 `ApiError(422)` 驱动一次真实提交，验证“错误落到对应 FormRow 并 focus”。
3. **DatePicker 的“今天”按钮**：按钮渲染与 `jumpToToday` 逻辑未单独断言（键盘/min-max/月份已覆盖）。
4. **编辑模式的封面移除/替换链路**：`CoverUploader` 自身在 `components/media/**` 已有 13 个用例；本次只断言表单把 `trip` 传入且不重复 `setCover`，没有在表单层重跑 replace/remove。
5. **E2E/浏览器级验证**：未跑 Playwright 或 `next build`；本次验收为 lint + tsc + vitest，构建产物未验证（若 CI 要求 build，见建议 S1）。
6. **可访问性自动化**：未接 axe；仅靠 role/name 查询隐式覆盖键盘可达性。
7. **移动端视觉**：无截图验证（表单布局为既有实现，本次未改样式）。

---

## 8. 建议的下一步

- **S1** 在 CI 中补 `pnpm --filter @roamlog/web build`，确认 `next build` 对新路由/客户端组件无回归（本次时间预算内未执行）。
- **S2** 产品决策后，把旅行表单的 409 收口到共享 `ConflictDialog`（需 `app-shell` 写权限）。
- **S3** 为“上传后放弃创建”的 media 增加清理策略（TTL 任务或前端补偿删除），消除 R1。
- **S4** 明确 `countryCodes` 是否包含起点国，统一 `deriveCountryCodes` 与服务端语义，消除 R2。
- **S5** 补 429 态与 422 UI 级用例（本报告第 7 节 1、2 条），并考虑给表单加 axe 冒烟。