# SHARE_LIVE_PHOTO — 公开分享页播放 Live Photo

- **状态：DONE**（4 项必须实现全部落地；范围外顺手修掉 1 条 lint）
- **任务 ID：SHARE_LIVE_PHOTO**
- **角色：web_frontend**
- **时间：2026-11-19**
- **commit：`feat(share): play live photos on the public page`**

---

## 1. 变更文件（严格边界内）

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `apps/web/components/media/live-photo.tsx` | 修改 | **仅新增 3 个可选 prop + Space 键 + 删除失效 lint 注释**，默认行为不变 |
| `apps/web/components/media/live-photo.test.tsx` | 修改 | +3 用例（Space、labels/videoLabel、onStillError） |
| `apps/web/components/share/share-article.tsx` | 修改 | `SharePhoto` 接入 `LivePhoto`（`livePhoto===true && motion?.url`） |
| `apps/web/components/share/share.test.tsx` | 修改 | +7 用例（播放、降级、reduced-motion、a11y、无泄漏） |
| `.audit/share-live-photo-report.md` | 新增 | 本报告 |

**未触碰**：`apps/api/**`、`packages/**`、`apps/web/components/{ai,trips,trip-form,moderation}/**`、
`apps/web/lib/**`、`e2e/**`、`docs/**`、`apps/admin/**`、`apps/web/components/media/index.ts`。

---

## 2. 实现摘要（逐 4 项）

### 2.1 复用 `LivePhoto`（未重写、未复制播放逻辑）
`apps/web/components/media/live-photo.tsx` 原本的 props 已经是**通用形态**（`stillUrl` / `motionUrl` /
`alt` / `durationMs`），不含任何 `Media` 私有字段，因此分享页可以直接拿 `PublicMedia` 的
`url` / `thumbUrl` / `motion.url` 传入 —— **没有第二份播放实现**（`lib/places-attribution.ts` 的共享模式：
单一 source of truth，调用方只做适配）。

只新增了 3 个**可选** prop，全部默认关闭、默认文案不变：

```ts
labels?: { live: string; still: string };  // 公开页的访客文案；私有页仍用 alt 派生默认值
videoLabel?: string;                        // 传了才去掉 <video> 的 aria-hidden 并给 aria-label
onStillError?: () => void;                  // 静图自身 signed URL 失效时通知宿主换成占位
```

两个纯加固、对私有页无观感差异的改动：

- **Space**：`onKeyDown` / `onKeyUp` 现在同时接受 `Enter` 与 `" "`（`preventDefault()` 阻止浏览器再合成一次
  click，仍然只播一次）。Enter 路径完全不变。
- **删除** `// eslint-disable-next-line @next/next/no-img-element`：本仓 `eslint.config.mjs` **没有注册**
  `@next/next` 插件，这条注释本身是一条 error（详见 §7）。

公开页拿不到 `storageKey` / `bucket` / `variants`：组件只消费字符串 URL，`PublicMediaSchema` 也不含这些字段。

### 2.2 `ShareArticle` 接入
`SharePhoto` 是所有相册格子（照片墙 + 日志内嵌照片）的唯一渲染入口，因此只改这一处就同时覆盖两个位置：

```tsx
const motionUrl = media.livePhoto === true ? (media.motion?.url ?? null) : null;
...
{photoUrl && motionUrl ? <LivePhoto ... /> : photoUrl ? <img ... /> : <gradient />}
```

- `livePhoto === true && motion?.url` → `<LivePhoto>`（静图 + `LIVE` 角标 + 播放层）
- `livePhoto === false` / `motion: null` / `motion.url: null`（processing 中的静图）→ **现状不变**（普通 `<img>`，
  保留 `srcSet` / `sizes` / `lazy` / `onError` 渐变降级），DOM 里**没有** `<video>`
- 格子尺寸统一为 `aspect-[4/3] w-full`，Live Photo 与普通照片占同一格，网格不跳行

**交互**：长按 250ms / 悬停播、移开停；移动端点击播；`Enter` / `Space` 播、keyup 停；`blur` 停。
**降级**：视频 `onError` → 移除 `<video>`、隐藏角标、保留静图、**零错误文案**（无 alert、无技术字符串）；
静图自身 `onError` → 走原有的生成式渐变占位（与普通照片同一条规则）。
**reduced-motion**：组件自读 `matchMedia`，`reduce` 时禁用悬停/长按自动播放，角标保留，点击 / Enter 仍播。

### 2.3 视觉与可达性
- 角标 `text-[10px]`、mono、`uppercase tracking-[0.12em]`、`left-2 top-2`，不抢图。
- **对比度**：`text-white` on `bg-black/55`。最坏情况（叠在纯白照片上）合成背景 `#727272`
  → 相对亮度 0.1708 → 对比度 `1.05 / 0.2208 = 4.76:1` ≥ 4.5:1；深色照片上远高于此。
  公开页**不传 `durationMs`**：角标秒数子标签是 `opacity-70`，在白底照片上只有 ~3.2:1，不符合要求，故只保留 `LIVE`。
- `<video>` 有 `aria-label="播放这段 Live Photo"`（公开页传入），`<button>` 有可读名称
  （没有 caption 时同样是「播放这段 Live Photo」，有 caption 时是「<caption>（实况照片：长按、悬停或点击播放）」）。
- `muted` + `playsInline` + `preload="none"` 从组件继承，**不自动播放声音**。
- 390px：格子 `aspect-[4/3] w-full` + `figure.overflow-hidden`，角标是绝对定位小文本，无固定宽度/min-width，
  不产生横向溢出（**见 §8：无真实浏览器测量**）。

### 2.4 测试
`apps/web/components/share/share.test.tsx` 新增 `describe("ShareArticle live photos")` 7 条，
`apps/web/components/media/live-photo.test.tsx` +3 条。覆盖：

1. `livePhoto:true` + `motion.url` → `[data-testid="live-photo"]`、`LIVE` 角标、`video src === motion.url`、
   `muted` / `playsInline` / `preload=none` / `poster=still`、静图仍是 payload 的 `url`
2. `livePhoto:false`（即使带 motion）/ `motion:null` / `motion.url:null` → 普通图，`0` 个 video、`0` 个角标
3. 悬停 → `play()` 且 `data-playing=true`；移开 → `pause()`；点击（移动端）→ 播放
4. `prefers-reduced-motion`（stub `matchMedia`）→ 悬停不播放、角标保留、点击才播
5. 视频 `onError` → 静图保留、video 消失、`queryByRole("alert") === null`、无错误文案
6. 静图 `onError`（签名过期）→ 落回渐变占位，不留破图、不留空播放器
7. a11y：`button` 可读名、`video` 可读名、`Enter` 与 `Space` 都能播放/停止
8. 安全：`video[src]` 严格等于 payload 的 `motion.url`，DOM 不含 `storageKey|bucket|X-Amz-Security-Token`

---

## 3. 验证命令与结果（原始输出）

### 3.1 `pnpm --filter @roamlog/web typecheck`
```
$ next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully
TYPECHECK_EXIT:0
```
（首次运行时有 20 条 error，**全部**在 `components/trips/trip-form/**` —— 并行 Agent 中途迁移
`destinations → destinationsV2` 导致；对方随后修复，复跑即 0。本任务文件从未出现在错误列表里。）

### 3.2 `pnpm --filter @roamlog/web exec vitest run components/share components/media`
```
 RUN  v5.1.0 C:/Users/BY9700/Desktop/UI/roamlog/apps/web

 ✓ components/media/live-photo.test.tsx (10 tests) 243ms
 ✓ components/media/use-live-photo-upload.test.tsx (4 tests) 55ms
 ✓ components/media/cover-upload-validation.test.tsx (7 tests) 17ms
 ✓ components/media/cover-uploader.test.tsx (15 tests) 466ms
 ✓ components/share/share.test.tsx (31 tests) 1273ms
   ✓ PublicSharePage (2)
     ✓ requires a password, rejects a wrong password, and then opens the share 481ms
 ✓ components/media/use-cover-upload.test.tsx (20 tests) 1499ms

 Test Files  6 passed (6)
      Tests  87 passed (87)
```
现有 share 测试从 24 → 31 条（新增 7），全部通过；`cover-uploader` / `use-cover-upload` 35 条不受影响。

### 3.3 `pnpm --filter @roamlog/web test`（全量）
```
 Test Files  44 passed (44)
      Tests  376 passed (376)
   Duration  24.24s
TEST_EXIT:0
```
（期间一次中间态 `trip-form.test.tsx` 失败是并行 Agent 的 `destinationsV2` 半成品，非本任务；修复后全绿。）

### 3.4 `pnpm --filter @roamlog/web lint`
```
$ eslint -c ../../eslint.config.mjs .
LINT_EXIT:0
```
（`live-photo.tsx` 原第 148 行 `@next/next/no-img-element` 的「规则不存在」error 已消失；见 §7。）

### 3.5 `pnpm --filter @roamlog/web build`
```
 ✓ Generating static pages using 15 workers (10/10) in 504ms
...
├ ƒ /share/[token]
...
BUILD_EXIT:0
```

### 3.6 真实分享链接 + Playwright 截图 —— **未取到（说明原因）**
```
api4000:200      # 本地 API 在跑
web3000:200      # 本地 Web 在跑
minio:down       # S3/MinIO 9000 未监听
```
`SELECT ... FROM "MediaMotion"` / `"Media"`（本地 PG `127.0.0.1:55444/roamlog_local`）**返回 0 行**：
本地库里既没有 live-photo media，也没有可用的 share token；MinIO 也未启动，签名 URL 必然 404。

要造出这条链路需要**向共享本地 DB 写数据**（auth → 建 trip → 上传静图+动图 → 建分享链接 → 起 MinIO），
属于并行 Agent 共用的环境，越界且会污染他人验证，故未执行。按任务允许的「拿不到就只用单测 + 说明」交付。
（单测是在真实 DOM 树上渲染 `ShareArticle`，断言的是最终 markup，不是 mock 组件。）

---

## 4. CodeGraph 证据

```
$ codegraph explore "SharePhoto ShareArticle LivePhoto motionUrl public share"

Flow (call path among the symbols you queried)
1. ShareArticle (apps/web/components/share/share-article.tsx:31)
   ↓ dynamic: renders <SharePhoto>
2. SharePhoto (apps/web/components/share/share-article.tsx:345)
   ↓ dynamic: renders <LivePhoto>
3. LivePhoto (apps/web/components/media/live-photo.tsx:58)

Blast radius:
- LivePhoto — 4 callers in apps/web/components/share/share-article.tsx,
  apps/web/components/media/index.ts; tests: components/media/live-photo.test.tsx
- SharePhoto — 1 caller in share-article.tsx; tested via components/share/share.test.tsx
- LivePhotoProps — 2 callers（index.ts barrel + 组件自身）
```
改动前用 `codegraph_explore "LivePhoto share-article SharePhoto PublicMedia motion livePhoto"` 确认：
`LivePhoto` 当时**只有 barrel + 测试**两个调用方（即「分享页还没接」），`SharePhoto` 是相册格子的唯一出口 ——
这是决定「只改 `SharePhoto` 一处即覆盖照片墙 + 日志内嵌图」的依据。
`codegraph status` 全程 `up to date`（首次 `sync` 同步了 33 个并行改动文件）。

---

## 5. 范围外但顺手修的 lint（单列）

`apps/web/components/media/live-photo.tsx` 第 148 行：

```
148:8  error  Definition for rule '@next/next/no-img-element' was not found  @next/next/no-img-element
```

原因：`eslint.config.mjs` 只挂了 `@eslint/js` + `typescript-eslint`，**没有** `@next/next` 插件，
任何 `// eslint-disable-next-line @next/next/...` 都会变成「规则不存在」错误。
选择**方案 1（删注释）**：`<img>` 在这里是正确的 —— URL 是带签名/过期的远端资源，`next/image` 的优化器会把它当
静态资源缓存并改写 URL，既没有收益又会被签名过期反噬；其余分享页 `<img>` 也一直是裸 `<img>`，无该注释。

验证：`pnpm --filter @roamlog/web exec eslint components/media/live-photo.tsx` → `ESLINT_EXIT:0`；
全量 `pnpm --filter @roamlog/web lint` → `LINT_EXIT:0`。

---

## 6. 已知风险

1. **懒加载 / 首帧成本**：`preload="none"` 意味着不动就不下载 MOV；代价是首次悬停/点击时 `play()` 可能等待
   网络与解码，短时间内只看到静图（无骨架、无 loading 文案 —— 有意为之，外部访客不该看到技术态）。
   长列表里每格都挂着 `<video>` 元素（未下载任何字节），100 张 Live Photo 的 DOM 成本可接受，但未压测。
2. **CORS / Range 请求**：`<video>` 走跨域签名 GET，播放器依赖对象存储返回 `206 Partial Content` 与
   `Content-Type: video/quicktime|video/mp4`。本地 MinIO 的 CORS 由 `tooling/services` 配置；**生产 S3/CDN
   若没配 `Range` 与 CORS，视频会 `onError` → 静默回落到静图**（不会报错，但功能等于不可用）。未在真实
   CDN 上验证。
3. **签名 URL 过期**：`motion.url` 与静图同 TTL（`expiresAt` 取三者最早）。过期或 403 时：
   `<video>` `onError` → 静图保留；静图也过期时 `onStillError` → 生成式渐变占位。**播放器永远不会变成空壳**。
   但页面本身不做「刷新签名」重试 —— 用户需要重新加载分享页。
4. **HEVC 兼容性（继承 D2 风险）**：iOS `video/quicktime` 多为 HEVC/H.265，Chrome/Android 常无法解码 →
   播放静默失败回落静图。需要 worker 侧转码（见 §8）。
5. **长按与浏览器长按菜单**：移动端 250ms 长按会同时触发浏览器图片长按菜单（组件已 `draggable={false}`，
   但 iOS/Android 的长按菜单未在真机验证）。
6. **`aria-label` 的重复播报**：`<video>` 不再 `aria-hidden` 后，部分读屏会在按钮名称之外再念一次
   「播放这段 Live Photo」。这是「video 必须有可读 label」这条要求的直接后果；按钮仍是唯一键盘入口。

---

## 7. 未覆盖项

1. **真实分享链接的浏览器截图**（本地 DB 无 live-photo 数据 + MinIO 未启动，见 §3.6）——未做。
2. **390px 真机/浏览器视觉回归**：只有 class 级论证，没有 Playwright 截图或真实设备测量。
3. **CORS / Range / CDN 上的真实播放**——未在真实对象存储/CDN 上验证（本地 MinIO 未起）。
4. **iOS Safari 内联播放、低电量模式 `play()` reject、长按菜单**——需要真机。
5. **HEVC/HEIC 兼容**——依赖 worker 转码，本任务不做。
6. **图片 `srcSet` 的 Live Photo 版本**：Live Photo 路径只用 `media.url`（960w），没把 320w 缩略图放进
   `srcSet`，因为共享组件目前不接收 `srcSet`；公开页 Live Photo 格子首屏字节略高于普通格子。

---

## 8. 建议下一步

1. 给 `LivePhoto` 增加可选 `stillSrcSet` / `sizes`（同样是纯附加 prop），让 Live Photo 格子复用缩略图变体，
   省首屏字节。
2. 生产对象存储/CDN 侧确认：bucket CORS 允许 `GET` + `Range`、不强制 `Content-Disposition: attachment`、
   `Cache-Control: private` 或短 TTL（签名 URL 可缓存但要注意过期）。
3. worker 增加 HEVC → H.264 转码（D2 §9 同款建议），否则 Chrome/Android 上「能播但静默失败」。
4. 数据侧准备一条固定的 E2E 种子（一个带 motion 的 media + 一个 share token + 起 MinIO），
   之后就能把「公开页播放 Live Photo」纳入真实浏览器回归。
5. 若产品希望角标显示时长，需要先把角标秒数子标签从 `opacity-70` 提到不透明度 ≥90%（或加 `bg-black/70`），
   否则白底照片上达不到 4.5:1。