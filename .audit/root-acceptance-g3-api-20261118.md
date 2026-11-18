# 根 Agent 验收记录 — G3_API_JOURNEYS（真实 API + PG + 浏览器）

任务 ID: G3_API_JOURNEYS
验收结论: **ACCEPT（J7 因无 SMTP 未覆盖；根 Agent 已把环境补齐并实测放通）**
时间: 2026-11-19 01:05
结果: **11 passed / 1 failed（2.4m）**；J1–J6、J8、J9 全 PASS
环境: `playwright.g3.config.ts`（新增，未改既有 config）+ live 基座；PG 55443、API 4100、Web 3100（真实 api 模式）

## 逐条结果

| # | 旅程 | 结果 | 关键证据 |
|---|---|---|---|
| G0 | 环境门禁 | PASS(3) | `GET /register` 200 且 apiCopy=true / mockCopy=false；`/v1/health` 200 |
| J1 | 注册/登录/会话 | PASS(8) | `sign-up` **200**、`sign-in` 200、Cookie `roamlog.session_token`(httpOnly)、刷新后 `/v1/me` 200 且 email 一致 |
| J2 | 全字段创建 | PASS(12) | 标题/简介/状态/可见性/日期/起点/目的地/预算+币种/标签/同行人 → 跳 `/w/…/trips/<uuid>` |
| J3 | DB 直查回显 | PASS(14) | DB 与页面一致：`status=upcoming`、`visibility=private`、`origin=Kyoto`、`destinations=["大阪府"]`、`budgetAmountMinor=1234567`、`JPY`、tags、guests |
| J4 | PATCH 只发变更 | PASS(10) | body keys **精确为** `["budgetAmountMinor","budgetCurrency","destinations","title","version"]`；未改字段全部缺席；刷新+DB 回显 |
| J5 | 7 tab | PASS(21) | 行程/照片/费用/行李/分享/活动 各发专属 GET（全 200）；参与者由头部预取、页面渲染真实数据；证据 `j5-tabs.json` |
| J6 | 分享 | PASS(12) | `POST share-links` **201** 返回 token+url（一次性）；list 200 **不含 token**；`GET /v1/public/trips/<token>` **200**（360B，**无 bucket/key/variants**）；incognito 可见标题、匿名 session 无 user |
| J7 | viewer 权限 | **FAIL** | `POST /v1/workspaces/:id/invitations` → **503**（无 SMTP → 邮件投递失败），拿不到邀请 token |
| J8 | 409 冲突 | PASS(4) | A 保存 200（version 2）；B 出现冲突提示；DB 终值 = A 的标题、version 3（后保存者未覆盖前者） |
| J9 | 390 无溢出 | PASS(2) | create/detail 均 `scrollWidth=390=clientWidth` |

**J8 尤其有价值**：证明乐观锁在真实双会话下真的生效，且**后保存者没有静默覆盖前者**。

**J6 同样关键**：公开响应 360 字节、无 `bucket`/`key`/`variants` —— 这是「不泄露存储坐标」的运行时证明，不是单元测试断言。

## 该 Agent 的自我纠正（我第一次的判断被它推翻，我接受）

上一轮它判定「3100 是 mock 模式」，依据是 `/register` HTML 含 `local fixture`。本轮它自己纠正：

> `local fixture` 是 `apps/web/components/auth/auth-shell.tsx:62` 的**静态文案，两种模式都有**，不能当 mock 证据。真正的判别用 `/register` 分支文案（api：「注册后会发送验证邮件…」；mock：「…mock 预览…」）。上一版「web 是 mock 模式」结论作废；旧实例的真实问题只是**未 hydrate**。

→ 我在给用户的汇报里也用过这条判据，同样应被推翻。**正确判据已记入验收文档。**（附带说明：该静态文案已在 `AUTH_SHELL_FAKE_DATA` 中被删除。）

## J7 的处置（根 Agent 亲自补环境并实测放通）

我判断 J7 不是产品缺陷，而是**本地无 SMTP** 的环境缺口。已在本地验收栈里补了 SMTP sink（`.audit/local-verify/smtp-sink.mjs`，1025 端口，落 `.eml` + 提取链接到 `links.txt`），并实测：

```
POST /v1/workspaces/<ws>/invitations  {"email":"viewer@roamlog.test","role":"viewer"}
→ HTTP 201（此前 503）
邀请链接被抓取：http://localhost:3000/invite/0MkSK90L_...
POST /v1/invitations/<token>/accept
→ 200 {"role":"viewer","status":"active"}   ← viewer 成员关系真实建立
```

→ **邀请与接受链路在真实 API + PG 上跑通**，J7 的阻断解除。viewer 的「只读」行为已另派 `G3_VIEWER_E2E` 用真实浏览器验证（含直接打 API 验服务端边界）。

## 它列出的 5 个产品观察（我逐条裁定）

| # | 观察 | 我的裁定 |
|---|---|---|
| 1 | **无 SMTP 时邀请与邮箱验证整链不可用**：邀请 503；注册只记 `email.delivery_failed`，账号停在 unverified 且不跳转 | **真实产品问题**。服务层在投递失败时会**回滚邀请并返回 503**（我读过代码，message 明确「No pending invitation was left behind」，状态一致，无脏数据）。但在生产 Resend 抖动时，用户会**完全无法邀请**，且注册后停在未验证、无重发入口 → 应改为「201 + 交付状态 + 重发入口」或提供复制链接。**已记为发布后 P1**（本地已用 SMTP sink 绕过，不阻塞 rc.4） |
| 2 | 起点手动回退存 `originLat/Lng/countryCode/timeZone = null` | 契约允许，**接受**（手动地点本就无坐标）；UI 已标「坐标为空」 |
| 3 | 地点标签本地化（Osaka→大阪府、Nara→奈良市） | **接受**，E2E 需 locale 容错（已写入测试规范） |
| 4 | PATCH 带成对字段 `budgetCurrency`（随金额）与 `countryCodes`（随目的地）及 `version` | **正确行为**（成对约束要求），非缺陷 |
| 5 | 分享 token 只 POST 一次性返回，列表有意不回传 | **设计如此**（符合 UI 文案「链接只显示一次」），非缺陷 |

## 未覆盖

- J7 的 viewer 只读行为 → 已派 `G3_VIEWER_E2E`
- 真实 S3 上传（storage down）、真实 Resend 投递（无凭据）
- Admin 端（不在本任务）

## 端口纪律

3100 / 4100 / 46379 / 55443 全部释放（netstat 复核）；未触碰 3000 / 3001 / 55442。