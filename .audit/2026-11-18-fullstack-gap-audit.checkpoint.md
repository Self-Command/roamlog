# Roamlog 全栈缺口审计 Checkpoint

更新时间：2026-11-18（Asia/Shanghai，最终收口）
模式：只读审计；仅写 `.audit/`。

## 已完成核对

- AGENTS.md、全栈设计文档已读（字段、权限、媒体、工作流、DoD）。
- `apps/web` 路由与 live/mock 双数据源已核对：生产 Web `NEXT_PUBLIC_DATA_MODE=api`。
- 旅行创建：`new-trip-shell.tsx` 仍是显式 FORM SKELETON，只提交 title/summary/startDate/endDate；visibility 是假按钮；origin/destinations 硬编码“未填写”；无封面、预算、标签、协作者、天数。
- 旅行详情：`trip-detail-live.tsx` 可编辑 title/summary/status，展示行程/日志；无封面、地点、日期、预算、可见性、标签、协作者、分享、删除、照片、行李、费用入口。
- Prisma：`Trip` 已有 origin/destinations/countryCodes/tags/guestNames/budgetAmountMinor/budgetCurrency/visibility/favorite/version/coverMediaId；`Stop` 已有坐标/日期/order；`Media` 已有 variants/status/cover relation；迁移仅 `0001_init` + `0002_*`，生产已应用。
- 契约：Create/UpdateTrip 支持大部分字段；无 place/geocoder 契约；Trip 响应只有 coverMediaId，不返回可显示封面；Media variants 仅 key，不返回签名 URL。
- 媒体后端：presign/complete/process/cleanup 链路存在，限额 25MB，MIME 白名单；Worker 生成 thumb/medium/large/jpeg variants；本地 staging-full 证据 media ready。
- 生产：镜像 v0.1.0-rc.3，web/api/admin/worker/postgres/redis/minio healthy；Mailpit 而非 Resend；队列 0 积压；数据库仅 1 个未删除 trip，0 media，1 个 trip 的 origin/destinations 为 UI 占位“未填写”；2 users、2 workspaces、2 owner memberships。
- 生产 S3：`S3_ENDPOINT=http://minio:9000`，`S3_PUBLIC_BASE_URL` 为空，MinIO 9000 未发布，Nginx 仅代理 `/v1`；浏览器无法直传/读取签名 URL。
- Realtime：Socket.IO 后端含 Redis adapter/presence；Web 无 socket.io-client，无 presence/失效订阅。
- Web 查询层：无 stops/media/packing/expenses/share-links/export/participants mutation hooks；仅 trips/entries/itinerary/comments/notifications/members/search。
- 测试：API/worker/web 单测与 staging E2E 存在；缺少旅行全字段、封面 API、媒体显示、地点搜索、停止编辑、删除/归档、真实浏览器上传的覆盖。

## 最终核对结果

- 生产 DB：2 migrations（0 unfinished/0 rolled back）；2 users（1 super_admin + 1 admin）；2 workspaces；2 owner memberships；1 trip；0 entries/stops/media/share/expense/packing/comment/notification。
- 占位 trip：cover null、budget null、tags 空、guestNames 空、origin/destinations 均为“未填写”。
- Redis：media/email/export wait/active/failed/delayed 均 0；ingress 0。
- Nginx：有 `/v1/` 与 `/v1/ws`，无 `/media`；MinIO 9000 未发布；`S3_PUBLIC_BASE_URL` 未被 API 读取。
- Web：无 socket.io-client；无 media/stops/packing/expense/share hooks；新建/详情只覆盖少量字段。
- 契约：无 places；Trip 无 cover 投影；公开分享 media 只有 variants key。
- Admin：媒体真实数据仍用渐变预览，桶名硬编码 `roamlog-local`。
- 测试：API 30 个单测 spec、25 个 e2e spec；staging-full 媒体/导出/邮件证据通过；生产 journey 仅最小创建。

## 已落盘产物

- `.audit/2026-11-18-fullstack-gap-audit.md`（747 行，完整报告）
- `.audit/2026-11-18-fullstack-gap-audit.checkpoint.md`（本文件）

## 待核对/未验证

- 真实浏览器 `media.spacedo.org` PUT/GET、CORS、CSP。
- HEIC/HEIF 在 rc.3 worker 的解码。
- 生产备份恢复、迁移回滚、Docker digest、k6/security gate。
- private trip 与 participant 的产品策略。

## 下一步（给根 Agent）

1. 先派 `W0_CONTRACTS`、`W0_DB`、`W0_STORAGE`/`W0_EDGE`。
2. 契约冻结后并行 `W1_TRIP_COVER_API`、`W1_PLACES_API`、`W1_WEB_DATA`、`W1_WEB_REALTIME`。
3. 再派 `W2_PLACE_UI`/`W2_COVER_UI`，最后 `W2_TRIP_FORM`/`W2_TRIP_DETAIL`。
4. 功能 tab 只写新文件，由详情 owner 统一挂载。
