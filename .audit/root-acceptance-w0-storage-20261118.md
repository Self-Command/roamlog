# 根 Agent 验收记录 — W0_STORAGE_INFRA

任务 ID: W0_STORAGE_INFRA
验收结论: **ACCEPT（含 2 处边界偏差批准 + 1 处必须记录的风险）**
时间: 2026-11-18 21:45
交付: `.audit/w0-storage-report.md`、`deploy/nginx/media.conf.example`、`docs/operations/media-delivery.md`

## 核心设计（根 Agent 认可）

SigV4 把 `Host` 纳入签名 → **内部读写走 `S3_ENDPOINT`（minio:9000），交给浏览器的 presign 一律用 `S3_PUBLIC_ENDPOINT`**，Nginx 原样转发 `Host` 给 MinIO；**不做 `/media/` 重写**（会破坏 canonical request → 403 SignatureDoesNotMatch）。这与我在派单前固定的设计一致。

## 通过的验证

- `pnpm --filter @roamlog/api exec vitest run src/config src/modules/storage` → 3 files / **41 tests** 通过。
- 全 `src` 回归 → 39 files / **277 tests** 通过。
- 我改动文件的 tsc 零报错；api typecheck 唯一剩余错误是 `test/content-trips.e2e-spec.ts(45,19)`（属 API_TRIP_MEDIA 在途）。
- CORS 脚本用 `mc` 桩真实执行 10 case：正常/幂等 exit 0；坏 scheme/带 path/XML 注入/空列表/set 失败/回读失败 全部 exit 1 且信息明确。
- compose PyYAML 解析：3 处新 env 落在正确服务，services 列表与 minio-init entrypoint 未变。
- Nginx 结构 lint：括号平衡、无 rewrite/无 `proxy_set_header Host minio`、location 内无 `add_header`（不破坏 server 级继承）、14 项关键指令到位。

## 边界偏差裁定

| 偏差 | 裁定 | 理由 |
|---|---|---|
| 改 `apps/api/src/config/app-config.service.ts`（加 3 getter + storageSettings 装配） | **批准** | 不改则新配置完全不生效，属必要接线，非功能扩张 |
| 改 `apps/api/src/modules/media/media.service.ts`（`assertMediaVisible()`） | **批准** | 这是任务第 6 条授权的越权漏洞修复；**已实测在 API_TRIP_MEDIA 并发重写后仍保留**（3 处调用 + L400 定义） |
| Nginx 方法白名单放行 `OPTIONS` | **批准** | 跨域带 `Content-Type` 的 PUT 必发 preflight；拒 OPTIONS 会让签名正确的上传也失败。CORS 头仍只由 MinIO 出，Nginx 不重复加，避免重复 ACAO |

## 必须记录的风险

1. **导出链接共享媒体 TTL**：`StorageService` 默认 TTL 现在优先取 `MEDIA_SIGNED_URL_TTL_SECONDS`（未设置时回退 `EXPORT_SIGNED_URL_TTL`，行为不变）；一旦设置，导出下载也会用媒体 TTL。彻底解耦需在 `exports.service.ts` 显式传 TTL（未授权）。
2. presign PUT 未签 `Content-Length`，25MB 上限只在 complete 复核，可能留孤儿对象；pending 行无清理任务。
3. presign 非幂等（仅 complete 支持 Idempotency-Key）。
4. staging 无公网媒体域（`APP_ENV` 缺省 → 回退内网），浏览器仍不可达——刻意的兼容取舍，G5 需显式设置。

## 未覆盖（→ G5/G6）

真实 `nginx -t`、真实 MinIO presign→PUT→GET、真实 CORS preflight、`docker compose config` 实际插值、Cloudflare 代理链路。本机无 nginx/docker/mc，属环境缺口，部署前必须在有 Docker 的主机复验。

## 未授权但已过时的项（→ 已派 `W0_DOCS_ENV_SYNC`）

`deploy/README.md` 的 "Known integration gap"、`docs/operations/README.md` 索引、README 变量表、`.env.example`、`tooling/scripts/check-env.ts`。