import { AI_DEFAULT_SUGGESTED_PROMPTS } from "@roamlog/contracts";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SuggestedActions } from "../suggested-actions";
import {
  AI_SUGGESTED_PROMPTS_KEY,
  readSuggestedPrompts,
  useAiSuggestedPrompts,
} from "../use-suggested-prompts";

describe("suggested actions", () => {
  it("uses the platform defaults when the public setting is missing or invalid", () => {
    expect(readSuggestedPrompts(undefined)).toEqual([...AI_DEFAULT_SUGGESTED_PROMPTS]);
    expect(readSuggestedPrompts([""])).toEqual([...AI_DEFAULT_SUGGESTED_PROMPTS]);
    expect(readSuggestedPrompts(null)).toEqual([...AI_DEFAULT_SUGGESTED_PROMPTS]);
  });

  it("accepts an operator-provided 4–8 item prompt list", () => {
    const prompts = ["规划行程", "比较方案", "整理资料", "写一份日志"];
    expect(readSuggestedPrompts(prompts)).toEqual(prompts);
  });

  it("renders cards with prompt-specific labels and sends on click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <SuggestedActions
        onSelect={onSelect}
        suggestions={["规划行程", "比较方案"]}
      />,
    );

    expect(screen.getByTestId("suggested-actions")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "比较方案" }));
    expect(onSelect).toHaveBeenCalledWith("比较方案");
  });

  it("renders all cards on first paint without an initial opacity animation", () => {
    const prompts = ["规划行程", "比较方案", "整理资料", "写一份日志"];
    render(<SuggestedActions onSelect={vi.fn()} suggestions={prompts} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(prompts.length);
    for (const button of buttons) {
      expect(button).toBeVisible();
      expect(button.closest("[style]")?.getAttribute("style") ?? "").not.toMatch(
        /opacity\s*:\s*0(?:[;"']|$)/u,
      );
    }
  });

  it("keeps the public settings key stable for the backend contract", () => {
    expect(AI_SUGGESTED_PROMPTS_KEY).toBe("ai.suggestedPrompts");
  });

  it("reads an operator-provided list from the public settings endpoint", async () => {
    const custom = ["规划路线", "比较住宿", "整理预算", "记录当天见闻"];
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        settings: { [AI_SUGGESTED_PROMPTS_KEY]: custom },
        generatedAt: "2026-11-24T00:00:00.000Z",
      }),
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useAiSuggestedPrompts({ fetcher }));

    await waitFor(() => expect(result.current).toEqual(custom));
    expect(fetcher).toHaveBeenCalledWith(
      "/v1/public/settings",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
  });
});
