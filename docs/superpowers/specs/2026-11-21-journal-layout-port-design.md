# Roamlog 日志排版完整移植设计

日期：2026-11-21
实施完成：2026-11-22
状态：已实施 / 待发布
范围：日志编辑器、详情只读、公开分享页、HTML 清洗、内联媒体 URL 刷新

## 1. 目标

把日志正文从「单栏富文本」升级为可持久化、可清洗、编辑器与分享页一致的排版系统，覆盖：

- 单图图注、alt、标题、链接、显示尺寸、左/中/右对齐；
- 多图 Gallery 网格（1–6 列）、方形裁切、逐图图注、添加/删除/排序/预览；
- 2–4 栏 Columns，插入、左右增列、删除列、Tab/Shift-Tab 栏间导航；
- 图片左/右浮动时文字自动环绕，移动端自动取消浮动；
- Gallery 与 Columns 在 390px 自动折叠；
- 分享页与编辑器共用同一套排版 token 和 CSS；
- 分享页正文图片每次请求换签，避免 15 分钟后 403。

## 2. 非目标

- 不实现 Obsidian MCL 的 Cards、Timeline、Callout 等 GPL 功能；许可证不允许复制。
- 不在本期实现不等宽栏预设（70/30、30/70）；先做等宽 2–4 栏。
- 不在本期实现 `wide/full` 图片突破正文容器；Emdash 的编辑面板本身过滤了这两个选项，先按上游实际暴露的 left/center/right 移植。
- 不新增数据库列、不做旧文档批量迁移。
- 不实现无来源的「按图片比例自动分组算法」；自动排版指 CSS Grid 自动流、响应式折叠、浮动文字环绕。
- 不改变现有协作、权限、版本冲突和自动保存语义。

## 3. 移植来源与许可证

### 3.1 主来源

| 能力                                                         | 来源                              | Commit                                     | 许可证 |
| ------------------------------------------------------------ | --------------------------------- | ------------------------------------------ | ------ |
| 图片图注、对齐、尺寸、链接、Gallery 网格/列数/多选/排序/删除 | `emdash-cms/emdash`               | `732867e9836efbd9fa9cf01f4fd086949b1bb392` | MIT    |
| Columns/Column 节点、插入/增删列、Tab 导航、上下文工具栏     | `hunghg255/reactjs-tiptap-editor` | `496b84967ef58b85465edb1c4eae517de11fba73` | MIT    |
| 宿主                                                         | 现有 Tiptap                       | `3.34.0`                                   | MIT    |

Emdash 关键文件：

- `packages/admin/src/components/editor/GalleryNode.tsx`
- `packages/admin/src/components/editor/GalleryDetailPanel.tsx`
- `packages/admin/src/components/editor/ImageDetailPanel.tsx`
- `packages/admin/src/portable-text/schema.ts:328-430`
- `packages/core/src/components/Gallery.astro:177-240`
- `packages/core/src/components/Image.astro`

Reactjs-tiptap-editor 关键文件：

- `src/extensions/Column/Column.ts`
- `src/utils/columns.ts`
- `src/components/Bubble/RichTextBubbleColumns.tsx`
- `src/styles/columns.scss`

### 3.2 明确排除

- `efemkay/obsidian-modular-css-layout`：GPL-3.0，只能参考行为，禁止复制代码/CSS/类名/HTML。
- `tnichols217/obsidian-columns`：GPL-3.0，禁止复制。
- `tianma-if/edgeever`：AGPL-3.0，禁止复制。
- Tiptap Pro Columns/FileHandler 等：专有许可，禁止复制。

## 4. 实施前缺口（已关闭）

以下六项是 2026-11-21 的缺口记录，保留用于追溯；当前实现状态见 §15。

1. 编辑器只有单栏 Tiptap，没有 figure/figcaption、gallery、columns 节点。
2. 详情页读 `contentJson`，分享页读 `contentHtml`；两套渲染没有共享 CSS。
3. API 清洗白名单没有 `figure/figcaption`，也没有布局所需的 data 属性；新增节点保存后会被剥掉。
4. 分享页 `SHARE_PROSE_CLASS` 只覆盖图片和任务列表，h2/h3、列表、引用、代码、表格在 Tailwind preflight 下会退化。
5. 内联图片把 900 秒签名 URL 直接写进 `contentJson/contentHtml`，不保存 `mediaId`；15 分钟后详情页和分享页正文图片都会 403。
6. `contentJson` 当前绕过清洗，新节点属性必须在 parse/render/NodeView 层自行校验。

## 5. 节点契约

所有节点禁止 inline style、任意 class、任意 data-* 值。HTML 只使用固定枚举的 `data-*`，CSS 用属性选择器。

### 5.1 image（复用现有节点名）

用途：单张图片，兼容旧 `<img>` 和旧 JSON。

Schema：

- name: `image`
- group: `block`
- atom: `true`
- draggable: `true`
- selectable: `true`

Attrs：

| attr            | 类型                                    | 默认    | 说明                        |
| --------------- | --------------------------------------- | ------- | --------------------------- |
| `src`           | string                                  | `""`    | 仅 http(s) 或同站 `/`       |
| `alt`           | string                                  | `""`    | 最长 280                    |
| `title`         | string/null                             | `null`  | 最长 280                    |
| `caption`       | string/null                             | `null`  | 最长 280，渲染为 figcaption |
| `alignment`     | `"left" \| "center" \| "right" \| null` | `null`  | null 等同默认左对齐、不浮动 |
| `displayWidth`  | number/null                             | `null`  | 80–2400，渲染为 img width   |
| `displayHeight` | number/null                             | `null`  | 80–2400，渲染为 img height  |
| `linkHref`      | string/null                             | `null`  | http(s)/mailto/同站 `/`     |
| `linkBlank`     | boolean                                 | `false` | 新窗口打开                  |
| `mediaId`       | string/null                             | `null`  | UUID v7；用于换签           |

HTML：

```html
<figure data-type="image" data-align="left">
  <img
    src="https://media.example/photo.jpg"
    alt="鸭川边的清晨"
    title="京都"
    width="480"
    height="320"
    loading="lazy"
    decoding="async"
    data-media-id="0193f6a0-7c00-7000-8000-000000000001"
  />
  <figcaption>鸭川边的清晨</figcaption>
</figure>
```

带链接：

```html
<figure data-type="image" data-align="right">
  <a href="https://example.com" target="_blank" rel="noopener noreferrer">
    <img src="/media/photo.jpg" alt="照片" data-media-id="0193..." />
  </a>
  <figcaption>照片</figcaption>
</figure>
```

无 `alignment` 时不输出 `data-align`。无 caption 时不输出 `figcaption`。`data-media-id` 只允许 UUID；不合法则省略。

解析：

- `figure[data-type="image"]`：读取 figure 的 `data-align`，读取内部 `img` 与 `figcaption`。
- `img[src]`：兼容旧内容，读取 src/alt/title/width/height；`data-media-id` 存在且合法时读取。
- 旧 JSON 缺省 attrs 自动使用默认值。

JSON：

```json
{
  "type": "image",
  "attrs": {
    "src": "https://media.example/photo.jpg",
    "alt": "鸭川边的清晨",
    "title": "京都",
    "caption": "鸭川边的清晨",
    "alignment": "left",
    "displayWidth": 480,
    "displayHeight": 320,
    "linkHref": null,
    "linkBlank": false,
    "mediaId": "0193f6a0-7c00-7000-8000-000000000001"
  }
}
```

### 5.2 gallery + galleryImage

用途：多图网格。

Schema：

- `gallery`
  - group: `block`
  - content: `galleryImage+`
  - isolating: `true`
  - defining: `true`
  - draggable: `true`
  - attrs: `columns: number`，默认 3，范围 1–6
- `galleryImage`
  - atom: `true`
  - selectable: `true`
  - draggable: `false`
  - attrs: `src, alt, title, caption, width, height, mediaId`

HTML：

```html
<div data-type="gallery" data-columns="3">
  <figure data-type="gallery-item">
    <img
      src="https://media.example/a.jpg"
      alt="锦市场"
      width="1200"
      height="800"
      loading="lazy"
      decoding="async"
      data-media-id="0193..."
    />
    <figcaption>锦市场的一碗热汤</figcaption>
  </figure>
  <figure data-type="gallery-item">
    <img src="https://media.example/b.jpg" alt="南禅寺" loading="lazy" decoding="async" />
  </figure>
</div>
```

约束：

- `data-columns` 只允许 1–6；非法值按 3 处理。
- Gallery 至少 1 张图；删除最后一张时删除整个 gallery 节点。
- 图片方形裁切：`aspect-ratio: 1 / 1; object-fit: cover`。
- 移动端（<=640px）列数大于 1 时显示 2 列；列为 1 时保持 1 列。
- Gallery 不支持整组 caption；每图独立 caption。

JSON：

```json
{
  "type": "gallery",
  "attrs": { "columns": 3 },
  "content": [
    {
      "type": "galleryImage",
      "attrs": {
        "src": "https://media.example/a.jpg",
        "alt": "锦市场",
        "title": null,
        "caption": "锦市场的一碗热汤",
        "width": 1200,
        "height": 800,
        "mediaId": "0193..."
      }
    }
  ]
}
```

### 5.3 columns + column

用途：多栏文字/图文混排。

Schema：

- `columns`
  - group: `block`
  - content: `column{1,4}`
  - isolating: `true`
  - defining: `true`
  - priority: `200`
  - attrs: `columns: number`，默认 2，UI 范围 2–4
- `column`
  - content: `block+`
  - isolating: `true`
  - defining: `true`
  - attrs: `index: number`，0-based

HTML：

```html
<div data-type="columns" data-columns="2">
  <div data-type="column" data-column-index="0">
    <p>左栏文字。</p>
  </div>
  <div data-type="column" data-column-index="1">
    <figure data-type="image" data-align="center">
      <img src="/media/photo.jpg" alt="照片" loading="lazy" decoding="async" />
    </figure>
  </div>
</div>
```

约束：

- `data-columns` 只允许 1–4；非法值按 2 处理。
- 插入时 UI 只提供 2/3/4 栏。
- 删除到 1 栏时保留单栏节点，用户仍可继续加列；不自动拆掉外层，避免内容丢失。
- `Tab`/`Shift-Tab` 只在光标位于 columns 内时切换栏，否则返回 `false`，不拦截列表/表格的默认行为。
- 768px 以下 `display: block`，每栏 100% 宽。

JSON：

```json
{
  "type": "columns",
  "attrs": { "columns": 2 },
  "content": [
    {
      "type": "column",
      "attrs": { "index": 0 },
      "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "左栏" }] }]
    },
    {
      "type": "column",
      "attrs": { "index": 1 },
      "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "右栏" }] }]
    }
  ]
}
```

## 6. 内联媒体 URL 刷新（前置）

现状：上传后只把 `media.url` 写进 image attrs，不保存 mediaId；签名 URL 900 秒过期。Gallery 不能继承这个缺陷。

规则：

1. 上传成功后将 `media.id` 写入 image/galleryImage 的 `mediaId`。
2. HTML 的 `img` 输出 `data-media-id`；只允许 UUID。
3. 公开分享：`ShareLinksService.publicPayload` 在已有 `mediaById` 签名映射上，对 entry.contentHtml 的 `img[data-media-id]` 换签 `src`；换签后再交给 `SanitizeService`。
4. 编辑器/详情：NodeView 在图片加载失败时按 `mediaId` 调 `fetchMedia` 刷新一次 src；成功后更新节点属性，不写历史。失败显示错误占位。
5. 旧图没有 mediaId：不猜测、不迁移；保持原 URL，失败时显示占位。
6. 分享页客户端 `sanitizePublicHtml` 保留 `data-media-id`，但不再换签；换签只在服务端做。

测试：

- 构造过期 src + 有效 mediaId，分享接口返回新签名 src。
- 编辑器图片 onError 后刷新成功；刷新失败显示占位。
- 无 mediaId 的旧图不触发请求。

## 7. 清洗契约

### 7.1 API `sanitize.service.ts`

标签新增：

- `figure`
- `figcaption`

属性新增：

```ts
figure: ["data-type", "data-align", "data-columns", "data-column-index"],
div: ["data-type", "data-columns", "data-column-index"],
img: ["src", "alt", "title", "width", "height", "loading", "decoding", "data-media-id"],
```

保留现有 `a`、`table`、task-list 属性。禁止 class/style/on*。

`transformTags.img`：

- 校验 src 仍是 http(s)/同站 `/`；
- `data-media-id` 必须是 UUID，否则删除；
- 强制 `loading="lazy"`、`decoding="async"`；
- 不允许 `srcset`。

`exclusiveFilter`：

- 无安全 src 的 img 丢弃；
- `figure[data-type="gallery"]` 若没有合法 gallery-item 子节点，整组丢弃；
- `div[data-type="columns"]` 若没有 column 子节点，整组丢弃。

### 7.2 Web `share/html.ts`

- `IMAGE_ATTRIBUTES` 增加 `loading`、`decoding`、`data-media-id`；
- 保留 `figure/figcaption`；
- 对 `div/figure` 只保留固定 data 属性，删除其他 data-*；
- 继续删除所有 on*、style、srcdoc、javascript:/data: URL；
- 不新增客户端换签。

### 7.3 contentJson

- 不新增 DB 迁移，不改变现有契约。
- image/gallery/columns 的 parse/render/NodeView 必须校验 URL、枚举、数字范围。
- 残余风险：Tiptap 现有 link mark 的 contentJson 仍可能带不安全 href；本期不扩大处理，记录为独立安全任务。

## 8. 编辑器交互

### 8.1 工具栏

- 现有图片按钮保留。
- 新增 Gallery 按钮（Grid3X3）：打开多选文件输入，上传全部后插入 gallery（默认 3 列）。
- 新增 Columns 按钮（Columns3）：插入 2 栏 columns，每栏一个空段落。
- 上传中禁用按钮并显示“正在上传 N 张图片…”；失败显示 `role="alert"`，不插入半成品。

### 8.2 图片 NodeView

- 选中时显示边框和浮动工具条。
- 工具条：左浮动、居中、右浮动、设置、替换、删除、预览。
- 设置 Popover：alt、title、caption、链接、新窗口、显示宽/高。
- caption 可在图下直接编辑；空 caption 不渲染 figcaption。
- 图片加载失败：有 mediaId 时刷新一次，仍失败显示“图片加载失败”占位。
- 预览打开现有 `PhotoLightbox`。

### 8.3 Gallery NodeView

- 网格展示，选中时显示工具条。
- 工具条：列数 1–6、添加图片、设置、删除 Gallery。
- 设置 Popover：缩略图列表、逐图 alt/caption、删除、上移/下移、拖拽排序。
- 添加图片使用多选上传；上传完成后追加到当前 gallery。
- 删除最后一张图时删除整个 gallery。
- 点击预览按钮打开灯箱；编辑器内点击图片默认选中，不直接打开灯箱。
- 拖拽使用 `@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities`（均 MIT）；保留上移/下移按钮作为键盘替代。

### 8.4 Columns

- 选中栏内内容时显示 Bubble 工具条：左侧加列、右侧加列、删除当前列、栏数显示。
- 插入默认 2 栏；工具栏按钮可选 2/3/4。
- Tab/Shift-Tab 栏间导航；不在 columns 内时不拦截。
- 删除列后重排 `index` 和 `data-columns`。
- 空栏保留一个空段落，避免无法聚焦。

### 8.5 状态与可访问性

- 所有按钮有 `aria-label`，对齐按钮有 `aria-pressed`。
- Popover 使用 Radix，焦点可见，Esc 关闭。
- 工具栏可 Tab 到达；不新增 roving tabindex。
- 移动端工具条换行，Popover 最大宽度 `calc(100vw - 24px)`。
- 所有新节点支持 undo/redo；删除操作可撤销。

## 9. 只读与分享

### 9.1 详情页

- 继续使用 `JournalEditor readOnly`，注册同一套扩展。
- 图片/Gallery 预览可用，编辑工具条隐藏。

### 9.2 分享页

- 使用 sanitized contentHtml + `dangerouslySetInnerHTML`。
- `SHARE_PROSE_CLASS` 扩展为共享排版样式，必须覆盖：
  - h2/h3/h4、p、strong/em、ul/ol/li、blockquote、code/pre、hr、a、table；
  - figure/figcaption、image 对齐、gallery、columns；
  - task list 现有样式。
- 共享 CSS 文件 `apps/web/components/journal/journal-layout.css`，编辑器与分享页都 import；颜色/间距使用现有 token。
- 图片左/右浮动：`float:left/right`，宽度 `min(50%, 360px)`，文字环绕；`h2/h3/blockquote/table/gallery/columns` 清除浮动；<=640px 取消浮动、宽度 100%。
- Gallery：`display:grid`，按 `data-columns` 设置 1–6 列；gap 8px；图片方形裁切；caption 小号 mono/muted；<=640px 2 列。
- Columns：flex 等宽，gap 16px；<=768px 单列。
- 分享页 Gallery 图片点击打开现有 `PhotoLightbox`：在正文容器上做事件委托，收集当前 gallery 内所有图片的 src/alt/caption，传入灯箱。
- 图片加载失败显示渐变占位和 alt 文本，不显示破图图标。
- 无 JS 时正文 HTML 仍可读；灯箱不可用，但图片本身可见。

## 10. 测试矩阵

### 单元测试

- image parse/render：旧 `<img>`、figure 带 caption/align/mediaId、无 caption、无 align、恶意 src/href。
- gallery parse/render：1/3/6 列、非法列数、空 gallery、子图 caption/alt、HTML→JSON→HTML roundtrip。
- columns parse/render：2/3/4 栏、非法栏数、Tab/Shift-Tab、加列/删列/重排 index。
- sanitizer：允许 figure/figcaption/data-*；剥离 script/onerror/style/javascript:/data:/srcset/任意 class；UUID 校验。
- media refresh：过期 src + mediaId → 新 URL；无 mediaId 不请求；失败占位。
- share CSS：现有标签和新增节点的类名/属性选择器存在。

### API / 契约

- create/update entry 后 contentHtml 保留 image/gallery/columns。
- revision restore 保留布局。
- public share 返回换签后的 img src。
- XSS：`<img src=x onerror=...>`、`<figure data-type=image><script>`、`javascript:` 链接、伪造 `data-media-id` 全部被清理。
- 旧 contentHtml `<img>` 不被破坏。

### Playwright（真实栈）

- 正常路径：登录 → 新建日志 → 插入图片 → 设置 caption/左浮动 → 插入 3 图 gallery → 设置 3 列/排序/图注 → 插入 2 栏 columns → 保存 → 刷新 → 分享页。
- 空态/加载态/错误态：上传失败、图片 403 后刷新、空 gallery 删除、分享 API 503。
- 权限：Viewer 打开详情只读，看不到编辑工具条；不能保存。
- 持久化：刷新后布局、列数、caption、排序仍在。
- 响应式：1440 和 390 截图；390 无横向溢出；gallery 2 列；columns 单列；图片浮动取消。
- 截图路径：`.audit/journal-layout/editor-1440.png`、`editor-390.png`、`share-1440.png`、`share-390.png`、`gallery-panel-1440.png`、`columns-390.png`。

## 11. 实施任务包

### Wave 0：契约与媒体

#### JL-01 清洗白名单

- 目标：API + Web 清洗器支持 figure/figcaption/data-*，不改变现有标签行为。
- 可写：`apps/api/src/common/services/sanitize.service.ts`、`apps/web/components/share/html.ts`、对应测试。
- 验证：API sanitize 单测、share sanitize 单测、XSS 用例。
- 依赖：无。

#### JL-02 mediaId 持久化

- 目标：image 上传/插入保存 mediaId；HTML 输出 data-media-id；清洗器允许。
- 可写：`journal-editor.tsx` 图片插入、`journal-image-upload.ts` 返回类型、image 扩展 attrs、测试。
- 验证：上传单测断言 mediaId；HTML 含 data-media-id。
- 依赖：JL-01。

#### JL-03 分享页换签

- 目标：public payload 对 img[data-media-id] 用当次签名 URL 替换 src。
- 可写：`apps/api/src/modules/share-links/share-links.service.ts`、`sanitize.service.ts`（如需专用方法）、测试。
- 验证：过期 src + 有效 mediaId → 新 src；无 mediaId 不变。
- 依赖：JL-01、JL-02。

### Wave 1：Tiptap 节点

#### JL-04 image 节点

- 目标：实现 attrs/parse/render，兼容旧 `<img>`。
- 可写：`apps/web/components/journal/extensions/journal-image.ts`、`journal-editor.tsx` 注册、单测。
- 集成时必须**替换**现有 `@tiptap/extension-image`，不能同时注册两个同名 `image` 节点。
- 依赖：JL-01。

#### JL-05 gallery 节点

- 目标：gallery + galleryImage，HTML/JSON 契约，1–6 列。
- 可写：`journal-gallery.ts`、`journal-editor.tsx` 注册、单测。
- 依赖：JL-01。

#### JL-06 columns 节点

- 目标：columns + column，插入/增删列/Tab，2–4 栏。
- 可写：`journal-columns.ts`、`journal-editor.tsx` 注册、单测。
- 依赖：JL-01。

### Wave 2：编辑器 UI

#### JL-07 图片 NodeView（只读+图注）

- 目标：figure/img/figcaption 渲染、选中边框、错误占位。
- 可写：`journal-image-node-view.tsx`、`journal-image.ts` NodeView 注册、单测。
- 依赖：JL-04。

#### JL-08 图片设置

- 目标：对齐、alt/title/caption、链接、宽高、替换/删除/预览。
- 可写：`journal-image-node-view.tsx`、Popover 组件、测试。
- 依赖：JL-07。

#### JL-09 Gallery 网格

- 目标：网格 NodeView、逐图 caption、选中状态、删除。
- 可写：`journal-gallery-node-view.tsx`、测试。
- 依赖：JL-05。

#### JL-10 Gallery 设置

- 目标：列数、缩略图、alt/caption、添加/删除、上移/下移。
- 可写：`journal-gallery-panel.tsx`、测试。
- 依赖：JL-09。

#### JL-11 Gallery 拖拽

- 目标：dnd-kit 排序 + 键盘替代；更新子节点顺序。
- 可写：`journal-gallery-panel.tsx`、`package.json`（新增 dnd-kit 依赖）、锁文件、测试。
- 依赖：JL-10。

#### JL-12 Columns UI

- 目标：Bubble 工具栏、插入/增删列、Tab 导航、工具栏按钮。
- 可写：`journal-columns-node-view.tsx`、`journal-columns-bubble.tsx`、`journal-editor.tsx` 工具栏、测试。
- 依赖：JL-06。

### Wave 3：只读与验收

#### JL-13 共享 CSS

- 目标：`journal-layout.css` 同时服务编辑器和分享页；补齐现有标签排版。
- 可写：`apps/web/components/journal/journal-layout.css`、`journal-editor.tsx`、`share-article.tsx`。
- 依赖：JL-04/05/06。

#### JL-14 分享灯箱

- 目标：Gallery 图片点击打开 PhotoLightbox；编辑器预览按钮。
- 可写：`share-article.tsx`、`share-gallery-lightbox.tsx`、`journal-gallery-node-view.tsx`、测试。
- 依赖：JL-09、JL-13。

#### JL-15 API roundtrip

- 目标：create/update/revision/public share 的 HTML 保留与 XSS。
- 可写：`apps/api/src/modules/entries/__tests__/**`、`share-links/__tests__/**`。
- 依赖：JL-01/02/03/04/05/06。

#### JL-16 Playwright 与截图

- 目标：真实栈完整旅程、权限、错误、1440/390 截图。
- 可写：`e2e/web/journal-layout.spec.ts`、`.audit/journal-layout/**`（不提交）。
- 依赖：JL-07..JL-14。

## 12. 验收标准

- 所有节点在编辑器、详情只读、分享页三处显示一致。
- 旧日志打开不报错，旧 `<img>` 仍可见。
- 保存后刷新，布局、caption、列数、排序不丢。
- 分享页正文图片 15 分钟后仍能通过换签加载。
- 1440/390 截图无横向溢出；移动端 gallery 2 列、columns 单列、图片不浮动。
- XSS 用例全部被清洗；无 style/on*/javascript:/data: 通过。
- 单测、API e2e、Playwright 全绿；根 Agent 亲自看截图并抽查 1–2 处上游源码行号。
- 交付报告包含 `移植来源:` 与 `CodeGraph 证据:`。

## 13. 风险

- `contentJson` 的 link mark 已在 API create/update/revision/read 递归规范化；image/gallery/columns 的非 link attrs 仍主要依赖节点 parse/render/NodeView 校验。
- 旧图无 mediaId，过期后无法自动恢复。
- `wide/full` 未实现；若产品坚持，需要另找可移植的容器突破实现并补截图。
- dnd-kit 只进入编辑器 chunk；Journal 列表首屏已改为按需加载编辑器，分享页不加载 dnd-kit。
- Gallery/Columns 的 HTML 解析必须严格，否则复制粘贴可能丢节点。
- 分享页 CSS 改动会影响所有旧日志，必须做旧内容截图回归。

## 14. 来源与证据

移植来源：

- `emdash-cms/emdash@732867e9836efbd9fa9cf01f4fd086949b1bb392`：`packages/admin/src/components/editor/GalleryNode.tsx`、`GalleryDetailPanel.tsx`、`ImageDetailPanel.tsx`、`packages/admin/src/portable-text/schema.ts:328-430`、`packages/core/src/components/Gallery.astro:177-240`、`Image.astro`。MIT。
- `hunghg255/reactjs-tiptap-editor@496b84967ef58b85465edb1c4eae517de11fba73`：`src/extensions/Column/Column.ts`、`src/utils/columns.ts`、`src/components/Bubble/RichTextBubbleColumns.tsx`、`src/styles/columns.scss`。MIT。
- 内部现状：`.audit/journal-layout/source-audit.md`、`.audit/journal-layout/internal-gap-audit.md`。

CodeGraph 证据：

- `codegraph status` → `[OK] Index is up to date`
- `codegraph explore "JournalEditor TIPTAP_TAGS sanitizePublicHtml contentHtml contentJson ShareArticle journal-prose"` → `JournalEditor → onUpdate → contentHtml/contentJson → SanitizeService → ShareLinksService → ShareArticle`
- `codegraph explore "public share contentHtml image signed url refresh media"` → `ShareLinksService.publicPayload`、`publicMediaList`、`MediaUrlService.signMany`、`ShareArticle`

## 15. 实施结果（2026-11-22）

### 15.1 功能矩阵

| 能力                                                | 实现                                                                           | 验证状态                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Image figure/figcaption、旧 `<img>` 兼容            | `journal-image.ts` + `journal-image-node-view.tsx`                             | 单元测试、API roundtrip、真实编辑器/分享页通过                                        |
| 图注行内编辑、alt/title/link/新窗口/显示宽高        | `journal-image-caption.tsx`、`journal-image-settings.tsx`                      | 单元测试 + A11Y/编辑 E2E 通过                                                         |
| 默认/左浮动/居中/右浮动                             | `journal-image-toolbar.tsx` + 共享 CSS                                         | `aria-pressed` 与 1440/390 视觉探针通过                                               |
| 图片替换、删除、预览                                | 工具栏 + 现有 `PhotoLightbox`                                                  | 单元测试通过；真实 S3 上传用于 Gallery，单图替换浏览器旅程未单独跑                    |
| 图片 mediaId 换签、失败占位                         | 单图与 `galleryImage` NodeView                                                 | 单元测试覆盖；真实 15 分钟过期 E2E 未单独覆盖                                         |
| Gallery 1–6 列、方形裁切、逐图图注                  | `journal-gallery.ts` + `journal-gallery-node-view.tsx`                         | 单测 + 真实上传/分享 E2E 通过                                                         |
| Gallery 多选上传、追加、失败不半插入                | 编辑器工具栏 + NodeView `添加图片`                                             | 真实 presign→PUT→complete→S3，`2 passed`                                              |
| Gallery 列数/图注/删除/上移下移/拖拽排序            | `journal-gallery-panel.tsx` + dnd-kit                                          | 单测通过；真实 pointer 拖拽 E2E `1 passed`，刷新/分享顺序一致                         |
| Gallery 编辑/只读预览灯箱、焦点回归                 | Gallery NodeView + `PhotoLightbox`                                             | A11Y E2E 3 passed                                                                     |
| Columns 2–4 栏、插入菜单、BubbleMenu、Tab/Shift-Tab | `journal-columns*.ts(x)`                                                       | 真实点击 3 栏、右侧加列、删列、刷新/分享通过                                          |
| 共享排版 CSS                                        | `journal-layout.css`                                                           | 分享页 1440/390 + 编辑器 CSS 探针通过                                                 |
| 分享 SSR、无 JS 正文、密码门                        | `app/share/[token]/page.tsx`、`public-trip-server.ts`、`public-share-page.tsx` | SSR/无 JS 1440/390、密码分享 E2E 通过                                                 |
| 分享 Gallery 灯箱按需加载                           | `share-gallery-lightbox.tsx`                                                   | 首屏 YARL 请求 0，点击后加载                                                          |
| 图片 float 文字环绕/移动端取消                      | `journal-layout.css`                                                           | 1440 float 336px；390 float none、宽度 100%                                           |
| 安全清洗                                            | `SanitizeService` + `share/html.ts`                                            | target `_blank`、data-* 归一化、危险 link mark、空锚点/空 figure 均有测试与真实栈 E2E |
| CI Gate                                             | `.github/workflows/ci.yml`                                                     | layout/upload/password/security/a11y/drag 六 spec + dependency-audit job              |

### 15.2 证据摘要

- Web 单元/组件测试：最近汇总结论 `components/journal + components/share` 22 files / 228 tests passed。
- Web 全量：96 files / 832 tests passed。
- API：全量 150 files / 1340 tests passed；17 files / 118 tests 因未设置 `ROAMLOG_TEST_DATABASE_URL` 跳过。
- DB：无测试 URL 时 17 files / 87 tests passed；隔离 schema 迁移后 27 files / 125 tests passed。
- 默认 `pnpm test`：10/10 Turbo tasks passed，无 failed；TEST-1 修复了 skip suite 在收集期解析空 URL 的缺陷。
- `pnpm security:check`：无已知 high/critical/moderate；`effect@3.22.5`、`glob@14.0.6` override。
- Web/API typecheck、production build、`pnpm contracts:check`、`pnpm staging:validate`、`git diff --check` 通过。
- 真实栈 E2E：
  - `e2e/web/journal-layout.spec.ts`：1 passed
  - `e2e/web/journal-gallery-upload.spec.ts`：2 passed
  - `e2e/web/journal-layout-security.spec.ts`：1 passed
  - `e2e/web/journal-layout-a11y.spec.ts`：3 passed
  - `e2e/web/journal-share-password.spec.ts`：1 passed
  - `e2e/web/journal-gallery-drag.spec.ts`：1 passed（真实 pointer 拖拽、刷新、分享、键盘替代）
- CI workflow 已通过 `actionlint` / Prettier / `staging:validate`，但尚未触发新的 GitHub Actions run；首次 run 仍需确认 MinIO 启动时间与 job 总时长。
- 截图/报告目录：`.audit/journal-layout/`（不提交）。关键截图：
  - `e2e-desktop-1440.png`、`e2e-mobile-390.png`
  - `e2e-share-1440.png`、`e2e-share-390.png`
  - `e2e-gallery-upload-1440.png`、`e2e-gallery-share-1440.png`
  - `a11y-1440.png`、`a11y-390.png`
  - `share-nojs-1440.png`、`share-nojs-390.png`
  - `share-password-gate-1440.png`、`share-password-unlocked-1440.png`

### 15.3 当前残余与延期

- `wide/full` 图片突破正文容器：未实现，按 §2 非目标处理。
- 不等宽栏（70/30 等）：未实现。
- 密码分享刷新后保持解锁：当前产品设计为“不保存密码”，刷新重新锁定；E2E 按现有行为验收。若产品要求保持解锁，需新增短 TTL 分享会话 cookie。
- Gallery 真实 pointer 拖拽只在“上传 → 保存 → 重开 → 排序”稳定路径验证；刚上传未保存时立即打开设置的历史选中态问题需继续回归。
- 图片设置与 Gallery 预览的运行时全局回调已移除；Esc 与焦点回归由 Radix `onCloseAutoFocus` / `onEscapeKeyDown` 与 NodeView scoped `useEffect` 管理，A11Y 3 passed。
- 真实 15 分钟过期换签 E2E：NodeView/单测覆盖逻辑，未做时间旅行真实对象存储。
- BullMQ 队列投递、重试、stalled-job recovery：本地以 worker `handleMediaJob` drain 验证上传，队列可靠性待 staging/CI。
- 真实触屏、NVDA/VoiceOver、真实移动网络带宽：未覆盖。
- `contentJson` 非 link 节点 attrs 仍主要依赖节点层校验；link mark 已由 API 递归规范化。
- 生产发布仍 BLOCKED：见 `.audit/journal-layout/deploy-readiness.md`（dirty worktree、备份恢复、生产 env、审批、邮件/监控证据）。

### 15.4 关键文件入口

- 编辑器：`apps/web/components/journal/journal-editor.tsx`
- 节点：`apps/web/components/journal/extensions/journal-image.ts`、`journal-gallery.ts`、`journal-columns.ts`
- NodeView：`journal-image-node-view.tsx`、`journal-gallery-node-view.tsx`、`journal-gallery-image-node-view.tsx`、`journal-columns-node-view.tsx`
- 设置/工具栏：`journal-image-settings.tsx`、`journal-image-toolbar.tsx`、`journal-gallery-panel.tsx`、`journal-columns-bubble.tsx`
- 共享样式：`apps/web/components/journal/journal-layout.css`
- 分享：`apps/web/components/share/share-article.tsx`、`share-gallery-lightbox.tsx`、`public-share-page.tsx`、`public-trip-server.ts`
- 清洗：`apps/api/src/common/services/sanitize.service.ts`、`apps/web/components/share/html.ts`、`apps/api/src/modules/entries/content-json-links.ts`
- CI：`.github/workflows/ci.yml`

### 15.5 交付报告

完整实施记录、证据命令、风险和上线判断见：

- `docs/superpowers/reports/2026-11-22-journal-layout-delivery.md`
- `.audit/journal-layout/final-gate.md`
- `.audit/journal-layout/release-commit-plan.md`
- `.audit/journal-layout/release-index-plan.md`
- `.audit/journal-layout/deploy-readiness.md`
