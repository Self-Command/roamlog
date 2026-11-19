# 流程事故记录：`git commit --amend` 误改他人提交

时间: 2026-11-19 11:33
发现者: 根 Agent（由 `A2_BUILD_FLAGS` 主动上报）

## 事故

`A2_BUILD_FLAGS` 在修正 `README.md` 的一处表格后执行：

```
git add README.md && git commit --amend --no-edit
```

执行瞬间，另一个 Agent（`A3_DEAD_BRANCHES`）刚提交了 `257bdbd`，amend 因此落到了**对方的提交**上，把 `257bdbd` 改写为 `9d973bd`。

## 影响范围（已核实）

| 项 | 事实 |
|---|---|
| 内容丢失 | **无** |
| `9d973bd` 构成 | 48 个 `apps/web` 文件（−4596 行）+ `README.md` 2 行 |
| `A3` 的成果 | 完整（`rg "useDataMode\|DataMode" apps/web --glob '!**/*.test.*'` 无输出） |
| `A2` 的成果 | 独立提交 `77ffa3f`（10 文件，仅 docker/.env.example/README/deploy/tooling）完好 |
| 推送状态 | 均**未推送**，仅本地 |
| 工作区 | 无损；`apps/admin` 与 `packages`/`apps/api` 的未提交改动属其他并行任务 |

## 处置决定

**不回滚历史。** 理由：
- 内容完整、无丢失；
- 尚未推送，影响限于本地；
- 当时有 4 个 Agent 并行读写工作区，reset/rebase 的二次事故风险高于收益。

## 已同步给所有 Agent 的硬规则

1. **禁止** `git commit --amend`、`git rebase`、`git reset`（任何形式）。
2. 一个 Agent 一次只提交**自己任务的文件**：`git add <精确路径>`；**禁止** `git add -A`、`git add .`。
3. 发现提交边界异常 → **停下报告**，由根 Agent 处理，不得自行修正历史。

## 遗留

- 历史里 `9d973bd` 是一个**跨任务**提交（web 清理 + README 修文档）。推送后不影响功能，但会略微影响逐任务追责。
- 若将来需要整洁历史，由根 Agent 在**所有 Agent 空闲、工作区干净**时统一 squash/rebase，且必须先备份分支。

## 教训（写进后续任务包）

> 并行多 Agent 场景下，`commit --amend` 等同于对共享索引的写操作。任何"只改我自己的提交"的意图，在多 Agent 环境里都不成立。