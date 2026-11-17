# W0-UI-DESIGN-SYSTEM 交付报告

状态: DONE_WITH_CONCERNS
任务 ID: W0-UI-DESIGN-SYSTEM
日期: 2026-11-17

## 变更文件

### `packages/ui`

- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `README.md`
- `src/index.ts`
- `src/lib/cn.ts`
- `src/lib/initials.ts`
- `src/styles/tokens.css`
- `src/styles/tokens.ts`
- `src/styles/fonts.ts`
- `src/test/setup.ts`
- `src/__tests__/tokens.test.ts`
- `src/__tests__/primitives.test.tsx`
- `src/__tests__/smoke.test.tsx`
- `src/primitives/avatar.tsx`
- `src/primitives/badge.tsx`
- `src/primitives/button.tsx`
- `src/primitives/dialog.tsx`
- `src/primitives/dropdown-menu.tsx`
- `src/primitives/form.tsx`
- `src/primitives/icon-button.tsx`
- `src/primitives/pagination.tsx`
- `src/primitives/popover.tsx`
- `src/primitives/progress.tsx`
- `src/primitives/separator.tsx`
- `src/primitives/sheet.tsx`
- `src/primitives/skeleton.tsx`
- `src/primitives/states.tsx`
- `src/primitives/tabs.tsx`
- `src/primitives/tooltip.tsx`
- `src/patterns/mobile-nav.tsx`
- `src/patterns/page-glow.tsx`
- `src/patterns/page-header.tsx`
- `src/patterns/sidebar.tsx`
- `src/patterns/topbar.tsx`

### `packages/config`

- `package.json`
- `tsconfig.json`
- `tailwind-preset.ts`

最终工作区未保留对 `apps/**`、`packages/contracts/**`、`packages/db/**`、root `package.json`、
`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`turbo.json`、Docker、CI、原型或设计文档的改动。

## 实现摘要

- 完整语义 tokens：纯黑 canvas、四级 surface、ink/body/muted/ash/stone、hairline/hairline-strong/divider、六种 accent、12px card、8px control、full pill。
- 字体三通道：Serif Display（Instrument Serif + Noto Serif SC）、Sans UI（Geist + Noto Sans SC）、Mono metadata（Geist Mono）；页面/旅行/日志标题上限分别为 56/48/36px。
- `prefers-reduced-motion` 与 `html.reduce-motion` 双尊重；全局 2px ink + 2px offset 焦点环。
- 全部指定 primitives：Button、IconButton、Input、Textarea、Select、Checkbox、Switch、Tabs、Dialog、Sheet、Popover、DropdownMenu、Tooltip、Badge、Avatar、AvatarGroup、Progress、Separator、Skeleton、EmptyState、ErrorState、Pagination。
- 额外提供 `FormField` 与 `Label`，保证 label、hint、error 的 `aria-describedby`/`aria-invalid` 关联。
- 产品壳模式：PageHeader、PageGlow、Sidebar/SidebarContent、Topbar、MobileNav；不接路由、API、store 或种子业务数据。
- `@roamlog/ui/tokens.css` 同时导出 Tailwind 4 `@theme` tokens，并通过 `@source` 让消费方扫描 UI 包源码。
- `@roamlog/config/tailwind-preset` 提供 Tailwind 3/4 配置式消费路径，颜色、字体、圆角、标题字号与 CSS tokens 对齐。
- 所有卡片、浮层和控件不使用 `shadow-*` / `drop-shadow`；状态层级依赖 surface 明度和 hairline。
- 移动端控件触控目标为 44–48px；桌面收紧到 36–40px；MobileNav 尊重 safe-area。

## 新增依赖

### `@roamlog/ui` dependencies

- `@radix-ui/react-avatar@1.3.1`
- `@radix-ui/react-checkbox@1.4.1`
- `@radix-ui/react-dialog@1.3.1`
- `@radix-ui/react-dropdown-menu@2.2.1`
- `@radix-ui/react-popover@1.3.1`
- `@radix-ui/react-progress@1.2.1`
- `@radix-ui/react-separator@1.2.0`
- `@radix-ui/react-slot@1.5.0`
- `@radix-ui/react-switch@1.4.1`
- `@radix-ui/react-tabs@1.2.1`
- `@radix-ui/react-tooltip@1.4.1`
- `class-variance-authority@0.7.1`
- `clsx@2.1.1`
- `lucide-react@1.74.0`
- `tailwind-merge@3.7.0`

`Select` 使用原生 `<select>` + 样式化 chevron，不新增 Radix Select 依赖。

### `@roamlog/ui` peers/dev

- peer: `react@^19.3.0`, `react-dom@^19.3.0`, `tailwindcss@^4.3.0`
- dev: `@testing-library/jest-dom@7.0.1`, `@testing-library/react@16.3.3`,
  `@testing-library/user-event@14.6.12`, `@types/react@19.3.0`,
  `@types/react-dom@19.3.0`, `jsdom@31.0.1`, `react@19.3.1`,
  `react-dom@19.3.1`, `typescript@5.9.3`, `vitest@5.1.0`

### `@roamlog/config`

- dev: `typescript@5.9.3`

## 验证命令与结果

1. TDD 红灯：

```powershell
.\node_modules\.bin\vitest.cmd run packages/ui/src/__tests__/tokens.test.ts --environment node
```

实现前失败：`Cannot find module '../styles/fonts'`。随后 tokens 测试 4/4 通过。

2. UI 组件测试：

```powershell
cd packages/ui
.\node_modules\.bin\vitest.cmd run
```

结果：exit `0`；3 个测试文件、8 个测试全部通过。覆盖 Button disabled 点击阻断、
Dialog accessible title/description、FormField 错误关联、tokens、六种 accent、标题上限、
reduced-motion，以及全部 primitives + shell 的运行时 smoke render。

3. TypeScript：

```powershell
cd packages/ui
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json

cd ../..
.\node_modules\.bin\tsc.cmd --noEmit -p packages/config/tsconfig.json
```

结果：两者 exit `0`，无输出。

4. ESLint / Prettier：

```powershell
.\node_modules\.bin\eslint.cmd packages/ui packages/config
.\node_modules\.bin\prettier.cmd --check "packages/ui/**/*.{ts,tsx,json,md,css}" "packages/config/**/*.{ts,json}"
```

结果：exit `0`。

5. 导出面：

```powershell
.\node_modules\.bin\tsx.cmd -e "import * as ui from './packages/ui/src/index.ts'; ..."
```

结果：83 个运行时导出；27 个指定顶层能力全部存在，`missing: []`。

6. Tailwind 4 实际编译（临时验证脚本，验证后已删除）：

- 成功编译 `@import "tailwindcss"` + `@roamlog/ui/tokens.css`。
- 生成 10,552 bytes CSS。
- 确认 `bg-canvas`、`border-hairline-strong`、`rounded-card`、`font-serif`、
  `text-page-title`、accent alpha、`aria-[invalid=true]`、`data-[state=checked]`
  均能生成有效 CSS，且引用 `var(--roamlog-*)` tokens。

## 未覆盖与风险

- 设计规范 §15.2 只列出五个具名 accent，但计划 Task 3 与任务包要求“六种 accent”。本实现按 Resend 分析中的深石板色补充 `--accent-slate: #64748b`，仅用于低透明度状态/图表/光晕。若产品经理不接受该扩展，需要重新冻结为五种。
- 当前没有 Web/Admin 路由或应用壳可挂载，因此未生成 1440/390 浏览器截图；视觉验收需在 Web/Admin shell 集成后执行。
- Tooltip、Popover、DropdownMenu、Sheet、Tabs 已做挂载 smoke test，但未做完整键盘/交互 E2E；当前证据覆盖结构、ARIA 和运行时渲染，不覆盖所有复杂浮层交互。
- 验证过程中 `pnpm --filter` 触发过 pnpm 12 的自动依赖校验/安装；之后改用包内二进制。当前工作区 `pnpm-lock.yaml` 与 `pnpm-workspace.yaml` 无 git diff，但 `node_modules` 已安装本次依赖。根 Agent 仍必须按最新 package manifests 统一执行安装/锁文件更新。
- 本任务只交付设计系统和壳组件，不声称 Web、Admin、API、Worker 或真实后端能力完成。

## 建议下一步

1. 根 Agent 统一运行 `pnpm install`，锁定 `packages/ui`/`packages/config` 依赖及新增 peer。
2. 用根命令复验：`pnpm --filter @roamlog/ui test`、`pnpm --filter @roamlog/ui typecheck`、`pnpm --filter @roamlog/config typecheck`、`pnpm lint`。
3. Web/Admin shell 首次接入时，在根 CSS 中 `@import "@roamlog/ui/tokens.css"`，并用 `next/font` 设置 `--font-instrument`、`--font-noto-serif`、`--font-geist`、`--font-noto-sans`、`--font-geist-mono`。
4. 完成真实页面后做 1440/390 截图验收，逐屏确认最多一个白色 primary、无横向溢出、键盘焦点可见、移动触控目标达标。
5. 由产品经理批准或移除第六 `accent-slate` 扩展，并同步设计文档/Tailwind preset/tokens 测试。
