# 根 Agent 验收记录 — SHARE_GALLERY_MEDIA

任务 ID: SHARE_GALLERY_MEDIA
验收结论: **ACCEPT（条件：实机视觉未核对）**
时间: 2026-11-18 23:40

## 通过

### 修复
- `SharePhoto` 改为真实 `<img src={media.url ?? media.thumbUrl}>`，与封面 `coverImageUrl()` **同一规则**（保持一致是关键，避免两套取图逻辑）
- 两处调用点改为传 `media={item}`（传整个对象而非散字段，减少后续字段增删的改动面）
- 响应式：`srcSet="<thumbUrl> 320w, <url> 960w"` + `sizes="(min-width:1024px) 200px, (min-width:640px) 30vw, 45vw"` —— 按照片墙 2/3/4 列单元格实际宽度推算，`src` 始终是显示 URL
- `loading="lazy"`、`decoding="async"`、`aspect-[4/3]`、`object-cover`
- **fallback 完整保留**：`url`/`thumbUrl` 皆空 或 `onError` → `setFailed(true)` → 原渐变块（`aria-hidden`），且 **`srcSet` 也置空**（避免失败后仍尝试加载）—— 这个细节做得对

### alt 决策（有理由，我认可）
```ts
const caption = media.caption?.trim() ? media.caption : null;
alt={caption ?? ""}
```
- 有真实 caption → 用 caption
- null/纯空白 → `alt=""`（装饰性）
- **不用假文案、不拿 location 顶替**（正确：location 是地理位置，不是图片描述）
- `figcaption` 仍显示 `caption ?? location`，但把纯空白 caption 归为 null（避免空图注）

### 测试（8 个新用例，覆盖到位）
url 有值→`src=url` 无渐变 ｜ 仅 thumbUrl→`src=thumb` ｜ `srcSet` 小图/大图 ｜ 两者 null→渐变（无 `<figure> img`）｜ `onError`→回落渐变 ｜ 日志内嵌照片同一签名路径 ｜ 空白 caption→`alt=""` ｜ **每个 img src 均属于 payload URL 集合且以 payload 宿主开头**，HTML 不含 `media.example.invalid` / `s3.` / `amazonaws` / `storage.googleapis` / `minio` / `_next/image`，且 `img` 无 `data-nimg`

最后两条是防「偷偷回到硬编码/next-image」的护栏，有价值。

### 验证
`vitest run components/share` → 1 file / **17 tests** 通过 ｜ `typecheck` exit 0 ｜ `lint` exit 0

## 风险（接受）

1. `sizes` 按 880px 容器 + 2/3/4 列推算；**若改分享页最大宽度或列数需同步**——这是隐性耦合，已记录。
2. `alt=caption` 而 `figcaption` 也显示 caption → 屏幕阅读器念两遍（我指定策略的副作用，低 severity）。
3. `expiresAt` 未使用：页面停留超过签名有效期后再懒加载 → `onError` → 回落渐变，**不会自动重签**。这是真实的长期停留场景问题（分享页往往是长读页面），但影响是「图变渐变」而非「报错」，可接受；已入账为后续「过期→自动重签」。
4. 只有 `url` 无 `thumbUrl` 时网格直接下显示图（可用性优先，正确取舍）。

## 未覆盖

- **实机视觉未核对**（端口被占，禁止起 server）→ G3 覆盖：需在 `/share/demo-*` 桌面 4 列 / 移动 2 列检查观感，并与封面同屏对比
- 真实 S3 预签名跨域/防盗链（后端 + 存储配置，见 `docs/operations/media-delivery.md`）
- E2E（`e2e/**` 禁写）