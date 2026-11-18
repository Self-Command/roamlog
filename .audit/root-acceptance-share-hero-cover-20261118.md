# 根 Agent 验收记录 — SHARE_HERO_COVER

任务 ID: SHARE_HERO_COVER
验收结论: **ACCEPT（条件：照片墙仍未接真实 URL，已另派 SHARE_GALLERY_MEDIA）**
时间: 2026-11-18 23:20

## 通过

### 修复本身
- `coverImageUrl(cover) = cover && cover.status === "ready" ? (cover.url ?? cover.thumbUrl) : null`
- 有可用 URL → `<img src alt="" loading="eager" decoding="async" onError={fallback}>`，容器不再挂 `.trip-cover` / `trip-cover--*`
- 另加底部压暗叠层（`bg-gradient-to-t from-black/75`）以保证 `text-white/60` 元数据的**对比度**——这是主动的可访问性考虑，值得记

### fallback 触发条件（完整，无空白洞）
1. `trip.cover` 为 null
2. `status !== "ready"`（pending/processing/failed）
3. `url` 与 `thumbUrl` 都为 null
4. **运行时签名 URL 加载失败（`onError`）** ← 这条是真实生产会遇到的情况（URL 过期）
fallback 分支完整保留原 `trip-cover` + `coverClassForTrip()` 渐变与 `aria-hidden`。

### alt 决策（有理由，我认可）
`alt=""`（装饰性）。理由链：`h1` 紧跟 hero 下方已是旅行的可访问名称；封面无 caption/人物语义；用标题会**重复播报同一标题**；WAI 规则下相邻文本已表达信息时用空 alt。→ 判断正确。

### loading 决策
`loading="eager"`：hero 在首屏且是 LCP 候选；`decoding="async"` 避免阻塞。→ 正确。

### 边界自证
`grep cover|Cover` 在 `apps/web/components/share/**` 只命中 `share-article.tsx` 两处，其它文件无封面逻辑 → 无遗漏、无顺手改动。

### 验证
| 命令 | 结果 |
|---|---|
| `web typecheck` | **exit 0**，零诊断 |
| `vitest run components/share` | 1 file / **9 tests** 通过（新增 5 例） |
| `web lint` | **exit 0**（全仓 zero output） |

新增 5 例覆盖：ready+url 渲染 img 且无 `.trip-cover*` / cover null 渲染渐变且无 img / processing 且 url null 走 fallback / `img error` 回落渐变 / `src === data.trip.cover.url` 且 HTML **不含** `media.example.invalid` 与 `s3.`（防硬编码）。

## 条件项 / 未覆盖

**照片墙 `SharePhoto` 仍用渐变占位**，而 `PublicMediaSchema` 本身已带 `url`/`thumbUrl`。这是审计 P1「照片墙与分享页图片」的剩余部分，用户可见。已另派 `SHARE_GALLERY_MEDIA`。

## 风险（接受）

1. 签名 URL 过期时 `onError` 回落前会短暂破图；`coverFailed` 不随 cover 变化复位（分享页每次新挂载，无实际影响）。
2. 未做浏览器/移动端截图（端口被占，禁止起 server）→ G3 覆盖。
3. `bg-gradient-to-*` 在 Tailwind 4.3.5 有兼容映射（仓库另有 15 处用法），非新风险。