import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { MessageReasoning } from "../reasoning";

const LONG_REASONING = Array.from(
  { length: 40 },
  (_, index) => `第 ${String(index + 1)} 步：检查行程约束、预算与同行人偏好。`,
).join("\n\n");

describe("reasoning layout", () => {
  it("renders the full reasoning text without a nested scroll box", async () => {
    render(<MessageReasoning isLoading={false} reasoning={LONG_REASONING} />);

    expect(screen.queryByTestId("reasoning-body")).toBeNull();
    await userEvent.click(screen.getByText("模型原始思考"));

    expect(screen.getByTestId("reasoning-body")).toBeTruthy();
    expect(screen.getByText(/第 40 步/u)).toBeTruthy();
    const block = screen.getByTestId("reasoning-body");

    expect(block.className).not.toContain("max-h-[200px]");
    expect(block.className).not.toContain("overflow-y-auto");
  });
});
