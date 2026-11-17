import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { nextPackingOrder, normalizeReorder } from "../packing-order.js";

describe("packing order", () => {
  it("rejects duplicate ids", () => {
    expect(() =>
      normalizeReorder([
        { id: "01942f30-1200-7000-8000-000000000001", order: 1 },
        { id: "01942f30-1200-7000-8000-000000000001", order: 2 },
      ]),
    ).toThrow(BadRequestException);
  });

  it("sorts and compacts arbitrary orders into a dense sequence", () => {
    expect(
      normalizeReorder([
        { id: "b", order: 20 },
        { id: "a", order: 10 },
        { id: "c", order: 15 },
      ]),
    ).toEqual([
      { id: "a", order: 0 },
      { id: "c", order: 1 },
      { id: "b", order: 2 },
    ]);
  });

  it("appends new packing items after the current maximum", () => {
    expect(nextPackingOrder(null)).toBe(0);
    expect(nextPackingOrder(4)).toBe(5);
  });
});
