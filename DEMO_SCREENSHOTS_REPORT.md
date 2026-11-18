# DEMO_SCREENSHOTS_REPORT

状态: NEEDS_REVIEW  
任务 ID: DEMO-SCREENSHOTS  
工作目录: `C:\Users\BY9700\Desktop\UI\roamlog`

## 交付文件

- `docs/assets/screenshots/web-dashboard.png`
- `docs/assets/screenshots/web-trips.png`
- `docs/assets/screenshots/web-journal.png`
- `docs/assets/screenshots/web-journal-sheet.png`
- `docs/assets/screenshots/web-trip-budget.png`
- `docs/assets/screenshots/web-map.png`
- `docs/assets/screenshots/web-public-share.png`
- `docs/assets/screenshots/admin-dashboard.png`
- `docs/assets/screenshots/admin-queues.png`
- `docs/assets/screenshots/admin-flags.png`
- `docs/assets/screenshots/admin-system.png`
- `docs/assets/screenshots/web-dashboard-mobile.png`
- `docs/assets/screenshots/web-journal-mobile.png`
- `docs/assets/screenshots/README.md`
- `DEMO_SCREENSHOTS_REPORT.md`

未修改产品代码、截图测试、根 README、workflows、contracts/db 或 lockfile；
未 commit / push。

## 来源

- Web 与 Admin 当前版本：2026-11-18 通过滚动启动的
  `localhost:3000` / `localhost:3001` 开发预览截取；数据模式为
  MSW/local fixture。
- 12 张当前版本视口截图由本地 Playwright capture 生成；临时 capture
  脚本在完成后删除，没有改动现有截图测试。
- `web-map.png` 使用 `screenshots/w4-map-desktop.png`（2026-11-17
  20:33）的已有最终截图。当前 headless Chromium 重新打开地图时仅得到
  空 MapLibre canvas，没有 tile 请求，因此没有把黑地图交付到资产目录。
- `web-public-share.png` 来自当前版本 `/share/demo-public`，保留只读
  share 投影，不含评论或邮箱。

## 尺寸与体积

| 文件 | 尺寸 | 大小 |
|---|---:|---:|
| `web-dashboard.png` | 1440×1000 | 342.7 KB |
| `web-trips.png` | 1440×1000 | 454.4 KB |
| `web-journal.png` | 1440×1000 | 345.9 KB |
| `web-journal-sheet.png` | 1440×1000 | 170.1 KB |
| `web-trip-budget.png` | 1440×1000 | 353.9 KB |
| `web-map.png` | 1440×1000 | 268.5 KB |
| `web-public-share.png` | 1440×1400 | 296.7 KB |
| `admin-dashboard.png` | 1440×1000 | 128.9 KB |
| `admin-queues.png` | 1440×1000 | 104.5 KB |
| `admin-flags.png` | 1440×1000 | 119.8 KB |
| `admin-system.png` | 1440×1000 | 126.9 KB |
| `web-dashboard-mobile.png` | 390×844 | 107.8 KB |
| `web-journal-mobile.png` | 390×844 | 59.5 KB |

合计约 2.9 MB，均为 PNG，未见文字模糊或过度压缩。

## 校验结果

- 当前 12 张重新截取页面均满足 `documentWidth === viewportWidth` 且
  `bodyWidth === viewportWidth`，没有横向溢出。
- 逐张视觉检查：无整屏黑图、空白海报、截断的导航或测试专用文案。
  Journal sheet 使用干净的 seed 评论，没有 `E2E` 评论；Budget 没有
  `E2E` 花费。
- 敏感信息扫描：未发现 Bearer、API key、JWT、分享明文 token 或连接
  字符串。桌面侧栏显示 `lin.mo@roamlog.local` 与
  `lin.zhixia@roamlog.local`，两者均为 fixture 的 `.local` 演示身份；
  Public Share 截图中邮箱数量为 0。
- Playwright 视觉截图测试：9 passed（dashboard、trips、journal、
  atlas-map、public-share、admin dashboard/queues/flags/system）。
- Playwright 交互测试：journal sheet 与 budget 2 passed；随后用干净
  viewport capture 替换了测试产生的带 `E2E` 文案截图。
- `localhost:3000` 与 `localhost:3001` 仍在监听；未停止预览。

## 未覆盖项与风险

1. **提交阻塞：** `.gitignore` 第 37 行的 `screenshots/` 规则会匹配
   `docs/assets/screenshots/`。`git check-ignore -v` 已确认 13 个 PNG 与
   本目录 README 都被忽略；当前 `git status` 因此看不到这些资产。根
   Agent 需在后续提交前加入 `!docs/assets/screenshots/` 与
   `!docs/assets/screenshots/**`，或明确强制添加。本任务按要求没有修改
   `.gitignore`。
2. 所有 Web/Admin 资产仍展示 MSW、fixture 或 mock 标识，不能作为真实
   API 已完成的生产证据。
3. `web-map.png` 不是 2026-11-18 的新截图；当前 headless 地图渲染为空。
   如需严格证明地图最新状态，应在能加载 MapLibre 瓦片的环境重截并人工
   复核后替换。
4. 运行 Playwright 截图时，其默认 `test-results/` 清理行为移除了原先
   已存在的 `test-results/staging-release/`。任务开始时已核对其中
   journey/public-share/admin 截图与 evidence 文件；该目录未复制到
   `e2e/staging-full/artifacts/runs`，本地没有可恢复副本。需要从
   staging/远端重跑 `tooling/k6/run-staging-release.ps1` 找回证据；后续
   重跑前应先归档该目录。
5. 同一轮 Playwright 交互测试还按默认 reporter 配置重写了
   `playwright-report/index.html`。截图资产不受影响；如需保留旧 HTML
   报告，应重跑对应 staging 测试或从远端恢复。

## 建议下一步

- 在支持 WebGL/MapLibre 瓦片且可联网的环境补拍当前地图，覆盖
  `web-map.png`。
- 由根 Agent 决定是否重跑 staging release 证据，并在验收记录中保留
  上述 test-results 清理事故。
- 根 README 如需引用这些资产，只添加相对路径
  `docs/assets/screenshots/<file>.png`，不要提交断链或修改截图数据来源
  标识。
