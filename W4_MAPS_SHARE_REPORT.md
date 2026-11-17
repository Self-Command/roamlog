# W4-MAPS-SHARE — Delivery Report

状态: DONE
任务 ID: W4-MAPS-SHARE
角色: Map & Public Share Engineer
工作目录: `C:\Users\BY9700\Desktop\UI\roamlog`

## 变更文件

新增:

- `apps/web/components/map/map-types.ts`
- `apps/web/components/map/geo.ts`
- `apps/web/components/map/city-search.tsx`
- `apps/web/components/map/map-fallback.tsx`
- `apps/web/components/map/map-canvas.tsx`
- `apps/web/components/map/trip-map.tsx`
- `apps/web/components/map/atlas-map.tsx`
- `apps/web/components/map/trip-map-live.tsx`
- `apps/web/components/map/trip-map.test.tsx`
- `apps/web/components/share/demo-share.ts`
- `apps/web/components/share/html.ts`
- `apps/web/components/share/share-article.tsx`
- `apps/web/components/share/public-share-page.tsx`
- `apps/web/components/share/share-link-dialog.tsx`
- `apps/web/components/share/share.test.tsx`
- `apps/web/app/share/[token]/page.tsx`
- `apps/web/app/(app)/w/[workspaceSlug]/trips/[tripId]/map/page.tsx`

修改:

- `apps/web/components/map/atlas-workspace.tsx` — 世界足迹页接入 MapLibre / 降级地图。
- `apps/web/components/trip-detail/trip-map-tab.tsx` — 旅行地图 Tab 接入真实地图与分享入口。
- `apps/web/test/setup.ts` — jsdom `ResizeObserver` stub，供 Radix Dialog 测试使用。
- `apps/web/package.json` — 新增 `maplibre-gl@6.18.0`、`react-map-gl@8.1.0`。

未触碰:

- `components/journal/**`
- `components/trip-detail/journal-tab.tsx`
- auth、Admin、API、Worker、root config
- 未 commit、未停止 `3000` / `3001`

## 实现摘要

### 地图

- MapLibre GL + react-map-gl，地图样式来自 `NEXT_PUBLIC_MAP_STYLE_URL`，默认 `https://tiles.openfreemap.org/styles/liberty`。
- 城市搜索使用 `NEXT_PUBLIC_GEOCODER_URL`，默认 Photon；兼容 Nominatim 响应；300ms debounce；5 分钟内存缓存。
- 停靠点 marker、路线 LineString、选中高亮、点击 marker 更新右侧停靠点详情。
- attribution 同时由 MapLibre attribution control 和可见的 `© OpenStreetMap · OpenFreeMap` 链接提供。
- WebGL 不可用、MapLibre 加载失败、worker/style 初始化失败时自动降级：
  - 可访问停靠点列表；
  - 简化 SVG 世界地图；
  - 标记可键盘聚焦与选择。
- 世界足迹页使用同一条 MapLibre 渲染路径，9 个旅行标记和结果面板保持联动。
- API 模式新增 `/w/[workspaceSlug]/trips/[tripId]/map`，使用 generated `listStops` + `TripQuery`；mock 模式复用 demo store。
- 城市搜索选择只做地图预览，不伪装保存停靠点。

### 公开分享

- `/share/[token]` 无应用壳，720–960px 编辑式单列阅读页。
- 显示封面、标题、摘要、路线/日期、停靠点、日志、照片、可选预算摘要。
- 只渲染公开契约白名单字段；评论、邮箱、内部备注、分账付款人等字段即使混入对象也不会显示。
- 日志 HTML 再做一次客户端清洗，移除 script/style/iframe/表单、`on*` 事件和 `javascript:` URL。
- 默认 `robots: noindex, nofollow`。
- 覆盖密码表单、密码错误、过期、撤销、not-found、网络/服务错误状态。
- 密码分享通过 API `password` query 读取；mock 模式提供 `password-demo`（密码 `roamlog`）、`expired-demo`、`revoked-demo`、`demo` 等演示 token。
- Share Link Dialog：密码、过期时间（7/30 天/永不）、是否显示预算；创建后仅展示一次 token/URL，关闭 Dialog 即清空；Viewer 禁用创建。
- mock 模式创建会写入 sessionStorage 元数据，生成的 `demo-*` 链接可直接预览密码/预算行为。

## 验证命令与结果

```powershell
pnpm --filter @roamlog/web test
```

结果: PASS — 14 个测试文件，38 个测试全部通过。

覆盖:

- 地图失败/强制降级为可访问列表与简化 SVG；
- 列表模式；
- marker 选择回调；
- 城市搜索 300ms debounce 与结果渲染；
- 公开分享对象混入评论、邮箱、内部备注时不泄漏；
- 密码缺失/错误后正确打开；
- 过期与撤销提示；
- Share Dialog token 只显示一次，关闭后重开不再显示。

```powershell
pnpm --filter @roamlog/web typecheck
```

结果: PASS。

```powershell
pnpm --filter @roamlog/web build
```

结果: PASS — Next.js 16.4.6 Turbopack production build 完成，新增路由已生成：

- `ƒ /share/[token]`
- `ƒ /w/[workspaceSlug]/trips/[tripId]/map`

浏览器 smoke（Playwright，当前 3000 dev server）:

- `/share/demo`: HTTP 200；桌面与 390px 移动截图正常，无应用壳。
- `/share/password-demo`: HTTP 200；移动端密码表单正常。
- `/w/roamlog-crew/map`: HTTP 200；浏览器中 `.maplibregl-map = 1`、`.maplibregl-marker = 9`、fallback = 0，无 console error。
- `/share/expired-demo`、`/share/revoked-demo` 由组件测试覆盖独立状态。

截图:

- `screenshots/w4-share-desktop.png`
- `screenshots/w4-share-mobile.png`
- `screenshots/w4-share-password-mobile.png`
- `screenshots/w4-map-maplibre.png`

## 已知风险

- **MapLibre worker URL**：Turbopack dev 将 `new URL(...)`/`?url`/`?raw` 的 worker 入口输出为不可执行 TS（`video/mp2t`），因此显式将 worker 设为固定版本 CDN：
  `https://cdn.jsdelivr.net/npm/maplibre-gl@6.18.0/dist/maplibre-gl-worker.mjs`。
  CDN 不可达时组件会自动降级到可访问列表，不会白屏。后续如需完全离线，应由 root/DevOps 在部署层提供同源 worker 文件并替换该 URL。
- **依赖安装副作用**：没有主动执行 `pnpm install`；但 `pnpm --filter @roamlog/web typecheck` 时 pnpm 12 自动补齐缺失依赖并更新了 `pnpm-lock.yaml`。该 lockfile diff 同时包含并发 Agent 的 Tiptap 条目，无法安全拆分为仅 map 依赖。若 lockfile 由 root 单独管理，请由 root 审阅/重建 lockfile。
- 真实 API 对过期和撤销统一返回 404，UI 显示合并的“已失效”说明；mock 模式提供独立过期/撤销状态。
- `allowIndex` 当前始终为 false，公开 payload 不返回 allowIndex，因此页面始终 noindex。

## 未覆盖项

- 分享链接列表/撤销运营页（本次只交付创建 Dialog 与公开阅读页；API 已有 list/revoke）。
- 公开页参与者头像/姓名（PublicTripResponse 当前不含 participant 字段）。
- 地图停靠点新增/编辑/排序持久化（地图侧只做搜索预览与选择；写接口与表单属于旅行编辑流程）。
- 真实 API 模式下的 Playwright E2E（需要 API/DB/对象存储运行；本次用 component tests + mock smoke 覆盖）。

## 建议下一步

1. root 审阅 `pnpm-lock.yaml` 与并发 Tiptap 依赖，统一重建/提交 lockfile。
2. 若生产环境需要完全自托管，将 MapLibre worker 放入同源静态资源并替换 `map-canvas.tsx` 的 CDN URL。
3. 补 Share Link 管理列表与撤销入口，复用已有 API `listShareLinks` / `revokeShareLink`。
4. 将 City Search 结果接入真实的 stop create/update 表单，形成“搜索 → 填坐标 → 保存停靠点”的完整旅程。
