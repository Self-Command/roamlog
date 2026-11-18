# SHARE_HERO_COVER — 匿名分享页 hero 封面修复

- 任务 ID: SHARE_HERO_COVER
- 角色: web_frontend
- 状态: DONE
- 仓库: `C:\Users\BY9700\Desktop\UI\roamlog`
- 提交: 无（按任务要求未提交）

## 变更文件（本任务只写了这两个）

| 文件 | 变更 |
| --- | --- |
| `apps/web/components/share/share-article.tsx` | hero 读取 `trip.cover`；无可用封面时保留 `coverClassForTrip()` 渐变；新增 `coverImageUrl()`；签名 URL 加载失败时回落 |
| `apps/web/components/share/share.test.tsx` | 新增 `ShareArticle cover` 5 个用例 |

边界说明：`git status` 里同目录的 `public-share-page.tsx`、`share-link-dialog.tsx` 显示 `M`，`components/share/demo-share.ts` 显示 staged `D`，这些是工作区中既有的他人改动，本任务未触碰。`share.test.tsx` 的 diff 中还包含一条本任务开始前就存在的 import 路径替换（`./demo-share` → `@/components/legacy-mock/share/demo-share`，随 `demo-share.ts` 的移动而来）；本任务在该文件只新增了两条 import 与 88 行 `ShareArticle cover` 用例。`share-article.tsx` 的 diff 全部来自本任务。

## 缺陷与修复

后端 `SHARE_COVER_FIX` 已让公开 API 返回 `trip.cover = { mediaId, status, url, thumbUrl, width, height, blurhash, expiresAt }`（签名 URL），workspace 级封面（`media.tripId = null`）也可返回；跨租户 / 非 `ready` / 软删仍为 `cover: null`。

修复前 `share-article.tsx:45` 只有 `coverClassForTrip(tripIndex)`，从不读取 `trip.cover`，所以匿名访客永远看到渐变块。

修复后：

```tsx
function coverImageUrl(cover: PublicTrip["cover"]): string | null {
  if (!cover || cover.status !== "ready") return null;
  return cover.url ?? cover.thumbUrl;
}
```

- `coverUrl` 非 null → 渲染 `<img src={coverUrl} …>`，`src` 完全来自 `trip.cover`，不做任何拼接。
- `trip.cover` 为 null / `status !== "ready"` / 两个 URL 都为 null → 不渲染 `<img>`，保留原来的 `trip-cover` + `coverClassForTrip()` 渐变容器（fallback 未删除，也不会留空白洞）。
- 签名 URL 在运行时失效（403 / 过期）→ `onError` 置 `coverFailed`，同样回落到渐变，避免破图。
- 有封面时不再挂 `.trip-cover` / `trip-cover--*`，只加一层底部压暗叠层保证元数据对比度。

### alt 决策：`alt=""`（装饰性）

1. `<h1>{trip.title}</h1>` 紧跟 hero 下方，已经是这趟旅行的可访问名称。
2. 封面照片不携带额外信息（无人物/地点说明、无 caption）；若用标题作 alt，读屏会把同一标题连续播报两次。
3. 按 WAI 图像指南，信息已由相邻文本完整表达时应使用空 alt；图片从可访问性树移除，hero 内的国家 / 天数元数据仍可被读出。
4. fallback 分支保留原来的 `aria-hidden="true"`；有封面的分支不再整体隐藏，所以真实图片与元数据不会像原来的假封面那样被一并屏蔽。

### 加载属性

- `loading="eager"`：hero 在首屏，是匿名页最大的视觉元素（LCP 候选），懒加载会推迟首图出现。
- `decoding="async"`：不阻塞首屏渲染。

### 为什么不用 `next/image`

租户上传的 S3 签名 URL 主机名/路径随环境与租户变化，无法在 `next.config` 里静态配置 `remotePatterns`。登录态页面（`trip-card.tsx:21`、`dashboard-page.tsx:71`、`atlas-workspace.tsx:454`）都是原生 `<img>`，分享页保持一致。未添加任何 `eslint-disable` 注释，也没有引入 `@next/next` 规则依赖。

### `share/**` 其它假封面排查

`grep "cover|Cover"` 在 `apps/web/components/share/**` 只命中 `share-article.tsx` 的两处（import 与 hero），`public-share-page.tsx` / `share-link-dialog.tsx` 没有封面渲染逻辑，因此第 2 条要求没有其它需要改动的位置。

## 验证

1. `pnpm --filter @roamlog/web typecheck` → exit 0，`next typegen && tsc --noEmit` 零诊断（未出现他人未提交文件导致的错误）。
2. `pnpm --filter @roamlog/web exec vitest run components/share` → `Test Files 1 passed (1)` / `Tests 9 passed (9)`。
3. `pnpm --filter @roamlog/web lint` → exit 0（`eslint -c ../../eslint.config.mjs .` 全仓零输出，本任务文件 0 error / 0 warning）。
4. `codegraph status` → `[OK] Index is up to date`；`codegraph explore "coverImageUrl ShareArticle"` 已索引新符号。

### 新增测试（5）

| # | 场景 | 断言 |
| --- | --- | --- |
| 1 | `cover.status="ready"` 且有 url | `<img>` 的 `src` = payload url；`alt=""`、`loading="eager"`、`decoding="async"`；页面无 `.trip-cover` 与 `trip-cover--*` |
| 2 | `cover: null` | 无 `<img>`；存在 `trip-cover--{amber,moss,ice,coast,rose}` 且 `aria-hidden="true"` |
| 3 | `status="processing"`、url/thumbUrl 均为 null | 走 fallback，无 `<img>` |
| 4 | 签名 URL 触发 `error` 事件 | 回落到渐变，`<img>` 被移除 |
| 5 | 来源与硬编码 | `src === data.trip.cover.url`；渲染 HTML 不含 `media.example.invalid`、`s3.` / `s3-` |

## CodeGraph 证据

- MCP `codegraph_explore`（`projectPath=C:\Users\BY9700\Desktop\UI\roamlog`）查询 `share-article coverClassForTrip trip.cover cover-url share components hero cover` → 命中 `ShareArticle`（`apps/web/components/share/share-article.tsx:26`）、`coverClassForTrip`（`apps/web/lib/trip-presentation.ts:103`）、`PublicTripCover`（`packages/api-client/src/generated/schemas/publicTripCover.ts:13`）；blast radius 显示 `ShareScreen` 经 `share.test.tsx` 覆盖。
- 查询 `PublicTripResponse PublicTripCover PublicTrip cover status url thumbUrl contracts public share payload` → 命中 `packages/contracts/src/api/share-links.ts`（`PublicTripSchema.cover = TripCoverSchema.nullable()`，`PublicMediaSchema.url`）与 `apps/api/src/modules/share-links/share-links.repository.ts`（workspace 级 cover 的 `OR` 查询与租户/status/deletedAt 约束）。
- 修改后：`codegraph explore "coverImageUrl ShareArticle"` → `coverImageUrl`（`share-article.tsx:282`）1 个调用方 `ShareArticle`，测试 `share.test.tsx`；`codegraph status` 为 up to date。

## 已知风险

1. 未做浏览器/截图验证：任务禁止起 dev server，3000/3100/3300/4100 均被其它 Agent 占用。样式沿用既有 token 与类；`bg-gradient-to-*` 在本仓库 Tailwind 4.3.5 中仍是可用别名（`lib.js` 内存在 `bg-gradient-to-` 兼容映射，仓库另有 15 处既有用法），`object-cover` 防拉伸。
2. 签名 URL 若过期，`onError` 回落前面会短暂出现浏览器破图；后续可用 `blurhash` 做占位。
3. `coverFailed` 不会因 `trip.cover` 变化自动复位；分享页每次拿到数据都是新挂载（loading → ready），当前没有实际影响。
4. 移动端真实视口未检查。

## 未覆盖项（超出本任务范围，仅记录）

- `share-article.tsx` 的 `SharePhoto` 仍用 4 色渐变占位，而 `PublicMediaSchema` 本身带 `url` / `thumbUrl`。它属于日志/相册照片而不是封面，按要求未改。若用户投诉的是“整页没有图片”，建议单开 `SHARE_GALLERY_MEDIA` 处理。
- `legacy-mock` 里的 `photos-tab.tsx` 等假图不在本任务范围。
- 未提交、未做 `next build`（不属于本任务的验证清单）。

## 建议的下一步

1. 用非 3000/3100/3300/4100 的隔离端口起 web，拿真实分享 token 做桌面/移动截图，确认英雄区有图且 fallback 正常。
2. 评估 `SHARE_GALLERY_MEDIA`：`SharePhoto` 改用 `PublicMedia.url ?? thumbUrl`，同样保留渐变 fallback。
3. 若签发 URL 有效期短于页面停留时间，考虑基于 `expiresAt` 的被动刷新（需后端或 Query 层支持）。