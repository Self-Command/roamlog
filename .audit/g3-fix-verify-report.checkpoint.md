# G3_FIX_VERIFY — checkpoint

- 状态: **DONE / PASS**（V1 PASS、V2 PASS、V3 PASS；9 用例 / 89 产品断言，连续 3 轮 9 passed）
- 环境: Next dev 16.4.6 于 `http://localhost:3500`（非影子目录）；Playwright 1.65 + Chromium；三道门（/login 200、/trips/new 可进、创建按钮可见）全部通过
- 关键事实: `page.route` 命中 0（MSW 在 Service Worker 内）；实际注入走 `window.fetch` init-script shim（未改 MSW）；另保留无打桩的真实 500 用例与 `context.setOffline` 真实断网用例
- 证据: `.audit/evidence/g3-fix/shots/`（14 张）、`.audit/evidence/g3-fix/logs/`（9 JSON + env-gates + 第 3 轮运行日志）
- 断言源: 新增 `e2e/g3-fix/*.spec.ts` + `support/harness.ts`
- 边界: 未改 apps/**、packages/**、既有 e2e、playwright 配置；无 git 写操作；未跑 build
- 清理: 3500 dev server 已停止，`netstat` 确认无 LISTENING（仅 TIME_WAIT 客户端连接）；未用影子目录，无临时目录需删除；3100/4100/55443 未触碰
- 详细结论: `.audit/g3-fix-verify-report.md`