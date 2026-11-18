# 根 Agent 验收记录 — WEB_TRIP_FORM（含 CLOSEOUT）

任务 ID: WEB_TRIP_FORM + WEB_TRIP_FORM_CLOSEOUT
验收结论: **ACCEPT（条件：409 未收口 ConflictDialog、孤儿 media）**
时间: 2026-11-18 23:15

## 过程说明

原 Agent `WEB_TRIP_FORM` 写完主体后卡住（20+ 分钟零文件变化），我终止并派 `WEB_TRIP_FORM_CLOSEOUT` 接手。收尾 Agent **没有重写表单**，只补测试与报告——符合我的指令。

## 通过

### 封面（两条路径都正确）
- `trip-form.tsx:552` 挂载 `<CoverUploader>`
- **新建**：只暂存 `mediaId`，`new-trip-shell.tsx:38-45` 在 `createTrip` 成功后调 `setCover(trip.id, mediaId)`，再 `push` 到 `/w/<slug>/trips/<id>`
- **编辑**：直接传 `trip`，**不重复 setCover**
- `createTrip` 失败时 media **保留**，重试复用（`createdTripRef` 防重复建 trip）

### 日期选择器（真日历，非裸文本）
- `role=grid` 月历；键盘：←→ ±1 天、↑↓ ±7 天、Enter/Space 选定、Esc 关闭、PageUp/PageDown 换月
- `min/max` 由 `date-utils.isDateOutsideRange` + `clampDateOnly`；禁用格无 `onClick`，commit 有守卫

### combobox 五态
loading / 空 / error+重试 / degraded / 手工降级 —— 均有实现与对应测试名。

### payload 精确性
- CREATE 字段集用 `toEqual` **锁定**（防止漏发或多发）
- EDIT diff 在 `trip-form-state.ts:333-404`：只发变更 + 必带 `version`；无变更返回 `null`（UI 提示不提交）

### 验证
| 命令 | 结果 |
|---|---|
| `web lint` | **exit 0** |
| `web typecheck` | **0 错误** |
| `vitest run components/trips components/forms` | 6 files / **41 tests** |
| `pnpm --filter @roamlog/web test` | 31 files / **178 tests**，exit 0 |

## 条件项 / 风险（我评估后接受，但记录）

| ID | 问题 | 我的判断 |
|---|---|---|
| R1 | **放弃创建会留孤儿 media**（无清理调用） | 真实数据垃圾，需后台清理任务（pending media TTL）。已入账。 |
| R2 | `countryCodes` 含起点国；非本表单创建的 trip 首次编辑可能多一个 patch | 轻微，可接受；但会造成一次无意义 PATCH，建议 diff 时排除 |
| R3 | **409 走表单内联 alert + 「重新加载最新版本」，未用共享 `ConflictDialog`** | 功能等价（有冲突提示 + 可重载，不静默覆盖），但**与其他模块不一致**（详情工作台用了 `ConflictDialog`）。属体验一致性问题，非缺陷。已入账。 |
| R4 | 坐标浮点严格比较 | 低风险（表单内同源字符串→数字），记录 |

## 未覆盖（→ G3）

429 rate-limit 态、422 字段映射的 UI 级测试（仅纯函数）、DatePicker「今天」按钮、编辑封面的替换/移除在表单层、e2e、axe、移动端截图。

其中「编辑封面替换/移除」是关键——`WEB_COVER_UPLOAD` 的测试覆盖了组件层，但**表单层的接线未被测**。G3 会实测。

## 结论

表单在**代码与单元测试层面**已完整，可作为 rc.4 的一部分。真实浏览器行为由 `G3_UI_JOURNEYS` / `G3_API_JOURNEYS` 验收。