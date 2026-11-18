# FORM_RESILIENCE 交付报告

状态: DONE
任务 ID: FORM_RESILIENCE
角色: web_frontend
时间: 2026-11-18

## 结论

3 个 G3 真实浏览器验收缺陷已修复，均有新增测试覆盖，`typecheck` / 定向测试 / `lint` / 全量 `test` 全部通过。

## 变更文件

生产代码：

- `apps/web/components/forms/searchable-combobox.tsx`
- `apps/web/components/trips/trip-form/trip-form-state.ts`
- `apps/web/components/trips/trip-form/trip-form.tsx`
- `apps/web/components/trips/trip-form/origin-field.tsx`
- `apps/web/components/trips/trip-form/destinations-field.tsx`

测试：

- `apps/web/components/forms/__tests__/searchable-combobox.test.tsx`
- `apps/web/components/trips/trip-form/__tests__/trip-form-state.test.tsx`
- `apps/web/components/trips/trip-form/__tests__/trip-form.test.tsx`

报告/checkpoint：

- `.audit/form-resilience-report.md`
- `.audit/form-resilience-report.checkpoint.md`

未改动 `apps/web/lib/api/trip-form.ts`：错误分类/清洗收口在 combobox 渲染层，`ApiError` 与 `errorFromResponse` 仍可供其他调用方做非 UI 处理；没有新增 API 契约。

## 实现摘要（逐缺陷）

### 缺陷 1（P0）搜索失败时无法手动填写地点

**改前**：`options`（含 `manualOption`）只在 `status === "ready"` 渲染；`catch` 里 `setActiveIndex(-1)`。搜索 500 后只剩错误文案 + 重试，起点字段无法保存任何手动值，G3 实测旅行创建被迫中止。

**改后**：

- 新增 `renderOptionRow()`，`ready` 渲染完整 options；`error` / `rate-limited` 时在错误文案 + 重试按钮之后单独渲染 `manualOption`（沿用 `border-t` 手动行样式）。
- `catch` 中 `setActiveIndex(keepsManualOption ? 0 : -1)`，错误态下 `aria-activedescendant` 指向 manual 行，`Enter` 直接选中；`options` 仍只有 manual 一项时 `↑/↓` 稳定停在 0，不会与重试按钮串位。
- 保留错误提示与重试按钮；`loading` 期间不渲染 manual（与原约定一致，加载结束进入 ready/error 均有 manual）。
- 点击 manual 行继续走既有 `select()` → `onManual(trimmedValue)`，不新增提交路径。

**测试**：`error: keeps the manual fallback clickable after the search fails`、`error: Enter selects the manual fallback`、`rate-limited: keeps the retry hint and the manual fallback`（rate-limited 下 Enter 选中 manual）。

### 缺陷 2（P1）错误文案泄露底层异常

**改前**：`setErrorMessage((error instanceof Error && error.message) || errorLabel)` → 直接将 `API request /v1/places/search failed with status 500`、`Unexpected token 'I', "Internal S"...` 渲染进 DOM。

**改后**：

- 新增 `classifySearchFailure()`：只读取稳定的 `status` / `code` / `name` 元数据，分为 `timeout`、`offline`、`invalid-response`、`unavailable`（429 仍由原分支提前处理）。
- 新增 `failureMessage()` 与固定文案映射；`errorLabel` 作为服务端失败/未知失败的固定兜底，异常 message 永不进入 DOM。
- 原始异常仅 `console.warn("SearchableCombobox: search request failed", error)`。
- `rate-limited` 分支继续使用 `rateLimitedLabel(seconds)`（安全文案），不渲染 `PlaceSearchRateLimitError.message`。
- `origin-field.tsx` / `destinations-field.tsx` 传入地点场景固定文案：「地点搜索暂时不可用，你可以直接输入地点名称。」及超时/断网/响应异常的对应文案；`budget-field` 既有 `errorLabel` 继续作为兜底，同样不再透传异常。

**测试**：`error: never renders HTTP status, request paths or parser output`（用 `ApiError(500, 'Unexpected token ...')` 构造，断言 listbox 不含 `500`、`/v1/`、`Unexpected token`、`JSON`，并断言原始错误只进 `console.warn`）；`error: maps classified failures onto fixed user copy`（TimeoutError → 固定超时文案）。

### 缺陷 3（P1）日期默认值使未来出发不可选

**改前**：新建 `startDate = endDate = today`，开始 picker `max={endDate}` → 所有未来日期 disabled；用户必须先去改返回日期。

**改后**：

1. `emptyTripFormValues()` 用既有 `date-utils.addDays` 生成 `endDate = startDate + DEFAULT_TRIP_NIGHTS(6)`（含首尾 7 天）；开始日期默认可选 `[today, today+6]`。
2. 新增纯函数 `applyTripDateChange(values, field, value)`：
   - start 改到 end 之后 → `endDate = 新 startDate`（同时 `adjusted: "endDate"`）
   - end 改到 start 之前 → `startDate = 新 endDate`（`adjusted: "startDate"`）
   - 合法改动不动另一端
3. `trip-form.tsx` 新增 `handleDateChange()`，使用该纯函数并**重新校验日期字段、清除相关错误**；派生时长 `tripFormDurationLabel(values)` 随 `values` 自动更新。两个 `DatePicker` 移除互相的 `min`/`max` 钳制（`max={endDate}` / `min={startDate}`），改用成对自动修正，用户不再看到"禁用日期无路可走"。

**测试**：

- `default trip dates`：`endDate = startDate + 6`，`inclusiveDurationDays === 7`，`validateTripForm` 无 endDate 错误。
- `applyTripDateChange`：start 越界 → end 跟进；end 越界 → start 回退；合法选择保持另一端不变；修正后校验通过。
- `trip-form.test.tsx`：新建表单默认显示 today / today+6；选择 today+7（旧逻辑下被 `max` 禁用）成功，且两个 picker 都变为该日期（成对自动修正）。

## 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @roamlog/web typecheck` | exit 0，`next typegen` + `tsc --noEmit` 无错误 |
| `pnpm --filter @roamlog/web exec vitest run components/forms components/trips` | exit 0，6 files / 51 tests passed |
| `pnpm --filter @roamlog/web lint` | exit 0（eslint 无输出） |
| `pnpm --filter @roamlog/web test` | exit 0，31 files / 201 tests passed，14.93s |

定向测试明细：`searchable-combobox` 11、`trip-form-state` 18、`trip-form` 8、`date-picker` 8、`new-trip-shell` 2、`trips-library` 4。

原有测试调整说明（行为变化导致，不是放宽断言）：

- combobox 原 error 测试断言原始 message「搜索服务不可用」——正是本次要移除的泄露行为，改为断言固定文案 + 重试仍可用；五态覆盖（loading / empty / error+retry / degraded / manual + 键盘）全部保留。
- `trip-form` 创建 payload 测试的 `endDate` 由 `today` 更新为 `today + 6`，并新增默认窗口断言。

## CodeGraph 证据

- `codegraph status` → `[OK] Index is up to date`（1,481 files / 22,686 nodes / 49,855 edges）。
- `codegraph explore "SearchableCombobox DatePicker trip-form-state TripForm"` →
  - 调用链：`TripForm → OriginField → SearchableCombobox`（`trip-form.tsx:155` → `origin-field.tsx:29` → `searchable-combobox.tsx:81`）；
  - blast radius：`SearchableCombobox` 8 callers（origin/destinations/budget field 等）、`DatePicker` 5 callers、`TripForm` 6 callers，测试命中 `searchable-combobox.test.tsx`、`date-picker.test.tsx`、`trip-form.test.tsx`。
- `codegraph explore "applyTripDateChange classifySearchFailure failureMessage renderOptionRow"`（改动后复核）→ `failureMessage → classifySearchFailure`、`SearchableCombobox → failureMessage / renderOptionRow`、`applyTripDateChange` 被 `trip-form.tsx` 调用且有 `trip-form-state.test.tsx` 覆盖。

## 已知风险

- 自动修正按需求把区间收敛为「单日」（start 越界时 end=新 start，反之亦然），不会保留原行程长度；若产品希望保留时长，需要另立规则。
- `role="listbox"` 内仍包含错误 `role="status"` 与「重试」`button`（原有结构），本次未做无关重构；键盘操作不影响，但严格 ARIA 校验会提示 listbox 子节点角色。
- 默认行程由「当天往返」变为「7 天」，创建 payload 的默认日期随之改变；已更新测试，API/契约未变。
- 错误分类对非 `Error` 对象、自定义异常依赖 `status`/`code`/`name` 元数据；未知形态统一落到安全兜底文案（不会泄露原文）。

## 未覆盖项

- 未执行可选的 3400 端口真实浏览器（Playwright）复跑：本次以 jsdom 真实组件集成测试 + 全量套件验证；无浏览器截图/视频证据。
- 未覆盖真实网络断网（`navigator.onLine === false`）与真实 504 的浏览器级验证；相关分支有单元测试（TimeoutError、TypeError 分类）。
- 未覆盖服务端 place search 真实 500 的 E2E；用真实 `ApiError` 对象模拟同一消息形态。

## 建议的下一步

1. QA 在 3400 起 Web（API 故障注入 / 停掉 places provider）复跑：起点搜索失败后手动填写并成功创建旅行。
2. 若产品确认，考虑自动修正时保留原行程天数（如 start 越界时 end 按原 duration 平移），当前实现严格按任务要求。
3. 其他使用 `SearchableCombobox` 的页面若需要错误分类文案，按地点字段方式传 `errorLabel` / `errorMessages` 即可，无需改组件。