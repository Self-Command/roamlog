# Roamlog rc.4 生产部署前置核查报告（只读）

| 项目 | 内容 |
| --- | --- |
| 任务 ID | `PROD_PREFLIGHT` |
| 状态 | **NEEDS_REVIEW**（核查完成；部署前置条件存在 3 个阻断项，见 D 节） |
| 执行时间 | 2026-11-19 00:16 +08:00 / 2026-11-18 16:16 UTC（以目标机时间为准） |
| 目标主机 | `root@217.217.197.188`（Ubuntu 26.04.1 LTS，`eth0=217.217.197.188/32`） |
| 方法 | SSH BatchMode 只读命令 + 本地仓库配置/文档阅读（CodeGraph 先查，YAML 用文件读取） |
| 写操作 | **服务器：零写操作**。仅本地新增本报告与 checkpoint 两份文件 |
| 密钥处理 | 未读取、未输出任何密钥值；env 仅列键名、权限与属主 |

---

## 0. 结论摘要

1. **好消息：数据可以沿用，不是重新初始化。** 当前 staging 栈（`compose.server.yml` 的 `!override`）已经 bind 到与生产编排**完全相同**的 `/opt/roamlog/data/{postgres,redis,minio}`，PostgreSQL 数据目录 `PG_VERSION=17`，与生产 `postgres:17-alpine` 同主版本；MinIO 使用同一 digest 镜像。切换后生产栈看到的是同一份数据。
2. **但三个阻断项必须先解决：**
   - `/opt/roamlog/config/.env.production` **不存在**（生产编排的 `${VAR:?}` 插值会直接失败）；
   - `/opt/roamlog/repo` 停留在 `b96ca9b`（2026-11-18 13:19 +0800），**没有** `docker/compose.production.yml`、`docker/production.env.example`、`deploy/nginx/media.conf.example`；
   - `media.spacedo.org` **无 DNS 记录、无证书、Nginx 无 server 块** → 生产 API 在 `APP_ENV=production` 下会因 `S3_PUBLIC_ENDPOINT` 校验失败而拒绝启动。
3. **端口：13000/13001/14000 正被 staging 占用**，19000/19001 当前空闲（现有 MinIO 容器运行时没有实际发布端口，见 B1）。切换必须先停旧栈；停机窗口约 **2–5 分钟**（镜像可提前拉取）。
4. **没有可用于回滚的数据库备份**：`/opt/roamlog/backups` 只有 5 个 env/nginx 快照，从未跑过 `pg_dump`；`/opt/roamlog/bin` 不存在，无 cron、无 systemd timer。部署前必须手工备份。
5. 生产 Nginx 上游端口（13000/13001/14000）与现有 `/etc/nginx/sites-available/roamlog` **完全一致**，应用路由不需要改 Nginx；只有媒体子域需要新增站点。
6. 本次**未执行**任何 `docker compose up/down/pull/restart`、`systemctl`/`nginx reload`、文件写入/删除、`git pull`、数据库写。

---

## A. 现状确认

### A1. 容器与镜像

命令：

```bash
ssh root@217.217.197.188 "docker ps --format '{{.Names}} | {{.Image}} | {{.Status}}'"
```

输出摘要（仅列 roamlog 相关，其它站点原样保留、未触碰）：

| 容器 | 镜像 | 状态 |
| --- | --- | --- |
| roamlog-staging-web-1 | `ghcr.io/self-command/roamlog/web:v0.1.0-rc.3` | Up 11 hours (healthy) |
| roamlog-staging-admin-1 | `ghcr.io/self-command/roamlog/admin:v0.1.0-rc.3` | Up 11 hours (healthy) |
| roamlog-staging-api-1 | `ghcr.io/self-command/roamlog/api:v0.1.0-rc.3` | Up 11 hours (healthy) |
| roamlog-staging-worker-1 | `ghcr.io/self-command/roamlog/worker:v0.1.0-rc.3` | Up 11 hours (healthy) |
| roamlog-staging-postgres-1 | `postgres:17-alpine` | Up 12 hours (healthy) |
| roamlog-staging-redis-1 | `redis:7-alpine` | Up 12 hours (healthy) |
| roamlog-staging-minio-1 | `7618b82bba99`（digest 固定的 chainguard/minio） | Up 12 hours (healthy) |
| roamlog-staging-mailpit-1 | `axllent/mailpit:v1.27.8` | Up 12 hours (healthy) |

同机其它项目 `classbook-*`、`creditpass-*`、`hermes`、`magpie` 等正常运行，**未做任何操作**。

基线健康（只读）：

```
GET http://127.0.0.1:14000/v1/health -> {"status":"ok"}
GET http://127.0.0.1:14000/v1/ready  -> {"status":"ok","checks":{"database":{"status":"up","latencyMs":78},"redis":{"status":"up","latencyMs":52},"storage":{"status":"up","latencyMs":59}}}
```

rc.3 当前 digest（记入回滚基线，公开信息）：

```
api     ghcr.io/self-command/roamlog/api@sha256:7bfc09b701eae74633d55806d4f2beca540a37cb3056f2b9acbf910c95cc2314
migrate ghcr.io/self-command/roamlog/migrate@sha256:b5250fcd1a868801fd0ad4efbf5aa2661457591c00ae870d69f896fed6023dee
worker  ghcr.io/self-command/roamlog/worker@sha256:41c86c678cc1919825e3aea707f8e8924b40a002f55ec7e67878efa1e1a3df18
web     ghcr.io/self-command/roamlog/web@sha256:695413905b61f4fa0f3adc20499a15619ba7273ff7e9482af5a35fb7acc3a7ab
admin   ghcr.io/self-command/roamlog/admin@sha256:1068f72c017738abb2ebd4a6f54ed82106248a0c1e0d6e2bd10c0d14b598183f
```

### A2. `/opt/roamlog` 目录结构

命令：`ls -la /opt/roamlog; du -sh /opt/roamlog/*`

| 路径 | 存在 | 权限/属主 | 大小 |
| --- | --- | --- | --- |
| `repo/` | 是 | `755 root:root` | 19M |
| `config/` | 是 | `700 root:root` | 60K |
| `data/` | 是 | `755 root:root` | 67M |
| `backups/` | 是 | `700 root:root` | 32K |
| `logs/` | 是 | `700 root:root` | 4K（空） |
| `bin/` | **否** | — | —（runbook 期望的 `/opt/roamlog/bin/backup-roamlog.sh` 未安装） |

### A3. `config/` 下的 env 文件与当前生效文件

命令：`ls -la /opt/roamlog/config; stat -c '%n %a %U:%G %s' ...; grep -oE '^[A-Z0-9_]+' <file> | sort -u`

文件清单：

| 文件 | 模式 | 属主 | 大小 | 说明 |
| --- | --- | --- | --- | --- |
| `.env.staging` | `600` | `root:root` | 2278 B | **当前编排实际使用**（`compose.server.yml` 的 `env_file` 绝对路径） |
| `admin-credentials.json` | `600` | `root:root` | 451 B | staging 首次 bootstrap 产物（未读取内容） |
| `complete-admin-bootstrap.mjs` | `644` | `root:root` | 4529 B | bootstrap 脚本 |
| `compose.rendered.json` | `600` | `root:root` | 29502 B | 历史渲染产物（未读取） |
| `seed-deployed-demo.mjs` | `644` | `root:root` | 6191 B | 演示种子脚本 |
| `.env.production` | **不存在** | — | — | **阻断项 B-01** |
| `image-digests.txt` | **不存在** | — | — | runbook 要求部署时记录 |

`.env.staging` 键名清单（**不含值**，共 61 个键）：

```
ADMIN_2FA_ENFORCED ADMIN_URL API_URL APP_URL BETTER_AUTH_SECRET BETTER_AUTH_URL
BOOTSTRAP_SUPER_ADMIN_EMAIL BOOTSTRAP_SUPER_ADMIN_NAME CORS_ORIGINS DATABASE_URL
DEMO_SEED_ENABLED EMAIL_FROM EXPORT_SIGNED_URL_TTL GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET
GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET LOG_LEVEL MINIO_BROWSER_REDIRECT_URL MINIO_IMAGE
MINIO_MC_IMAGE MINIO_ROOT_PASSWORD MINIO_ROOT_USER NEXT_PUBLIC_ADMIN_DATA_MODE
NEXT_PUBLIC_DATA_MODE NEXT_PUBLIC_GEOCODER_URL NEXT_PUBLIC_MAP_STYLE_URL
NEXT_TELEMETRY_DISABLED NODE_ENV OTEL_EXPORTER_OTLP_ENDPOINT POSTGRES_DB POSTGRES_PASSWORD
POSTGRES_USER REDIS_PASSWORD REDIS_PREFIX REDIS_URL RESEND_API_KEY ROAMLOG_ENV_FILE
ROAMLOG_IMAGE_TAG ROAMLOG_SEED_PRINT_SHARE_TOKEN ROAMLOG_SEED_S3_UPLOAD S3_ACCESS_KEY
S3_BUCKET S3_ENDPOINT S3_FORCE_PATH_STYLE S3_PUBLIC_BASE_URL S3_REGION S3_SECRET_KEY
SENTRY_DSN SENTRY_TRACES_SAMPLE_RATE SESSION_COOKIE_DOMAIN SMTP_HOST SMTP_PASSWORD
SMTP_PORT SMTP_USER STAGING_ADMIN_PORT STAGING_API_PORT STAGING_MAILPIT_UI_PORT
STAGING_MINIO_CONSOLE_PORT STAGING_WEB_PORT TRUST_PROXY
```

> 注意：不能把 `.env.staging` 直接复制成 `.env.production`。生产模板（`docker/production.env.example`）有 61 个键，但集合不同，缺少以下 **16 个生产必需/常用键**：
> `APP_ENV`、`API_PORT`、`EMAIL_PROVIDER`、`RATE_LIMIT_WINDOW_SECONDS`、`AUTH_RATE_LIMIT_MAX`、`PUBLIC_SHARE_RATE_LIMIT_MAX`、`PUBLIC_SHARE_PASSWORD_RATE_LIMIT_MAX`、`MEDIA_PRESIGN_RATE_LIMIT_MAX`、`MEDIA_SIGNED_URL_TTL_SECONDS`、`MEDIA_CORS_ORIGINS`、`S3_PUBLIC_ENDPOINT`、`PRODUCTION_WEB_PORT`、`PRODUCTION_ADMIN_PORT`、`PRODUCTION_API_PORT`、`PRODUCTION_MINIO_S3_PORT`、`PRODUCTION_MINIO_CONSOLE_PORT`。

### A4. 当前实际运行的 compose 文件

命令：

```bash
docker compose ls -a
docker inspect roamlog-staging-api-1 --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}'
```

输出摘要：

```
NAME             STATUS                  CONFIG FILES
classbook        running(3)              /opt/classbook/deploy/docker-compose.yml
creditpass       running(2)              /opt/creditpass/deploy/docker-compose.yml
hermes           running(1)              /opt/stack/hermes/compose.yaml
magpie           running(1)              /opt/stack/magpie/compose.yaml
roamlog-staging  exited(2), running(8)   /opt/roamlog/repo/docker/compose.staging.yml,/opt/roamlog/repo/docker/compose.server.yml

project=roamlog-staging
config=/opt/roamlog/repo/docker/compose.staging.yml,/opt/roamlog/repo/docker/compose.server.yml
workdir=/opt/roamlog/repo/docker
```

- `exited(2)` 是 one-shot 的 `migrate` 与 `minio-init`，属正常。
- 服务器仓库：`git log -1` → `b96ca9b 2026-11-18 13:19:09 +0800 fix(api): use execute raw for workspace onboarding lock`，`git status --porcelain` 为空（干净）。
- 服务器仓库 **缺少** rc.4 所需的编排与环境模板（见 D 节 B-02）。

---

## B. 与新生产编排的差异与风险

新编排（本地 `docker/compose.production.yml`，已逐行阅读）：

- `name: roamlog`；standalone，不允许叠加 staging 文件。
- 端口全部 `127.0.0.1`：web `13000`、admin `13001`、api `14000`、minio S3 `19000`、minio console `19001`。
- 数据卷全部 bind：`/opt/roamlog/data/{postgres,redis,minio}`。
- 7 个服务：`postgres`、`redis`、`minio`、`minio-init`、`migrate`、`api`、`worker`、`web`、`admin`（5 个 GHCR 镜像：migrate/api/worker/web/admin）。
- 网络：`backend`、`edge`、`egress`（项目前缀 `roamlog_`）；无 named volumes。
- app 服务 `env_file: /opt/roamlog/config/.env.production`；`S3_PUBLIC_ENDPOINT` 为必填（`${...:?}`）。

### B1. 端口占用 —— **会冲突，必须先停旧栈**

命令：`ss -ltnp | grep -E ':13000|:13001|:14000|:19000|:19001'`

输出摘要：

| 端口 | 当前占用 | 新编排需要 | 结论 |
| --- | --- | --- | --- |
| 13000 | `docker-proxy` pid 554717（staging web） | web | **冲突** |
| 13001 | `docker-proxy` pid 554688（staging admin） | admin | **冲突** |
| 14000 | `docker-proxy` pid 554206（staging api） | api | **冲突** |
| 19000 | **空闲**（`ss` 无监听） | minio S3 | 切换后可绑定 |
| 19001 | **空闲**（`ss` 无监听） | minio console | 切换后可绑定 |

19000/19001 的特殊情况（已交叉验证）：

```
docker port roamlog-staging-minio-1                     -> 空
docker inspect ... NetworkSettings.Ports                -> {"9000/tcp":null,"9001/tcp":null}
HostConfig.PortBindings                                  -> 19000/19001 已声明
curl 127.0.0.1:19000/minio/health/live                   -> 连接失败
```

即：`compose.server.yml` 虽然声明了 MinIO 端口映射，但当前运行的容器**没有实际发布端口**，所以当前 19000/19001 是空闲的。**不要**先 `docker compose up` 旧栈来"刷新"配置，否则会把这两个端口也占上。

**切换顺序（硬性）**：先 `stop` 旧栈释放 13000/13001/14000（同时避免两个栈同时写 `/opt/roamlog/data/*`），再 `up` 新栈。

### B2. project name / 容器名 / 卷名 / 网络名 —— **不冲突**

| 类别 | 现状（staging） | 新编排（production） | 是否撞名 |
| --- | --- | --- | --- |
| project | `roamlog-staging` | `roamlog` | 否 |
| 容器 | `roamlog-staging-<svc>-1` | `roamlog-<svc>-1` | 否 |
| named volumes | **无**（`docker volume ls \| grep roamlog` 为空；`compose.server.yml` 用 `!override` 改成 bind） | 无（全部 bind） | 否 |
| networks | `roamlog-staging_backend` / `_edge` / `_egress` | `roamlog_backend` / `_edge` / `_egress` | 否 |

结论：`docker compose -p roamlog ... down` 只会操作带 `com.docker.compose.project=roamlog` 标签的资源，不会影响 `roamlog-staging_*` 或其它站点网络。

补充差异（安全姿态，不阻断）：staging 的 `backend` 网络是 `internal: true`，生产编排的 `backend` 不是 internal。生产仍不发布 Postgres/Redis 主机端口，但内部服务可出网；如需要更严格，可在后续变更中把 `backend` 改回 internal（本次不改）。

### B3. 数据目录 —— **路径一致，可沿用；但有两个前提**

命令：`docker inspect <postgres/redis/minio> --format '{{range .Mounts}}...'`、`ls -la /opt/roamlog/data`、`du -sh`

| 容器 | 当前 bind 源 | 生产编排 bind 源 | 一致？ |
| --- | --- | --- | --- |
| postgres | `/opt/roamlog/data/postgres` | 同左 | ✅ |
| redis | `/opt/roamlog/data/redis` | 同左 | ✅ |
| minio | `/opt/roamlog/data/minio` | 同左 | ✅ |

目录现状：

| 路径 | 属主/权限 | 大小 | 关键内容 |
| --- | --- | --- | --- |
| `data/postgres` | `70:root 700` | 65M | `PG_VERSION=17`（与 `postgres:17-alpine` 同主版本） |
| `data/redis` | `root:root 755`（`appendonlydir 700`） | 1.3M | `appendonlydir/` + `dump.rdb` |
| `data/minio` | `65532:65532 750` | 232K | `.minio.sys/` + `roamlog/` bucket |

**结论：不是"重新初始化"，而是沿用同一份数据。** 但必须满足：

1. **生产 `.env.production` 的 `POSTGRES_USER` / `POSTGRES_DB` 必须与现有集群初始化时一致**，`POSTGRES_PASSWORD` 也必须匹配现有角色密码。数据目录非空时 `POSTGRES_PASSWORD`/`POSTGRES_DB` 不会重新初始化；用户/库/密码对不上，API 会认证失败。
2. **迁移兼容性未知**：rc.4 的 `migrate` 会对这份数据执行迁移。rc.3 是否还能读迁移后的 schema 未验证（见 `docs/operations/rollback.md` 的 expand/contract 规则）。回滚前必须确认。
3. **绝对不要两个栈同时运行**：同目录 bind，双重写入会损坏数据（runbook 也明确写了 "Do not run both stacks against the same data directories"）。
4. Redis 现有 key 前缀是 `roamlog-staging`，生产默认 `REDIS_PREFIX=roamlog`；新前缀不会读到旧 key，旧 key 会成为残留（无害，可后续清理）。

### B4. Nginx 期望的上游端口 —— **完全一致，应用路由不需要改**

命令：`grep -nE 'upstream|server 127|server_name|listen|proxy_pass' /etc/nginx/sites-available/roamlog`

输出摘要：

```
6:upstream roamlog_web_upstream    { 7: server 127.0.0.1:13000; }
11:upstream roamlog_admin_upstream { 12: server 127.0.0.1:13001; }
16:upstream roamlog_api_upstream   { 17: server 127.0.0.1:14000; }
24:server_name we.spacedo.org;   listen 80 / 443 ssl
```

- `/etc/nginx/sites-enabled/roamlog` 已正确链接到 `sites-available/roamlog`。
- upstream 与新编排默认端口 **13000 / 13001 / 14000 一致** → **应用入口不需要改任何一行**。
- 只有媒体子域缺失（见 B7）。

### B5. GHCR 拉取权限 —— **无法证明，需在拉取时验证**

命令：

```bash
docker info | grep -iE 'username|registry'      # 无输出
ls -la /root/.docker/config.json                # -rw------- 600 root:root 123 B
jq -r '.auths | keys[]' /root/.docker/config.json   # ghcr.io
grep credsStore                                  # 无
```

结论：

- `docker info` 没有显示已登录用户名（新版 Docker 通常也不显示）；
- `/root/.docker/config.json` 存在、`600 root:root`、**含 `ghcr.io` 认证条目**（内联 auth，无 credsStore）；
- 12 小时前 rc.3 镜像是成功拉取的，说明该凭据历史上可用；
- 但"能否拉取 rc.4"**不能在只读约束下验证**（`docker pull` 属禁止操作）。

处理：手册 C3 先直接 `pull`；若返回 `denied`/`unauthorized`，执行

```bash
read -rsp 'GHCR PAT (read:packages): ' GHCR_PAT; echo
printf '%s' "$GHCR_PAT" | docker login ghcr.io -u <github-user> --password-stdin
unset GHCR_PAT
```

PAT 只需 `read:packages`。不要把 token 写进 shell 历史或报告。

### B6. 磁盘与内存 —— **够用，但余量不大**

命令：`df -h /opt`、`free -m`、`docker system df`、`docker images | grep roamlog`

```
/dev/sda1  58G  30G used  28G avail  52%  /
Mem: total 7935 MB, used 2417 MB, available 5518 MB, swap 0
Images: 28 total, 20.05GB, reclaimable 13.78GB (68%)
Local Volumes: 7, 1.25GB, reclaimable 1.148GB (91%)
Build Cache: 386.2MB
```

rc.3 五个镜像占用（`docker images` 的 SIZE 列）：api 1.43GB + migrate 2.22GB + worker 890MB + web 1.3GB + admin 1.09GB ≈ **6.9GB**。拉取 rc.4 约需 5–7GB（共享层可能更少），28G 可用空间**足够**，拉完仍有 ~21G；但只剩约 3 倍余量，建议部署成功后清理 rc.2。

**安全清理命令（仅列出，本次未执行；不要在旧栈运行时清 rc.3）：**

```bash
# 删除已不被任何容器使用的 rc.2 五个镜像（部署成功、确认 rc.3 不再需要回滚后）
docker image rm ghcr.io/self-command/roamlog/{api,migrate,worker,web,admin}:v0.1.0-rc.2
# 或按时间清理 7 天前的悬空/未使用镜像（先 docker image ls 核对）
docker image prune -a --filter "until=168h"
```

内存 5.5GB 可用，单栈（Postgres+Redis+MinIO+4 应用）足够；**不要双栈并行**。

### B7. 证书 —— **主域有效，媒体子域完全缺失**

命令：

```bash
openssl x509 -enddate -noout -in /etc/letsencrypt/live/we.spacedo.org/fullchain.pem
ls /etc/letsencrypt/live/
certbot certificates
getent hosts media.spacedo.org
```

输出摘要：

- `we.spacedo.org`：`notAfter=Feb 16 03:08:16 2027 GMT`（**89 天有效**），`CN=we.spacedo.org`。
- `certbot.timer` 活跃：上次 2026-11-18 00:05 UTC，下次 2026-11-18 21:44 UTC。
- 现有证书目录：`ai`、`chaoxing`、`class`、`opencode`、`we` —— **没有 `media.spacedo.org`**。
- `media.spacedo.org` 证书文件不存在（`Could not open file ... No such file or directory`）。
- `getent hosts media.spacedo.org` 返回空、exit 2 → **无 DNS 记录**（we.spacedo.org 解析到 Cloudflare `2606:4700:...`）。
- Nginx 配置中没有任何 `media.spacedo.org` 引用。

**影响（阻断）**：生产编排把 `S3_PUBLIC_ENDPOINT` 设为必填，且 API 在 `APP_ENV=production` 下要求它是"无 path 的公网 https origin"（`apps/api/src/config/app-config.service.ts` + `storage-settings.ts`）。没有媒体域名/证书/Nginx 站点，API 无法启动。

### B8. 备份现状 —— **没有数据库备份，也没有调度**

命令：`ls -la /opt/roamlog/backups`、`find ... -printf`、`crontab -l`、`systemctl list-timers | grep roam`

`/opt/roamlog/backups`（700 root:root，32K）内容：

```
env.staging.before-20261118T035628Z             2357 B
env.staging.before-we-domain-20261118T040610Z   2467 B
nginx-before-roamlog-20261118T035628Z.tar.gz   10152 B
roamlog.certbot-baseline-20261118T040751Z.conf  1047 B
roamlog.http-before-certbot-20261118T040637Z.conf 434 B
```

- 最近一次：2026-11-18 04:06（均为 env/nginx 配置快照）。
- **没有任何 `pg_dump` / MinIO 镜像备份**。
- `crontab -l` → `no crontab for root`；`systemctl list-timers` grep roamlo → **无**。
- `/opt/roamlog/bin` 不存在 → `deploy/backup-roamlog.sh` 未安装。
- 现有脚本（本地 `deploy/backup-roamlog.sh`）只支持 legacy staging 两文件编排 + `.env.staging`，**不是**生产备份脚本；直接用于本次会失败（它要求 `compose.staging.yml`/`compose.server.yml`）。
- 数据库当前大小：`9886 kB`（dump 秒级完成）。

---

## C. 部署手册（供照抄执行；本报告未执行其中任何一步）

> 约定：`TAG=v0.1.0-rc.4`（按实际 Release 替换）；所有命令在 `/opt/roamlog/repo` 下执行；每个 `⚠️` 是回滚点。
> 预计影响：停止旧栈到新栈 healthy 约 **2–5 分钟**（镜像已在停栈前拉好；迁移数据量仅 ~10MB）。

### C0. 前置条件（必须先完成，全部由人工执行；任一项不过不得开始）

1. **确认 release**：rc.4 的 commit SHA、5 个镜像 digest 与 GitHub Release 一致。
2. **同步服务器仓库**（当前 `b96ca9b` 缺少生产文件）：

   ```bash
   cd /opt/roamlog/repo
   git fetch --tags origin
   git status --porcelain            # 必须为空，否则先人工处理
   git checkout --detach <rc.4-commit-sha>
   ls -l docker/compose.production.yml docker/production.env.example deploy/nginx/media.conf.example
   ```

   > 三个文件必须都存在。若 release 未包含它们，**停止**并回到 release owner。
3. **创建 `/opt/roamlog/config/.env.production`**（600 root:root，值来自批准的秘密存储，禁止进入 git/工单）：

   ```bash
   cd /opt/roamlog/repo
   install -m 600 docker/production.env.example /opt/roamlog/config/.env.production
   chown root:root /opt/roamlog/config/.env.production
   # 人工填满全部 CHANGE_ME；重点键：
   #   APP_ENV=production
   #   EMAIL_PROVIDER=resend（禁止 mailpit），EMAIL_FROM 非 .local
   #   S3_PUBLIC_ENDPOINT=https://media.spacedo.org（见 C0-4）
   #   MEDIA_CORS_ORIGINS=https://we.spacedo.org
   #   ROAMLOG_IMAGE_TAG=v0.1.0-rc.4
   #   POSTGRES_USER/POSTGRES_DB/POSTGRES_PASSWORD 必须与现有数据目录一致
   #   CORS_ORIGINS/APP_URL/ADMIN_URL/API_URL/BETTER_AUTH_URL/SESSION_COOKIE_DOMAIN 用同源生产值
   ```

4. **媒体域名（阻断项）三选一，推荐 A**：
   - **A（推荐）**：DNS 增加 `media.spacedo.org` → origin，签证书，安装 `deploy/nginx/media.conf.example` 为 `/etc/nginx/sites-available/roamlog-media` 并 link 到 `sites-enabled`；`certbot --nginx -d media.spacedo.org --non-interactive --agree-tos --redirect`；`nginx -t && systemctl reload nginx`。
   - B：若 DNS 暂不可用，**不要**部署生产栈（API 会拒绝启动）；先在 staging 验证。
   - C：把 `S3_PUBLIC_ENDPOINT` 指到 `https://we.spacedo.org` 需要在现有 Nginx 增加媒体路径反代并保持 `Host`，**未被仓库配置覆盖，不推荐临时手改**。
5. **env 语法/必填校验（只读，不打印值）**：

   ```bash
   cd /opt/roamlog/repo
   docker compose --env-file /opt/roamlog/config/.env.production \
     -f docker/compose.production.yml config --quiet
   ```

   退出 0 才继续。注意：宿主机**没有 pnpm**、`node_modules` 不存在，runbook 里的 `pnpm check:env` 不能直接跑（见 D 节 B-09）；可在 CI 或本地对同一份 env 内容跑该检查。
6. **GHCR 可用**（见 B5）；如 pull 失败按 B5 登录。

### C1. 备份（第一个回滚点之前）

```bash
set -Eeuo pipefail
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST=/opt/roamlog/backups/pre-rc4-$STAMP
install -d -m 700 "$DEST"

# PostgreSQL 自定义格式 dump（容器内读取自身 env，不打印任何凭据）
docker exec -T roamlog-staging-postgres-1 sh -lc \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' \
  > "$DEST/postgres.dump"
docker exec -T roamlog-staging-postgres-1 pg_restore --list < "$DEST/postgres.dump" >/dev/null
[[ -s "$DEST/postgres.dump" ]] && echo "dump ok: $(du -h "$DEST/postgres.dump" | cut -f1)"

# 关键配置与当前编排文件
install -m 600 /opt/roamlog/config/.env.staging "$DEST/env.staging"
cp /opt/roamlog/repo/docker/compose.staging.yml \
   /opt/roamlog/repo/docker/compose.server.yml "$DEST/"
tar -C /etc -czf "$DEST/nginx.tar.gz" nginx
docker ps -a --format '{{.Names}} | {{.Image}} | {{.Status}}' > "$DEST/docker-ps.txt"
docker compose ls -a > "$DEST/compose-ls.txt"

# 校验和
( cd "$DEST" && sha256sum * > SHA256SUMS && chmod 600 * )
echo "backup: $DEST"
```

可选（媒体对象仅 232K）：`tar -C /opt/roamlog/data -czf "$DEST/minio-data.tar.gz" minio`。

**回滚点 R0**：备份目录存在、`pg_restore --list` 通过。

### C2. 记录基线（回滚要用）

```bash
for s in api migrate worker web admin; do
  printf '%s ' "$s"
  docker image inspect --format '{{index .RepoDigests 0}}' \
    ghcr.io/self-command/roamlog/$s:v0.1.0-rc.3
done | tee /opt/roamlog/backups/pre-rc4-rc3-digests.txt
```

### C3. 拉取新镜像（旧栈继续服务，无停机）

```bash
cd /opt/roamlog/repo
export ROAMLOG_IMAGE_TAG=v0.1.0-rc.4
docker compose --env-file /opt/roamlog/config/.env.production \
  -f docker/compose.production.yml pull migrate api worker web admin
```

**回滚点 R1**：pull 失败 → 停止，旧栈未动，无需回滚。

### C4. 校验 digest

```bash
cd /opt/roamlog/repo
for s in api migrate worker web admin; do
  printf '%s ' "$s"
  docker image inspect --format '{{index .RepoDigests 0}}' \
    ghcr.io/self-command/roamlog/$s:v0.1.0-rc.4
done | tee /opt/roamlog/config/image-digests.txt
chmod 600 /opt/roamlog/config/image-digests.txt
```

与 Release 公布的 5 个 digest 逐一比对；不一致 → **停止**（不要启动）。

**回滚点 R2**：镜像已就绪但未启动，随时可放弃。

### C5. 停止旧栈（**只停 roamlog-staging**，顺序重要）

```bash
cd /opt/roamlog/repo
# 方式 A（推荐，保留旧容器以便最快回滚）
docker compose \
  --env-file /opt/roamlog/config/.env.staging \
  -f docker/compose.staging.yml \
  -f docker/compose.server.yml \
  --profile app stop

# 方式 B（等价，按依赖顺序精确 stop，绝不使用 docker stop $(docker ps -q)）
# docker stop roamlog-staging-web-1 roamlog-staging-admin-1 \
#   roamlog-staging-api-1 roamlog-staging-worker-1 \
#   roamlog-staging-mailpit-1 roamlog-staging-minio-1 \
#   roamlog-staging-redis-1 roamlog-staging-postgres-1
```

验证端口已释放、旧栈确实停了：

```bash
ss -ltn | grep -E ':13000|:13001|:14000' || echo "ports free"
docker ps --filter name=roamlog-staging --format '{{.Names}} {{.Status}}'   # 应为空
```

**回滚点 R3**：此步之后新栈未起；若需放弃，反向 `docker start`（顺序：postgres→redis→minio→mailpit→api→worker→web→admin）或 C8 的旧栈命令。

### C6. 启动新栈

```bash
cd /opt/roamlog/repo
export ROAMLOG_IMAGE_TAG=v0.1.0-rc.4
docker compose --env-file /opt/roamlog/config/.env.production \
  -f docker/compose.production.yml up -d --no-build
```

观察迁移与健康：

```bash
docker compose --env-file /opt/roamlog/config/.env.production \
  -f docker/compose.production.yml ps
docker logs roamlog-migrate-1 2>&1 | tail -30
docker inspect roamlog-migrate-1 --format 'migrate exit={{.State.ExitCode}}'   # 必须为 0
```

`migrate` 非 0 / api 不 healthy → 直接进入 C8 回滚，不要反复重启。

**回滚点 R4**：新栈已起，冒烟未过。

### C7. 冒烟检查（15 分钟窗口）

```bash
base=https://we.spacedo.org
for p in / /login /admin /admin/login /v1/health /v1/ready; do
  printf '%s ' "$p"; curl -sS -m 10 -o /dev/null -w '%{http_code}\n' "$base$p"
done
printf '/v1/metrics '; curl -sS -m 10 -o /dev/null -w '%{http_code}\n' "$base/v1/metrics"   # 期望 404
curl -fsS "$base/v1/ready" | python3 -m json.tool      # database/redis/storage 全 up
```

逐项对照 `docs/operations/production-smoke-checklist.md`，至少确认：

- [ ] `/`、`/login`、`/admin`、`/admin/login` = 200；`/v1/health` = `{"status":"ok"}`；`/v1/ready` 三项 up；`/v1/metrics` = 404。
- [ ] Admin 静态资源 `/admin-assets/_next/...` = 200。
- [ ] 登录一次，Set-Cookie 为 `Secure; HttpOnly; SameSite=Lax`；未登录 `/v1/admin/metrics` = 401。
- [ ] 媒体：上传一张私有图 → 签名 URL 的 host 必须是 `media.spacedo.org`，**不能**出现 `minio:9000`；缩略图可读。媒体入口连通性可先 `curl -sI https://media.spacedo.org/`（MinIO 返回 403 即路由正常）。
- [ ] 邮件：验证/重置邮件能从批准的发件人送达，`EmailLog` 有记录。
- [ ] 队列：一个后台任务完成；worker 日志无未处理错误。
- [ ] 容器 `ps` 全部 healthy；`docker logs roamlog-api-1` 无 5xx/密钥泄漏。

### C8. 回滚（冒烟失败或 15 分钟内无法修复）

**决策窗口**：0–15 分钟冒烟期，出现认证/租户隔离/数据完整性问题 → **立即回滚**；超过 60 分钟且已有新写入 → 不要盲目回滚镜像，先按 `docs/operations/rollback.md` 判断是否向后兼容，必要时用 C1 备份恢复数据库。

```bash
cd /opt/roamlog/repo
# 1) 只 down 生产项目（不会碰 roamlog-staging_*）
docker compose --env-file /opt/roamlog/config/.env.production \
  -f docker/compose.production.yml down

# 2A) 若 C5 用的是 stop：直接启回旧容器（保留原状态，最快）
docker start roamlog-staging-postgres-1 roamlog-staging-redis-1 \
  roamlog-staging-minio-1 roamlog-staging-mailpit-1
sleep 15
docker start roamlog-staging-api-1 roamlog-staging-worker-1 \
  roamlog-staging-web-1 roamlog-staging-admin-1

# 2B) 若旧容器已被删除：
cd /opt/roamlog/repo
ROAMLOG_IMAGE_TAG=v0.1.0-rc.3 docker compose \
  --env-file /opt/roamlog/config/.env.staging \
  -f docker/compose.staging.yml \
  -f docker/compose.server.yml \
  --profile app up -d --no-build
```

回滚验证：

```bash
curl -fsS http://127.0.0.1:14000/v1/ready
curl -sS -o /dev/null -w '%{http_code}\n' https://we.spacedo.org/login
docker ps --format '{{.Names}} {{.Status}}' | grep roamlog
```

若迁移破坏了 rc.3 兼容性：**停止 api/worker/web/admin 写入** → 按 `docs/operations/production-backup-restore.md` 恢复 C1 的 `postgres.dump`（`pg_restore --clean --if-exists` 属破坏性操作，需二次审批）→ 重跑迁移与冒烟。记录数据丢失窗口。

**回滚点 R5**：旧栈恢复并 `/v1/ready` 通过 = 回滚完成。

### C9. 收尾（成功路径）

1. 记录 release tag、5 个 digest（已在 `config/image-digests.txt`）、备份目录、冒烟输出、操作人与时间。
2. 至少观察 24h；确认无 5xx、无队列积压、媒体可读。
3. 24h 后再执行 `docker compose -p roamlog-staging ... down` 清理旧栈（**另开变更**，本次手册不包含）。
4. 安装生产备份脚本 + cron/timer（**另一个变更**；现有脚本只面向 staging，需要先适配生产编排）。

### C10. 本手册未执行的步骤（声明）

本次只做只读勘查，**没有执行** C0–C9 中任何一条写命令。具体未执行：

- 未创建/修改 `/opt/roamlog/config/.env.production`、`image-digests.txt`；
- 未同步 `/opt/roamlog/repo`（未 `git fetch/checkout`）；
- 未 `docker compose pull/up/down/stop`、未 `docker pull/rm/stop`；
- 未签发证书、未改 Nginx、未 `nginx -t`/reload；
- 未写任何数据库、未跑 `pg_dump`（备份也未做，属部署第一步）；
- 未安装 `/opt/roamlog/bin/backup-roamlog.sh`、未配置 cron/timer；
- 未触碰 `classbook-*`、`creditpass-*`、`hermes`、`magpie`、`chaoxing`、`opencode`、`ai`、`api` 等任何非 roamlog 容器/站点；
- 本地仅新增本报告与 `.audit/prod-preflight-report.checkpoint.md`，未改代码、未跑 build/test、未做 git 写操作。

---

## D. 风险与阻断项

| ID | 级别 | 发现 | 影响 | 处理 |
| --- | --- | --- | --- | --- |
| B-01 | **BLOCKER** | `/opt/roamlog/config/.env.production` 不存在 | 生产编排 `${VAR:?}` 插值直接失败，`up` 无法启动 | C0-3 创建，600 root:root，校验 `config --quiet` |
| B-02 | **BLOCKER** | 服务器仓库 `b96ca9b` 无 `compose.production.yml` / `production.env.example` / `media.conf.example` | 无法按生产编排部署 | C0-2 同步到 rc.4 commit；三文件必须存在 |
| B-03 | **BLOCKER** | `media.spacedo.org` 无 DNS、无证书、无 Nginx server 块 | `S3_PUBLIC_ENDPOINT` 校验失败 → API 拒绝启动；媒体上传/读取不可用 | C0-4 建 DNS+证书+Nginx；否则不部署 |
| B-04 | **HIGH** | 从未做过数据库备份；`bin/` 缺失；无 cron/timer | 回滚无数据兜底 | C1 手工 dump + 校验；备份自动化另开变更 |
| B-05 | **HIGH** | 13000/13001/14000 被 staging 占用 | 新栈起不来（address already in use），或旧栈未停导致数据双写 | C5 先 stop 旧栈，验证端口释放后再 C6 |
| B-06 | **HIGH** | 两栈共用 `/opt/roamlog/data/*` | 同时运行会损坏数据；`POSTGRES_USER/DB/PASSWORD` 不匹配则 API 连不上；rc.3→rc.4 迁移兼容性未知 | 严禁双栈；C0-3 对齐凭据；C8 先判断迁移兼容性 |
| B-07 | **MEDIUM** | GHCR 登录状态无法只读验证（config.json 有 ghcr.io 条目，`docker info` 无用户名） | pull 可能 401/403 | C3 试拉；失败按 B5 `docker login`（read:packages PAT） |
| B-08 | **MEDIUM** | 磁盘 28G 可用，新镜像 ~6.9G | 空间够但余量约 3 倍；旧 rc.2/rc.3 占 ~13.8GB | 成功后清 rc.2；不要在部署前清 rc.3 |
| B-09 | **MEDIUM** | 宿主机无 `pnpm`、无 `node_modules` | runbook 的 `pnpm check:env` 不能直接执行 | 用 `docker compose config --quiet` 兜底；或在 CI 跑 check:env |
| B-10 | **MEDIUM** | 生产 `backend` 网络非 `internal`（staging 是 internal） | 内部服务可出网，攻击面略增 | 记录为后续加固项，不阻断 |
| B-11 | **LOW** | Redis 残留 `roamlog-staging` 前缀 key | 少量无效 key 占用 | 部署后可选清理，勿在切换前删 |
| B-12 | **LOW** | staging 有 Mailpit，生产没有 | 生产必须真实邮件提供商 | C0-3 确认 `EMAIL_PROVIDER=resend`、`RESEND_API_KEY`/`EMAIL_FROM` |
| B-13 | **INFO** | `we.spacedo.org` 证书有效至 2027-02-16（89 天），certbot.timer 活跃 | 无近期风险 | 保持 timer |
| B-14 | **INFO** | `image-digests.txt` 不存在 | 审计缺口 | C4 生成并 600 |
| B-15 | **INFO** | staging `docker compose ls` 显示 `exited(2)` | one-shot `migrate`/`minio-init` 正常退出 | 无需处理 |

---

## E. CodeGraph 证据

1. `codegraph status`（`C:\Users\BY9700\Desktop\UI\roamlog`）：

   ```
   [OK] Index is up to date
   Files: 1,485   Nodes: 22,739   Edges: 50,166   DB: 65.75 MB
   ```

2. MCP 查询：

   ```
   codegraph_explore(
     query="docker/compose.production.yml docker/compose.staging.yml deploy/backup-roamlog.sh nginx roamlog",
     projectPath="C:\Users\BY9700\Desktop\UI\roamlog"
   )
   ```

   结果：32 个符号；CodeGraph **不索引 YAML/Markdown 配置**（未命中 compose/nginx 文件），转而命中存储配置代码：
   - `apps/api/src/config/storage-settings.ts:18` `StorageSettings`（`endpoint` 与 `publicEndpoint` 双端点，presign 按 Host 签名）；
   - `apps/api/src/modules/storage/storage.service.ts:52-79,143`（`createS3Client` / `resolveSigningEndpoint` / `signingClient`）；
   - `apps/api/src/config/app-config.service.ts:188-215`（`S3_PUBLIC_ENDPOINT` 为必填，`storageSettings`）。

   该结果直接佐证：**生产 API 必须配置公网 `S3_PUBLIC_ENDPOINT`，否则不启动**，也解释了媒体域名缺失为何是阻断项。

3. 配置/文档按 AGENTS.md 的例外用文件读取完成：`docker/compose.production.yml`、`docker/compose.staging.yml`、`docker/compose.server.yml`、`deploy/nginx/*.example`、`deploy/README.md`、`deploy/backup-roamlog.sh`、`docs/operations/{rollback,production-smoke-checklist}.md`。

---

## F. 建议的下一步（给根 Agent / 用户）

1. **先定 release 事实**：确认 rc.4 的 commit SHA 与 5 个 digest；确认该 commit 已包含 `docker/compose.production.yml`、`docker/production.env.example`、`deploy/nginx/media.conf.example`（服务器仓库当前没有）。
2. **建 `.env.production`**：从模板生成、填 16 个生产专属键；`POSTGRES_USER/DB/PASSWORD` 必须与现有数据目录一致（否则沿用数据会连接失败）；`config --quiet` 通过后才继续。
3. **决定媒体域名方案**：推荐先完成 `media.spacedo.org` 的 DNS + 证书 + Nginx（B-03），否则生产 API 无法启动；不要在部署当天临时改架构。
4. **安排维护窗口**：提前 `pull` 5 个镜像（无停机），窗口内只做"停旧 → 起新 → 冒烟"，预计 2–5 分钟；窗口前先执行 C1 备份并校验。
5. **回滚预案**：保留 rc.3 镜像与旧容器（用 `stop` 而非 `down`），记录 rc.3 digest；15 分钟内冒烟不过即回滚；超过 60 分钟且有写入时先评估迁移兼容性。
6. **两个独立后续变更**（不要混进本次部署）：① 安装生产备份脚本 + cron/systemd timer；② 评估将 `backend` 网络改为 `internal`、清理 Redis 旧前缀 key。

> 本报告只读勘查完成；是否推进部署请由根 Agent/用户批准。若需要我执行 C0–C9，请明确授权（当前任务禁止写操作）。