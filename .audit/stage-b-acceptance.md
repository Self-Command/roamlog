# 验收记录 — B / C / D1 阶段（截至 2026-11-19 13:50）

## B1A 设置底座 —— ACCEPT
提交 `02c8dce`(db) + `fc400e9`(api)。AES-256-GCM + key ring + AAD；secret write-only；进程 5s → Redis 300s → DB；DB 故障抛错不回落默认值；9 组 45 键；审计不含值。db 48 tests / api settings 74 tests。

## B1B 设置 UI —— ACCEPT
提交 `565d1bb`（10 文件，+2730）。
- **端到端真跑通**：`PATCH site.title=「Roamlog 验收」` → `GET /v1/admin/settings/site.title` 新值 → `GET /v1/public/settings` 已变。
- Playwright 真实 UI 完成「改标题→保存→toast→来源/updatedAt」，无控制台错误，390px 无横向溢出。
- 23 条组件测试；按 type 分派控件；422 映射字段；secret 只显示 last4；reveal 确认 + 10s 自动隐藏。
- 诚实纠错：我任务包里的 key `general.site.title` 不存在，真实是 `site.title`（前者 422 `UNKNOWN_SETTING`）。

## B1C 运行期配置 —— ACCEPT
提交 `a32ee47`。真实 HTML 证据：
```html
<title>登录 · Roamlog</title>
<html data-theme="system" data-accent="white"
      style="--accent-primary:#fcfdff;--accent-glow:rgba(255,89,0,0.18);color-scheme:light dark">
<meta name="description" content="A collaborative travel journal ...">
```
SSR 写入、无闪烁；`revalidate 30s`；配置失败回落默认值不报错。18 条新测试。

## B1D 设置真实性 —— ACCEPT
提交 `63f2b4d`。修掉两个假功能：
1. `seo.*` 4 键改为公开 → `/v1/public/settings` 返回 11 键；**10 个 secret 键实测 absent**；`/login` 的 `<title>` 走模板、`robots` 来自配置、`og:image` 为空不输出；`/share` 的 noindex 未被覆盖。
2. `theme.defaultMode` 枚举收敛为 `dark|system`，**删掉假 light**；库里旧值 `light` 归一化为 `system` 并 warn。

## B3 用户编辑 + 权限矩阵 —— ACCEPT
提交 `0b27300`(db) + `0092f70`(api+contracts) + `b70b263`(admin)。
- `PATCH /v1/admin/users/{id}`：邮箱变更 → `emailVerified=false` + 发验证邮件 + `delivery:"sent"|"failed"` 回读；`LAST_SUPER_ADMIN` / `SELF_DEMOTION_FORBIDDEN` 409；审计只记 `changedFields`。
- `GET/PATCH /v1/admin/permissions`：矩阵由常量派生（无副本）；`grantable=false` 动作越权 422；`PlatformRoleOverride` 只存 diff。
- 真实 curl 证据：改名→GET 确认；`admin:users:delete`→422；override→200 且 GET 生效；自我降级→409。
- 遗留（我处理）：导航一行已由我合并为 `ef6a9e2`；OpenAPI 注册待生成。
- 风险：**覆盖层未接入运行时鉴权**（`canPlatform` 仍用代码矩阵），需后续异步 guard。

## C Geoapify 地点 —— ACCEPT
提交 `00de674`（26 文件）。
- 真实外网验明 **bbox 顺序 = `[west, south, east, north]`**（用 lat 落在第 2/第 4 项之间反推），并发现 **Photon `extent` 是 `[west,north,east,south]`** 已重排。
- 补 `address`/`bbox`/`importance`；`timeZone` 保留原名（不擅自改名破坏 Stop/Trip/web）。
- **修既有 bug**：Photon normalizer 不再丢弃 `street/housenumber/postcode`。
- 1.2s 超时 + 每日配额 Redis 计数 + 降级 Photon + 双失败 200 空列表。
- places 119 tests / contracts 65 tests。
- 缺口（已派 `F`）：Stop/Trip 无 `address` 字段，地址当时只显示不落库。

## D1 客户端压缩 —— ACCEPT（根 Agent 独立复跑基准）
提交 `422a6dc`。

| 原始 | 耗时 | 质量档 | long task | 最大帧间隔 |
|---|---|---|---|---|
| 25.91 MB | 1009 ms | 0.82 | **0** | 16.8 ms |
| 3.26 MB | 575 ms | 0.82 | 0 | 16.8 ms |
| 7 KB | 8 ms | 1（跳过） | 0 | 16.7 ms |

- OffscreenCanvas + `convertToBlob` WebP 阶梯 0.82→0.55，320px 缩略图 q0.72，blurhash；
- 状态机新增 `compressing`，进度 0–20/20–90/90–100；压缩重试从 `compressing` 起、上传重试**不重压**；取消回 `idle`；
- 合成 HEIC → `DECODE_FAILED` 且有可读中文提示；Turbopack 生产构建内 Worker 实测执行；
- 定向 5 files / 55 tests，web 全量 32 files / 239 tests。
- 未覆盖：真实 HEIC 样本、Safari/iOS 真机、`keepOriginal` 仅记录未实现。
- 缺口（已派 `H`）：压缩参数写死在代码里，`media.*` 设置读不到 → 第三个假设置。

## 待我串行处理
1. OpenAPI 注册 `/v1/admin/permissions`（B3）+ E1 的 AI 端点 → 一次性 `contracts:generate` + `api-client:generate`。
2. `media.*` 公开投影（H 在做）。
3. 覆盖层接入运行时鉴权（后续）。