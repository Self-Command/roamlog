# P0-CI-COPY 收口报告

状态: ACCEPT
日期: 2026-11-20
范围: CI/Release 地图默认值、用户可见开发者文案、文案回归门禁

## 变更

- `.github/workflows/ci.yml`、`.github/workflows/release.yml`：地图样式与地理编码默认值统一为 OpenFreeMap Liberty + Photon，保留 `vars.*` 覆盖。
- `.env.example`：同步默认值。
- 旅行工作区 6 个对话框、分享链接、删除旅行、行程表单、照片 503 错误态、照片上传限额：移除 API 路径、HTTP 状态码、`服务端签发上传链接`、`软删除`、`令牌` 等用户不可见实现语言。
- `.audit/local-verify/copy-gate.mjs` / `copy-gate.sh`：11 条 AST 文案规则 + ci/release/.env.example 默认值漂移检查。
- 新增文案回归测试：`copy.test.tsx`、`share-copy.test.tsx`、`query-errors.test.tsx`。

## 验证

- `NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty NEXT_PUBLIC_GEOCODER_URL=https://photon.komoot.io/api/ pnpm --filter @roamlog/web test` → 76 files / 635 tests passed。
- `pnpm typecheck` → 11/11 tasks passed。
- `bash .audit/local-verify/copy-gate.sh` → PASS，156 files，0 hits / 11 rules，workflow defaults aligned。
- 真实浏览器截图：`.audit/copy-sweep/*.png`、`.audit/error-copy/photos-503-*.png`、`.audit/photo-limits-copy/*.png`。

## CodeGraph 证据

- `codegraph status` → `[OK] Index is up to date`。
- `codegraph explore "DEFAULT_STYLE_URL DEFAULT_GEOCODER_URL StopsTab ExpensesTab ShareTab ItineraryList"` → 命中 `globe-view.tsx`、`map-canvas.tsx`、`geo.ts` 及 TripWorkspace 调用链。
- `codegraph explore "failureFrom toApiError QueryPanel"` → `QueryPanel` 14 个调用方；错误兜底影响 Photos/Participants/Share/Packing/Stops/Activity。

## 移植来源

- 地图默认值：产品源码 `apps/web/components/map/globe-view.tsx:40`、`map-canvas.tsx:64`、`geo.ts:5`；CI/Release 仅对齐既有默认值。
- 文案：仓库既有 `DialogDescription` / `EmptyBlock` / `Badge` 产品文案模式；本轮为删除开发者语义，不新增功能。

## 已知风险

- 若 GitHub 仓库变量显式设置为 demotiles/nominatim，仍会覆盖 release fallback；默认值漂移检查只校验文件。
- `ShareLinkDialog` 当前只被未挂载的 `TripMapLive` 引用，截图使用真实组件 + 真实 CSS 的 harness，不是 live 路由。
- `invite-accept.tsx`、`two-factor-security.tsx`、`trip-detail-live.tsx` 仍有少量技术文案；`trip-form.tsx:474` 仍保留 409 文案，需后续小任务处理。
