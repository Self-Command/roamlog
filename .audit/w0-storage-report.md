# W0_STORAGE_INFRA — 媒体交付与写入授权

状态: DONE（含 2 处已披露的边界偏差，需根 Agent 确认）
任务 ID: W0_STORAGE_INFRA
完成时间: 2026-11-18T21:20+08:00

## 1. 变更文件

| # | 文件 | 改动 |
| - | ---- | ---- |
| 1 | `apps/api/src/config/storage-settings.ts` | 新增 `publicEndpoint` / `publicBaseUrl` / `mediaSignedUrlTtlSeconds`（**可选**，保持 `apps/api/test/storage*.e2e-spec.ts` 既有字面量与 `scripts/bootstrap-admin.ts` 兼容）；文件注释解释双 endpoint 与签名 Host |
| 2 | `apps/api/src/config/environment.ts` | 新增 `S3_PUBLIC_ENDPOINT`、`S3_PUBLIC_BASE_URL`、`MEDIA_SIGNED_URL_TTL_SECONDS`（默认 900，60–604800）；`APP_ENV=production` 下强制公网 https origin（拒绝 minio/localhost/127.0.0.1/私网 IPv4/IPv6/`*.local`/`*.internal`/单标签主机/路径/凭据/未替换占位符）；空值回退 `S3_ENDPOINT`；错误信息只含变量名，不回显密钥或被拒 URL |
| 3 | `apps/api/src/config/environment.spec.ts` | 新增 12 个 storage 用例；给 W0_MAIL 的 `productionEmail` fixture 补 `S3_PUBLIC_ENDPOINT`（生产新增强制项，否则邮件用例被连带失败） |
| 4 | `apps/api/src/config/app-config.service.ts` | **边界外（必要接线）**：`mediaSignedUrlTtlSeconds` / `s3PublicEndpoint` / `s3PublicBaseUrl` getter，并把 3 个字段装进 `storageSettings` |
| 5 | `apps/api/src/modules/storage/storage.service.ts` | `client`（`S3_ENDPOINT`，head/delete/health）与 `signingClient`（`S3_PUBLIC_ENDPOINT`，presign GET/PUT）双客户端；保留 `MAX_SIGNED_URL_TTL_SECONDS=604800` 与 key 校验；`createS3Client(settings, endpoint?)` 向后兼容；暴露 `signingEndpoint` 便于诊断 |
| 6 | `apps/api/src/modules/storage/storage.service.spec.ts` | 新增 14 个用例：TTL 默认/覆盖/上下界、公网 vs 内网 client 选择、空/空白/尾斜杠回退、`new URL(url).host` 断言、`X-Amz-SignedHeaders=host`、签名随 Host 变化、内网 client 不被签名路径触碰、key 校验 |
| 7 | `apps/api/src/modules/media/media.service.ts` | **最小授权修复**：新增 `assertMediaVisible()`（private trip 可见性），用于 `update` / `remove`，`complete` 复用同一 helper（行为不变） |
| 8 | `docker/minio-init/01-create-bucket.sh` | 新增 bucket CORS：`MEDIA_CORS_ORIGINS`（逗号分隔，默认 `http://localhost:3000`）→ `mc cors set`；GET/PUT/HEAD、`*`、`ExposeHeaders ETag`、`MaxAgeSeconds 3000`；幂等；非法源/写入失败/回读失败均非零退出 |
| 9 | `docker/compose.production.yml` | 仅追加 env：api 增加 `S3_PUBLIC_ENDPOINT`（compose 层 `:?` 必填）/`S3_PUBLIC_BASE_URL`/`MEDIA_SIGNED_URL_TTL_SECONDS`；worker 同名（非必填）；minio-init 增加 `MEDIA_CORS_ORIGINS`。未重构文件 |
| 10 | `docker/production.env.example` | `S3_PUBLIC_ENDPOINT`、`S3_PUBLIC_BASE_URL`（预留说明）、`MEDIA_SIGNED_URL_TTL_SECONDS=900`、`MEDIA_CORS_ORIGINS`；更新启动校验说明 |
| 11 | `deploy/nginx/media.conf.example` | 新建：80→301、443 TLS、`server_name media.spacedo.org`（注释列明 4 处替换）、`proxy_pass http://127.0.0.1:19000`、**`proxy_set_header Host $host;`**、`proxy_http_version 1.1`、`proxy_buffering off`/`proxy_request_buffering off`、方法白名单 GET/HEAD/PUT/OPTIONS（其它 405）、`autoindex off`、`client_max_body_size 30m`、nosniff / CSP `default-src 'none'; sandbox` / CORP / `Cache-Control: private, no-store`、`proxy_hide_header Server`、`proxy_hide_header Content-Disposition`、`/minio/` 404、Cloudflare real-IP/Host/缓存注意点 |
| 12 | `deploy/nginx/roamlog.conf.example` | 仅在 CSP 上方加注释：`img-src https:` 与 `connect-src https:` 已覆盖媒体域（结论：**足够，无需补精确域名**）；若将来收紧为白名单需同时加到 `img-src`/`media-src`/`connect-src` |
| 13 | `docs/operations/media-delivery.md` | 新建：问题成因、文字架构图、双 client 表、path-style 约束、变量表与生产拒绝项、DNS/TLS/安装/重启/冒烟步骤、CORS 机制、TTL、回滚、Cloudflare、403 排查表、诊断命令、已知缺口 |
| 14 | `.audit/w0-storage-report.md`、`.audit/w0-storage-report.checkpoint.md` | 本报告与 checkpoint |

未触碰：`packages/**`、`apps/web/**`、`apps/admin/**`、`apps/api/src/modules/{trips,places,share-links}/**`、`docker/compose.staging.yml`、`.github/**`、lockfile、`deploy/README.md`、生产服务器。未执行任何 git 写操作。

## 2. 实现摘要

**核心机制**：SigV4 预签名把 `Host` 纳入签名。API/worker 的内部读写继续走 `S3_ENDPOINT=http://minio:9000`；所有交给浏览器的 presign GET/PUT 改由 `signingClient` 用 `S3_PUBLIC_ENDPOINT`（如 `https://media.spacedo.org`）生成；Nginx 媒体域原样转发 `Host: media.spacedo.org` → MinIO 用同一 Host 重算签名 → 校验通过。没有 `/media/` 前缀重写，因为重写会改变 canonical request。

- 配置回退：`S3_PUBLIC_ENDPOINT` 为空 → 规范化后取 `S3_ENDPOINT`（本地/staging 行为不变）；生产（`APP_ENV=production`）则必填且必须是公网 https origin，缺失/内网/占位符一律拒绝启动。
- TTL：`MEDIA_SIGNED_URL_TTL_SECONDS` 默认 900、范围 60–604800；`MEDIA_SIGNED_URL_TTL_SECONDS` 优先于 `EXPORT_SIGNED_URL_TTL` 作为 `StorageService` 的默认 TTL，单次调用仍可显式覆盖，服务层上限 604800。
- CORS：`mc cors set local/$S3_BUCKET <xml>`（固定镜像 `mc RELEASE.2025-08-13T08-35-41Z` 经上游源码确认支持）→ 回读校验后才算成功。
- 授权：`presign` 原本已校验 trip 归属与 private 可见性；缺口在 `update`/`remove` 只校验 workspace，不校验目标 media 所属 private trip 的可见性。已用与 `complete` 相同的规则补齐。

## 3. 验证命令与结果

**CodeGraph 门禁/同步**

```
$ codegraph status
Pending Changes: Modified: 3 files      # 非 [OK]
$ codegraph sync
• Modified: 3 - 181 nodes in 2.6s
$ codegraph status | grep -E "Pending"
Pending Changes:                       # 空
...
$ codegraph sync          # 交付前再同步
• Added: 3, Modified: 15 - 243 nodes
$ codegraph status
[OK] Index is up to date
```

**单测（目标命令）**

```
$ pnpm --filter @roamlog/api exec vitest run src/config src/modules/storage
 ✓ src/config/environment.spec.ts (24 tests) 20ms
 ✓ src/modules/storage/storage.service.spec.ts (14 tests) 50ms
 ✓ src/config/app-config-two-factor.spec.ts (3 tests) 4ms
 Test Files  3 passed (3)
      Tests  41 passed (41)
```

**全量 API 单测（回归，确认 media.service.ts 改动不破坏既有）**

```
$ pnpm --filter @roamlog/api exec vitest run src
 Test Files  39 passed (39)
      Tests  277 passed (277)      # 含 API_TRIP_MEDIA 的 media-url.service.spec.ts (8)
```

**typecheck**

```
$ pnpm --filter @roamlog/api typecheck
test/content-trips.e2e-spec.ts(45,19): error TS2554: Expected 4-5 arguments, but got 3.
```

`tsc` 在我改动的任何文件（config/*、modules/storage/*、modules/media/media.service.ts）均无报错。唯一错误位于 `apps/api/test/content-trips.e2e-spec.ts`：`TripsService` 构造参数被 API_TRIP_MEDIA 从 3 改为 4–5 个（该文件不在我可写范围，`git status` 显示 trips 模块此刻仍在被改，`trips.service.ts` mtime 21:10）。不属于本任务引入，也不是 `packages/db` 的 TS2719。

**shell 语法**

```
$ bash -n docker/minio-init/01-create-bucket.sh   # OK
$ sh  -n docker/minio-init/01-create-bucket.sh    # OK
```

**CORS 脚本行为（`mc` 桩，本地真实执行脚本）**

```
case[default] exit=0            # 未设置 MEDIA_CORS_ORIGINS → http://localhost:3000
case[prod] exit=0               # "https://we.spacedo.org, https://admin.spacedo.org"
case[again] exit=0              # 幂等；cmp captured-prod.xml captured-again.xml → identical
case[bad_scheme] exit=1         # ftp:// → 非零
case[with_path] exit=1          # https://we.spacedo.org/media → 非零
case[xml_injection] exit=1      # 含 "<" 的源被字符白名单拒绝
case[empty_list] exit=1         # " , " → 至少一个源
case[set_fails] exit=1          # mc cors set 失败 → 非零 + 明确信息
case[readback_fails] exit=1     # 回读失败 → 非零（-x 追踪确认输出
                                #   "Bucket CORS was set but could not be read back ..." 后 exit 1）
```

生成的 CORS XML（生产两源时）：

```xml
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>https://we.spacedo.org</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3000</MaxAgeSeconds>
  </CORSRule>
  ... 每个源一条 rule ...
</CORSConfiguration>
```

**compose 结构（PyYAML 解析，非 `docker compose config`——本机无 docker）**

```
api        : {"S3_ENDPOINT":"http://minio:9000","S3_PUBLIC_ENDPOINT":"${S3_PUBLIC_ENDPOINT:?S3_PUBLIC_ENDPOINT is required}","S3_PUBLIC_BASE_URL":"${S3_PUBLIC_BASE_URL:-}","MEDIA_SIGNED_URL_TTL_SECONDS":"${MEDIA_SIGNED_URL_TTL_SECONDS:-900}"}
worker     : {"S3_ENDPOINT":"http://minio:9000","S3_PUBLIC_ENDPOINT":"${S3_PUBLIC_ENDPOINT:-}","MEDIA_SIGNED_URL_TTL_SECONDS":"${MEDIA_SIGNED_URL_TTL_SECONDS:-900}"}
minio-init : {"MEDIA_CORS_ORIGINS":"${MEDIA_CORS_ORIGINS:-http://localhost:3000}","S3_BUCKET":"${S3_BUCKET:?S3_BUCKET is required}"}
services   : postgres,redis,minio,minio-init,migrate,api,worker,web,admin   # 未增删服务
minio-init entrypoint: ["/bin/sh","/init/01-create-bucket.sh"]              # 未改 entrypoint
```

**Nginx 结构检查（自定义 lint，非 `nginx -t`）**

```
deploy/nginx/media.conf.example: brace_depth_at_end=0 problems=0
deploy/nginx/roamlog.conf.example: brace_depth_at_end=0 problems=0
  OK proxy_pass http://127.0.0.1:19000;   OK proxy_set_header Host $host;
  OK proxy_http_version 1.1;              OK proxy_buffering off; / proxy_request_buffering off;
  OK 方法白名单 + 405;                     OK autoindex off; / client_max_body_size 30m;
  OK nosniff / 7 条 server 级安全头;        OK proxy_hide_header Server; / Content-Disposition;
  OK 301 → https;                          OK server_name 出现 2 次（80/443）;
  OK 无 rewrite 指令 / 无 Host minio / 无 $proxy_host / location 内无 add_header（不破坏继承）
```

## 4. 截图/日志/接口证据

- 无 UI 变更，无截图。
- 证据为上文命令输出：41 + 277 单测、tsc 输出、`bash -n`/`sh -n`、CORS 桩的 10 个 case、compose 解析、nginx 结构 lint。
- **未能执行**：真实 `nginx -t`、真实 MinIO 的 presign → curl PUT/GET、真实 CORS preflight（本机无 `nginx`/`docker`/`mc`，`127.0.0.1:9000` 与 `:19000` 均无监听）。

## 5. CodeGraph 证据

- 查询：`codegraph status`（初始 `Pending Changes: Modified: 3 files`，非 `[OK]` → `codegraph sync` → 干净）、`codegraph sync`、`codegraph status`（交付前 `[OK] Index is up to date`）。
- 查询：`codegraph_explore "StorageService createS3Client createSignedReadUrl StorageSettings S3_ENDPOINT media presign"`（projectPath `C:\Users\BY9700\Desktop\UI\roamlog`）
  - 命中 `apps/api/src/modules/storage/storage.service.ts:44 createS3Client`、`:144 createSignedReadUrl`
  - blast radius：`createSignedReadUrl` 有 4 个调用方（`exports.service.ts`、`media.service.ts`、`media-url.service.ts`），测试 `apps/api/test/staging-storage.e2e-spec.ts`
  - `media.service.ts:56 presign`、`media.controller.ts:44 presign`、`media-url.service.ts:51 sign`
  - 结论：签名路径集中在 `StorageService`，改一处即可覆盖媒体读/上传，并据此判断 exports 会共享默认 TTL（见风险）。
- MCP `codegraph_explore` 输出被截断的部分用 `cat -n` 补读（`media.service.ts` 全文，用于授权审计）。

## 6. 已知风险

1. **导出链接共享媒体 TTL**：`StorageService` 所有签名 URL 的默认 TTL 现在优先取 `MEDIA_SIGNED_URL_TTL_SECONDS`。未设置该变量时行为完全不变（回退 `EXPORT_SIGNED_URL_TTL`）；一旦设置，导出下载链接也使用该值。彻底解耦需要 `exports.service.ts` 显式传 TTL（该文件不在可写范围）。
2. **presign 不约束上传体积**：S3 预签名 PUT 未签 `Content-Length`，25 MB 上限只在 `complete` 的 HEAD 复核时生效，超大对象可能被写入并成为孤儿；`pending` media 行无清理任务。Nginx 侧 `client_max_body_size 30m` 是第一道闸。
3. **presign 非幂等**：只有 `complete` 支持 `Idempotency-Key`，重复 presign 会产生多条 pending 记录 + 多个上传 URL。
4. **`media.service.ts` 可能被并行任务重写**：我改动时该文件相对 HEAD 干净且 mtime 为 19:19（同模块 `media.module.ts`/`media.presenter.ts` 已在 20:41–20:43 被改）。若 API_TRIP_MEDIA 之后整体重写该文件，需保留 `assertMediaVisible()` 及其 3 处调用。
5. **OPTIONS 放行**：任务书要求"只允许 GET/HEAD/PUT"。我在媒体域额外放行 `OPTIONS`（其它方法仍 405），因为浏览器对带 `Content-Type` 的跨域 PUT 必发 preflight；拒绝 OPTIONS 会让上传在"签名正确"的情况下失败。CORS 响应头只由 MinIO 提供，Nginx 不重复添加（避免重复 `Access-Control-Allow-Origin`）。
6. **staging 仍无公网媒体域**：`APP_ENV` 缺省为 `development`，staging 回退内网 endpoint（浏览器仍不可达），这是刻意的兼容取舍。
7. **`deploy/README.md` 的 "Known integration gap"（第 279–285 行）已过时**：仍写着"API 用 `http://minio:9000` 签名"。该文件不在可写范围，需根 Agent 更新指向本方案。
8. 变量未同步到 `README.md` 变量表、`.env.example`、`tooling/scripts/check-env.ts`（均不可写）。

## 7. 未覆盖项

- 真实 `nginx -t -c`（无 nginx 二进制）。
- 真实 MinIO 端到端：presign → curl PUT → HEAD/complete → 签名 GET；以及真实 CORS preflight（无 docker/mc/MinIO）。
- `media.service.ts` 授权修复的自动化测试：`apps/api/src/modules/media/**` 除 `media.service.ts` 外不在可写范围，未新增 spec；仅由 277 个既有单测回归确认无破坏。
- 未验证 `docker compose config` 的变量插值（无 docker），仅用 PyYAML 验证结构与键位。
- 未验证 Cloudflare 实际代理链路（禁止连生产）。

## 8. 建议的下一步

1. 根 Agent 验收：重点看 §1 第 4、7 项（边界偏差）与本报告 §6 的取舍是否接受。
2. 更新不可写但已过时的文档/脚本：`deploy/README.md`（Known integration gap）、`docs/operations/README.md`（索引）、`README.md` 变量表、`.env.example`、`tooling/scripts/check-env.ts`（把 `MEDIA_SIGNED_URL_TTL_SECONDS` 加入范围校验）。
3. 转派 API_TRIP_MEDIA：合并前确认 `media.service.ts` 保留 `assertMediaVisible`；补 `media.service` 的 private-trip 授权测试；顺便修 `test/content-trips.e2e-spec.ts:45` 的构造参数。
4. G6 部署顺序：DNS → 证书 → 安装 `media.conf` → `.env.production` 填入 `S3_PUBLIC_ENDPOINT`/`MEDIA_CORS_ORIGINS` → `docker compose config --quiet` → `up -d` → 按 `docs/operations/media-delivery.md` §4.5 冒烟（presign → PUT → GET 均 200）。
5. 后续任务：presign 幂等 + 上传大小签名约束（如 `Content-Length` 条件或改用 multipart policy）、pending media 清理任务、导出 TTL 与媒体 TTL 解耦。