# 根 Agent 验收记录 — FORM_RESILIENCE

任务 ID: FORM_RESILIENCE
验收结论: **ACCEPT（条件：浏览器级复验由 G3_FIX_VERIFY 补，已派）**
时间: 2026-11-19 00:20

## 通过（三条缺陷逐一修好，我读了代码确认）

### 1. P0 —— 搜索失败时无法手动填写地点（已修）
**改前**（`searchable-combobox.tsx`）：
```tsx
{status === "ready" ? options.map(...) : null}   // manual 行只在 ready 渲染
catch → setActiveIndex(-1)
```
**改后**：
```tsx
{status === "ready"
  ? options.map((option, index) => renderOptionRow(option, index))
  : (status === "error" || status === "rate-limited") && manualOption
    ? renderOptionRow(manualOption, options.length - 1)
    : null}
```
+ `catch` 里 `activeIndex` 指向 manual（有 manual 时）→ **Enter 可选中**；`↑/↓` 在单条 manual 内稳定，不会与"重试"按钮串位；错误提示与重试按钮**保留**。
→ 这直接解除了「地点服务挂了 = 旅行创建被迫中止」的死路。

### 2. P1 —— 错误文案泄露底层异常（已修）
**改前**：直接渲染 `(error instanceof Error && error.message)`，实测出现 `API request /v1/places/search failed with status 500` 与 `Unexpected token 'I', "Internal S"...`。
**改后**：新增 `classifySearchFailure()`（只看 `status`/`code`/`name`，分类为 `timeout` / `offline` / `invalid-response` / `unavailable`）+ **固定文案映射**；原始异常**只进 `console.warn`**；`rate-limited` 复用 `rateLimitedLabel(seconds)` 不透传原文；地点字段用「地点搜索暂时不可用，你可以直接输入地点名称。」
→ 分类逻辑是**基于错误形状**而非字符串匹配，比原实现健壮。

### 3. P1 —— 日期默认值陷阱（已修，两处）
**改前**：`start = end = today`，且 start picker `max={endDate}` → 未来日期全 disabled，必须先改结束日期。
**改后**：
- `emptyTripFormValues` 用既有 `date-utils.addDays` 设 `endDate = startDate + 6`（7 天含首尾）
- 新增**纯函数** `applyTripDateChange`：start 越过 end → end 跟进；end 早于 start → start 回退；区间始终合法
- `handleDateChange` 重新校验并清除日期字段错误；派生天数自动更新
- **两个 picker 移除互相 min/max**（这才是彻底解法——钳制本身就是陷阱根源）

## 验证

| 命令 | 结果 |
|---|---|
| `web typecheck` | exit 0 |
| `vitest run components/forms components/trips` | 6 files / **51 tests** |
| `web lint` | exit 0 |
| **`pnpm --filter @roamlog/web test`** | 31 files / **201 tests**，exit 0 |

新增测试质量高：
- error 下 manual **可见 + 可点击 + Enter 可选中**
- rate-limited 下 manual + Enter
- 错误文案**不含** `500` / `/v1/` / `Unexpected token`（用**真实 `ApiError` 构造**，并断言原文只进 `console.warn`）—— 这条断言方式正确，不是拿字符串硬编码去蒙
- `TimeoutError` 固定文案
- 日期：默认 `end=start+6`、双向自动修正、合法选择不误改
- trip-form 新建页选 `today+7`（旧 max 下被禁用）并验证两个 picker 同步

**它主动改了两条既有断言**（并说明理由）：
1. combobox 原 error 测试里「原始 message 可见」→ 改为安全文案断言（这正是缺陷本身）
2. trip-form 创建 payload 的 `endDate` 期望 → 按新默认改为 `today+6`
→ 这两处改测试是**正确的**（跟随行为变更），不是掩盖失败。

## 风险（我评估后接受，但记录）

1. **自动修正收敛为单日区间，不保留原行程长度**：例如 7 天行程把 start 移到 end 之后，end 会跳到 start（变成单日），而不是保持 7 天。这是我明确指定的行为，但产品上**保留时长**通常更好。已入账为后续 UX 改进。
2. listbox 内含原有 `role="status"` 与重试 `button`，严格 ARIA 校验会提示（未做无关重构，可接受）。
3. **新建默认从"当天往返"变为 7 天**，创建 payload 默认日期随之变化；API 契约未变。
4. 未知异常形态统一落到安全兜底文案（不影响分类可见性）。

## 未覆盖（已派 `G3_FIX_VERIFY` 补）

- **真实浏览器验证未做**（它未启动任何服务）
- 真实断网/504 只做了单元级分类覆盖

→ 已派 `G3_FIX_VERIFY`：用 `page.route()` 注入 `places/search` 500 与 `route.abort()`，在真实浏览器里验证「起点可手动填写 + Enter 可选中」「页面无原始错误文本」「默认 7 天 + 未来日期可选 + 成对自动修正」，并出截图。**这是打 tag 前最后一道浏览器门。**