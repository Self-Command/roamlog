# Roamlog 演示截图

本目录保存 README 与发布说明可直接引用的 PNG 资产。桌面截图均来自当前
commit 的本地开发预览（Web `localhost:3000`、Admin `localhost:3001`），
使用 MSW/local fixture 演示数据；它们不用于证明真实认证、数据库写入、
上传、邮件或实时协作已经完成。

最后一次截图：2026-11-18。除地图外，桌面与移动端截图均为当前版本重新
截取；地图使用最近一次通过视觉检查的 schematic fallback 版本，因为
headless Chromium 本次未能渲染 MapLibre 瓦片。

> **提交前注意：** 根目录 `.gitignore` 当前的 `screenshots/` 规则也会
> 忽略本目录。根 Agent 需要在 `.gitignore` 中加入
> `!docs/assets/screenshots/` / `!docs/assets/screenshots/**`，或明确使用
> `git add -f`，否则 GitHub README 会得到断链。本任务没有修改
> `.gitignore`。

## 资产索引

| 文件                       | 页面                            | 视口      | 用途                                               |
| -------------------------- | ------------------------------- | --------- | -------------------------------------------------- |
| `web-dashboard.png`        | Web Dashboard / 旅行总览        | 1440×1000 | 展示统计、下一段旅行、预算与近期整理的工作型首屏   |
| `web-trips.png`            | Web Trips / 旅行库              | 1440×1000 | 展示搜索、状态筛选和 9 趟旅行的卡片密度            |
| `web-journal.png`          | Web Journal / 全部日志          | 1440×1000 | 展示日志索引、搜索、筛选和旅行日志卡片             |
| `web-journal-sheet.png`    | Journal Detail Sheet / 日志详情 | 1440×1000 | 展示富文本编辑、自动保存、版本历史与评论协作       |
| `web-trip-budget.png`      | Trip Budget / 旅行预算          | 1440×1000 | 展示预算摘要、花费明细和分类支出                   |
| `web-map.png`              | World Map / 世界足迹            | 1440×1000 | 展示地图降级视图、9 个旅行标记与右侧旅行索引       |
| `web-public-share.png`     | Public Share / 公开分享         | 1440×1400 | 展示只读旅行分享、路线、预算与日志，不含评论和邮箱 |
| `admin-dashboard.png`      | Admin Dashboard / 平台总览      | 1440×1000 | 展示平台指标、趋势、审计、队列与邮件健康           |
| `admin-queues.png`         | Admin Queues / 队列             | 1440×1000 | 展示 BullMQ 等待/活跃/失败计数和队列操作           |
| `admin-flags.png`          | Admin Flags / 功能开关          | 1440×1000 | 展示开关、灰度比例和 Workspace 白名单              |
| `admin-system.png`         | Admin System / 系统健康         | 1440×1000 | 展示依赖探针、Worker、Redis 与迁移状态             |
| `web-dashboard-mobile.png` | Web Dashboard / 移动端总览      | 390×844   | 展示单列总览、统计卡与下一段旅行                   |
| `web-journal-mobile.png`   | Web Journal / 移动端日志        | 390×844   | 展示移动端日志头部、筛选和归档索引                 |

## 引用示例

```markdown
![Roamlog Web Dashboard](docs/assets/screenshots/web-dashboard.png)
![Roamlog Journal](docs/assets/screenshots/web-journal.png)
![Roamlog Admin](docs/assets/screenshots/admin-dashboard.png)
```

## 数据与安全检查

- 截图中的人名、地点、金额、账户和邮件均来自 seed/fixture；邮箱仅使用
  `@roamlog.local` 演示域，没有真实个人邮箱。
- 没有 token、cookie、密码、连接字符串或分享明文 token。
- 当前 12 张重新截取的页面均检查了 `scrollWidth <= viewportWidth`，没有
  横向溢出；地图资产沿用已通过视觉检查的 1440×1000 fallback 截图。
- Web/Admin 截图中的 `MSW DEVELOPMENT DATA`、`FIXTURE DATA` 与
  `MOCK DATA` 标识应保留，避免把演示数据误称为生产能力。

## 重新生成

保留 `localhost:3000` 与 `localhost:3001` 运行时，可执行：

```powershell
$env:E2E_SKIP_WEB_SERVER='1'
$env:E2E_SKIP_ADMIN_SERVER='1'
pnpm exec playwright test --config=playwright.a11y.config.ts --project=web-visual --project=admin-visual
```

注意：Playwright 会清理 `test-results/`。需要保留 staging 证据时，应先
归档 `test-results/staging-release/`，再运行截图测试。
