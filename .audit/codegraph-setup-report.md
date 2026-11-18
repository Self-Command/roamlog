# CodeGraph 安装与接入报告

状态: DONE
任务 ID: TOOL_CODEGRAPH
日期: 2026-11-18 (Asia/Shanghai)
执行者: 根 Agent（工具链配置，不涉及产品业务代码）

## 1. 结论

CodeGraph v1.6.3 已安装、接入 DeepSeek Harness（MCP），并在 `roamlog` 建立完整索引；
文件变更自动增量同步已实测通过。后续所有 Agent 必须按 `AGENTS.md` 第 0 节强制使用。

## 2. 安装与配置

| 项 | 值 |
|---|---|
| CLI | `C:\Users\BY9700\AppData\Local\codegraph\current\bin\codegraph`（v1.6.2 → v1.6.3，`codegraph upgrade`） |
| MCP 配置 | `C:\Users\BY9700\.dsh\cordis.patch.yml`（`mcp-codegraph`，stdio：`codegraph serve --mcp`） |
| 全局说明 | `C:\Users\BY9700\.dsh\AGENTS.md`（CodeGraph 自动写入的使用说明） |
| 项目规则 | `C:\Users\BY9700\Desktop\UI\AGENTS.md` 第 0 节（强制门禁 + BLOCKED 停止条件 + CodeGraph 证据要求） |
| 遥测 | 已关闭（`codegraph telemetry off`） |
| 索引目录 | `roamlog/.codegraph/`（已加入 `.gitignore`，不提交） |

## 3. 索引事实

```
Project: C:\Users\BY9700\Desktop\UI\roamlog
Files:     1,338
Nodes:     19,714
Edges:     41,588
DB Size:   49.80 MB
Backend:   node:sqlite (full WAL)
Journal:   wal
```

语言分布：typescript 1,113；tsx 203；javascript 13；yaml 8；python 1。

## 4. 验证证据

| 验证 | 命令 | 结果 |
|---|---|---|
| 版本 | `codegraph --version` | 1.6.3 |
| 索引状态 | `codegraph status` | `[OK] Index is up to date` |
| 符号查询（CLI） | `codegraph query "presentAdminAuditLog"` | 命中 `apps/api/src/modules/admin/admin.presenters.ts:22` 及其 import |
| 影响面（MCP） | `codegraph_explore("presentAdminAuditLog AuditLogSchema admin audit presenter", projectPath=roamlog)` | 返回 20 symbols / 3 files 的逐行真实源码、调用方与测试覆盖 |
| 自动同步（新增） | 新建 `sync-probe-codegraph.ts` → sleep 4s → `codegraph query codegraphSyncProbe2` | 命中新文件，Files 1,338 → 1,339 |
| 自动同步（删除） | 删除探针 → sleep 3s → 查询 | 无结果，Files 1,339 → 1,338，状态 up to date |
| MCP 进程 | `codegraph serve --mcp`（PID 20952/21332） | 由 DSH 启动，工具可用 |

注：首次带点前缀的探针文件 `.codegraph-sync-probe.ts` 未被索引（CodeGraph 跳过 dotfile），
改用普通文件名后验证通过，不是 watcher 故障。

## 5. 使用方式（Agent 必须遵守）

1. `cd roamlog && codegraph status` → 确认 `[OK] Index is up to date`。
2. 优先 MCP：`codegraph_explore`（带 `projectPath: C:\Users\BY9700\Desktop\UI\roamlog`）。
3. MCP 不可用：`codegraph explore "<symbol or question>"`。
4. 未覆盖内容（日志/HTTP/DB/文档/生成物实际内容）才用 read/grep/glob。
5. 交付必须附 `CodeGraph 证据:`。

## 6. 停止条件

`codegraph` 不存在、索引缺失且无法建立、MCP 与 CLI 均不可用、或索引过期且 `codegraph sync` 失败时，
所有 Agent 必须停止代码任务并报告 `BLOCKED: CodeGraph unavailable`，不得用 grep 兜底继续。

## 7. 风险与未覆盖

- 索引为本地机器产物（约 50 MB），换机/清理后需重新 `codegraph init`；不进 git、不进镜像。
- `codegraph serve --mcp` 已在当前 DSH 会话可用；若宿主重启后 MCP 未加载，按安装器提示重开 DSH 会话。
- CodeGraph 不覆盖 `.data/`、`.audit/` 等非代码内容，这部分仍需 read/grep。
- 未对 `roamlog-prototype` 单独建索引；如需跨原型查询，由负责人决定是否 `codegraph init`。
