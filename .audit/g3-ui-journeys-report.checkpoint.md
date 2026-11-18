# G3_UI_JOURNEYS — checkpoint

状态: **DONE**（含 4 个真实 FAIL，均为 mock 能力缺口，不是脚本缺陷）

- 环境: web dev :3000（mock），Playwright 1.65 + Chromium，真实点击/键盘
- 用例: 23 个 spec（`e2e/g3/*.spec.ts`），结果 **19 PASS / 4 FAIL**
- 证据: `.audit/evidence/g3-ui/shots/`（29 张）+ `logs/`（run-1..4、focus-order、detail-tabs、overflow、submit 观测）
- 运行配置（未改仓库配置）: `.audit/evidence/g3-ui/playwright.g3.config.ts`

## 结论
1 创建全字段 FAIL（起点不可填 + 提交不跳转，其余全通过）
2 combobox 五态 PASS
3 日期键盘 PASS
4 编辑页 FAIL（回填通过，保存不跳转/不持久）
5 详情工作台 FAIL（mock 挂载 legacy 8 tab，7-tab 工作台需 api 模式；已挂载 tab 全部真实渲染）
6 响应式 PASS（390/820/1440 无横向溢出）
7 键盘 PASS（29 个控件 focus-visible + ring）
8 reduced motion PASS

## 根因（一条链路）
mock 的 MSW handlers 只有 GET；写请求与 `/v1/places/search` 被 bypass → rewrite 到未启动的 :4000 → 500；
`searchable-combobox` 在 error 态不渲染 manual 行 → 起点无法手动降级；
详情路由 `DATA_MODE === "api"` 才渲染 `TripDetailLive/TripWorkspace`，否则 legacy 详情。

## 后续建议
1. 为 mock 增加 POST/PATCH trips 与 places/search（含 degraded 分支）；
2. combobox error/rate-limited 态也渲染 manual 行；
3. 统一搜索失败文案（当前泄露 JSON 解析异常）；
4. mock 详情路由改为渲染 `TripWorkspace`（或在 e2e 中显式 api 模式跑 7-tab 旅程）。

CodeGraph 证据: `codegraph status` = [OK] Index is up to date；`codegraph explore "NewTripPage TripForm EditTripPage TripWorkspace TripDetailLive SharePage AppShell"` = 42 symbols / 8 files，确认 `TripDetailLive → TripWorkspace` 为唯一渲染入口、`TripForm` 6 callers。