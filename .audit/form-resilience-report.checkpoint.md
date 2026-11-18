# FORM_RESILIENCE checkpoint

- 状态: DONE
- 任务: 修复 3 个 G3 真实浏览器验收发现的表单缺陷（见 `.audit/form-resilience-report.md`）
- 完成内容:
  1. combobox `error` / `rate-limited` 渲染 manual 降级行，activeIndex 指向 manual，Enter 可选中
  2. 错误文案改为固定分类文案（timeout/offline/invalid-response/unavailable），原始异常只进 console.warn
  3. 新建默认 `endDate = startDate + 6`；日期成对自动修正 + 重新校验，移除 picker 互相 min/max 钳制
- 关键文件:
  - `apps/web/components/forms/searchable-combobox.tsx`
  - `apps/web/components/trips/trip-form/{trip-form-state.ts,trip-form.tsx,origin-field.tsx,destinations-field.tsx}`
  - 三个对应测试文件
- 验证:
  - typecheck exit 0
  - `vitest run components/forms components/trips` → 6 files / 51 tests passed
  - lint exit 0
  - 全量 `test` → 31 files / 201 tests passed
- 端口: 未启动任何 3400/3500 服务，无需停止。
- 未覆盖: 3400 真实浏览器 Playwright 复跑未执行（已在报告中说明）。