# 照片上传 + 地图聚合 移植规格（PHOTO_UPLOAD_MAP_RESEARCH）

- 状态: DONE（只调研与规格，未写任何产品代码）
- 仓库 HEAD: `d9e8832`（`git log --oneline -1`，2026-11-20）
- 唯一改动文件: `.audit/photo-upload-map-spec.md`
- 未触碰 `apps/**`、`packages/**`；未 `git add` / `commit`
- CodeGraph 证据: `codegraph_explore "photos-tab PhotosTab media exif map-canvas showPhotos PhotoLocationsPanel onSelectPhotoGroup"` → 定位 `PhotosTab`(photos-tab.tsx:186)、`PhotoLocationsPanel`(photo-layer.tsx:16)、`MapCanvas`(map-canvas.tsx:57)、blast radius：`PhotosTab` 3 callers / `PhotoLocationsPanel` 3 callers + `photo-layer.test.tsx`、`atlas-workspace-photo.test.tsx`

---

## 0. 一句话结论

三块能力必须分开移植，且**不存在单一上游项目能覆盖「批量上传 + 大图查看 + 地图聚合」**：

| 能力 | 移植来源（整块） | 许可证 | 结论 |
|---|---|---|---|
| 批量上传 | `transloadit/uppy`（`@uppy/core` 6.3.2 + `@uppy/dashboard` 6.0.3 + 自写 uploader 插件） | MIT | 整块采用，不自研队列 |
| 大图查看 | `igordanchenko/yet-another-react-lightbox` 3.33.1（+ Zoom / Thumbnails 插件） | MIT | 整块采用 |
| 地图聚合 | `maplibre/maplibre-gl-js` 内建 GeoJSON cluster（仓库已移植，`cluster-points-source.tsx`） | BSD-3-Clause | 已有，不新增依赖 |

拼装点只有 3 个（上传完成 → 失效媒体列表；地图点击 → 打开 viewer；签名 URL 过期 → 重签），一致性保障见 §E。

---

## 1. 移植来源总表（全部实测）

### 1.1 许可证实测（`web_fetch raw.githubusercontent.com/<owner>/<repo>/main/LICENSE`）

| 项目 | LICENSE 实测结果 | 结论 |
|---|---|---|
| `transloadit/uppy` | MIT（"Copyright (c) 2019 Transloadit"） | 可用 |
| `pqina/filepond` | MIT（"Copyright (c) 2019 Pqina"） | 可用 |
| `react-dropzone/react-dropzone` | MIT（"Copyright (c) 2018 Param Aggarwal"） | 可用 |
| `igordanchenko/yet-another-react-lightbox` | MIT（"Copyright (c) 2022 Igor Danchenko"） | 可用 |
| `dimsemenov/PhotoSwipe` | MIT（"Copyright (c) 2014-2022 Dmitry Semenov"） | 可用 |
| `MinJieLiu/react-photo-view` | **Apache-2.0** | 可用 |
| `mapbox/supercluster` | **ISC**（"Copyright (c) 2024, Mapbox"） | 可用 |
| `maplibre/maplibre-gl-js` | BSD-3-Clause（含 mapbox-gl-js v1.13 BSD-3、glfx.js MIT、d3-color BSD 声明） | 可用 |

无 AGPL / SSPL / Commons Clause / BSL / 自定义社区许可。

### 1.2 提交哈希（`git ls-remote https://github.com/<repo>.git HEAD`，2026-11-20 实测）

| 仓库 | HEAD commit |
|---|---|
| `transloadit/uppy` | `4c7fed69a67c6112c7e2134cd372a25140a8ca12` |
| `pqina/filepond` | `2a2e2871f2fe1428bec102857d3fb5d8b2877aff` |
| `react-dropzone/react-dropzone` | `22f11de71085f698db56005abed694f1113b8470` |
| `igordanchenko/yet-another-react-lightbox` | `6ef6a6e9807ff65023a8acf01a167ea8a8cabcc0` |
| `dimsemenov/PhotoSwipe` | `cd41cb587a460634e4cae53134f3d01d06e284a6` |
| `MinJieLiu/react-photo-view` | `e5c91c00e4b0ae59174b65e5a1b100321b8f19d6` |
| `mapbox/supercluster` | `641713a579c6bdbc5b588ac8a61b1552ccb21311` |
| `maplibre/maplibre-gl-js` | `7a6b265daecebb91e082f85d4fef09a8f75d84b0` |

> 下文的 `path:line` 均按上表 commit 读取（`raw.githubusercontent.com/<repo>/<sha>/<path>`）。Uppy 的 HEAD 与 npm 已发布版本一致（实测 `@uppy/core`=6.3.2、`@uppy/dashboard`=6.0.3、`@uppy/thumbnail-generator`=6.0.2），版本与源码对得上。

---

## A. 批量上传器

### A.1 候选实测对比

| 维度 | Uppy 6.3.2 / Dashboard 6.0.3 | FilePond 4.32.14 | react-dropzone |
|---|---|---|---|
| 批量选择 | Dashboard 自带隐藏 `<input type="file" multiple>`，`multiple={maxNumberOfFiles !== 1}`，`accept={allowedFileTypes.join(', ')}`（`packages/@uppy/dashboard/src/components/AddFiles.tsx:68-79`） | `allowMultiple`（默认 **false**，`dist/filepond.esm.js:1828`） | 只做选择 |
| 单次数量上限 | `restrictions.maxNumberOfFiles`（`packages/@uppy/core/src/Restricter.ts:11, 87-96`；Dashboard 读取于 `Dashboard.tsx:1251`） | `maxFiles`（`filepond.esm.js:1843`） | 无（要自己实现） |
| 单文件大小上限 | `restrictions.maxFileSize`（`Restricter.ts:8`，校验在 `validateSingleFile`） | `maxFileSize` | 无 |
| 总大小上限 | `restrictions.maxTotalFileSize`（`Restricter.ts:10, 98-105`） | **没有该选项**（实测 `grep -c maxTotalFileSize dist/filepond.esm.js` = 0） | 无 |
| 并发上限 | 由 uploader 插件决定：`@uppy/xhr-upload` `limit` **默认 5**（`.../xhr-upload/src/index.ts:149`），`new TaskQueue({ concurrency: this.opts.limit })`（`:188`） | `maxParallelUploads` 默认 **2**（`filepond.esm.js:1859`） | 无 |
| 拖拽 | Dashboard `handleDragOver` / `handleDrop`（`Dashboard.tsx:844`） | `allowDrop` 默认 true（`:1825`） | 有 |
| 粘贴 | Dashboard 文档级 `paste` 监听（`Dashboard.tsx:758-770`，注册于 `:986`，注释说明为何挂在 document 而非 onPaste `:910-919`） | `allowPaste` 默认 true（`:1827`） | 无 |
| 缩略图预览 | `@uppy/thumbnail-generator`（Dashboard 依赖，`thumbnailWidth` 默认 280，`Dashboard.tsx:186`） | 需另装 `filepond-plugin-image-preview` 4.6.12（MIT） | 无 |
| 进度 / 暂停 / 重试 | StatusBar：`uppy.pauseAll()`（`core/src/Uppy.ts:1446`）、`resumeAll()`（`:1464`）、`retryAll()`（`:1531`）、`#getFilesToRetry`（`:1486`） | 有进度与 abort，无同类“整批重试”API | 无 |
| i18n 中文 | `packages/@uppy/locales/src/zh_CN.ts`（实测 200，7,998 B） | `locale/zh-cn.js`（实测 200） | 无 UI |
| gzip 体积 | `@uppy/dashboard@6.0.3` **39,309 B**；`@uppy/core@6.3.2` **18,045 B**（bundlephobia API 实测） | `filepond@4.32.14` **34,340 B** | 很小 |
| 能否对接自带后端 | **能**，`uppy.addUploader(fn)` 是公开扩展点，见 A.3 | 能，`server.process` 是回调 | 不适用 |

### A.2 推荐：Uppy（整块移植）

理由（都是可核对的功能差，不是口味）：

1. **只有 Uppy 单块覆盖全部要求**：批量选择、单次数量上限、单文件/总大小上限、并发上限、进度、暂停/恢复、重试、缩略图、拖拽、粘贴、中文、可自定义上传链路。FilePond 缺 `maxTotalFileSize`（实测无此选项），react-dropzone 只有选择能力——用它就得自建队列/并发/重试，违反「禁止自己设计」。
2. Uppy 的数量/大小校验在 **core**（`Restricter.ts`），不是 UI 层：即使 Dashboard 换成别的界面，限制语义不变。

### A.3 「接自带后端」的源码依据：Uppy 是否允许自定义 uploader

**允许，且是公开 API，不是 hack：**

- `core/src/Uppy.ts:762` `addUploader(fn: Processor): void`，写入 `#uploaders: Set<Processor>`（`:468`、`:763`）；`#runUpload` 把 `#uploaders` 拼进流水线（`:2303`）。
- 官方 uploader 就是这么做出来的：`@uppy/xhr-upload` 构造里 `this.type = 'uploader'`（`xhr-upload/src/index.ts:181`），`install()` 里 `this.uppy.addUploader(this.#handleUpload)`（`:569`），`uninstall()` 里 `removeUploader`（`:583`）。
- 结论：我们自己写一个 `type='uploader'` 的插件，`install()` 里注册 `async (fileIDs, uploadID) => {...}`，内部走 **presign → PUT → complete**，与 `@uppy/xhr-upload` 完全同构。**不要**装 `@uppy/xhr-upload`（它的 `endpoint` 只能发一个 multipart POST，装不进我们三步链路）。

### A.4 上传器插件必须发出的契约（照 `xhr-upload` 抄，别发明）

| 时机 | 必做 | 依据 |
|---|---|---|
| 开始 | `uppy.emit('upload-start', filesToEmit)`（用 `filterFilesToUpload` / `filterFilesToEmitUploadStarted` 过滤，二者从 `@uppy/core/utils` 导出，`core/src/utils/index.ts:47-48`） | `xhr-upload/src/index.ts:533-535` |
| 进度 | `uppy.emit('upload-progress', file, {uploadStarted, bytesUploaded, bytesTotal})` | 同上 `:238` |
| 单文件成功 | `uppy.emit('upload-success', file, {status, body, uploadURL})`；再把 `mediaId/poster` 之类写进 `file.meta` 或 `uppy.setFileState` | 同上 `:267` |
| 单文件失败 | `uppy.emit('upload-error', file, error, request)` | 同上 `:286-292` |
| 取消 | 监听 `cancel-all` / `file-removed` 并 `AbortController.abort()` | 同上 `:397-398`、`:496` |

> `@uppy/core` 一旦收到 `upload-success`，会把该文件的 `progress.uploadComplete/percentage` 置好（`Uppy.ts` 的 `upload-success` handler），缩略图/状态栏才会正确收尾——所以**不能只 complete 后端而不 emit 事件**，否则 UI 永远停在 uploading。

### A.5 限制参数怎么配（Uppy 侧写法，非自研）

```
restrictions: {
  maxNumberOfFiles: 20,
  maxFileSize: 25_000_000,
  maxTotalFileSize: 150 * 1024 * 1024,
  minNumberOfFiles: 1,
  allowedFileTypes: ['image/jpeg','image/png','image/webp','image/avif','image/heic','image/heif'],
}
```

依据见 §D2（含来源）。`allowedFileTypes` 必须与 `packages/contracts/src/api/media.ts:29` 的正则 `/^image\/(jpeg|png|webp|avif|heic|heif)$/` 完全一致，否则前端放过、后端 400。

### A.6 并发怎么控

两条路，二选一，**不要都做**：

- 路 A（推荐，最省事）：把 `TaskQueue` 用起来。`@uppy/core/utils` 已导出 `TaskQueue`（`core/src/utils/index.ts:86-89`），实现见 `core/src/utils/TaskQueue.ts:44`（`#concurrency` `:47`、`#paused` `:48`、`pause()` `:183`、`resume()` `:190`、`add(task)` `:62`）。`new TaskQueue({ concurrency: 3 })`，把我们 uploader 的每文件流水线塞进去，`xhr-upload` 就是这么干的（`xhr-upload/src/index.ts:188`）。
- 路 B：插件内手写 `for (const batch of chunks(fileIDs, 3))`。能跑，但 pause/resume 要自己管，不推荐。

### A.7 失败重试怎么做

- 整批重试：`uppy.retryAll()`（`core/src/Uppy.ts:1531`），它只挑 `file.error` 且不缺 required meta 的文件（`#getFilesToRetry` `:1486-1499`），并会先清 `error` 再新建 upload（`:1531-1545`）。
- 单文件自动重试：我们的 uploader 里对“可重试错误”做 2 次指数退避后再 emit `upload-error`。可重试集合必须与后端一致：
  - 可重试：网络中断、`429`（预签名限流，`media-presign-rate-limit.guard.ts:16`）、`5xx`。
  - 不可重试：`400`（契约不符）、`403`（角色无 `media:presign`）、`413`/`415`。
- 注意：**retry 会重新 presign**，会再消耗一次 `limits.uploadPerMinute` 配额（因为 presign 才是限流点）。

### A.8 EXIF 时机不能破

Uppy 的 `file.data` 就是原始 `File`；我们的 uploader 在 `compress()` **之前**调 `readPhotoExif(file.data)`，沿用仓库现有规则（`apps/web/components/media/use-live-photo-upload.ts:327-336` 的 `completionExif`、`apps/web/lib/image/read-photo-exif.ts:78-97` 的 `EXIFR_OPTIONS`）。**禁止**把 exif 读取挪到压缩之后，也禁止让 `@uppy/compressor` 之类的预处理插件先跑。

---

## B. 图片查看器（lightbox）

### B.1 候选实测

| 维度 | YARL 3.33.1 | react-photo-view（Apache-2.0） | PhotoSwipe 5 |
|---|---|---|---|
| 框架 | React 组件，`peerDependencies` 支持 `react ^16.8 || 17 || 18 || 19`（`package.json` 实测），0 运行期依赖 | React 组件 | 原生 JS，需自己接线 |
| 体积 | npm `bundleSize` = **11 kB**；bundlephobia gzip **12,210 B** | README 自述 7 KB gzip | 未测 |
| 缩放 | `plugins/zoom`，默认 `maxZoom: 8`、`minZoom: 1`、`scrollToZoom: false`、`doubleTapDelay: 300`、`pinchZoomDistanceFactor: 100`（`src/plugins/zoom/props.ts`） | 内置双指缩放 | 内置 |
| 缩略图条 | `plugins/thumbnails`，默认 `position:'bottom'`、`width:120`、`height:80`、`gap:16`、`vignette:true`（`src/plugins/thumbnails/props.ts`） | 无内置缩略图条 | 需自建 |
| 键盘 | ←/→/Esc；`Esc` 受 `controller.closeOnEscape`（默认 **true**）控制，且**主动 `stopPropagation`** 以免同时关掉外层 Radix/MUI 弹窗（`src/modules/Navigation/useKeyboardNavigation.ts:29-45`，注释写明了这个场景） | 自述支持键盘 | 支持 |
| a11y | `role="dialog"`、`aria-modal`、`aria-label`（`src/modules/Portal.tsx:130-132`）；打开时给兄弟节点打 `inert` + `aria-hidden`（`:94-95`）；关闭时恢复焦点（`:100`）；容器 `tabIndex={-1}` 并在挂载时 `focus()`（`src/modules/Controller/Controller.tsx:417`、`:329-339`，受 `controller.focus` 默认 true 控制，`src/props.ts:32`） | README 只声明键盘导航，未声明焦点陷阱 | 有焦点陷阱与 `role="dialog"`（`src/js/photoswipe.js:118-121` 注释、`:737` `setAttribute('role','dialog')`、`:749` `aria-roledescription="carousel"`、`:750` `aria-live="off"`） |
| 服务端渲染 / 动态导入 | `open=false` 时直接 `return null`（`src/Lightbox.tsx` 末尾 `if (!props.open) return null`），可安全 `next/dynamic` 懒加载 | 自述支持 SSR | 需要 `window` |
| 签名 URL 过期后换图 | **支持**：`slides` 或 `index` 的引用变化会 `dispatch({type:'update', slides, index})`（`src/contexts/LightboxState.tsx:79`），打开状态下替换 `slides[].src` 即换图 | 需验证 | 需 `photoswipe.refresh()` |

### B.2 推荐：YARL 3.33.1 + Zoom + Thumbnails

MIT、React 19 原生、零依赖、11 kB、a11y 是真正实现出来的（不是文档口号）、Esc 与 Radix 弹窗的冲突已在源码里处理（我们 `photos-tab.tsx` 的详情就是一个 Radix `Dialog`，这条直接决定选它）。

PhotoSwipe 作为备选：a11y 也合格，但它是原生 JS、自带 DOM 与 CSS、React 接线要手写（`PhotoSwipeLightbox` + 手动 `init`），移植进 Next App Router 的成本明显高于 YARL；且缩略图条要自建。

react-photo-view（Apache-2.0，中文文档）体积更小、手势好，但缺缩略图条、a11y 无焦点陷阱证据，且其 API 是“包裹 children”的隐式触发（`<PhotoProvider><PhotoView src>…`），**从地图点开指定索引**需要额外桥接，不如 YARL 的受控 `open/index` 直接。

### B.3 接入点（3 处，全部受控，不新建全局状态库）

1. **照片 tab**：`apps/web/components/trip-workspace/photos-tab.tsx` 现在点卡片是 `setDetailTarget(item)` 打开 Radix `Dialog`（`:276`、`:287-315`）。改为：点卡片 → `setViewer({ items: 当前日期组或全量, index })` → 渲染 `<PhotoLightbox open index slides>`。原 `Dialog` 里的 EXIF 详情迁到 lightbox 的 `Captions`/自定义 `render.slide` 之外的详情抽屉（见 §D3）。
2. **地图**：`map-canvas.tsx` 的 `handleClick` 已经算出 `photoGroupKey(photo)`（`:110-113`）并回调 `onSelectPhotoGroup`。把「打开 viewer」作为**第二个回调**接入，不要改 `onSelectPhotoGroup` 的语义（它同时被 `PhotoLocationsPanel` 用来高亮某地，见 `photo-layer.tsx:26`）。建议新增 `onOpenPhoto?: (photoId: string) => void`：单击未聚合的 `photo-point` → 打开该张；点聚合簇 → 维持现有「展开/选中该组」行为（`expandClusterIfAny`，`map-canvas.tsx:106`）。
3. **atlas 侧栏**：`photo-layer.tsx:86-117` 的缩略图 `<li>` 现在是纯展示（没有点击）。加 `onOpen(photo.id)`，`atlas-workspace.tsx:433-440` 传下去。

`slides` 一律用**已签名的 `thumbUrl`/`url`**（`mediaPreviewUrl`，`apps/web/components/trip-workspace/media-urls.ts:26`），不要拼 S3 key。`true` 的 `srcSet` 可用 `variants.thumb / variants.medium / variants.large`（`MediaReadSchema` 之外，列表里 `variants` 带 `{key,url,expiresAt}`，见 `media.service.ts:695` 的 `presentMedia(record, views, ...)`）。

### B.4 移动端手势

由 YARL `Controller` 模块负责：`touchAction: 'none'`（默认，`src/props.ts:34`）、指针滑动 `usePointerSwipe.ts`、滚轮滑动 `useWheelSwipe.ts`、缩放插件 `pinchZoomDistanceFactor`/`doubleTapDelay`（`src/plugins/zoom/props.ts`）。我们**不要**自己写 `touchstart` 处理；只需要保证容器父级没有 `overflow:hidden` 冲突，并把 `closeOnPullDown` / `closeOnPullUp` 按产品取舍（默认 false，`src/props.ts:35-36`）。

### B.5 a11y 验收点（可直接写成 e2e 断言）

- 打开后焦点在 lightbox 容器（`tabIndex=-1` + `focus()`）。
- 兄弟节点 `inert`/`aria-hidden` → 背景 Tab 不可达。
- `Esc` 关闭；关闭后焦点回到触发元素（`restoreFocus`，`Portal.tsx:100,144-145`）。
- `role="dialog"` + `aria-modal` + `aria-label`（默认 `labels.Lightbox`，可用 `labels={{ Lightbox: '照片查看' }}` 覆盖）。
- 键盘 ←/→ 翻页；`Zoom` 插件下 `+/-`/双击。

### B.6 签名 URL 过期后的重载

- 现状：签名 URL TTL 默认 **900s / 15 分钟**（`apps/api/src/config/environment.ts:247`，`MEDIA_SIGNED_URL_TTL_SECONDS: ...default(900)`，上限 604800，`storage.service.ts:49`）。
- 触发点：`<img>` 加载失败时（YARL `ImageSlide` 有 `onError` 状态，`src/components/ImageSlide.tsx` 的 `SlideStatus` 机制）→ 调 `queryClient.invalidateQueries(['v1', ... 'media'])` 重取列表 → 新 `slides` 数组 → `LightboxState` 自动 `update`（`contexts/LightboxState.tsx:79`）。
- **不要**用 `expiresAt` 定时器无脑轮询；只在 `onError` / 用户重新打开时重签。

---

## C. 地图照片聚合与点击

### C.1 仓库现状（已具备，不需要新建）

- `apps/web/components/map/cluster-points-source.tsx:5-10` 注释写明：该 cluster 图层「移植自 MapLibre 官方示例 `test/examples/create-and-style-clusters.html`，`github.com/maplibre/maplibre-gl-js @ b8a71bd...`」。
- `PHOTO_CLUSTER_SPEC`：`clusterMaxZoom: 16`、`clusterRadius: 46`（`cluster-points-source.tsx:50-58`）；`<Source cluster clusterMaxZoom clipRadius>`（`:96-102`）。
- 点击链路：`map-canvas.tsx:90-113` `handleClick` → `clusterInteractiveLayerIds(PHOTO_CLUSTER_SPEC)` 判定 → `expandClusterIfAny` → 否则取 `properties.id` 找到 photo → `onSelectPhotoGroup(photoGroupKey(photo))`。
- 已有 `photoFocus`（"缩放到照片"，`photo-points.ts:128-137`）。

### C.2 内建 cluster 的官方参数（版本 + URL）

- 文档：<https://maplibre.org/maplibre-style-spec/sources/>（`geojson` source 的 `cluster` 小节）。实测页面含 `cluster`、`clusterRadius`、`clusterMaxZoom`、`clusterMinPoints`、`clusterProperties`。
- 文档原文（实测抓取）：「clusters are re-evaluated at integer zoom levels so setting `clusterMaxZoom` to 14 means the clusters will be displayed until z15」；`clusterMinPoints`「Minimum number of points necessary to form a cluster… Defaults to 2」。
- 仓库内 maplibre-gl 版本 **6.18.0**（`apps/web/package.json:37`）；npm 最新 6.19.0（实测）。源码映射（`maplibre-gl-js@7a6b265…/src/source/geojson_source.ts:241-252`）：`cluster: options.cluster || false`、`maxZoom: this._getClusterMaxZoom(clusterMaxZoom)`、`minPoints: Math.max(2, clusterMinPoints || 2)`、`radius: this._pixelsToTileUnits(clusterRadius || 50)`。
- **放大后自动散开**靠 `clusterMaxZoom`：超过它就不再聚合，显示单个 `photo-point`（图层 filter `["!",["has","point_count"]]`，`cluster-points-source.tsx:127`）。我们的 16 意味着 z17 起必然单点。
- 动态改参数：`GeoJSONSource#setClusterOptions({clusterRadius, clusterMaxZoom, ...})`（`geojson_source.ts:364-369` 注释自带示例）。
- `clusterProperties` 可做「簇内最早拍摄年份」之类聚合，但**本需求不需要**，不要加。

### C.3 点开单张 → lightbox 的接法（`queryRenderedFeatures` 路线）

1. `map-canvas.tsx` 的 `interactiveLayerIds` 已经只含 `[photo-clusters, photo-point]`（`:135-137`），所以 `event.features[0]` 一定是这两层之一。
2. 判定：`feature.properties.point_count` 存在 → 是簇（`expandClusterIfAny` 处理）；否则 `properties.id` 就是 `mediaId`。
3. 该 `mediaId` 在 `photos`（`PhotoPoint[]`）里查索引 → `onOpenPhoto(photo.id)`，由上层把 `slides` 的 `index` 设为这条（同组内顺序），打开 lightbox。
4. 聚合簇点击**不要**直接开 viewer：先 `map.getClusterExpansionZoom(clusterId)` 放大（`expandClusterIfAny` 已做），保持现有交互。

### C.4 是否需要 `mapbox/supercluster`（ISC）

**不需要。** 理由：

- MapLibre v6 的 GeoJSON 聚合由 `@maplibre/geojson-vt` 承担（`geojson_source.ts:353-354` `return new GeoJSONVT(data, options)`；worker 侧 `_createGeoJSONIndex` 在 `src/source/geojson_worker_source.ts:269`，`updateClusterOptions` 在 `:280`，`getClusterExpansionZoom` 在 `:319`），选项与 supercluster 同构（`maxZoom/minPoints/radius/clusterProperties`，`geojson_source.ts:246-255`）。`maplibre-gl` 的依赖里确实没有 `supercluster`（`package.json` dependencies 实测：`kdbush`、`@maplibre/geojson-vt`、`@maplibre/vt-pbf` 等，无 supercluster）。
- 只有当我们想在**地图之外**自己算聚合（例如给侧栏生成“城市级簇计数”）才需要 `mapbox/supercluster`。当前侧栏用的是网格分组 `groupPhotos`（`photo-points.ts:96-108`，精度 3 位小数 ≈ 110m），不需要再引一个库。

**结论：C 段零新增依赖。**

---

## D. 移植规格

### D1 文件映射表

> 「整块」指：UI + 状态机 + 交互全带上，不挑功能。因此 Uppy / YARL 以**依赖 + 适配层**方式移植（这是 MIT 库的标准移植方式），适配层单独列在最下面并标注原因。

#### D1.1 上游 → 本仓库

| 上游（commit 见 §1.2） | 本仓库目标 | 形式 |
|---|---|---|
| `@uppy/core@6.3.2`（`packages/@uppy/core`，`Uppy.ts:762 addUploader`、`Restricter.ts:7-18`、`utils/TaskQueue.ts:44`） | `apps/web/package.json` 依赖 + `apps/web/lib/upload/uppy-instance.ts`（单例 + restrictions + zh_CN） | 依赖（整包） |
| `@uppy/dashboard@6.0.3`（`Dashboard.tsx` 全量：选择/拖拽/粘贴/缩略图/状态栏/重试/暂停） | `apps/web/components/media/photo-uploader.tsx`（`inline: true` 挂载） | 依赖（整包） |
| `@uppy/dashboard/dist/style.min.css` | `apps/web/components/media/photo-uploader.module.css`（import + `.uppy-Dashboard` 覆盖） | 样式适配 |
| `packages/@uppy/locales/src/zh_CN.ts` | `locale: zh_CN` 传参 | 配置 |
| `packages/@uppy/xhr-upload/src/index.ts:181-583`（上传器插件骨架、事件契约） | `apps/web/lib/upload/roamlog-uploader.ts`（自写 uploader：presign→PUT→complete） | **逐函数转写**（去掉 formData/bundle/remote 分支，保留事件顺序与 abort 处理） |
| `yet-another-react-lightbox@3.33.1`（`src/Lightbox.tsx`、`Portal.tsx`、`Controller`、`Carousel`、`Navigation`） | `apps/web/package.json` + `apps/web/components/media/photo-lightbox.tsx` | 依赖（整包） |
| `plugins/zoom`、`plugins/thumbnails`（`src/plugins/zoom/props.ts`、`thumbnails/props.ts`） | `photo-lightbox.tsx` 的 `plugins={[Zoom, Thumbnails]}` | 依赖 |
| `yet-another-react-lightbox/styles.css` + `plugins/thumbnails.css` | 同上（按需 `import`） | 样式 |
| `maplibre/maplibre-gl-js` 官方 cluster 示例（`create-and-style-clusters.html @ b8a71bd…`） | **已移植**：`apps/web/components/map/cluster-points-source.tsx` | 已存在，不改 |

#### D1.2 本仓库既有文件（复用，不重写）

| 文件 | 复用点 |
|---|---|
| `apps/web/lib/image/read-photo-exif.ts` | `readPhotoExifSafely`（:56）、`EXIFR_OPTIONS`（:78）、50 字段产出（:104-190） |
| `apps/web/lib/image/compress-image.ts` | `IMAGE_MAX_EDGE=2000`、`IMAGE_QUALITY_STEPS`、`IMAGE_TARGET_BYTES=1_500_000`（:5-11） |
| `apps/web/lib/image/use-image-compression.ts` | 单 worker 串行压缩（已有队列，见 `:79` `this.queue`） |
| `apps/web/lib/api/media.ts` | `putObjectToSignedUrl`（:95）、`createCoverMediaClient`（:185）、`COVER_MAX_BYTES`（:36） |
| `apps/web/components/trip-workspace/queries.ts` | `useTripMedia`（:183，`limit:100`, `sort createdAt:desc`） |
| `apps/web/components/map/photo-points.ts` | `photosFromMedia` / `groupPhotos` / `photosToGeoJson` / `photoFocus` |
| `apps/web/components/map/photo-layer.tsx` | `PhotoLocationsPanel`（:16）、`PhotoLayerToggle`（:123） |

#### D1.3 适配层（必须显式标注：为什么不能原样照搬）

| 适配层 | 为什么 |
|---|---|
| `photo-uploader.tsx` 的 options | 上游没有任何“我们的 workspaceId/tripId/权限/设计 token”；Uppy options 全部得由我们注入（`restrictions` 与契约对齐、`note` 中文文案、`proudlyDisplayPoweredByUppy: false`、`theme: 'dark'`）。上游默认 `theme: 'light'`（`Dashboard.tsx:208`）、品牌标识默认 **true**（`:201`）。 |
| `roamlog-uploader.ts` | 上游 uploader 都是“一个请求发完”（XHR/TUS/S3-multipart）。我们的链路是 3 段（presign→PUT→complete）+ 浏览器压缩 + EXIF 前置读取，**上游没有等价物**，只能按 `xhr-upload` 骨架转写。 |
| Uppy 主题 CSS | `packages/@uppy/dashboard/src/style.scss` 实测 `grep -c "var(--"` = **0**：没有任何 CSS 自定义属性，主题靠 `[data-uppy-theme='dark'] &` 选择器（`:187, 289, 314, 350, 392`）与 Sass 变量；文件头第 1 行还写着「variables … are not considered stable and can change at any time」。所以只能覆写类名，**做不到 token 化**。这是移植后唯一的“不像我们产品”的地方，必须接受或另议。 |
| `photo-lightbox.tsx` | 上游只管展示；`slides` 由我们的 `Media[]` 映射、`labels` 中文化、`index` 由地图/tab 决定。 |

### D2 限制参数建议（每个都带依据）

| 参数 | 建议值 | 依据（可核对） |
|---|---|---|
| **单次批量上限** | **20 张** | ① 预签名限流是**每账号 20 次/60s**：`MEDIA_PRESIGN_RATE_LIMIT_MAX` 默认 20（`apps/api/src/config/environment.ts:242`；`.env.example:79`；`docker/*.env.example` 同为 20），窗口 `RATE_LIMIT_WINDOW_SECONDS` 默认 60（`:238`），判定 `count <= limit`（`apps/api/src/common/security/rate-limit.service.ts:90`）。② 运行时还会被 `limits.uploadPerMinute` 覆盖，默认同样是 **20**（`apps/api/src/modules/settings/limits-settings.consumer.ts:50, 55`，允许 1..600）。③ 一张照片 = 一次 presign，所以批量 > 20 必然在第 21 张开始 429。**20 与后端配额对齐，不是拍脑袋。** 若运营把 `limits.uploadPerMinute` 调高，前端上限跟着读该设置即可（不需要改代码）。 |
| **单文件大小上限** | **25,000,000 B（25 MB 十进制）** | `packages/contracts/src/api/media.ts:30-34` `size.max(25*1024*1024)`；前端同值 `COVER_MAX_BYTES = 25_000_000`（`apps/web/lib/api/media.ts:36`）；设置项默认 `media.maxUploadBytes` 25,000,000（`apps/web/lib/settings.test.ts:312` 断言）。注意服务端常量是 **25 MiB = 26,214,400**（`apps/api/src/modules/media/media-rules.ts:31`，注释说明这是刻意留 1.2 MB slack）——**文案只能写 25 MB**，不能从服务端常量推导。 |
| **总大小上限** | **150 MB（客户端守卫）** | Uppy 的 `maxTotalFileSize` 默认 `null`（`Restricter.ts:31`）＝上游不提供默认值，所以这是纯产品决策。计算依据：20 × 25 MB = 500 MB 明显过宽；实际每张压缩后目标 1.5 MB（`IMAGE_TARGET_BYTES=1_500_000`，`compress-image.ts:6`）→ 一批期望 ~30 MB；150 MB 留 5× 余量且能在 20 Mbps 移动网络下 ~60s 传完。**后端没有总大小限制**，这只是保护客户端内存与网络。 |
| **并发上传数** | **3**（可配 2–5） | 上游默认：`@uppy/xhr-upload` `limit: 5`（`xhr-upload/src/index.ts:149`）；FilePond `maxParallelUploads: 2`（`filepond.esm.js:1859`）。我们的现实约束：每张图压缩要解码到 `maxEdge=2000` 的 canvas（`compress-image.ts:5`），按 RGBA 计 2000×1500×4 ≈ **12 MB/张**；5 并发 ≈ 60 MB 峰值，叠加源文件缓冲，移动端容易触发 Safari 内存回收；3 并发 ≈ 36 MB，与 FilePond 默认同量级。压缩本身已被单 worker 串行化（`use-image-compression.ts:79`），并发数实际只影响网络与 EXIF 读取。 |
| **单个请求超时 / 签名有效期** | 预签名 URL **900s**，PUT 超时 30s 起 | `MEDIA_SIGNED_URL_TTL_SECONDS` 默认 900（`environment.ts:247`），上限 604800（`storage.service.ts:49`）；`@uppy/xhr-upload` 默认 `timeout: 30 * 1000`（`xhr-upload/src/index.ts:150`）。一张 25 MB 在慢速 4G 上可能超 30s → 我们的 uploader 用 **60s/张**，且失败后可 `retryAll` 重新 presign。 |
| **动图（Live Photo motion）** | 50 MB / 30s | `packages/contracts/src/api/media.ts:22-23` `MEDIA_MOTION_MAX_BYTES` / `MEDIA_MOTION_MAX_DURATION_MS` |

**不允许**把上述数字散落到组件里：`maxNumberOfFiles` / `maxFileSize` 必须来自一处常量，并与 `@roamlog/contracts` 的 schema 对齐（`allowedFileTypes` 与 `media.ts:29` 正则同源）。

### D3 EXIF 展示规格

#### D3.1 `Media.exif` 里真实存了哪些 tag —— **确切 50 个字段**

来源：`packages/contracts/src/entities/media.ts:68-135`（`MediaExifSchema`，`.describe("Curated photo EXIF (~45 tags)…")` ← **注释写的 ~45 是错的，实测 50**）。浏览器侧 `apps/web/lib/image/read-photo-exif.ts:104-190` 产出的 object literal **同样 50 个键**（脚本统计：schema 50 / reader 50，键名逐一相同）。

分组（按 schema 注释的原始分组，10/15/7/8/10 = 50）：

| 组 | 字段（exifr tag 名） | 数量 |
|---|---|---|
| 相机 / 镜头 / 署名 | `Make` `Model` `LensMake` `LensModel` `Software` `Artist` `Copyright` `OwnerName` `BodySerialNumber` `LensSerialNumber` | 10 |
| 曝光 | `FNumber` `ExposureTime` `ISO` `FocalLength` `FocalLengthIn35mmFormat` `ExposureCompensation` `ExposureProgram` `ExposureMode` `Flash` `WhiteBalance` `MeteringMode` `LightSource` `SceneCaptureType` `DigitalZoomRatio` `SubjectDistance` | 15 |
| 时间 | `DateTimeOriginal` `CreateDate` `ModifyDate` `OffsetTimeOriginal` `OffsetTime` `SubSecTimeOriginal` `GPSDateTime` | 7 |
| 图像 | `Orientation` `ColorSpace` `ExifImageWidth` `ExifImageHeight` `XResolution` `YResolution` `ResolutionUnit` `BitsPerSample` | 8 |
| 位置 | `latitude` `longitude` `GPSLatitude` `GPSLongitude` `GPSAltitude` `GPSAltitudeRef` `GPSImgDirection` `GPSImgDirectionRef` `GPSHPositioningError` `GPSProcessingMethod` | 10 |

#### D3.2 存储与读出语义（影响 UI 判断）

- **写入**：`sanitizeExif` 遍历 schema 的全部 50 个键，缺失填 `null`（`read-photo-exif.ts:223-234`）→ DB 的 `exif` JSONB **每条都是 50 键**，多数为 `null`。
- **读出**：`presentMediaExif` 逐字段校验，`null`/非法**直接丢弃**，全空则整体 `null`（`apps/api/src/modules/media/media.presenter.ts:62-78`）。
- **因此前端拿到的 `exif` 是“只有有值的键”的稀疏对象** → 「没值的不显示」是天然成立的，只需要渲染层不补 `—`。

#### D3.3 现在的 UI 只显示了 50 个里的 8 个（缺口）

`apps/web/components/media/media-exif.tsx:238-281`（`MediaExifDetail`）当前只渲染：

`Make`+`Model`（合成相机名）、`LensModel`/`LensMake`、`ISO`、`FocalLength`/`FocalLengthIn35mmFormat`、`FNumber`、`ExposureTime`、`DateTimeOriginal`/`CreateDate`（兜底用 `media.date`）。共 **8 个字段**，其余 42 个（含 `GPSAltitude`、`GPSImgDirection`、`Artist`、`Copyright`、`Software`…）在 UI 里不可见。

**规格要求**：详情面板按 D3.1 的 5 组渲染，逐组「有值才渲染该组、该组内无值的字段不占位」。星号字段建议二次确认是否展示（涉及隐私/无意义）：`BodySerialNumber` `LensSerialNumber` `OwnerName` `Artist` `Copyright` `Software`（这些是**设备与作者指纹**，`share-links.service.ts:332-334` 的注释明确说公开页故意不带 EXIF 就是因为它“carries device serial numbers and software versions”）。→ **建议：工作区内部详情显示，公开分享页永不显示**（与现有公开 payload 一致）。

### D4 位置开关语义（照现有实现，不自创）

#### D4.1 现有实现（已核实，逐条给证据）

| 位置 | 现状 |
|---|---|
| 列定义 | `packages/db/prisma/schema.prisma:433` `showExactPhotoLocation Boolean @default(true)`，由迁移 `packages/db/prisma/migrations/0014_media_exif/migration.sql` 引入 |
| 契约描述 | `packages/contracts/src/entities/trip.ts:233` `describe("Owner switch: expose exact photo GPS on the public share page.")` ——**语义就是“公开页”** |
| 服务端强制点 | **只有公开分享**：`apps/api/src/modules/share-links/share-links.service.ts:228-229` `const showExactPhotoLocation = trip.showExactPhotoLocation !== false;`，`:339` `const position = showExactPhotoLocation ? exactPosition(row) : {};`。关闭时坐标**根本不进 payload**（注释 `:219-227` 明说“nothing for the public page to un-hide”） |
| 认证 API | **不裁剪**：`media.presenter.ts:134-135` 无条件 `lat: record.lat ?? null, lng: record.lng ?? null`；`exif` 原样（`:129`）。`GET /v1/trips/:tripId/media`（`media.controller.ts:126`）同样走这个 presenter |
| 行程 presenter | `apps/api/src/modules/trips/content-presenters.ts:169` `showExactPhotoLocation: record.showExactPhotoLocation ?? true` |
| 产品文案（已落地） | `apps/web/components/trips/trip-form/trip-form.tsx:213`：「默认开启。关闭后，公开分享页只显示城市，不显示照片拍摄的精确位置；**工作区成员在应用内看到的照片位置不受影响**。」 |
| 照片 tab 现状 | `photos-tab.tsx:208` 只读它来渲染一条提示 `ExactLocationNotice`（`:232`），不参与过滤 |
| 地图现状 | `atlas-workspace.tsx:105` `const showPhotos = photoLayer && hasPhotoLocations;` —— **完全不读开关** |

#### D4.2 所以「关闭时坐标要不要下发给前端」的答案

**按现有实现：要下发。** 开关不是“应用内脱敏”，而是“公开页脱敏”。认证响应里 `lat/lng` 与 `exif.latitude/longitude` 一直存在，这是 `trip-form.tsx:213` 已对用户承诺的行为。

#### D4.3 「关闭时应该怎样」（与现有实现一致的三个选项，按现有实现选第 3 条）

- ❌ 不下发精确坐标 → 会改变 `presentMedia` 的输出，与 `trip-form.tsx:213` 的文案直接矛盾，且需要改契约 → **属于产品变更，不是本任务能决定的**。
- ❌ 只下发城市级 → 服务端没有反地理编码能力用于 media（`location` 是用户手填字符串，不是反查结果），凭空造会违反铁律。
- ✅ **不显示在地图 / 详情**：**只有公开分享页**这么做，即维持现状。应用内（照片 tab、atlas、行程地图）**照常显示**。

**因此本规格要求**：新增的行程地图照片层**不新增**任何开关判断；仅在视觉上复用现有 `ExactLocationNotice` 文案的位置提示（照片 tab 已有，`photos-tab.tsx:232-236`）。若产品真要在应用内也隐藏，必须先改 `packages/contracts/src/entities/trip.ts:233` 的 describe 与 `trip-form.tsx:213` 的文案，再改 `presentMedia` —— 这是**独立的契约变更任务**，列入不确定性。

### D5 行程地图页接照片

#### D5.1 现状

- 页面（Server Component）：`apps/web/app/(app)/w/[workspaceSlug]/trips/[tripId]/map/page.tsx`，并行 fetch `/v1/trips/:id`（`TripSchema`）与 `/v1/trips/:id/stops`（`StopListResponseSchema`），用 cookie 转发，`cache: "no-store"`。
- 客户端：`apps/web/components/trip-map/trip-map-page.tsx`（points 来自 `stopToPoint`，route 来自 `routeCoordinates`）→ `TripStopMap`（`trip-stop-map.tsx:76-84` 只传 `points/route/selectedId/onSelect`）。
- `MapCanvas` **已经**支持 `photos` / `showPhotos` / `focusPhotosToken` / `onSelectPhotoGroup`（`map-canvas.tsx:37-44`），`TripStopMap` 没有传。

#### D5.2 要加的东西（最小改动，全部复用 atlas 已验证的部件）

1. **页面**：第三次并行 fetch `${baseUrl}/v1/trips/${tripId}/media?limit=100&sort=createdAt:desc`，用 `MediaPageSchema`（`packages/contracts/src/api/media.ts:176`）解析；失败按现有 `unavailable` 分支处理（不要新增一种错误态）。
2. **类型**：新增 `photos: MediaPage["items"]` 一路传下去，用既有的 `photosFromMedia`（`photo-points.ts:45-72`）在客户端转 `PhotoPoint[]`（只有 `lat/lng` 都在的行才会变成点，无位置的自动消失 —— 这就是“有位置才上图”）。
3. **`TripStopMap`**：新增 props `photos`、`showPhotos`、`focusPhotosToken`、`onSelectPhotoGroup`、`onOpenPhoto`，原样透传给 `MapCanvas`。**注意 frame 高度 hack**：`MapCanvas` 用 `height:100%`，所以必须留在 `h-[320px] sm:h-[440px]` 的 wrapper 内（`trip-stop-map.tsx:12-19` 注释记录过这个回归）。
4. **与 marker / route 共存**：照片走**独立 source id**（`photo-points`）与独立图层集，`beforeId` 不用改；`interactiveLayerIds` 只在 `showPhotos` 时并入照片层（`map-canvas.tsx:135-137` 现成逻辑），停靠点 marker 的点击（`onSelect`）不受影响。停在同一个点的照片与停靠点会重叠：照片簇 `circle-radius 20`（`cluster-points-source.tsx:107-116`）压在 marker 上，建议照片层放在 marker **之下**（用 layer `beforeId` 指向 marker 层），仅当 `showPhotos` 时照片可点。
5. **开关**：复用 `PhotoLayerToggle`（`photo-layer.tsx:123`）——但 atlas 的开关是“层显隐”，行程地图上建议同样只用它，不引入新语义。
6. **缩略图 / 打开大图**：行程地图上没有 atlas 的侧栏面板，用一条横向缩略图条（复用 `PhotoLocationsPanel` 的缩略图 `<ul>` 结构，`photo-layer.tsx:86-112`）或直接点击 marker 打开 lightbox。**不新增交互模式**：点击簇 = 放大散开（既有），点击单点 = 打开该张 lightbox。

#### D5.3 不要做的事

- 不要在行程地图页把照片**混进** `points`（`MapPoint`）里：那会污染 route/停靠点选中逻辑（`trip-map-page.tsx` 的 `selectedStop` 查找）。
- 不要为行程地图新写一个地图组件：`MapCanvas` 已经参数化好了。

### D6 风险

| 风险 | 事实依据 | 对策 |
|---|---|---|
| **包体积** | `@uppy/dashboard` 39.3 KB gzip + `@uppy/core` 18.0 KB gzip（bundlephobia 实测），加 CSS；YARL 12.2 KB gzip | 两者都 `next/dynamic` 懒加载：Dashboard 只在照片 tab 挂载、Lightbox 只在打开时（`open=false` 直接 `return null`，`src/Lightbox.tsx`） |
| **SSR** | Uppy/Dashboard 是 Preact + DOM（`this.el`、`document.addEventListener('paste', …)` `Dashboard.tsx:986`）。YARL 也碰 `document.body`（`Portal.tsx` `createPortal(..., document.body)`） | 一律 `"use client"` + `dynamic(..., {ssr:false})`；Server Component（行程地图页）只取数据，不渲染它们 |
| **移动端内存** | 压缩解码 ≈ 12 MB/张（`maxEdge=2000`，RGBA 4B）；Uppy 还存 `file.data` 原始 File | 并发 3；单次 20 张；总大小 150 MB；`waitForThumbnailsBeforeUpload: false`（默认，`Dashboard.tsx:188`） |
| **签名 URL 过期** | 900s 默认（`environment.ts:247`） | viewer 的 `onError` → invalidate `queries` → 新 `slides`（`LightboxState.tsx:79` 自动 update）；上传链路的 PUT 必须在 900s 内完成，失败即重 presign |
| **Uppy 主题不可控** | `style.scss` 零 CSS 变量、文件头声明变量不稳定（见 D1.3） | 只做类名覆盖（`.uppy-Dashboard` 等），接受与 token 系统不完全一致；必要时 `theme: 'dark'`（`:208` 默认 light） |
| **品牌标识** | `proudlyDisplayPoweredByUppy` 默认 **true**（`Dashboard.tsx:203`） | 显式设 `false`（MIT 允许） |
| **暂停/恢复在自定义 uploader 下不可用** | StatusBar 只在 `capabilities.resumableUploads` 为真时给暂停按钮传参（`statusbar/src/StatusBar.tsx:195`），而 core 默认 `resumableUploads: false`（`Uppy.ts:549` capabilities 初始化） | 明确“不做暂停/恢复”（我们的链式 PUT 不可续传）；需要时用 `hidePauseResumeButton: true` 隐藏，而不是给一个点了没用的按钮 |
| **429 幂等** | presign 是限流点（`media-presign-rate-limit.guard.ts:16`），complete 有幂等键（`media.controller.ts:64-70` 的 `media:complete:${userId}:${mediaId}`） | 批量 20 与配额对齐；重试前先判断 429 的 `retryAfterSeconds`（`rate-limit.service.ts` 的 decision 携带该字段） |
| **照片数据量** | 列表 `limit:100`（`queries.ts:184`）、`hasMore` | 行程地图要画全部照片位置时 100 条是硬上限；超过后图上缺照片 → 明确“仅显示最近 100 张”，与照片 tab 现有文案（`photos-tab.tsx:242` “仅显示最近 100 张”）保持一致 |

---

## E. 是否需要组合

### E.1 结论：**需要组合，而且只能是三块独立移植**

按仓库铁律应先找“单一功能完整的上游”。实测结论是**不存在**能同时覆盖这三块的项目：

| 候选“单一项目” | 能否覆盖 | 硬理由 |
|---|---|---|
| Uppy（含 Dashboard + ThumbnailGenerator） | 上传 ✅ / 查看 ❌ / 地图 ❌ | 它没有一个“全屏大图 + 缩放 + 缩略图条 + 焦点陷阱”的图库查看器；`@uppy/image-editor` 是裁剪编辑器，不是 viewer。也没有任何地图能力。 |
| YARL | 查看 ✅ / 上传 ❌ / 地图 ❌ | 纯展示库，不含队列。 |
| PhotoSwipe | 查看 ✅ / 上传 ❌ / 地图 ❌ | 同上。 |
| FilePond | 上传 ~（缺 `maxTotalFileSize`）/ 查看 ❌ / 地图 ❌ | 实测无该选项。 |
| 完整相册产品（`immich-app/immich`、`ente-io/ente`） | — | 许可证实测为 **AGPL-3.0**（`raw.githubusercontent.com/immich-app/immich/main/LICENSE`、`.../ente-io/ente/main/LICENSE` 均返回 "GNU AFFERO GENERAL PUBLIC LICENSE Version 3"），仓库铁律禁止移植，**未纳入候选**。 |
| MapLibre | 地图 ✅ | 已有。 |

即：**上传 / 查看 / 聚合是三个正交能力**，用户要求的是一个完整体验，而“完整体验”在开源里从来不是由单个项目提供的（Uppy 明确只做 upload，YARL 明确只做 lightbox）。这不是“我们偷懒拼装”，而是上游生态本身就分了三块。

### E.2 拼装处一致性风险（只有 3 个 seam，全部定死契约）

| Seam | 风险 | 一致性保障 |
|---|---|---|
| **S1 上传完成 → 列表刷新** | Uppy 内部有自己的文件状态机；我们的列表是 react-query。两边不同步会出现“传完了列表没有” | 唯一真相源是 **API**。uploader 的 `upload-success` 里写 `file.meta.mediaId`，并 `await queryClient.invalidateQueries({queryKey:['v1','trips',tripId,'media']})`；**不要**把 Uppy 的 `files` 直接渲染成照片卡片（那会与后端 `status: pending/processing/ready` 冲突）。卡片只认 `Media.status`（`media-exif`/`photos-tab` 已按 status 渲染真实状态，`photos-tab.tsx:309` “图片还在处理中”） |
| **S2 地图点击 → viewer 打开** | 地图的“组”概念（`photoGroupKey` 3 位小数网格）与 viewer 的“线性索引”概念不同 | 打开 viewer 时**必须**从 `PhotoPoint[]` 的同一个数组生成 `slides`（同一 `useMemo` 来源），`index = photos.findIndex(p => p.id === clickedId)`；不要用组内索引，否则同组多张时索引错位。地图只负责“传 photoId”，索引计算放在 lightbox 容器一处 |
| **S3 签名 URL 过期** | 地图缩略图、viewer 大图、照片 tab 卡片三处各自缓存 `url` | 统一走 `mediaPreviewUrl`（`media-urls.ts:26`）+ 同一个 query key；过期统一由 `onError` → invalidate 处理，三处都不许自建定时刷新 |

另外两条硬约束：

- **EXIF 只在一个地方读**（uploader 的 compress 之前），三块 UI 都只读 `Media.exif`。禁止 viewer 或地图自己再解析原图。
- **限制参数只有一个来源**（contracts + settings），Uppy restrictions 与后端守卫必须同源，避免“前端放开、后端 400”。

---

## 最大 3 个不确定性

1. **`showExactPhotoLocation` 是否也要管应用内**：现有实现与已落地文案（`trip-form.tsx:213`）都明确“只影响公开分享页”，但用户原话是“照片还要显示地图上”。如果产品希望“关闭 = 应用内也不上图”，那是一次**契约 + 文案 + presenter** 的变更（`trip.ts:233`、`trip-form.tsx:213`、`media.presenter.ts:133`），不在本规格范围内，需要产品拍板。
2. **Uppy Dashboard 的视觉能否接受**：它零 CSS 变量（`style.scss` 实测），只能类名覆写，且上游声明「随时可能变」。是接受“功能完整但视觉不完全统一”，还是要求把 Dashboard 的 UI 重写成我们的 token（等于放弃整块移植的收益），需要设计/产品决定。
3. **20 张/批 + 3 并发是否够用**：这组数字是“与后端 20 次/60s 预签名配额对齐”的结果。若真实用户常一次传 50+ 张（例如单反卡导入），必须改运营配置 `limits.uploadPerMinute`（`limits-settings.consumer.ts:49`，上限 600）或改成“分批排队、超配额时等下一窗口”——前者是配置，后者是新交互，需产品选择。

---

## 复现命令（本报告所有实测的依据）

```bash
# 许可证（逐个项目）
curl -sS https://raw.githubusercontent.com/transloadit/uppy/main/LICENSE
curl -sS https://raw.githubusercontent.com/pqina/filepond/master/LICENSE
curl -sS https://raw.githubusercontent.com/react-dropzone/react-dropzone/master/LICENSE
curl -sS https://raw.githubusercontent.com/igordanchenko/yet-another-react-lightbox/main/LICENSE
curl -sS https://raw.githubusercontent.com/dimsemenov/PhotoSwipe/master/LICENSE
curl -sS https://raw.githubusercontent.com/MinJieLiu/react-photo-view/master/LICENSE
curl -sS https://raw.githubusercontent.com/mapbox/supercluster/main/LICENSE
curl -sS https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/LICENSE.txt

# commit
git ls-remote https://github.com/transloadit/uppy.git HEAD

# 体积（bundlephobia）
curl -sS "https://bundlephobia.com/api/size?package=%40uppy%2Fdashboard%406.0.3"
curl -sS "https://bundlephobia.com/api/size?package=%40uppy%2Fcore%406.3.2"
curl -sS "https://bundlephobia.com/api/size?package=yet-another-react-lightbox%403.33.1"

# 仓库内事实
awk 'NR>=68 && NR<=135' packages/contracts/src/entities/media.ts | grep -cE '^ {4}[A-Za-z0-9]+: (z\.|IsoTimestampSchema)'
grep -n "MEDIA_PRESIGN_RATE_LIMIT_MAX\|RATE_LIMIT_WINDOW_SECONDS" apps/api/src/config/environment.ts
grep -n "showExactPhotoLocation" apps/api/src/modules/share-links/share-links.service.ts
grep -c "var(--" <(curl -sS https://raw.githubusercontent.com/transloadit/uppy/4c7fed69a67c6112c7e2134cd372a25140a8ca12/packages/%40uppy/dashboard/src/style.scss)
```