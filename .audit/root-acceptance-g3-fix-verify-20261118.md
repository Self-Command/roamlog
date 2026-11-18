# 根 Agent 验收记录 — G3_FIX_VERIFY

任务 ID: G3_FIX_VERIFY
验收结论: **ACCEPT（3/3 PASS，浏览器级证据充分）**
时间: 2026-11-19 00:35
环境: Next 16.4.6 dev `http://localhost:3500`（非影子目录）+ Playwright 1.65 Chromium
规模: **9 用例 / 89 条产品断言，连续 3 轮 9 passed / 0 failed**

## 我亲自核验的证据

`.audit/evidence/g3-fix/`：**14 张截图 + 11 份 JSON 日志**。其中 `logs/v2a-json500-no-leak.json` 一份就同时证明了 V1 + V2：

```json
{
  "observed": { "routeHits": 0, "shimHits": 1, "mode": "json500" },
  "listboxText": "地点搜索暂时不可用，你可以直接输入地点名称。\n\n重试\n使用「京都」作为起点",
  "listboxForbiddenCheck": [
    {"fragment":"500","present":false},
    {"fragment":"/v1/","present":false},
    {"fragment":"Unexpected token","present":false},
    {"fragment":"Internal Server","present":false}
  ],
  "bodyForbiddenCheck": [ ... 同样全 false ... ]
}
```
→ **手动降级行在 500 下可见** + **文案已清洗** + **错误提示与重试仍在** + **DOM 与 body 全文均无泄露片段**。这一份快照比十句自我陈述有力。

## 三条结论

### V1（P0）搜索失败仍可手动填地点 —— **PASS**（21 断言）
- 500 下 `使用「京都」作为起点` **可见可点**
- 点击 → 出现「手动地点」徽章 + 「坐标为空」提示
- **键盘 Enter 也能选中**；`aria-activedescendant="_r_a_-listbox-_r_a_-manual"` **实测指向 manual 行** → 证明 `activeIndex` 真的指向手动项（这是我要求验证的关键点，不是口头保证）
- 错误文案 + 「重试」始终存在，未被降级行替代

### V2（P1）文案不泄露 —— **PASS**（43 断言，4 种失败形态）
覆盖：注入 500 JSON / **真实 500 HTML（无打桩，Next dev proxy → :4000 未启动）** / 注入断网 / **真实 `context.setOffline` 断网**。
- `listbox` 与 `body.innerText` 均**不含** `500` / `/v1/` / `Unexpected token` / `Internal Server`
- 文案分别为「地点搜索暂时不可用…」「地点搜索返回异常…」「网络连接中断…」，重试始终在
- 原始异常**只进 `console.warn`**（dev server 日志可见，DOM 无）→ 证明"清洗的是用户可见层，不是删掉了错误信息"

### V3（P1）日期默认与成对修正 —— **PASS**（25 断言）
- 默认 `start=2026-11-18 / end=2026-11-24`（**end = start + 6，共 7 天 6 晚**）
- `start+5` 与 **`start+10`（修复前必被 max 禁用）** 的 `aria-disabled` 均非 true 且可点
- `start+8 > end` → **end 自动跟到 12-01**（推分支生效）
- `end` 改到 `start-2` → **start 回退**，区间恒合法，无校验错误

## 该 Agent 的两个诚实纠正（我认可，其中一个是我任务书写错）

1. **`page.route("**/v1/places/search**")` 命中 0 次**：MSW 跑在 **Service Worker** 里，页面级路由看不到 `/v1/*`。它保留了 route 并**回读命中数**（`routeHits: 0`），实际注入改用 `window.fetch` init-script shim（同 payload，未改 MSW 源码），并在报告写明。→ 这是对的做法：**不隐藏证据，明确标注"我原本的方法不生效"**。
2. **我任务书里「选中 start+5 → end 自动跟到该日」字面不成立**：默认窗口 `[start, start+6]` 内 `start+5 ≤ end`，`applyTripDateChange` 只对**非法方向**联动。它按括号里的「或按 `applyTripDateChange` 语义」断言 end 不动，另用 `start+8 > end` 验证推分支。→ **我的规格写错了，它按正确语义验证并说明了原因。**

## 清理

3500 dev server 已 kill，netstat 确认无 LISTENING（仅 TIME_WAIT）；无影子目录、无残留 lock；未触碰 3000/3100/4100/55443。

## 未覆盖

- **429 rate-limited 文案**（未验证）
- 真实 provider 搜索结果（需真实 Photon，见 `API_PLACES` 的降级路径）
- **创建提交持久化**（mock 无 POST handler，属 G3_API 与 staging 范围）

## 判定

三条 P0/P1 缺陷**在真实浏览器里确认修复**。G3 的 UI 侧（mock 模式）至此收口。剩余唯一未验的是 **G3_API_JOURNEYS**（真实 API + PG + 浏览器的写持久化、7-tab 工作台、分享匿名访问、权限、409）。