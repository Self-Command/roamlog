# WEB_FIXTURES_ISOLATION — checkpoint

状态: DONE（含验收后 gating 修正；api/mock 双构建对照完成）
任务 ID: WEB_FIXTURES_ISOLATION
完成时间: 2026-11-18 22:13（最终 api 产物 22:12:16）

## CodeGraph 门禁

- 初次 `codegraph status` 为脏 → `codegraph sync`（8 文件 / 223 nodes）→ `[OK]`。
- 主查询 `codegraph explore "DemoDataProvider providers.tsx demo-store trip-detail.tsx overview-tab packing-tab photos-tab budget-tab"`
  → 105 symbols / 8 files；`DemoDataProvider` 4 callers、`Providers` 2 callers（`app/layout.tsx`）。
- 交付时 `codegraph status` = `[OK] Index is up to date`（一次 sync 因其他 Agent 持有索引锁失败，重试后状态 OK，无需 unlock）。

## 验收后修正（gating 语义）

验收指出：把 `NODE_ENV !== "production"` 写进 **mock root 挂载**门控会让「生产构建 + mock 模式」白屏。已改：

```tsx
const mockModeEnabled = DATA_MODE === "mock";                                // 挂载：只看数据模式
const mswEnabled = mockModeEnabled && process.env.NODE_ENV !== "production"; // MSW：仍 dev/test only
const isApiBuild = process.env.NEXT_PUBLIC_DATA_MODE === "api";              // 产物消除：构建期常量
```

两者正交：`DATA_MODE` 决定「跑不跑」，`isApiBuild` 决定「进不进 bundle」。
护栏测试同步加入 4 条断言（挂载门控、渲染处、MSW 门控、构建门控），共 5 用例。

## 三次构建（顺序执行，`.next` 互相覆盖）

| # | NEXT_PUBLIC_DATA_MODE | exit | 产物时间 | demoFixtureState |
| --- | --- | --- | --- | --- |
| 1 | api | 0 | 22:11:00 | 0 files / 0 matches |
| 2 | mock（对照） | 0 | 22:11:38 | 4 files / 20 matches |
| 3 | api（还原） | 0 | 22:12:16 | 0 files / 0 matches |

api 产物另测：`林知夏` 0、`MSW DEVELOPMENT DATA` 0、`demo-store` 0、`lib/demo-store` 0、
`api-mocks` 2（required-server-files 的 transpilePackages 配置）、`legacy-mock` 7（server source map 原文）。
注：`林知夏` 是 admin fixture 字符串（web 不含），`MSW DEVELOPMENT DATA` 全仓不存在——防御性检索词。

## 验证结果

- `pnpm --filter @roamlog/web typecheck` → exit 0（0 error）。
- `pnpm --filter @roamlog/web test` → 23 files / 114 tests 全通过，
  `✓ components/__tests__/no-fixtures-in-api-mode.test.tsx (5 tests)`。
- 未改其它文件：仅 `components/providers.tsx` + `components/__tests__/no-fixtures-in-api-mode.test.tsx`。

## 交付物

- `.audit/web-fixtures-isolation-report.md`（含「Gating 语义（正交）」节与三次构建对照）
- `.audit/web-fixtures-isolation-report.checkpoint.md`（本文件）