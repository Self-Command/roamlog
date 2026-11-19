import { vi } from "vitest";

const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 240;

/**
 * jsdom performs no layout: every element reports a 0x0 rect, and the Recharts 3
 * `ResponsiveContainer` treats a non-positive measurement as "not measured yet"
 * and renders `null` instead of the chart. Stubbing a positive rect lets the
 * chart components mount in tests exactly as they do in a real browser.
 *
 * Test-only helper: it is not part of the shipped chart code.
 */
export function stubChartLayout(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        x: 0,
        y: 0,
        width,
        height,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        toJSON: () => ({}),
      }) as DOMRect,
  );
}
