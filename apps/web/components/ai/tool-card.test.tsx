import type {
  ToolCallMessagePartProps,
  ToolCallMessagePartStatus,
} from "@assistant-ui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ToolCard, mapToolStateToStatus, type ToolUiState } from "./tool-card";

function props(
  overrides: Partial<ToolCallMessagePartProps> = {},
): ToolCallMessagePartProps {
  return {
    type: "tool-call",
    toolCallId: "tool-1",
    toolName: "places.search",
    args: { query: "京都", limit: 5 },
    argsText: JSON.stringify({ query: "京都", limit: 5 }),
    status: { type: "running" },
    addResult: vi.fn(),
    resume: vi.fn(),
    respondToApproval: vi.fn(),
    ...overrides,
  } as ToolCallMessagePartProps;
}

describe("mapToolStateToStatus (7 → 4)", () => {
  const cases: Array<[ToolUiState, ToolCallMessagePartStatus]> = [
    ["approval-requested", { type: "requires-action", reason: "tool-calls" }],
    ["approval-responded", { type: "running" }],
    ["input-available", { type: "running" }],
    ["input-streaming", { type: "running" }],
    ["output-available", { type: "complete" }],
    ["output-denied", { type: "incomplete", reason: "cancelled" }],
    ["output-error", { type: "incomplete", reason: "error" }],
  ];

  it.each(cases)("maps %s", (state, expected) => {
    expect(mapToolStateToStatus(state)).toEqual(expected);
  });
});

describe("ToolCard", () => {
  it("renders a running card with the Chinese tool name, status, args and live duration", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToolCard
        {...props({
          status: { type: "running" },
          timing: { startedAt: Date.now() - 1200 },
        })}
      />,
    );

    expect(screen.getByText("搜索地点")).toBeInTheDocument();
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByTestId("tool-duration")).toHaveTextContent(/秒/);

    const trigger = screen.getByRole("button", { name: /搜索地点 运行中/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("参数")).toBeInTheDocument();
    expect(container.textContent).toContain('"query"');
    expect(container.textContent).toContain("京都");
  });

  it("renders a completed card with the result body", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToolCard
        {...props({
          status: { type: "complete" },
          result: { items: [{ name: "金阁寺" }] },
          timing: { startedAt: 1_000, completedAt: 2_500 },
        })}
      />,
    );

    expect(screen.getByText("完成")).toBeInTheDocument();
    expect(screen.getByTestId("tool-duration")).toHaveTextContent("1.5 秒");

    await user.click(screen.getByRole("button", { name: /搜索地点 完成/ }));
    expect(screen.getByText("结果")).toBeInTheDocument();
    expect(container.textContent).toContain("金阁寺");
  });

  it("renders a failed card with the error text and opens the body by default", () => {
    render(
      <ToolCard
        {...props({
          status: { type: "incomplete", reason: "error", error: "upstream exploded" },
          isError: true,
        })}
      />,
    );

    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByText("错误")).toBeInTheDocument();
    expect(screen.getByText("upstream exploded")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("upstream exploded");
  });

  it("renders a cancelled card with 已取消", () => {
    render(
      <ToolCard
        {...props({
          status: { type: "incomplete", reason: "cancelled" },
          providerMetadata: { roamlog: { state: "cancelled", durationMs: 800 } },
        })}
      />,
    );

    expect(screen.getByText("已取消")).toBeInTheDocument();
    expect(screen.getByTestId("tool-duration")).toHaveTextContent("<1 秒");
    expect(screen.queryByText("失败")).not.toBeInTheDocument();
  });

  it("collapses and expands again", async () => {
    const user = userEvent.setup();
    render(<ToolCard {...props()} />);

    const trigger = screen.getByRole("button", { name: /搜索地点 运行中/ });
    await user.click(trigger);
    expect(screen.getByText("参数")).toBeInTheDocument();

    await user.click(trigger);
    expect(screen.queryByText("参数")).not.toBeInTheDocument();
  });

  it("falls back to the raw tool name for unknown tools", () => {
    render(
      <ToolCard
        {...props({
          toolName: "unknown.tool",
          status: { type: "complete" },
          result: { ok: true },
        })}
      />,
    );

    expect(screen.getByText("unknown.tool")).toBeInTheDocument();
    expect(screen.getByText("完成")).toBeInTheDocument();
  });
});
