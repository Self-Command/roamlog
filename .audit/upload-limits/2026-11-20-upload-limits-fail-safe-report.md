# MEDIA_UPLOAD_LIMITS fail-safe 交付报告

**任务**：P0-AVATAR-LIMITS / B
**日期**：2026-11-20 21:34 CST
**状态**：DONE
**性质**：纯后端修复 + targeted 单测；没有 UI 改动可点，因此没有新增 UI 截图。

---

## 移植来源

本修复不新写限流算法，而是在仓库既有 `MediaUploadLimitsService` 上补齐错误路径，沿用同一套 fixed-window 语义：

| 来源 | 位置 | 用途 |
| --- | --- | --- |
| 仓库既有实现 | `apps/api/src/modules/media/media-upload-limits.service.ts`（原 fixed-window `INCRBY` + `TTL` + 进程内 fallback） | 保持“Redis 失败降级进程内窗口、`degraded=true`”的原设计 |
| 仓库既有 guard | `apps/api/src/modules/media/media-upload-rate-limit.guard.ts:33` | `RateLimit-Remaining` / `X-RateLimit-Degraded` 的真实响应头路径 |
| 仓库既有测试 | `apps/api/src/modules/media/__tests__/media-upload-limits.spec.ts`、`media-upload-limits-http.spec.ts` | 在既有测试文件扩展，不另造 harness |
| ioredis 行为约束 | `INCRBY` 的 RESP 整数回复；`TTL` 返回秒数 | 非 number 的返回值视为环境故障，不再进入 `count <= limit` |

适配层说明：没有上游可整块移植的新算法；本次只是在现有实现上增加输入守卫，算法与窗口语义不变。没有改 `packages/contracts`、`packages/db` 或媒体 UI。

---

## 修复内容

### 1. 配置值不再变成 NaN

`toEffectiveUploadLimits()` 对四个字段逐一调用 `finitePositiveOr()`：

- `undefined`、`NaN`、`0`、负数 → 回退到 `DEFAULT_LIMITS_RUNTIME`；
- 小数先 `Math.trunc()`，若结果为 0 也回退，避免窗口变成 0 秒；
- `consume()` 的 `limit`、`tokens`、`rateLimitWindowSeconds` 同样经过 finite/positive 守卫。

### 2. Redis 返回值/异常不再永久锁死

`countInRedis()` 用 `requireFiniteCounter()` 检查 `INCRBY` 的回复：

- 正常 Redis 返回 number → 继续累加；
- 本地 stub 错误返回字符串 `"OK"`、`undefined`、`Infinity` 等 → 抛错，进入既有内存 fallback；
- Redis 抛错/超时 → 同样进入内存 fallback；
- `TTL` 不是有限数字时按缺失 TTL 处理，调用 `EXPIRE` 修复；
- `decision()` 对 `count/limit/ttlSeconds` 再做一次有限性守卫，保证 `RateLimit-Remaining` 与 `Retry-After` 不出现 `NaN`。

### 3. Redis stub 对齐真实 `INCRBY`

`e2e/live-support/redis-stub.ts` 新增 `INCRBY`：

- 解析整数增量，返回 RESP integer（不是 `+OK`）；
- 保留 key 的 `expiresAt`；
- 非整数返回 `ERR value is not an integer or out of range`。

### 4. 文件末尾换行

`media-upload-limits.service.ts` 与测试文件均以 LF 结尾；`git diff --check` 返回 0。

---

## 代码位置

| 文件 | 变更 |
| --- | --- |
| `apps/api/src/modules/media/media-upload-limits.service.ts` | `finitePositiveOr`、`windowSecondsOr`、`requireFiniteCounter`；`consume`/`countInRedis`/`decision` 全链路守卫；文件末尾换行 |
| `apps/api/src/modules/media/__tests__/media-upload-limits.spec.ts` | 新增 malformed limits、INCRBY/EXPIRE/batch、非数字 INCRBY、fallback window 过期测试 |
| `e2e/live-support/redis-stub.ts` | `INCRBY` 命令实现 |

---

## 测试覆盖与结果

```bash
cd /c/Users/BY9700/Desktop/UI/roamlog

pnpm --filter @roamlog/api exec vitest run \
  src/modules/media/__tests__/media-upload-limits.spec.ts \
  src/modules/media/__tests__/media-upload-limits-http.spec.ts

pnpm --filter @roamlog/api exec tsc --noEmit
pnpm typecheck
git diff --check -- \
  apps/api/src/modules/media/media-upload-limits.service.ts \
  apps/api/src/modules/media/__tests__/media-upload-limits.spec.ts \
  e2e/live-support/redis-stub.ts
```

实际结果：

- media 测试：**2 files passed / 26 tests passed**（核心 spec 20 个，HTTP spec 6 个）；
- `@roamlog/api` `tsc --noEmit`：**0 errors**；
- `pnpm typecheck`：**11/11 tasks successful**；
- `git diff --check`：**clean**，无空白/末尾换行错误。

新增断言逐项对应验收要求：

| 要求 | 覆盖 |
| --- | --- |
| `toEffectiveUploadLimits` 遇 undefined/NaN/0/负数回退默认值 | `falls back to defaults for undefined, NaN, zero and negative settings` |
| `consume` 遇 Redis 非数字/抛错降级，不产生 NaN | `degrades instead of poisoning the bucket when INCRBY returns a non-number` + 既有 Redis unavailable 测试 |
| `INCRBY` 正常累加、TTL 修复、批量 token 计费 | `accumulates INCRBY charges, repairs a missing TTL, and bills the whole batch`（3 token → remaining 17；4 token → remaining 13；`EXPIRE key 60`） |
| 窗口过期后不会永久 429 | `expires the process-local fallback window instead of locking the account forever`（fake timer 前进 60,001ms 后再次 allowed） |
| `RateLimit-Remaining` 不出现 NaN | 非数字/Redis 失败两条路径均断言 `"17"`/`"0"`，并显式 `not.toBe("NaN")` |

关键断言示例（实际测试代码）：

```text
Redis INCRBY returns "OK"
→ first 3-file batch allowed
→ RateLimit-Remaining: 17
→ X-RateLimit-Degraded: true
→ next 18-file batch is a real 429 (3 + 18 > 20), not a poison 429
```

---

## 真实 HTTP / UI 证据说明

本次没有修改上传 UI，也没有新的用户可见界面；按任务定义，验收以 API 单测 + 现有 HTTP guard spec 为准：

- `media-upload-limits-http.spec.ts` 走真实 guard/controller 响应链，验证 429 与响应头；
- `media-upload-limits.spec.ts` 直接调用 service/guard，覆盖 Redis 异常、非数字回复、fallback window 过期等无法在正常本地栈自然触发的故障。

没有用 mock 数据代替正常上传验收：正常上传路径仍由上一节头像 e2e（真实 S3 stub + 真实 worker-drain + 真实 DB）覆盖。这里只对**第三方/基础设施故障**做可控注入。

---

## CodeGraph 证据

```bash
cd /c/Users/BY9700/Desktop/UI/roamlog
codegraph status
# → Files 2,163 / Nodes 36,315 / Edges 85,336 · [OK] Index is up to date

codegraph explore "MediaUploadRateLimitGuard canActivate MediaUploadLimitsService consume toEffectiveUploadLimits"
# → canActivate(media-upload-rate-limit.guard.ts:33)
# → resolve(media-upload-limits.service.ts:122)
# → toEffectiveUploadLimits(media-upload-limits.service.ts:79)
# → consume(media-upload-limits.service.ts:140)
# → tests: media-upload-limits.spec.ts / media-upload-limits-http.spec.ts
```

CodeGraph 还确认 blast radius：`toEffectiveUploadLimits` 4 个调用方、`consume` 2 个 guard 调用方，均在本任务允许的 `apps/api/src/modules/media/**` 内；没有跨到照片 UI、地图或契约/DB 包。

---

## 已知风险 / 未覆盖

1. **4000 进程未重启以加载本修复**：该进程启动于 `20:58:20`，而 `media-upload-limits.service.ts` 的 fail-safe 修改 mtime 是 `21:01:02`。运行中的 4000 仍使用启动时加载的旧版本；单测已证明新代码，若要线上验证需等 4000/46379 空闲后执行 `bash .audit/tools/start-api.sh`。没有杀别人的进程。
2. `INCRBY` 返回 `"1"`（字符串但可解析）也按环境故障降级；真实 ioredis 的整数回复是 number，这是有意的 fail-safe，不尝试猜测字符串。
3. 仅覆盖 media presign 限额；没有改 auth/public-share 限流器，也没有改契约/DB。
4. 没有新增 UI 截图，因为本任务没有 UI 变更；头像/邮箱 UI 截图在 `.audit/avatar-email/`。
