# PROD_PREFLIGHT checkpoint

- 状态: NEEDS_REVIEW
- 时间: 2026-11-18T16:16Z（目标机）
- 主报告: `.audit/prod-preflight-report.md`
- 只读约束遵守: 服务器零写操作；未 compose up/down/pull/restart、未 reload、未改 Nginx/文件/DB、未 git 写
- SSH: BatchMode 可用（root@217.217.197.188，Ubuntu 26.04）

## 已完成核查
- A1 容器清单（roamlog-staging-* 8 running，rc.3；其它站点未触碰）
- A2 /opt/roamlog 结构（repo/config/data/backups/logs；bin 缺失）
- A3 config 清单（仅 .env.staging 600 root:root，61 键；.env.production 缺失）
- A4 生效编排（labels → compose.staging.yml + compose.server.yml，project roamlog-staging；repo b96ca9b）
- B1 端口（13000/13001/14000 被占；19000/19001 当前空闲且 MinIO 运行态无发布端口）
- B2 名称对照（project/容器/网络均不撞；无 roamlog named volume）
- B3 数据目录（两栈同路径 /opt/roamlog/data/*；PG_VERSION=17；沿用而非重初始化）
- B4 Nginx upstream 13000/13001/14000 一致 → 应用路由不改
- B5 GHCR（config.json 600 含 ghcr.io 条目；无法只读验证 pull）
- B6 磁盘/内存（28G avail；mem 5.5G avail；新镜像 ~6.9G）
- B7 证书（we 有效至 2027-02-16；media 无 DNS/证书/Nginx）
- B8 备份（仅 5 个配置快照，无 pg_dump；无 cron/timer；bin 缺失）

## 阻断项
1. .env.production 缺失
2. 服务器 repo 缺 compose.production.yml / production.env.example / media.conf.example
3. media.spacedo.org 缺 DNS + 证书 + Nginx（API 因 S3_PUBLIC_ENDPOINT 拒绝启动）
4. 无数据库备份、无备份调度（部署前必须手工 dump）

## 下一步
等待根 Agent/用户批准；按主报告 C0→C9 执行（需另行授权写操作）。