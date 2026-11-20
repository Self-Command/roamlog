# Roamlog rc.6 根 Agent 验收记录

日期: 2026-11-20
基线: `d4c06b8`（代码提交）

## 结论

| 任务 | 结论 | 关键证据 |
| --- | --- | --- |
| P0-CI-COPY / P0-CI-COPY-2 | ACCEPT | 76 files / 635 tests；typecheck 11/11；copy gate 0 hits；CI/Release 默认值对齐 |
| P0-PHOTO | ACCEPT（带 fixture 风险） | 照片 e2e 10/10；Vitest 83/83；截图 1440/390 |
| P0-AVATAR-LIMITS | ACCEPT | media 26/26；头像/邮箱 live e2e 3/3；限额接口有限正整数 |
| P0-ERROR-COPY | ACCEPT | 5 个组件测试；真实 503 截图 1440/390，无 `/v1/` / `HTTP` |
| P0-PHOTO-LIMITS-COPY | ACCEPT | 8 个限额测试；上传面板 1440/390 截图 |
| P0-LIVE-LIMITS-QA | ACCEPT | 隔离栈 4173 启动晚于限额源码；`/v1/workspaces/.../media/limits` 200 |

## 全仓验证

- `pnpm --filter @roamlog/web test` → 76 files / 635 tests passed。
- `pnpm typecheck` → 11/11 tasks passed。
- `bash .audit/local-verify/copy-gate.sh` → 0 hits / 11 rules，defaults aligned。
- `git diff --check` → clean（仅 CRLF 警告）。
- `codegraph status` → `[OK] Index is up to date`（2,172 files）。
- 本地栈：Web 3000、Admin 3001、API 4000、PG 55444、S3 9000、Redis 6379、Mailpit 1025；`/v1/ready` 200。

## 已知风险

- 3 张历史 seed 照片缺少 `variants/*.webp`，照片页显示 `ImageOff`；已确认不是上传/签名/灯箱回归。
- 本地 Redis 是 stub，BullMQ 重试/stalled recovery 未在真实 Redis 上验收。
- 剩余技术文案：`invite-accept.tsx`、`two-factor-security.tsx`、`trip-detail-live.tsx`、`trip-form.tsx:474`。
- 上传面板顶部与拖拽区重复显示同一限额文案，属视觉去重项。
- GitHub CI / Release gate 需在 push 后重跑。

## 下一步

1. 推送 `rc.6` 并盯 CI / Release gate。
2. seed variants 小任务。
3. auth copy、trip copy、uploader dedupe 三个单文件小任务。
4. B2 停靠点地址搜索、B4 洞察服务端聚合、分享页地图/GPS、AI 消息编辑/投票。

## rc.6 门禁结果

- CI `44762581948` 与 Release gate `44762580885` 均在 Lint 步骤失败。
- 原因：`@next/next/no-img-element` 规则未在 `eslint.config.mjs` 注册，两个 disable 注释变成未定义规则；`workspace-settings-page.tsx` 的 `pending` 初始 `null` 永不被读取。
- 修复：移除无效 disable 注释、保留说明；`pending` 改为无初始值。`@roamlog/web lint` 通过，settings/AI 91/91，typecheck 通过。
- 按“失败 tag 不覆盖”原则，`v0.1.0-rc.6` 保留为失败记录，修复版打 `v0.1.0-rc.7`。

## rc.7 门禁结果

- CI `44764587807` 与 Release gate `44764836540` 在 `Contract and generated client freshness` 失败。
- 原因：`packages/contracts/openapi.json` 与 Orval 客户端未跟随媒体大小上限、成员 UUID 契约更新。
- 修复：执行 `pnpm --filter @roamlog/contracts contracts:generate` 与 `pnpm --filter @roamlog/api-client api-client:generate`；`pnpm contracts:check` 输出 OpenAPI fresh（113 paths / 213 schemas）与 client fresh（25 endpoint files / 801 schema files）。
- `v0.1.0-rc.7` 保留为失败记录，修复版打 `v0.1.0-rc.8`。
