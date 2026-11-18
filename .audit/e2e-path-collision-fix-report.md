# E2E 路径碰撞修复报告

- 任务 ID: `E2E_PATH_COLLISION_FIX`
- 角色: `qa_verifier`
- 仓库: `C:\Users\BY9700\Desktop\UI\roamlog`
- 基线 commit: `687b8a5`（`main`，工作区起点为空）
- 失败用例: CI run 44341514026 → `[api] › e2e/g3-api/journeys.spec.ts:121:3 › G0 environment gates`
  → `ENOENT: no such file or directory, open '.../.e2e-live/fixture.json'`

## 1. 根因复核（确认）

`playwright.config.ts` 三个 project 的 `testMatch` 均为**未锚定子串正则**（`od -c` 实测为单反斜杠 `\/`，非双写）：

```ts
{ name: "web",   testMatch: /web\/.*\.spec\.ts/ },
{ name: "admin", testMatch: /admin\/.*\.spec\.ts/ },
{ name: "api",   testMatch: /api\/.*\.spec\.ts/ },
```

`e2e/g3-api/journeys.spec.ts` 的路径含有子串 `api/journeys.spec.ts` → 被 `api` project 命中。
该 spec 的 fixture 由 `playwright.g3.config.ts` 的 `g3-setup` project 生成，单跑主配置必然 ENOENT。

## 2. 变更文件（`git mv` 前后对照）

`git status --porcelain`（最终态，仅此 4 条，无未跟踪文件）：

```
R  e2e/g3-api/g3.setup.ts       -> e2e/g3live/g3.setup.ts
R  e2e/g3-api/g3.teardown.ts    -> e2e/g3live/g3.teardown.ts
RM e2e/g3-api/journeys.spec.ts  -> e2e/g3live/journeys.spec.ts
 M playwright.g3.config.ts
```

`git diff HEAD -M --stat`（内容改动量）：

```
 e2e/{g3-api => g3live}/g3.setup.ts      |  0
 e2e/{g3-api => g3live}/g3.teardown.ts   |  0
 e2e/{g3-api => g3live}/journeys.spec.ts | 16 +++++++++++++++-
 playwright.g3.config.ts                 |  2 +-
 4 files changed, 16 insertions(+), 2 deletions(-)
```

- `playwright.g3.config.ts`：仅 `testDir: "./e2e/g3-api"` → `"./e2e/g3live"`（唯一一行）。
- `e2e/g3live/journeys.spec.ts`：新增 `existsSync` / `LIVE_FIXTURE_FILE` 两个 import + 一个 guard（13 行注释与代码），**未改动任何产品断言**。
- 相对 import 深度不变（`../live-support/fixture`、`../../packages/db/node_modules/pg` 原样有效）；`grep -rn "g3-api"`（排除 `.audit/`）仅剩 `playwright.g3.config.ts:47`，已改。
- 保留未改（有意）：`.audit/evidence/g3-api` 证据目录名（spec 的 `EVIDENCE` 常量 + config 的 `reporter`/`outputDir`）——它是产物路径，不参与 project 匹配，改名会破坏既有证据链接；如需统一命名建议另开任务。
- 行尾：改名后文件一度为 CRLF，已还原为 LF（`git ls-files --eol` = `i/lf w/lf attr/text eol=lf`），与同目录其它文件一致，提交不会出现整文件换行噪声。

## 3. 验证命令与结果（含改名前 / 改名后原始输出）

### 3.1 改名前基线：`pnpm exec playwright test --list --project=api`

**修复前 12 tests / 2 files，其中 10 条是 g3 用例（复现成功）**：

```
Listing tests:
  [api] › api\smoke.spec.ts:12:1 › API health responds with HTTP 200
  [api] › api\smoke.spec.ts:22:1 › unauthenticated admin metrics are rejected with HTTP 401
  [api] › g3-api\journeys.spec.ts:121:3 › G3 live-base journeys › G0 environment gates (must pass before any product assertion)
  [api] › g3-api\journeys.spec.ts:145:3 › G3 live-base journeys › J1 register + login + session cookie + reload
  [api] › g3-api\journeys.spec.ts:187:3 › G3 live-base journeys › J2 create trip with every field
  [api] › g3-api\journeys.spec.ts:227:3 › G3 live-base journeys › J3 page echo matches PostgreSQL
  [api] › g3-api\journeys.spec.ts:284:3 › G3 live-base journeys › J4 edit sends only changed fields and reloads
  [api] › g3-api\journeys.spec.ts:330:3 › G3 live-base journeys › J5 seven workbench tabs issue real requests
  [api] › g3-api\journeys.spec.ts:366:3 › G3 live-base journeys › J6 share link opens anonymously without storage internals
  [api] › g3-api\journeys.spec.ts:426:3 › G3 live-base journeys › J8 concurrent edit produces a 409 conflict
  [api] › g3-api\journeys.spec.ts:448:3 › G3 live-base journeys › J9 mobile 390x844 has no horizontal overflow
  [api] › g3-api\journeys.spec.ts:468:3 › G3 live-base journeys › J7 viewer cannot write and cannot see the share tab (blocked: invitation 503 without SMTP)
Total: 12 tests in 2 files
```

基线阶段主配置全量：`Total: 68 tests in 20 files`。

### 3.2 改名后：`pnpm exec playwright test --list --project=api 2>&1 | grep -i "g3"`

```
<<< 0 g3 lines >>>
```

```
Total: 2 tests in 1 file
```

→ **12 tests/2 files → 2 tests/1 file**，g3 用例 0 条，CI 的 `e2e:api` 不再收集该文件。

### 3.3 正确 config 仍可列出：`pnpm exec playwright test --config=playwright.g3.config.ts --list`

```
Listing tests:
  [g3-setup] › g3.setup.ts:8:1 › provision G3 isolated live accounts
  [g3-journeys] › journeys.spec.ts:135:3 › G3 live-base journeys › G0 environment gates (must pass before any product assertion)
  [g3-journeys] › journeys.spec.ts:159:3 › G3 live-base journeys › J1 register + login + session cookie + reload
  ...（J2/J3/J4/J5/J6/J8/J9 全列）
  [g3-journeys] › journeys.spec.ts:482:3 › G3 live-base journeys › J7 viewer cannot write and cannot see the share tab (blocked: invitation 503 without SMTP)
  [g3-teardown] › g3.teardown.ts:6:1 › clean up G3 live fixture
Total: 12 tests in 3 files
```

→ 用例总数与改名前一致（12），仅路径变为 `g3live/journeys.spec.ts`，setup/teardown 同目录照常匹配。

### 3.4 护栏运行时实证（关键，见第 4 节）：真实 spec 被「错误 project」收集且无 fixture

用临时 config（`testDir: ./e2e/g3live`、单 project、**无 setup 依赖、无 webServer**，跑完即删）复刻 CI 场景：

```
== 10 skipped ==
[1/10] [orphan] › e2e\g3live\journeys.spec.ts:135:3 › G3 live-base journeys › G0 environment gates ...
... [10/10] ... J7 viewer cannot write ...
  10 skipped
```

→ 改名前该场景是 ENOENT 崩溃（红），现在是 **10 skipped / 0 failed**。

### 3.5 类型检查与 lint

- `pnpm exec tsc --noEmit --strict --skipLibCheck --module esnext --moduleResolution bundler --target es2022 e2e/g3live/journeys.spec.ts playwright.g3.config.ts` → **exit 0，无输出**（仓库没有覆盖 `e2e/` 的 tsconfig，`tsc` 全量 0 错误；`tsconfig*.json` 中仅 `e2e/staging/tsconfig.json`，不含本目录）。
- `pnpm exec eslint e2e/g3live/*.ts playwright.g3.config.ts` → 1 条**既有**问题：`journeys.spec.ts:36 'ownerState' is always 'undefined'`。已用 `git show HEAD:e2e/g3-api/journeys.spec.ts | eslint --stdin` 复现同一报错（HEAD 行号 35），**非本次引入**；且根脚本 `lint = turbo run lint` 只跑各 package，CI 的 lint 步骤本就不覆盖 `e2e/`。按要求未顺手修复。

## 4. 实现摘要与一处**必须审阅的偏离**

### 4.1 已完成

1. `git mv e2e/g3-api e2e/g3live`（3 个文件，git 识别为 rename，历史保留）。
   新路径 `e2e/g3live/journeys.spec.ts` 不含 `api/`、`web/`、`admin/` 任一子串（已逐条 grep 验证 = clean）。
2. `playwright.g3.config.ts` 的 `testDir` 同步为 `./e2e/g3live`。
3. 新增 fixture 缺失护栏，**跳过条件 = 文件不存在**（非环境变量）：
   `test.skip(!existsSync(LIVE_FIXTURE_FILE), "requires playwright.g3.config.ts (live fixture is produced by its setup)")`
   其中 `LIVE_FIXTURE_FILE = process.env.ROAMLOG_LIVE_FIXTURE_FILE ?? resolve(cwd, ".e2e-live/fixture.json")`，与 `g3-config` 注入的值一致。
4. 未改任何产品断言、未碰 `playwright.config.ts` / CI workflow / 产品代码。

### 4.2 偏离：护栏放在 `describe` 的 `beforeAll`，而非文件顶层

任务书要求「文件顶层 `test.skip(condition, description)`」。照做会导致**静默假绿**，实测证据如下。

Playwright 的文件级 `test.skip()` 在**加载期**求值（早于任何 project 执行）。用一个一次性最小工程实测（setup project 先生成 fixture，spec 顶层 `test.skip(!existsSync(fixture))`）：

```
fixture exists before run: NO
[1/2] [setup] › .tmpguard\setup.ts:5:1 › produce fixture
[2/2] [guarded] › .tmpguard\guarded.spec.ts:6:1 › guarded body
  1 skipped
  1 passed (440ms)
```

即：**即使 setup 已生成 fixture，顶层 guard 仍把测试跳过**。放到真实 g3 场景：`.e2e-live/` 被 gitignore（`.gitignore:39`）、当前工作区无 `fixture.json`，因此任何干净检出上跑 `pnpm exec playwright test --config=playwright.g3.config.ts` 都会 **10 条 journey 全部 skipped** —— CI 变绿但等于没测。

同工程实测运行时钩子（把同样条件放进 `beforeAll`）后：

- RUN A（正确 config + setup 生成 fixture）：`3 passed` —— 不误跳；
- RUN C（错误 project、无 setup、无 fixture）：`2 skipped`、0 failed —— 仍然兜底。

故最终实现为：

```ts
test.describe("G3 live-base journeys", () => {
  test.beforeAll(() => {
    test.skip(
      !existsSync(LIVE_FIXTURE_FILE),
      "requires playwright.g3.config.ts (live fixture is produced by its setup)",
    );
    fixture = loadLiveFixture();   // 原断言逻辑不变，只在 guard 之后执行
  });
```

**两项要求都满足**：跳过条件仍是「文件不存在」；即使被错误 project 收集也只 skip、不会红。区别仅在于求值时机（执行期 vs 加载期），这是让 g3 套件仍然真正可跑的必要条件。若坚持字面顶层写法，须同时接受「干净检出上 g3 全量跳过」。

## 5. 同类碰撞排查（三个未锚定正则全量命中，逐条判定）

```
$ git ls-files 'e2e/**/*.spec.ts' | grep 'api/'
e2e/api/smoke.spec.ts              ← 本意（api project）
e2e/g3-api/journeys.spec.ts        ← 巧合命中 → 已改名为 e2e/g3live ✅

$ git ls-files 'e2e/**/*.spec.ts' | grep 'web/'
e2e/web/{dashboard,journal,members,mobile,planning,trips}.spec.ts   ← 本意（6 个）
e2e/a11y/web/{axe,keyboard}.spec.ts        ← 巧合命中（既有）
e2e/visual/web/visual.spec.ts              ← 巧合命中（既有）

$ git ls-files 'e2e/**/*.spec.ts' | grep 'admin/'
e2e/admin/{content,flags,login,queues,responsive,roles}.spec.ts   ← 本意（6 个）
e2e/a11y/admin/{axe,keyboard}.spec.ts      ← 巧合命中（既有）
e2e/visual/admin/visual.spec.ts            ← 巧合命中（既有）
```

实测主配置全量收集（改名前基线）确认上表「巧合命中」确实被收进去了：

```
[admin] › a11y\admin\axe.spec.ts        [admin] › visual\admin\visual.spec.ts
[web]   › a11y\web\axe.spec.ts          [web]   › visual\web\visual.spec.ts
[api]   › g3-api\journeys.spec.ts
```

判定与处置：

| 命中 | 归属 | 判定 | 处置 |
| --- | --- | --- | --- |
| `e2e/api/*`（1） | api | 本意 | 保留 |
| `e2e/web/*`（6） | web | 本意 | 保留 |
| `e2e/admin/*`（6） | admin | 本意 | 保留 |
| `e2e/g3-api/journeys.spec.ts` | — | **巧合**（本次红因） | 已改名 `g3live` |
| `e2e/a11y/web/*`、`e2e/visual/web/*` | `playwright.a11y.config.ts`（testDir `./e2e/a11y`） | **巧合，既有** | 不属本次可写范围，仅报告 |
| `e2e/a11y/admin/*`、`e2e/visual/admin/*` | 同上 | **巧合，既有** | 不属本次可写范围，仅报告 |

后 6 条**当前不红**（它们在主配置里跑通了、CI 的 `e2e:web`/`e2e:admin` 通过），但是同一类缺陷：a11y/视觉用例被主配置的 project 重复执行、产物落在错误的 outputDir、且真正该用的 a11y 配置再跑一遍。建议作为后续独立任务处理（需改 `playwright.config.ts`，本次禁止）。

## 6. CodeGraph 证据

- `codegraph status` → `[OK]`：`Files: 1,485 / Nodes: 22,728 / Edges: 50,134`，索引 up to date（含改名前后自动同步）。
- `codegraph_explore "loadLiveFixture LIVE_FIXTURE_FILE g3.setup g3.teardown journeys.spec G3 live-base journeys"`（projectPath = roamlog）关键结果：
  - blast radius：`loadLiveFixture`（`e2e/live-support/fixture.ts:7`）有 **4 个调用方** —— `e2e/g3-api/journeys.spec.ts`、`e2e/live/admin.spec.ts`、`e2e/live/api.spec.ts`、`e2e/live/web.spec.ts`；只有 g3 那份依赖 g3 setup，故只需给它加 guard。
  - 逐字源码确认 `loadLiveFixture()` = `JSON.parse(readFileSync(LIVE_FIXTURE_FILE, "utf8"))` —— 即 ENOENT 的直接来源（fixture.ts:7-9）。
  - 逐字源码确认 `LIVE_FIXTURE_FILE`（`e2e/live-support/env.ts:13-14`）为 `process.env.ROAMLOG_LIVE_FIXTURE_FILE ?? resolve(LIVE_ROOT, ".e2e-live/fixture.json")`，故护栏用文件存在性判定与 g3 config 注入值完全一致。
  - 逐字源码确认 `g3.setup.ts` 的 `runLiveFixtureScript()`（`fixture.ts:40`）是 fixture 的唯一生产者，验证了「只在 g3 config 的 setup 中生成」这一前提。

## 7. 已知风险

1. **既有同类碰撞未修**（见 §5 后 6 条）：a11y/视觉 spec 仍被主配置 web/admin project 重复收集并执行。当前不红，但属同一根因；修复需改 `playwright.config.ts`（本次禁止）。
2. **护栏为执行期求值**：文件级 `test.skip` 做不到（§4.2 实证）。若未来有人把 guard 挪到文件顶层，会重新变成「干净检出静默全跳」。已在代码注释里写明原因与实测结论，防止回归。
3. **g3 套件未在本地实际执行业务断言**：任务禁止起服务，故只验证到「收集正确 + 护栏行为正确（skip/pass 两向）+ 类型/lint」，未跑真实 API/PG/Chromium 的 10 条 journey。CI 也不跑 g3 config（`.github/workflows/ci.yml` 未引用），故本次不影响 CI。
4. `.audit/evidence/g3-api` 目录名保留（有意，不参与匹配）；若后续统一改名，需同步 spec 的 `EVIDENCE` 与 config 的 `reporter/outputDir`。
5. `journeys.spec.ts:36` 的 `ownerState` 既有 eslint 报错（HEAD 同样存在，根 `lint` 不覆盖 `e2e/`），本次未修，以免混入无关 diff。

## 8. 未覆盖项

- 未执行 `pnpm e2e:api`（CI 那一步）的实际运行：它需要真实 API :4000；任务的确定性证据已由 `--list`（改名前 12/2 → 改后 2/1）+ 错误 project 运行（10 skipped）给出。
- 未跑 `pnpm --filter @roamlog/web typecheck`（无 tsconfig 覆盖 e2e，改动不触及 apps/packages；已用定向 `tsc --noEmit` 对两个改动文件替代，exit 0）。
- 未改、未验证 CI workflow 内的 step 名称/缓存路径是否仍引用 `g3-api`（workflow 未引用该路径，grep 确认）。

## 9. 建议的下一步

1. 直接提交（建议 message：`fix(e2e): rename g3-api suite to g3live and guard on missing live fixture`）并重跑 CI；预期 `E2E API smoke` 恢复 `2 passed`。
2. 提交时用 `git add -A` 让 git 按 `.gitattributes`（`* text=auto eol=lf`）归一化  
   —— 当前 `journeys.spec.ts` 已手工还原为 LF，`git diff HEAD -M --stat` 为 `16 insertions(+), 2 deletions(-)`，无整文件换行噪声。
3. 后续独立任务：给 `playwright.config.ts` 三个 project 的 `testMatch` 加目录锚定（或改用 `testDir`/`testIgnore: '**/a11y/**', '**/visual/**'`），一次性消灭 §5 的 6 条既有巧合命中，并让 a11y/视觉只在其专属配置下运行。
4. 后续可选：把 `.audit/evidence/g3-api` 重命名为 `g3live`，与目录名对齐。