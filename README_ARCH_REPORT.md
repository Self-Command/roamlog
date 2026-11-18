# README-ARCH 交付报告

状态: NEEDS_REVIEW
任务 ID: README-ARCH

## 1. 变更文件

- `README.md`：重写为面向开发者的 GitHub README。
- `docs/architecture.md`：新增系统架构、时序、部署与失败模式说明。
- `CONTRIBUTING.md`：新增 GitHub 标准贡献指南。
- `SECURITY.md`：新增漏洞报告与安全边界说明。
- `docs/assets/screenshots/README.md`：本任务创建了截图索引；并行截图任务随后用最终资产清单覆盖了同名文件，当前版本已作为事实来源被 README 引用。
- `README_ARCH_REPORT.md`：本报告。

未修改代码、`contracts`、数据库结构、workflow、Compose、根 `package.json`、lockfile 或截图文件；未 commit、未 push。

## 2. 覆盖章节

`README.md` 已覆盖：

- 项目名、一句话定位、CI/Release/Node/pnpm/状态徽标和短特性列表。
- 当前状态、产品概览、角色/权限矩阵和 v1 功能清单。
- 截图入口与 Web Dashboard、Journal、Trip Budget、Map、Public Share、Admin Dashboard、Queues、Flags 的来源映射。
- 系统上下文/容器图、核心数据流图、Monorepo Mermaid 图和目录树。
- 技术栈、mock/API 两种快速开始、完整环境变量分组、常用命令。
- Web/Admin 路由、API 分组摘要、测试矩阵、CI/Release/Docker/GHCR/staging。
- 健康端点、可观测性、安全控制、Resend 风格视觉规则、文档导航和贡献入口。

`docs/architecture.md` 额外包含：

- 容器职责与数据所有权。
- Auth、Admin 2FA、presence、BullMQ ingress、媒体、导出、公开分享时序。
- 队列并发/重试策略、部署拓扑、失败模式、可观测性与安全边界。
- 当前可验证范围与上线前剩余项。

## 3. 验证命令与结果

```text
pnpm exec prettier --check README.md CONTRIBUTING.md SECURITY.md docs/architecture.md docs/assets/screenshots/README.md
  -> All matched files use Prettier code style!

相对 Markdown 链接检查（6 个文档，包含 8 张 README 截图）
  -> OK: 48 relative Markdown links resolve.

Markdown 锚点检查
  -> OK: 20 Markdown anchors resolve.

Mermaid 解析检查（README + docs/architecture.md）
  -> OK: 12 Mermaid diagrams parsed.
  -> 使用 @mermaid-js/parser 临时环境中的 mermaid@11.12.1 做静态 parse，不依赖仓库新增依赖。

git diff --check -- README.md CONTRIBUTING.md SECURITY.md docs/architecture.md
  -> 无 whitespace error。
```

## 4. 截图/日志/接口证据

- 本次只做文档改动，不产生运行时截图。
- 并行 `DEMO-SCREENSHOTS` 任务已在 `docs/assets/screenshots/` 生成当前版本截图；README 已嵌入要求的 Web Dashboard、Journal、Trip Budget、Map、Public Share、Admin Dashboard、Queues 与 Flags。
- 截图来自 MSW/fixture 演示数据；README 和截图索引都明确它是视觉证据，不是真实 API/生产证据。
- `screenshots/`、`e2e/screenshots/`、`test-results/` 属于本地/CI 忽略产物；README 不使用这些路径作为 GitHub 图片。
- 现有本地 staging/全链路/可访问性证据通过链接指向：
  - `STG_RELEASE_GATE_REPORT.md`
  - `STG_FULL_CHAIN_REPORT.md`
  - `W5_A11Y_PERF_REPORT.md`

## 5. 已知风险

1. **截图资产仍被 `.gitignore` 忽略。** `.gitignore:37` 的 `screenshots/` 规则匹配了整个 `docs/assets/screenshots/`，包括 13 个 PNG 和 README。文件在当前工作区存在，README 中 8 个图片相对链接也能解析，但 `git status` 不会显示它们。提交前必须由根 Agent 决定：
   - 显式追踪该目录（例如 `git add -f docs/assets/screenshots/...`），或
   - 把忽略规则收窄到截图二进制，而不忽略说明文件。
     本任务禁止修改 `.gitignore`，因此未自行处理。
2. **截图证明力有限。** 8 张图来自 mock/fixture 演示数据；`web-map.png` 沿用已通过视觉检查的 fallback，而不是本次 headless 重新渲染的地图。不能把它们当成真实 API、数据库、邮件或实时协作证据。
3. **GitHub 实际渲染未验证。** Mermaid 已通过本地 parser，但未在 GitHub 页面实际渲染；徽章和外部链接也未做网络可用性断言。
4. **产品状态按证据收紧。** README 明确写 Web Socket.IO 客户端/presence/query invalidation 尚未接线，未把“本地 staging 通过”写成 production-ready；远端 TLS/OAuth/Resend/Docker 实跑仍是未验证项。

## 6. 未覆盖项

- 没有真实远端 staging、TLS、DNS、OAuth、Resend、Docker/GHCR 实跑，因此没有把远端证据写入 README。
- 没有生成或复制 PNG；`docs/assets/screenshots/` 仍缺 8 个目标资产。
- 没有提交、分支、commit 或 push。
- 没有修改任何产品代码、contracts、数据库、workflow、Compose、root package/lockfile。

## 7. 建议的下一步

1. 根 Agent 强制追踪 `docs/assets/screenshots/`，或收窄 `.gitignore`，避免 GitHub README 图片断链。
2. 在可加载 MapLibre 瓦片的环境补拍 `web-map.png`，并复核现有截图的演示数据标识。
3. 在 GitHub 页面或 Mermaid Live 实际渲染一次，确认 12 个图无布局问题。
4. 远端 staging 完成 TLS/OAuth/Resend/Docker 后，更新“当前状态”表并附上新的 release evidence。
