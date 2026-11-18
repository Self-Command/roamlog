# 根 Agent 验收记录 — A11Y_TOPBAR_FIX

任务 ID: A11Y_TOPBAR_FIX
验收结论: **ACCEPT（含反证，证据等级高）**
时间: 2026-11-19 00:10

## 通过

### 修法（正是我指定的方案，未另辟蹊径）
```tsx
const visibleLabels = visible.map((member) => initialsFor(member.user.name));
const ariaLabel = `工作区成员 ${members.length} 人：${visibleLabels.join("、")}${
  overflow > 0 ? `、+${overflow}` : ""
}，查看成员列表`;
```
最终实测字符串：`工作区成员 4 人：林、MC、林、+1，查看成员列表`
可见文本：`林 / MC / 林 / +1`（四个 span **仍全部 `aria-hidden="true"`**）
→ 可见 token **逐字、同序、连续**出现在可访问名中，满足 WCAG 2.5.3 Label in Name。

未改 axe 配置 / 未加 exclude / 未放宽测试 / 未改 sr-only / 未改链接结构。

### 验证
| 项 | 结果 |
|---|---|
| `web typecheck` | exit 0，0 错误 |
| `components/app-shell` | 1 file / **13 tests** 通过（我独立复跑确认） |
| `web lint` | exit 0 |
| **axe（web-a11y project）** | **14 passed**，9 条 axe 路由全部**无 serious/critical** |
| **`label-content-name-mismatch`** | **7 → 0** |

### 反证（这是本报告最有价值的部分）
Agent 把 `aria-label` **临时换回旧全名版**重跑 axe → **1 条 serious 重新命中** `a[data-testid="topbar-members"]`；换回修复版 → **0 条**。反证后已恢复 DOM。

→ 说明：① 该 violation 真实存在且由该行代码引起；② 修复确实消除了它，而非偶然。**这种自证方式应作为后续 a11y 修复的标准做法。**

## 风险（接受）

1. **成员有头像图片时**：该 span 无可见文字（`img alt=""`），但 `aria-label` 仍含其首字母 → 多出的描述文字。axe 不判违规（名字只需**包含**可见文字），但语义上略微冗余。图片分支未改。
2. **可访问名不再含成员全名**：屏幕阅读器只播报首字母 + 人数。这是通过 2.5.3 的**必然取舍**（可见文字必须进名字）。若产品要求播报全名，需改设计（可见全名或 `aria-describedby`）——另立任务。
3. 该类文件在 git 中未跟踪（属更大未提交改动），未做任何 git 操作。

## 未覆盖

只跑 `web-a11y` project；`admin-a11y` / `visual` 未跑；未在 390px 单独扫描该链接；未跑全量 e2e。

## 附：可复用的 a11y 跑法（Agent 踩坑记录，已采纳）

1. **必须** `--config=playwright.a11y.config.ts`，否则默认 `playwright.config.ts`（projects: web/admin/api）会报 `Project(s) "web-a11y" not found`。
2. 复制到 `.data/a11y-runtime/web` 后**多一层目录** → `tsconfig` 的 `extends: "../../tsconfig.base.json"` 解析失败 → Next 500（`An issue occurred while parsing a tsconfig.json file`）。需按 `prepare-next-runtime.ts` 的做法**内联合并 base compilerOptions 并去掉 extends**。
3. **tsconfig 改完必须重启 dev server**（进程内已缓存）。
4. 起 server：`cd .data/a11y-runtime/web && node node_modules/next/bin/next dev -p 3400`（next 通过 node_modules junction 解析）。
5. 用完删除 `.data/a11y-runtime`，确认端口无监听。