# Roamlog 洞察图表服务端聚合设计

- 任务 ID: `INSIGHTS_SPEC`
- 日期: 2026-11-21
- 状态: 规格待评审（本文件不包含产品代码）
- 范围: `/w/[workspaceSlug]/insights` 的数据获取与服务端聚合
- 硬约束: **页面输出语义不变**；不改图表视觉、不引入新图表库、不做跨工作区聚合、不用 mock 数据冒充验收

---

## 0. 结论

1. 新增 `GET /v1/workspaces/{workspaceId}/insights`，一次返回洞察页所需的全部聚合结果。
2. 新增配套 `GET /v1/workspaces/{workspaceId}/insights/expenses.csv`，保留现有 CSV 导出，不让导出功能因为移除全量 expenses 而失效。
3. 服务端只做 **5 次 Prisma 调用**（工作区设置、可见旅行投影、支出事实聚合、预算事实聚合、日志事实聚合）。若 Prisma 对 `destinationsV2` 关系采用分离加载，最多 6 条 SQL；没有 N+1，没有分页，没有 100 趟 / 20 页截断。
4. 现有 `insights-model.ts` 的指标定义、排序、并列规则、币种口径、CSV 列顺序是唯一 source of truth；迁移时逐条对照，不重新发明指标。
5. v1 不引入 Redis。当前查询有索引且响应行数有界；等 p95 或数据库 CPU 证明需要时再加 TTL 缓存与写路径失效，不在本次范围。

---

## 1. 现状与问题

### 1.1 当前请求链路

`apps/web/components/charts/insights-data.ts:36-99`：

- `useTripsQuery(workspace?.id, { limit: 100 })` 只取前 100 趟旅行；
- `collectPages(adapter.fetchEntries, 20)` 最多翻 20 页、每页 100 条日志；
- 对每趟旅行创建一个 `useQueries`，每趟最多翻 20 页、每页 100 条支出；
- `tripsTruncated` 与 `truncated` 只用于显示黄条提示，不解决统计不完整。

`apps/web/components/charts/insights-workspace.tsx:73-92`：

- 在浏览器调用 `aggregateTripStats`、`annualTrips`、`monthlySpend`、`categoryTotals`、`budgetRows`、`heatmapRows`、`insightRecords`、`totalByCurrency`；
- `expenseCsv(expenses, trips)` 也在浏览器生成 CSV。

### 1.2 规模影响

最坏情况（100 趟、每趟 20 页支出）：

- 1 个 trips 请求；
- 1 个 entries 请求链（最多 20 个分页请求）；
- 100 个 expenses 请求链（最多 100 × 20 = 2,000 个分页请求）；
- 浏览器最多持有 100 趟 + 2,000 条日志 + 200,000 条支出并做多次全表扫描式 `filter`/`sort`。

超过 100 趟或 2,000 条日志后，页面统计只覆盖已加载数据，不是工作区全量。共享 fixture 当前只有 23 趟 / 18 条日志 / 20 笔支出（`.audit/port-completeness-audit.md:80`），所以小团队看不出问题；规模化后必现。

### 1.3 迁移不变量

以下行为必须逐条保持：

- `tripCount` 包含所有可见旅行，不按 `status` 过滤（愿望、计划、进行中、已完成都算）；
- `totalDays` 使用 `tripDurationDays(startDate, endDate)` 的包含首尾日算法；
- `countries` 统计 `Trip.countryCodes` 的去重数量，不从 `TripDestination.countryCode` 反推；
- `cities` 统计当前 `presentTrip` 投影出的 `destinations` 去重数量：优先 `destinationsV2`（`deletedAt: null`，按 `order, id`），为空时回退 `Trip.destinations`；
- `monthlySpend` 是“截至锚点月的最近 12 个自然月”，包含零值月份，标签 `MM月`；
- 主图只统计 `Workspace.defaultCurrency`；其他币种只进入 `currencyTotals` 的辅助展示；
- `categoryTotals` 只保留 `total > 0`，按金额降序；金额相同时按现有 `categoryLabels` 声明顺序；
- `budgetRows` 只取预算金额与预算币种都非空的旅行，按预算降序取前 6；金额相同时按旅行列表原顺序（`updatedAt desc, id asc`）；
- `insightRecords.highestBudget` 只要求 `budgetAmountMinor` 非空，`budgetCurrency` 可为空（与现有 `insightRecords` 一致；`budgetRows` 的规则更严）；
- `heatmapRows` 是日志数 + 支出数的年 × 12 月矩阵，年份为两者并集；
- `insightRecords` 的四项文案与并列规则不变；
- CSV 表头、列顺序、引号转义、分类中文名不变。

---

## 2. 端点

### 2.1 主端点

| 项 | 值 |
|---|---|
| 方法 | `GET` |
| 路径 | `/v1/workspaces/{workspaceId}/insights` |
| 认证 | 需要有效会话（`SessionGuard`） |
| 租户 | `TenantGuard` 校验 active workspace membership |
| 权限 | workspace member；Viewer 可读。Controller 要求 `trip:read`，Service 再断言 `entry:read`、`expense:read`、`budget:read` |
| 对象级过滤 | `tripVisibilityWhere`，与旅行列表、日志列表、支出详情完全同一套规则 |
| 分页 | 无。响应行数由年份、12 个月、6 个分类、6 条预算、币种数天然有界 |
| 缓存 | `Cache-Control: private, no-store`；客户端 React Query `staleTime: 30_000` 保持不变 |

Query 参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `month` | `YYYY-MM` | 否 | 最近 12 个月窗口的锚点月。Web 端传浏览器当前本地月，以严格保持现有 `new Date()` 语义；省略时服务端按 `Workspace.timezone` 计算当前月 |

不提供 `year` / `from` / `to`：现有页面没有年份筛选，年度旅行与热力图都返回全部年份；增加筛选会改变页面语义。

成功响应：`200 application/json`，`WorkspaceInsightsSchema`。

错误：

| HTTP | code | 触发条件 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `workspaceId` 不是 UUIDv7，或 `month` 不是 `YYYY-MM` |
| 401 | `UNAUTHENTICATED` | 无有效会话 |
| 403 | `WORKSPACE_ROLE_FORBIDDEN` | 角色缺少任一读取权限（当前 Viewer 不会触发） |
| 404 | `WORKSPACE_NOT_FOUND` | 非成员、工作区已删除或不存在（避免枚举） |
| 429 | `RATE_LIMITED` | 全局限流触发时 |
| 500 | `INTERNAL_ERROR` | 未预期错误 |

### 2.2 配套 CSV 端点

现有 `expenseCsv` 依赖浏览器里的全量 `expenses` 与 `trips`。移除全量拉取后，如果不同时提供服务端导出，导出按钮会静默失效或继续截断。因此本规格把 CSV 作为**必需的配套端点**，而不是可选增强。

| 项 | 值 |
|---|---|
| 方法 | `GET` |
| 路径 | `/v1/workspaces/{workspaceId}/insights/expenses.csv` |
| 权限 | `expense:read`；Viewer 可读 |
| 响应 | `200 text/csv; charset=utf-8`，`Content-Disposition: attachment; filename="roamlog-expenses.csv"`，`Cache-Control: no-store`，`X-Content-Type-Options: nosniff` |
| 过滤 | 与主端点完全相同的 workspace + `deletedAt: null` + 可见旅行过滤 |
| 分页 | 对外无分页；内部按 `date asc, id asc` 每批 500 条游标读取，流式写出 |
| 内容 | 表头精确为未加引号的 `日期,旅行,分类,备注,金额,币种`；数据行每格用双引号包裹，内部双引号双写；金额 `(amountMinor / 100).toFixed(2)`；行分隔 `\n`、无 BOM、不做公式前缀转义（与现有 `expenseCsv` 完全一致） |

CSV 顺序不是用户可见语义；为可复现，固定 `date asc, id asc`。当前实现按旅行顺序拼接，属于偶然顺序，不作为兼容目标。

Controller 必须先 `await` 第一批数据再写响应头，确保权限/校验/数据库错误仍能返回正常 problem JSON；之后逐批 `response.write`，最后 `end`。

CSV 的分类中文名必须与页面一致。实现时把 `apps/web/components/charts/insights-model.ts:3-10` 的 `categoryLabels` 提升为 `packages/contracts/src/entities/enums.ts` 的 `EXPENSE_CATEGORY_LABELS`，Web 的 `categoryLabels` 改为 re-export；API 的 CSV writer 直接使用同一常量。禁止在 API 里另抄一份中文映射。

不要直接复用 `apps/api/src/modules/admin/admin-csv.ts` 的 `csvValue`：它会加 BOM/CRLF 并对 `=+-@` 加前导单引号，改变现有导出内容。可以复用 `admin-users.controller.ts:39-64` 的“先取第一块再发响应头”的流式 controller 模式。

错误与主端点一致；如果响应头已发送后数据库失败，只能中断连接并记录日志，不能改成 4xx/5xx JSON。

---

## 3. 完整 Zod 契约

新建 `packages/contracts/src/api/insights.ts`。以下为建议的完整 schema；字段名、可空性、数组长度都按页面实际消费定义。

```ts
import { z } from "zod";

import { CountryCodeSchema, DateOnlySchema, UuidV7Schema } from "../common/ids";
import { AmountMinorSchema, CurrencyCodeSchema } from "../common/money";
import { ExpenseCategorySchema } from "../entities/enums";

export const InsightsMonthKeySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .describe("Calendar month in YYYY-MM form.");
export type InsightsMonthKey = z.infer<typeof InsightsMonthKeySchema>;

export const InsightsYearSchema = z
  .string()
  .regex(/^\d{4}$/)
  .describe("Calendar year in YYYY form.");
export type InsightsYear = z.infer<typeof InsightsYearSchema>;

export const InsightsQuerySchema = z
  .object({
    month: InsightsMonthKeySchema.optional(),
  })
  .strict();
export type InsightsQuery = z.infer<typeof InsightsQuerySchema>;

export const InsightsStatsSchema = z
  .object({
    tripCount: z.number().int().nonnegative(),
    totalDays: z.number().int().nonnegative(),
    countries: z.number().int().nonnegative(),
    cities: z.number().int().nonnegative(),
    years: z.array(InsightsYearSchema),
  })
  .strict();
export type InsightsStats = z.infer<typeof InsightsStatsSchema>;

export const InsightsAnnualTripsPointSchema = z
  .object({
    year: InsightsYearSchema,
    count: z.number().int().nonnegative(),
  })
  .strict();
export type InsightsAnnualTripsPoint = z.infer<typeof InsightsAnnualTripsPointSchema>;

export const InsightsMonthlySpendPointSchema = z
  .object({
    key: InsightsMonthKeySchema,
    label: z.string().min(1).max(8),
    amountMinor: AmountMinorSchema,
  })
  .strict();
export type InsightsMonthlySpendPoint = z.infer<typeof InsightsMonthlySpendPointSchema>;

export const InsightsCategoryTotalSchema = z
  .object({
    category: ExpenseCategorySchema,
    total: AmountMinorSchema,
  })
  .strict();
export type InsightsCategoryTotal = z.infer<typeof InsightsCategoryTotalSchema>;

export const InsightsBudgetRowSchema = z
  .object({
    tripId: UuidV7Schema,
    tripTitle: z.string().min(1),
    destination: z.string().nullable(),
    currency: CurrencyCodeSchema,
    budgetAmountMinor: AmountMinorSchema,
    spentAmountMinor: AmountMinorSchema,
    hasOtherCurrencySpend: z.boolean(),
  })
  .strict();
export type InsightsBudgetRow = z.infer<typeof InsightsBudgetRowSchema>;

export const InsightsHeatmapMonthSchema = z
  .object({
    key: InsightsMonthKeySchema,
    count: z.number().int().nonnegative(),
  })
  .strict();
export type InsightsHeatmapMonth = z.infer<typeof InsightsHeatmapMonthSchema>;

export const InsightsHeatmapRowSchema = z
  .object({
    year: InsightsYearSchema,
    months: z.array(InsightsHeatmapMonthSchema).min(12).max(12),
  })
  .strict();
export type InsightsHeatmapRow = z.infer<typeof InsightsHeatmapRowSchema>;

export const InsightsLongestTripSchema = z
  .object({
    tripId: UuidV7Schema,
    title: z.string().min(1),
    durationDays: z.number().int().positive(),
  })
  .strict();
export type InsightsLongestTrip = z.infer<typeof InsightsLongestTripSchema>;

export const InsightsHighestBudgetSchema = z
  .object({
    tripId: UuidV7Schema,
    title: z.string().min(1),
    budgetAmountMinor: AmountMinorSchema,
    currency: CurrencyCodeSchema.nullable(),
  })
  .strict();
export type InsightsHighestBudget = z.infer<typeof InsightsHighestBudgetSchema>;

export const InsightsMostVisitedCountrySchema = z
  .object({
    countryCode: CountryCodeSchema,
    tripCount: z.number().int().positive(),
  })
  .strict();
export type InsightsMostVisitedCountry = z.infer<typeof InsightsMostVisitedCountrySchema>;

export const InsightsRecordsSchema = z
  .object({
    longestTrip: InsightsLongestTripSchema.nullable(),
    highestBudget: InsightsHighestBudgetSchema.nullable(),
    mostVisitedCountry: InsightsMostVisitedCountrySchema.nullable(),
    lastEntryDate: DateOnlySchema.nullable(),
  })
  .strict();
export type InsightsRecords = z.infer<typeof InsightsRecordsSchema>;

export const InsightsCurrencyTotalSchema = z
  .object({
    currency: CurrencyCodeSchema,
    amountMinor: AmountMinorSchema,
  })
  .strict();
export type InsightsCurrencyTotal = z.infer<typeof InsightsCurrencyTotalSchema>;

export const WorkspaceInsightsSchema = z
  .object({
    workspaceId: UuidV7Schema,
    currency: CurrencyCodeSchema,
    month: InsightsMonthKeySchema,
    stats: InsightsStatsSchema,
    annualTrips: z.array(InsightsAnnualTripsPointSchema),
    monthlySpend: z.array(InsightsMonthlySpendPointSchema).min(12).max(12),
    categoryTotals: z.array(InsightsCategoryTotalSchema),
    budgetRows: z.array(InsightsBudgetRowSchema).max(6),
    heatmap: z.array(InsightsHeatmapRowSchema),
    records: InsightsRecordsSchema,
    currencyTotals: z.array(InsightsCurrencyTotalSchema),
    expenseCount: z.number().int().nonnegative(),
    currencyExpenseCount: z.number().int().nonnegative(),
  })
  .strict();
export type WorkspaceInsights = z.infer<typeof WorkspaceInsightsSchema>;
```

### 3.1 字段到 Prisma 的映射

| 响应字段 | 来源 |
|---|---|
| `workspaceId` | `Workspace.id` |
| `currency` | `Workspace.defaultCurrency` |
| `month` | query `month`；缺省时按 `Workspace.timezone` 计算 |
| `stats.tripCount` | 可见 `Trip` 行数 |
| `stats.totalDays` | 每趟 `tripDurationDays(startDate, endDate)` 求和 |
| `stats.countries` | 可见 `Trip.countryCodes` 去重计数 |
| `stats.cities` | 可见旅行投影出的 `destinations` 去重计数（`TripDestination.name` 优先，回退 `Trip.destinations`） |
| `stats.years` | 可见 `Trip.startDate` 的年份去重升序 |
| `annualTrips` | 按 `Trip.startDate` 年份计数，升序 |
| `monthlySpend` | `Expense.date` 的 `YYYY-MM` + `Expense.currency` + `SUM(Expense.amountMinor)`；固定 12 个桶 |
| `categoryTotals` | `Expense.category` + `Expense.currency` + `SUM(Expense.amountMinor)`；仅默认币种、仅 `> 0` |
| `budgetRows` | `Trip.budgetAmountMinor` / `Trip.budgetCurrency` + `Expense.tripId` / `Expense.currency` 的 `SUM(amountMinor)`；预算降序前 6 |
| `heatmap` | `JournalEntry.date` 计数 + `Expense.date` 计数，按年 × 12 月合并 |
| `records.longestTrip` | 可见旅行中 `durationDays` 最大；并列取 `updatedAt desc, id asc` |
| `records.highestBudget` | 可见旅行中 `budgetAmountMinor` 最大；并列取 `updatedAt desc, id asc`；`currency` 可空，保持旧逻辑只按金额筛选 |
| `records.mostVisitedCountry` | `Trip.countryCodes` 数组元素逐次计数（与 `stats.countries` 的 Set 去重不同）；并列按国家码升序 |
| `records.lastEntryDate` | 可见 `JournalEntry.date` 最大值 |
| `currencyTotals` | `Expense.currency` + `SUM(Expense.amountMinor)`；金额降序、币种升序 |
| `expenseCount` | 可见 `Expense` 行数（所有币种） |
| `currencyExpenseCount` | 可见 `Expense` 中 `currency = Workspace.defaultCurrency` 的行数 |

### 3.2 页面字段映射

| 页面位置 | 现在 | 迁移后 |
|---|---|---|
| 四个统计卡 | `aggregateTripStats(trips)` | `data.stats` |
| 年度旅行图 | `annualTrips(trips)` 的 `[year, count]` | `data.annualTrips`，Web 映射为 `[year, count]` |
| 月度支出图 | `monthlySpend(displayExpenses, currency)` | `data.monthlySpend` |
| 分类支出 | `categoryTotals(expenses, currency)` | `data.categoryTotals` |
| 预算构成 | `budgetRows(trips, expenses)` | `data.budgetRows` |
| 热力图 | `heatmapRows(entries, expenses)` | `data.heatmap` |
| 记录卡 | `insightRecords(trips, entries)` | `data.records` + Web 格式化 |
| 其他币种 | `totalByCurrency(expenses)` | `data.currencyTotals` |
| 总支出提示 | `expenses.length` / `displayExpenses.length` | `data.expenseCount` / `data.currencyExpenseCount` |
| CSV 导出 | `expenseCsv(expenses, trips)` | `GET .../insights/expenses.csv` |

---

## 4. Prisma 查询计划

### 4.1 共用可见性谓词

必须复用 `packages/db/src/trip-access.ts:200-230` 的 `tripVisibilityWhere`，不得复制一套 `visibility in [...]` 或管理员绕过逻辑。

```ts
const visibility = tripVisibilityWhere({
  userId: membership.userId,
  workspaceId: membership.workspaceId,
  platformRole: actor.user.platformRole,
});

const visibleTripWhere = {
  workspaceId: membership.workspaceId,
  deletedAt: null,
  ...visibility,
};

const visibleExpenseWhere = {
  workspaceId: membership.workspaceId,
  deletedAt: null,
  trip: {
    deletedAt: null,
    ...visibility,
  },
};

const visibleEntryWhere = {
  workspaceId: membership.workspaceId,
  deletedAt: null,
  trip: {
    deletedAt: null,
    ...visibility,
  },
};
```

说明：

- `tripVisibilityWhere` 对 `super_admin` 返回 `{}`，与现有旅行列表/日志/支出详情一致；不新增权限旁路。
- 软删除只过滤 `deletedAt`。Admin takedown 在 `applyModerationToTarget` 中同时写 `deletedAt` 与 `moderatedAt`（`apps/api/src/modules/reports/report-targets.ts:349-360`），所以不需要再单独加 `moderatedAt: null`，也不会把已下架内容统计进来。
- `JournalEntry` 与 `Expense` 都有 `workspaceId`，仍显式带上，保证租户隔离不依赖 join。

### 4.2 五次 Prisma 调用

五次 Prisma 调用可以并行执行；没有任何一条依赖另一条的结果。实际 SQL 可能是 5 条或 6 条（Prisma 关系加载策略可能把 `destinationsV2` 拆成单独查询），验收按“≤6 条 SQL”判定。

#### Q1. 工作区设置

```ts
prisma.workspace.findUnique({
  where: { id: membership.workspaceId },
  select: { defaultCurrency: true, timezone: true },
});
```

用于默认币种与 `month` 缺省值。`TenantGuard` 已保证工作区 active，不需要重复状态过滤。

#### Q2. 可见旅行投影（旅行维度）

```ts
prisma.trip.findMany({
  where: visibleTripWhere,
  select: {
    id: true,
    title: true,
    startDate: true,
    endDate: true,
    countryCodes: true,
    destinations: true,
    budgetAmountMinor: true,
    budgetCurrency: true,
    updatedAt: true,
    destinationsV2: {
      where: { deletedAt: null },
      orderBy: [{ order: "asc" }, { id: "asc" }],
      select: { name: true },
    },
  },
  orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
});
```

为什么旅行维度用一次投影，而不是 SQL `groupBy`：

- `durationDays` 不是数据库列，必须用 `tripDurationDays` 计算；用 SQL 计算日期差会复制一份契约算法。
- `countryCodes` 是 `text[]`，Prisma `groupBy` 只能按整个数组分组，不能 `unnest`。
- `cities` 依赖 `destinationsV2` 优先、`Trip.destinations` 回退的 presenter 规则，SQL 聚合会复制该规则。
- `budgetRows` 需要每趟旅行的标题、预算币种、首个目的地与 `updatedAt` 并列顺序。

因此旅行维度只做**一次有界投影**，在 API 进程内折叠；真正高基数的日志与支出全部在 SQL 聚合。这样既保持输出语义，又消除了浏览器全量拉取与 N+1。

风险边界：如果单工作区旅行数超过约 20,000，这次投影会占用较多内存；届时再引入按年 `groupBy` + 单独 records 查询或物化汇总表。v1 不做，避免过度设计。

#### Q3. 支出事实聚合（月 / 分类 / 币种 / 热力图）

```ts
prisma.expense.groupBy({
  by: ["date", "currency", "category"],
  where: visibleExpenseWhere,
  _sum: { amountMinor: true },
  _count: { _all: true },
});
```

一次查询同时提供：

- `currencyTotals`：按 `currency` 汇总 `_sum.amountMinor`；
- `monthlySpend`：只取 `currency = defaultCurrency`，按 `date` 的 `YYYY-MM` 汇总；
- `categoryTotals`：只取默认币种，按 `category` 汇总；
- `heatmap` 的支出部分：所有币种按 `date` 的 `YYYY-MM` 汇总 `_count._all`；
- `expenseCount`：所有分组 `_count._all` 之和；
- `currencyExpenseCount`：默认币种分组的 `_count._all` 之和。

分组行数上界约为“有支出的天数 × 币种数 × 6”，远小于支出行数；即使 20 年数据也通常是几万行以内。
所有 `_sum.amountMinor` 可能为 `null`（空组），折叠时统一 `?? 0`。

#### Q4. 预算事实聚合

```ts
prisma.expense.groupBy({
  by: ["tripId", "currency"],
  where: {
    ...visibleExpenseWhere,
    trip: {
      ...visibleExpenseWhere.trip,
      budgetAmountMinor: { not: null },
      budgetCurrency: { not: null },
    },
  },
  _sum: { amountMinor: true },
});
```

只扫描“有预算的可见旅行”的支出，按旅行 + 币种汇总。用于：

- `spentAmountMinor`：取 `currency === trip.budgetCurrency` 的汇总；
- `hasOtherCurrencySpend`：存在任一 `currency !== trip.budgetCurrency` 的分组；
- 预算行的支出金额不要求默认币种，保持现有“每趟按自己的预算币种统计”的口径。
- 没有支出分组的预算旅行，`spentAmountMinor = 0`、`hasOtherCurrencySpend = false`。

#### Q5. 日志事实聚合（热力图 / 最后日志）

```ts
prisma.journalEntry.groupBy({
  by: ["date"],
  where: visibleEntryWhere,
  _count: { _all: true },
});
```

用于热力图日志计数与 `records.lastEntryDate`（最大 `date`）。不需要拉取日志正文、标题或 HTML。

### 4.3 时区

- 业务日期都是 PostgreSQL `@db.Date`，API presenter 用 UTC 年月日输出 `YYYY-MM-DD`；现有前端所有分桶都是 `date.slice(0, 7)`，**日期分桶本身与时区无关**。
- 唯一受时区影响的是“最近 12 个月”的锚点：现有 `monthlySpend` 用浏览器本地 `new Date()` 取当前年月。
- 迁移后 Web 端把当前本地月作为 `?month=YYYY-MM` 传给 API，严格保持现有行为。
- API 省略 `month` 时，用 `Intl.DateTimeFormat("en-CA", { timeZone: workspace.timezone, year: "numeric", month: "2-digit" })` 得到 `YYYY-MM`；工作区默认 `Asia/Shanghai`。如果历史数据里的 timezone 非法导致 `RangeError`，回退 `Asia/Shanghai` 并记录 warning，不让整个洞察页 500。
- 12 个 key 用 UTC 的每月 1 日做月份加减（`Date.UTC`），避免 DST；不把 `@db.Date` 转成带时区时间戳。

### 4.4 币种

- `Workspace.defaultCurrency` 决定主图币种（月度、分类、总支出主数字）。
- 不做汇率换算。其他币种只出现在 `currencyTotals` 的“其他币种支出未折算”提示。
- 预算行使用每趟旅行自己的 `budgetCurrency`；`hasOtherCurrencySpend` 只表示“存在其他币种支出”，不折算。
- 现有页面“只统计 CNY”实际是“只统计 workspace.defaultCurrency”；若工作区默认币种不是 CNY，现有页面就统计该币种。本规格保持这一语义，不硬编码 CNY。

### 4.5 空工作区

返回 `200`，不是 404：

```json
{
  "workspaceId": "...",
  "currency": "CNY",
  "month": "2026-11",
  "stats": { "tripCount": 0, "totalDays": 0, "countries": 0, "cities": 0, "years": [] },
  "annualTrips": [],
  "monthlySpend": [12 个零值点],
  "categoryTotals": [],
  "budgetRows": [],
  "heatmap": [],
  "records": {
    "longestTrip": null,
    "highestBudget": null,
    "mostVisitedCountry": null,
    "lastEntryDate": null
  },
  "currencyTotals": [],
  "expenseCount": 0,
  "currencyExpenseCount": 0
}
```

Web 端仍用 `stats.tripCount === 0` 触发“还没有足够的旅行数据”空状态；有旅行但无日志/支出时，各面板显示各自的空状态，与现在一致。

### 4.6 索引与性能

现有索引足够 v1：

- `Trip @@index([workspaceId, status, startDate])`、`@@index([workspaceId, visibility])`：工作区旅行扫描与可见性过滤；
- `JournalEntry @@index([workspaceId, date])`、`@@index([tripId, date])`：日志按日期聚合；
- `Expense @@index([workspaceId, date])`、`@@index([tripId, date])`：支出按日期/旅行聚合。

不新增迁移。若真实 PG 的 `EXPLAIN (ANALYZE, BUFFERS)` 显示 Q3 因 `currency/category` 分组走大范围扫描，再评估 `@@index([workspaceId, currency, category])`；先有证据再加索引。

---

## 5. 与现有前端输出的兼容性

### 5.1 迁移映射

| 现有函数 | 迁移后 | 处理 |
|---|---|---|
| `aggregateTripStats(trips)` | `data.stats` | **删除聚合函数**。服务端按同一循环计算 `tripCount/totalDays/countries/cities/years` |
| `annualTrips(trips)` | `data.annualTrips` | **删除聚合函数**。Web 只把 `{year,count}` 映射成图表需要的 `[year,count]` |
| `monthlySpend(expenses, currency, now)` | `data.monthlySpend` | **删除聚合函数**。服务端生成 12 个 key/label/amount；Web 只保留 `formatMoney` |
| `categoryTotals(expenses, currency)` | `data.categoryTotals` | **删除聚合函数**。保留 `categoryLabels`、`categoryColors`、`categoryChartColors` 用于渲染 |
| `budgetRows(trips, expenses)` | `data.budgetRows` | **删除聚合函数**。`BudgetRow` 改为 `tripId/tripTitle/destination/...`，图表把 `row.trip.title` 改为 `row.tripTitle`，把 `row.trip.destinations[0] ?? "未设置目的地"` 改为 `row.destination ?? "未设置目的地"` |
| `heatmapRows(entries, expenses)` | `data.heatmap` | **删除聚合函数**。`HeatmapRow` 形状不变 |
| `insightRecords(trips, entries)` | `data.records` | **删除聚合/并列逻辑**。保留 `formatInsightRecords(records)`：`title ?? "—"`、`countryName(code) + " · N 段"`、`date ?? "—"` |
| `totalByCurrency(expenses)` | `data.currencyTotals` | **删除聚合函数**。Web 只按币种查找默认币种总额与“其他币种” |
| `expenseCsv(expenses, trips)` | CSV 端点 | **删除客户端 CSV 生成**。按钮改为下载服务端 CSV |
| `collectPages` / `useQueries` | 单次 insights 查询 | **删除**。页面不再请求 `/trips`、`/entries`、`/expenses` 做统计 |

保留为纯格式化/展示的函数：

- `formatMoney(amountMinor, currency)`；
- `countryName(code)`；
- `categoryLabels` / `categoryColors` / `categoryChartColors`；
- `formatInsightRecords(records)`；
- 图表组件的 tooltip、颜色、空状态文案、Recharts 配置。

`formatInsightRecords` 必须逐字保持现有输出：

```ts
function formatInsightRecords(records: InsightsRecords) {
  return {
    longestTrip: records.longestTrip?.title ?? "—",
    highestBudget: records.highestBudget?.title ?? "—",
    mostVisitedCountry: records.mostVisitedCountry
      ? `${countryName(records.mostVisitedCountry.countryCode)} · ${records.mostVisitedCountry.tripCount} 段`
      : "—",
    lastEntryDate: records.lastEntryDate ?? "—",
  };
}
```

### 5.2 并列规则

服务端必须显式排序，不能依赖 SQL 默认顺序：

- `annualTrips` / `stats.years` / `heatmap` 年份：字符串升序；
- `categoryTotals`：`total desc`，再按 `["transport","stay","food","activity","shopping","other"]` 顺序；
- `budgetRows`：`budgetAmountMinor desc, updatedAt desc, id asc`，取 6；
- `records.longestTrip`：`durationDays desc, updatedAt desc, id asc`；
- `records.highestBudget`：`budgetAmountMinor desc, updatedAt desc, id asc`；
- `records.mostVisitedCountry`：`tripCount desc, countryCode asc`；
- `currencyTotals`：`amountMinor desc, currency asc`（等额时币种顺序是唯一被规范化的偶然顺序；不影响金额与文案，只影响“其他币种”列表的并列顺序）。

### 5.3 页面状态

- 加载：`workspacesQuery.isLoading || insightsQuery.isLoading` → 现有 `InsightsLoading`；
- 错误：工作区或 insights 任一失败 → 现有“洞察暂时不可用 / 洞察数据读取失败”错误态，重试同时 refetch 两个 query；
- 空：`stats.tripCount === 0` → 现有“还没有足够的旅行数据”；
- 截断提示：**删除** `tripsTruncated || truncated` 黄条；服务端返回全量后不再存在该状态；
- 导出：`expenseCount === 0` 时禁用；点击后请求 CSV 端点，成功 notice 使用 `expenseCount`。

---

## 6. 分页、上限与缓存

### 6.1 上限如何被消除

- 旅行：Q2 一次 `findMany` 返回全部可见旅行，没有 `limit: 100`。
- 日志：Q5 `groupBy` 只返回日期计数，不返回日志行；没有 20 页上限。
- 支出：Q3/Q4 `groupBy` 只返回聚合组；没有每趟 20 页上限，也没有 N+1。
- 响应：`annualTrips` 年数、`heatmap` 年数、`monthlySpend` 12、`categoryTotals` ≤6、`budgetRows` ≤6、`currencyTotals` 币种数；没有游标。

### 6.2 缓存

v1 **不引入 Redis**：

- 五条查询都是 workspace 范围、走现有索引、返回行数有界；
- Redis 失效需要覆盖 trip/entry/expense/destination/budget 的所有写路径，漏一个就会显示过期统计；
- 现有 React Query `staleTime: 30_000` 已避免页面内频繁重复请求；
- HTTP 响应设 `private, no-store`，避免用户编辑后浏览器缓存旧聚合。

触发再评估的条件（写进后续运维观察，不本次实现）：

- p95 > 500ms 或 DB CPU 持续 > 70%；
- 单工作区旅行 > 20,000 或支出 > 500,000；
- 页面切换频繁导致同一工作区每分钟多次聚合。

届时的最小方案：Redis key `insights:{workspaceId}:{month}:{currency}`，TTL 60s；在 trip/entry/expense/destination 写事务提交后按 workspace 删除 key；权限变化（成员/可见性）也删除。不要做全量缓存或跨工作区缓存。

---

## 7. 契约与代码生成步骤

严格按以下顺序，避免 OpenAPI 与 Orval 漂移：

1. 新建 `packages/contracts/src/api/insights.ts`（第 3 节 schema）。
2. 在 `packages/contracts/src/api/index.ts` 导出 `./insights.js`。
3. 在 `packages/contracts/scripts/openapi/schemas.ts` 注册新增 schema（`WorkspaceInsightsSchema`、`InsightsQuerySchema` 等）。
4. 新建 `packages/contracts/scripts/openapi/paths-insights.ts`，用 `registerOperation` 注册：
   - `getWorkspaceInsights`：`GET /v1/workspaces/{workspaceId}/insights`，tag `Insights`，query `InsightsQuerySchema`，response `WorkspaceInsightsSchema`；
   - `exportWorkspaceInsightsExpenses`：`GET /v1/workspaces/{workspaceId}/insights/expenses.csv`，tag `Insights`，response `z.string()`，`responseContentType: "text/csv"`。
5. 在 `packages/contracts/scripts/generate-openapi.ts` 导入并注册该 paths 文件，并加入 `Insights` tag。
6. 运行：

   ```bash
   pnpm contracts:generate
   pnpm api-client:generate
   pnpm contracts:check
   ```

   产物：
   - `packages/contracts/openapi.json`
   - `packages/api-client/src/generated/endpoints/insights/insights.ts`
   - `packages/api-client/src/generated/schemas/*`

7. Web adapter 从 `@roamlog/api-client` 导入生成的 `getWorkspaceInsights` / `exportWorkspaceInsightsExpenses`，用 `unwrap(..., WorkspaceInsightsSchema, path)` 解析。若 Orval 的 fetch client 对 `text/csv` 生成 JSON 解析而不是返回字符串，CSV 下载改为同源 `fetch` + `credentials: "include"`（路径与 OpenAPI 保持一致），不要为了绕过类型而改响应为 JSON。
8. MSW：
   - 当前 `packages/api-mocks` 的 package 描述是 “Playwright fixtures only; not imported by any app.”，运行时没有 MSW worker；本任务**不需要**给 Web 加 MSW handler。
   - 如果未来组件/视觉测试使用 `packages/api-mocks`，在 Orval 生成之后再加 `http.get("/v1/workspaces/:workspaceId/insights", ...)`，fixture 必须通过 `WorkspaceInsightsSchema.parse`。
   - E2E 验收必须走真实 API + PostgreSQL，不得用该 handler 冒充。

---

## 8. 测试计划

### 8.1 API 单测（不连数据库）

`apps/api/src/modules/insights/__tests__/insights.service.spec.ts`：

- 空工作区：全零、12 个零值月、records 全 null；
- 101 趟旅行：`tripCount = 101`，不再被 100 截断；
- `totalDays` 包含首尾日，跨年旅行正确；
- `countries` 按 `countryCodes` 去重；同一旅行重复 code 按现有 `Set` 语义只算一次；
- `cities` 优先 `destinationsV2`，为空回退 `destinations`；
- `annualTrips` 跨年、年份升序；
- `monthlySpend` 跨年边界（如 `2026-01` 锚点包含 `2025-02` 到 `2026-01`）、零值月份、只算默认币种；
- `categoryTotals` 金额降序、并列按声明顺序、零金额分类不返回；
- `budgetRows` 只取预算双非空、按预算降序、并列按 `updatedAt desc, id asc`、最多 6、其他币种标记；
- `heatmap` 年份并集、12 个月、日志 + 支出计数；
- `records` 最长旅行/最高预算并列、国家次数并列（同一趟的重复 `countryCodes` 逐次计数）、最后日志日期；
- `currencyTotals` 多币种、默认币种总额、其他币种提示数据；
- `expenseCount` / `currencyExpenseCount` 区分所有币种与默认币种。

`apps/api/src/modules/insights/__tests__/insights.repository.spec.ts`（mock Prisma）：

- Q2 `where` 含 `workspaceId`、`deletedAt: null`、`tripVisibilityWhere`；
- Q3/Q4/Q5 的 `where` 含同样的可见性过滤，Q4 额外含预算双非空；
- 断言只调用 5 个 Prisma 方法，没有任何 per-trip 查询；
- 断言 `destinationsV2` 过滤 `deletedAt: null` 并按 `order,id`。

### 8.2 真实 PostgreSQL 集成测试

使用现有 `ROAMLOG_TEST_DATABASE_URL` 约定（参考 `packages/db/src/__tests__/seed.integration.test.ts:5-12`）。新建 `apps/api/src/modules/insights/__tests__/insights.integration.spec.ts`：

- 建独立 workspace，至少 101 趟旅行、2,001 条日志、跨 3 个币种、跨 3 个年份的支出；
- 造 private / custom / workspace 三种可见性，以及被邀请的 Viewer；
- 造软删除 trip/entry/expense 与被 admin takedown 的内容；
- 用 Nest 测试应用发真实 HTTP 请求（带 Viewer 会话），断言：
  - 200 且响应通过 `WorkspaceInsightsSchema.parse`；
  - 101 趟全部计入；
  - 2,001 条日志全部计入热力图；
  - 每趟超过 100 条支出全部计入；
  - 非授权 private/custom 不计入，授权参与者计入；
  - 软删除/下架内容不计入；
  - Viewer 200，非成员 404，非法 month 400；
  - 空工作区 200 全零；
  - 响应中 `budgetRows.length <= 6`、`monthlySpend.length === 12`；
- 查询计数：用 Prisma query event 或测试包装器断言一次请求 ≤6 条 SQL（工作区 + 旅行投影 + 3 个聚合，允许关系加载多 1 条），且不存在 `tripId = ...` 的逐趟查询。
- CSV：`GET .../insights/expenses.csv` 返回 200、`text/csv`、表头精确、行数等于可见支出数、引号/逗号/换行转义正确、软删除不出现。

### 8.3 契约测试

- `packages/contracts` 单测：`WorkspaceInsightsSchema` 接受完整响应、拒绝缺失 12 个月、拒绝负数金额、拒绝非 UUIDv7、拒绝未知字段（`.strict()`）。
- `pnpm contracts:check`：OpenAPI 与生成客户端无 drift。
- OpenAPI 快照/断言：存在两个 path、`Insights` tag、CSV content type。
- Orval 生成函数可被 `apps/web/lib/api/real.ts` 导入并通过 typecheck。

### 8.4 Web 单测

`apps/web/components/charts/insights-workspace.test.tsx` 重写为：

- 只 mock `adapter.fetchWorkspaceInsights`（新方法），返回真实形状的 `WorkspaceInsights`；
- 断言统计卡、年度图、月度图、分类、预算、热力图、记录卡文本；
- 断言 `fetchTrips` / `fetchEntries` / `fetchExpenses` **没有被调用**；
- 空态：`stats.tripCount = 0`；
- 加载态：query pending；
- 错误态：`fetchWorkspaceInsights` reject → 错误文案 + 重试成功；
- 导出：`expenseCount = 0` 禁用；`>0` 点击调用 CSV 方法并显示 notice；
- 不再出现“最多加载前 100 趟旅行与 20 页记录”黄条；
- 图表 `data-slot="chart"` / Recharts surface 数量不变（视觉回归由 E2E 兜底）。

`apps/web/components/charts/insights-charts.test.tsx`：只改 `BudgetRow` 字段（`tripTitle`、`destination`），断言渲染不变。

### 8.5 Playwright E2E（真实栈）

新增 `e2e/live/insights.spec.ts`，加入 `playwright.live.config.ts` 的 `web-live` project，打 `@insights` tag。使用真实 dev/prod Web + 真实 API + 真实 PostgreSQL + 真实登录态：

1. 用 live fixture 的 owner 账号创建/准备一个工作区，写入 3 趟旅行、5 条日志、6 笔支出（含 CNY + USD、跨年、含预算）。
2. 打开 `/w/{slug}/insights`，断言：
   - 统计卡数字来自真实数据；
   - 年度、月度、分类、预算、热力图五个面板可见；
   - 记录卡显示最长旅行、最高预算、最常去国家、最后日志日期；
   - 不再出现截断黄条；
   - 刷新后数字不变（持久化）；
   - 桌面 1440×1000 截图。
3. 切到 390×844，断言无横向溢出、图表/统计卡可见，截图。
4. CSV：点击导出，`page.waitForEvent("download")`，读取文件断言表头与行数；或直接 `page.request.get` 断言 content-type。
5. 空态：新建空工作区，打开 insights，断言“还没有足够的旅行数据”，截图。
6. 错误态：`page.route("**/v1/workspaces/*/insights*", route => route.abort())`，断言错误态与重试按钮；这是唯一允许的浏览器网络 stub，报告注明。
7. Viewer：owner 通过真实邀请 API 邀请 viewer 账号；viewer 登录后打开 insights，断言 200/页面可见/无写操作；截图。
8. 截图存 `.audit/insights-aggregation/`：`desktop.png`、`mobile.png`、`empty.png`、`error.png`、`viewer.png`，全部来自当前代码版本与真实数据。

使用 `e2e/live` 的隔离 fixture 账号与 workspace，测试结束走现有 teardown/cleanup；不要污染共享开发工作区。

验收命令：

```bash
pnpm e2e:live --grep @insights
```

### 8.6 截图与报告

- 桌面 1440px + 移动 390px；
- 每张截图必须能看到真实工作区名称/数字，不能是设计稿或 mock；
- 报告引用 `.audit/insights-aggregation/*.png`；
- 报告写明唯一 stub：错误态的 `page.route` 网络中断；其余全部真实。

---

## 9. 实施拆分

### Task INSIGHTS-1: 契约 + API + CSV

| 项 | 内容 |
|---|---|
| 依赖 | 无 |
| 目标 | 交付 `WorkspaceInsightsSchema`、两个端点、5 次 Prisma 调用、权限/错误/CSV、契约与 API 测试 |
| 可写文件 | `packages/contracts/src/api/insights.ts`（新）、`packages/contracts/src/api/index.ts`、`packages/contracts/src/entities/enums.ts`（新增共享 `EXPENSE_CATEGORY_LABELS`）、`packages/contracts/scripts/openapi/schemas.ts`、`packages/contracts/scripts/openapi/paths-insights.ts`（新）、`packages/contracts/scripts/generate-openapi.ts`、`packages/contracts/openapi.json`、`packages/api-client/src/generated/**`、`apps/api/src/modules/insights/**`（新）、`apps/api/src/app.module.ts`、`packages/api-mocks/src/handlers.ts`（可选，不得用于验收） |
| 禁止触碰 | `apps/web/**`、`e2e/**`、`packages/db/prisma/**`、任何迁移、AGENTS.md |
| 必须实现 | 第 2/3/4 节；Viewer 可读；5 次 Prisma 调用（SQL ≤6）；无 N+1；CSV 流式；错误码；OpenAPI/Orval；Web/API 共用 `EXPENSE_CATEGORY_LABELS` |
| 非目标 | 不改图表、不加 Redis、不加数据库索引/迁移、不做跨工作区 |
| 验收 | `pnpm contracts:generate && pnpm api-client:generate && pnpm contracts:check`；`pnpm --filter @roamlog/api test`；真实 PG 集成测试 101 趟/2,001 日志通过；Prisma 调用 5 次、SQL ≤6；Viewer 200；CSV 行数正确 |
| 验证命令 | `pnpm --filter @roamlog/contracts test`；`pnpm --filter @roamlog/api test`；`pnpm --filter @roamlog/api typecheck`；`ROAMLOG_TEST_DATABASE_URL=... pnpm --filter @roamlog/api test -- insights` |
| 交付格式 | 第 9 节子 Agent 模板 + `移植来源:` + `CodeGraph 证据:` |

### Task INSIGHTS-2: Web 接入

| 项 | 内容 |
|---|---|
| 依赖 | INSIGHTS-1 的契约与生成客户端 |
| 目标 | 洞察页改为单次 insights 查询；删除全量拉取、浏览器聚合、截断提示；CSV 走服务端 |
| 可写文件 | `apps/web/lib/api/types.ts`、`apps/web/lib/api/real.ts`、`apps/web/lib/query.ts`、`apps/web/components/charts/insights-data.ts`、`insights-workspace.tsx`、`insights-model.ts`、`insights-charts.tsx`、`insights-workspace.test.tsx`、`insights-charts.test.tsx`、`apps/web/test/fake-data.ts`（仅补 `fetchWorkspaceInsights` / CSV fake） |
| 禁止触碰 | `apps/api/**`、`packages/contracts/**`（除消费生成类型）、`packages/db/**`、`e2e/**` |
| 必须实现 | 新 adapter 方法 + `useWorkspaceInsightsQuery`；`useInsightsData` 单查询；`data.stats/annualTrips/monthlySpend/categoryTotals/budgetRows/heatmap/records/currencyTotals` 映射；`BudgetRow` 字段调整；CSV 下载；加载/错误/空态；删除 `collectPages`/`useQueries`/`expenseCsv`/截断黄条 |
| 非目标 | 不改图表视觉/动画/颜色；不引入图表库；不改其他页面 |
| 验收 | Web 单测通过；页面只发 1 个 insights 请求，不调用 `fetchTrips/fetchEntries/fetchExpenses`；桌面/移动渲染与现有截图一致（除删除截断黄条）；CSV 可下载 |
| 验证命令 | `pnpm --filter @roamlog/web test -- insights`；`pnpm --filter @roamlog/web typecheck`；`pnpm --filter @roamlog/web lint` |
| 交付格式 | 第 9 节子 Agent 模板 + `移植来源:` + `CodeGraph 证据:` |

### Task INSIGHTS-3: 真实栈 E2E + 截图

| 项 | 内容 |
|---|---|
| 依赖 | INSIGHTS-1 + INSIGHTS-2 |
| 目标 | 在真实 Web/API/PostgreSQL/登录态上验收主路径、空态、错误态、Viewer、CSV、刷新持久化，并交付截图 |
| 可写文件 | `e2e/live/insights.spec.ts`（新）、`playwright.live.config.ts`、`.audit/insights-aggregation/**` |
| 禁止触碰 | 产品代码、契约、数据库 schema、其他 E2E |
| 必须实现 | 第 8.5 节；真实数据；桌面 1440 + 移动 390；截图；报告 |
| 非目标 | 不用 MSW/mock 冒充验收；不改产品 UI 来让测试通过 |
| 验收 | `pnpm e2e:live --grep @insights` 通过；截图来自当前代码；报告写明唯一网络 stub |
| 验证命令 | `pnpm e2e:live --grep @insights`；`pnpm e2e:live`（回归） |
| 交付格式 | 第 9 节子 Agent 模板 + `移植来源:` + `CodeGraph 证据:` |

---

## 10. 非目标与风险

### 10.1 非目标

- 不改图表视觉、布局、颜色、动画、Recharts 配置；
- 不引入新图表库；
- 不做跨工作区聚合；
- 不做汇率换算；
- 不做任意年份/日期范围筛选（只保留 `month` 作为 12 个月锚点）；
- 不做异步导出 worker；CSV 同步流式返回；
- 不新增 Redis；
- 不新增数据库迁移/索引（除非后续有 EXPLAIN 证据）；
- 不伪造数据、不用 MSW 作为验收数据源；
- 不改动旅行可见性规则。

### 10.2 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 单工作区旅行数极大（>20k） | Q2 投影占内存 | v1 接受；监控响应时间/内存；超过阈值改为 SQL 年度聚合 + 单独 records 查询或物化表 |
| 支出事实 Q3 分组扫描较宽 | 大工作区 p95 升高 | 现有 `(workspaceId,date)` 索引；先测 EXPLAIN；必要时加 `(workspaceId,currency,category)` 索引或 Redis 60s |
| `currencyTotals` 等额排序与旧插入顺序不同 | 仅“其他币种”并列顺序变化 | 金额与文案不变；规格明确为确定性 tie-break |
| CSV 分类中文名在 API 重复维护 | 文案漂移 | 把 `EXPENSE_CATEGORY_LABELS` 提到 `packages/contracts` 共享；Web/API 同源 |
| `month` 由 Web 本地时区传入 | 与工作区时区不同的用户窗口略有差异 | 这是现有浏览器行为；API 缺省用工作区时区；E2E 固定 `Asia/Shanghai` |
| `budgetCurrency` 为空但金额非空 | 预算行无法生成 | 现有页面要求两者都非空；规格保持；数据层应保证成对写入 |
| CSV 流中途失败 | 无法改 HTTP 状态 | 记录错误并中断；客户端提示下载失败；导出不是幂等关键路径 |
| CSV 公式注入 | 备注以 `=+-@` 开头时可能被表格软件执行 | 现有 `expenseCsv` 就没有防护；本任务为保持输出不变不修，另开安全任务评估是否统一采用 `admin-csv` 的 `csvValue` |
| Viewer 导出权限 | 产品可能不想让 Viewer 导出 | 本规格按“只读下载”保留；若产品否决，需单独任务加 `export:create` 权限判断 |
| Super Admin 可见所有工作区旅行 | 统计包含 private/custom | 这是现有 `tripVisibilityWhere` 行为；不新增旁路，也不收紧 |

---

## 11. 移植来源

本规格没有引入外部聚合实现；指标定义、排序、币种口径、CSV 格式全部移植自当前前端与现有 API 权限模式。仓库 commit：`fd9248c9f2b0f1be7c034322632101d2bd5c0e64`（2026-11-21）。

| 来源 | 文件:行号 | 移植内容 |
|---|---|---|
| 当前前端指标 | `apps/web/components/charts/insights-model.ts:73-265` | `aggregateTripStats`、`annualTrips`、`monthlySpend`、`categoryTotals`、`budgetRows`、`heatmapRows`、`insightRecords`、`totalByCurrency`、`expenseCsv` 的完整语义 |
| 当前前端请求 | `apps/web/components/charts/insights-data.ts:14-99` | 100 趟、20 页、每趟 expenses、`tripsTruncated`/`truncated` 的现状 |
| 当前页面组合 | `apps/web/components/charts/insights-workspace.tsx:57-118, 195-330` | 统计卡、币种、空态、错误态、导出、截断黄条 |
| 图表输入 | `apps/web/components/charts/insights-charts.tsx:1-380` | `AnnualTripsChart`、`MonthlySpendChart`、`CategoryMixChart`、`BudgetCompositionChart`、`Heatmap` 的 props |
| 旅行列表与可见性 | `apps/api/src/modules/trips/trips.service.ts:135-189` | `tripVisibilityWhere` 与 `updatedAt desc, id asc` 的列表语义 |
| 可见性谓词 | `packages/db/src/trip-access.ts:200-230` | `tripVisibilityWhere` 的唯一实现 |
| 日志可见性 | `apps/api/src/modules/entries/entries.service.ts:60-81` | entry 列表如何嵌套 `tripVisibilityWhere` |
| 支出读取 | `apps/api/src/modules/expenses/expenses.service.ts:58-80` | `expense:read` + `requireTrip` 的对象级检查 |
| 审核下架 | `apps/api/src/modules/reports/report-targets.ts:349-360` | takedown 同时写 `deletedAt`/`moderatedAt`，解释为何只过滤 `deletedAt` |
| CSV 流式响应 | `apps/api/src/modules/admin/admin-users.controller.ts:39-64` | 先取第一块再发响应头、逐块写出、`Cache-Control: no-store` 的实现模式（不移植其 BOM/公式转义） |
| 数据模型 | `packages/db/prisma/schema.prisma:402-470, 579-614, 823-850` | Trip / JournalEntry / Expense 字段与索引 |
| 契约风格 | `packages/contracts/src/api/expenses.ts:1-35`、`packages/contracts/src/common/money.ts:1-25` | `AmountMinorSchema`、`CurrencyCodeSchema`、分页/查询 schema 风格 |
| 权限矩阵 | `packages/contracts/src/permissions.ts:243-262` | Viewer 的只读 action 集合包含 `entry:read`/`expense:read`/`budget:read` |

外部来源：无。未引用任何第三方聚合实现或算法；Prisma 版本为 `7.10.1`（`packages/db/package.json`），只使用其 `findMany` / `groupBy` / `findUnique` 公共 API。

---

## 12. CodeGraph 证据

```text
$ cd /c/Users/BY9700/Desktop/UI/roamlog && codegraph status
[OK] Index is up to date
（索引统计：function 5,063 / constant 4,385 / type_alias 3,307 / file 2,152 /
  method 1,503 / interface 1,036 / class 270 / route 225 / component 44；
  typescript 1,742 / tsx 333 / javascript 75）

$ codegraph explore "insights aggregateTripStats monthlySpend categoryTotals heatmapRows insightRecords"
Found 35 symbols across 5 files.

Blast radius:
- categoryTotals (apps/web/components/charts/insights-model.ts:138)
  — 2 callers in apps/web/components/charts/insights-workspace.tsx;
  tested via apps/web/components/charts/insights-workspace.test.tsx
- aggregateTripStats (apps/web/components/charts/insights-model.ts:73)
  — 2 callers in apps/web/components/charts/insights-workspace.tsx;
  tested via apps/web/components/charts/insights-workspace.test.tsx
- heatmapRows (apps/web/components/charts/insights-model.ts:190)
  — 2 callers in apps/web/components/charts/insights-workspace.tsx;
  tested via apps/web/components/charts/insights-workspace.test.tsx
- insightRecords (apps/web/components/charts/insights-model.ts:219)
  — 2 callers in apps/web/components/charts/insights-workspace.tsx;
  tested via apps/web/components/charts/insights-workspace.test.tsx

Relationships:
- InsightsWorkspace → categoryTotals / aggregateTripStats / annualTrips /
  budgetRows / heatmapRows / insightRecords / totalByCurrency
- categoryTotals → categoryLabels / ExpenseCategory / ExpenseWithSplits
- insightRecords → Trip / JournalEntry
```

补充只读证据：

- `apps/web/components/charts/insights-data.ts:39-68` 确认 `limit: 100`、`maxPages = 20`、每趟一个 `useQueries`；
- `apps/web/components/charts/insights-workspace.tsx:73-92` 确认所有聚合在浏览器执行；
- `apps/api/src/modules` 当前没有 `insights` 目录；`packages/contracts/src/api` 当前没有 `insights.ts`；
- 本地 PostgreSQL 在规格编写时未启动（`localhost:5432` 连接被拒绝），因此没有实时行数 SQL；共享 fixture 数据量采用 `.audit/port-completeness-audit.md:80` 的 23 趟 / 18 条日志 / 20 笔支出记录。

---

## 13. 规格验收清单

- [ ] 端点、权限、错误码完整；
- [ ] Zod 响应 schema 完整且字段可空性明确；
- [ ] 每个字段能追溯到 Prisma 模型/聚合；
- [ ] 5 次 Prisma 调用、SQL ≤6、无 N+1、无分页上限；
- [ ] 时区、软删除、可见性、币种、空工作区均有明确规则；
- [ ] 至少 3 个现有函数有迁移映射（本规格覆盖全部 9 个）；
- [ ] CSV 导出不回归；
- [ ] 契约/OpenAPI/Orval/MSW 顺序明确；
- [ ] API 单测 + 真实 PG 集成 + 契约 + Web 单测 + Playwright 计划完整；
- [ ] 实施拆分为 3 个可独立验收任务；
- [ ] 非目标与风险明确；
- [ ] `移植来源:` 与 `CodeGraph 证据:` 已附。
