# 根 Agent 验收记录 — AUTH_SHELL_FAKE_DATA

任务 ID: AUTH_SHELL_FAKE_DATA
验收结论: **ACCEPT（含文案真实性自证，质量高于预期）**
时间: 2026-11-19 00:50

## 问题（我在本地验收环境里抓到的）

`apps/web/components/auth/auth-shell.tsx` 的登录/注册/邀请页右栏有一张卡片：
```
RECENT WORKSPACE ACTIVITY              local fixture
─ 假姓名 A · 09:42
─ 假姓名 B · 08:15
─ 假姓名 C · 昨天
```
内容是**硬编码 `activityRows`**，且**在 api 模式下照常渲染** → 未登录访客看到的"最近工作区活动"是伪造的。这是访客看到的第一个页面，直接违反「线上无假数据」。

## 通过

### 修法（方案 A，我推荐的）
- 删除 `activityRows` 常量、`RECENT WORKSPACE ACTIVITY` 标题、`local fixture` 角标、整个活动列表卡片（含 3 条假动作/假姓名/假时间戳/3 个图标），**共 -45 行**
- 同位置换**非数据型**内容：`SHARED, NOT SOCIAL` + 产品说明（成员按角色阅读评论、无公开主页、无推荐信息流、对外分享需成员显式创建链接）+ hairline 下沿 mono 行 `private by default · opt-in share links`
- 移除已无用的 `lucide-react` 导入
- **判据清晰**：新面板无任何**记录型字段**（无姓名/账号/实体名/时间/数量/ID/可枚举行），不含数组常量、不含 `.map()`

### **文案真实性自证（这是本次最值得记的做法）**
它没有随手写漂亮话，而是**去代码里核对每一条陈述**：
- 分享必须成员主动创建且需 `share-link:create` 权限（`share-links.service.ts:72`）
- `allowIndex` / `showBudget` 默认 `false`（`:102-104`）
- `readPublic` 需合法 token 并校验 revoked/过期/密码（`:171-208`）
- **初稿写「仅受邀成员可见」，核对后发现公开分享链接存在会使该句失真 → 改为「opt-in share links」**

→ 这一点很重要：**假数据的对立面不是"删掉"，而是"说的每句话都能被代码验证"**。

### 验证
| 项 | 结果 |
|---|---|
| `web typecheck` | exit 0 |
| `web test` | **32 files / 203 tests**（基线 31/201，增量为新文件 2 条，**0 回归**） |
| `web lint` | exit 0 |
| 静态 grep `activityRows\|local fixture\|RECENT WORKSPACE ACTIVITY` | **0 命中** |

### 我独立复核的运行时证据（打到正在跑的 api 模式 3000）
```
/login  → local fixture: 0 命中 ; SHARED, NOT SOCIAL: 1 命中 ; Mira|顾南|林晚|09:42: 0 命中
```
→ **改动已在运行实例上生效**，访客 HTML 已彻底无 fixture。

并且我扫了 api 模式下 5 个页面，确认无残留假文案：
```
/w/verify-crew          → 0
/w/verify-crew/trips    → 0
/w/verify-crew/insights → 0
/w/verify-crew/map      → 0
/w/verify-crew/trips/new→ 0
```

## 风险（接受）

1. **文案绑定产品边界**：若后续上线公开主页/发现页或默认公开分享，此段需同步更新，否则又成不实陈述。已记入设计文档待办。
2. 仅 HTML 级验证，无像素级视觉核对（面板高度按类目估算与原卡片同量级）。
3. **生产构建产物仍含旧代码**——dev server 已热更新，但镜像需重新构建才生效（属发布侧，打 tag 时自然解决）。
4. 移动端无变化（左栏 `hidden lg:flex`，本来就隐藏）。

## 未覆盖

- 视觉回归截图（≥1024 宽度下的左栏垂直节奏）
- **`apps/admin` 登录面板是否有同类假数据（未检查）** ← 我会在 Admin 验收时补
- 其它语言文案

## 它给的一条方法论（我采纳为后续审计判据）

> 判据不是"grep 某个字符串"，而是：**访客可见的装饰内容不得含记录型字段（姓名 / 时间 / 数量 / ID / 可枚举行）**。

这比只 grep `local fixture` 更难被绕过——因为假数据可以换个名字继续存在。