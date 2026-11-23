import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommandPalette } from "./command-palette";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/query", () => ({
  useSearchQuery: mocks.search,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

const SEARCH_RESPONSE = {
  query: "京都",
  trips: [
    {
      id: "trip-1",
      type: "trip" as const,
      title: "京都慢行",
      snippet: "京都 · 2026.11",
      tripId: null,
      highlight: "京都",
    },
  ],
  entries: [
    {
      id: "entry-1",
      type: "entry" as const,
      title: "在雨停之前",
      snippet: "清水寺的清晨",
      tripId: "trip-1",
      highlight: "清水寺",
    },
  ],
  comments: [
    {
      id: "comment-1",
      type: "comment" as const,
      title: "Comment on 京都慢行",
      snippet: "这次行程很舒服",
      tripId: "trip-1",
      highlight: null,
    },
  ],
  people: [
    {
      id: "person-1",
      name: "顾行舟",
      image: null,
    },
  ],
};

function searchResult(overrides: Record<string, unknown> = {}) {
  return {
    data: SEARCH_RESPONSE,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

describe("CommandPalette", () => {
  beforeEach(() => {
    mocks.search.mockReset();
    mocks.push.mockReset();
    mocks.search.mockReturnValue(searchResult());
  });

  it("debounces a real workspace search and renders every result group", async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        workspaceSlug="roamlog-crew"
        workspaceId="workspace-1"
      />,
    );

    await user.type(screen.getByRole("combobox", { name: "搜索命令" }), "京都");

    await waitFor(() =>
      expect(mocks.search).toHaveBeenLastCalledWith(
        "workspace-1",
        { q: "京都", type: "all", limit: 8 },
        true,
      ),
    );
    expect(await screen.findByText("京都慢行")).toBeInTheDocument();
    expect(screen.getByText("在雨停之前")).toBeInTheDocument();
    expect(screen.getByText("Comment on 京都慢行")).toBeInTheDocument();
    expect(screen.getByText("顾行舟")).toBeInTheDocument();
  });

  it("navigates a selected entry to its trip and closes the palette", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        workspaceSlug="roamlog-crew"
        workspaceId="workspace-1"
      />,
    );

    const input = screen.getByRole("combobox", { name: "搜索命令" });
    await user.type(input, "京都");
    await user.click(await screen.findByText("在雨停之前"));

    expect(mocks.push).toHaveBeenCalledWith("/w/roamlog-crew/trips/trip-1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows a retry action when the real search request fails", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    mocks.search.mockReturnValue(
      searchResult({ data: undefined, isError: true, error: new Error("search failed"), refetch }),
    );
    render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        workspaceSlug="roamlog-crew"
        workspaceId="workspace-1"
      />,
    );

    await user.type(screen.getByRole("combobox", { name: "搜索命令" }), "京都");
    await user.click(await screen.findByText("搜索失败，点此重试"));

    expect(refetch).toHaveBeenCalled();
  });

  it("does not call the API until the query has two characters", async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette
        open
        onOpenChange={vi.fn()}
        workspaceSlug="roamlog-crew"
        workspaceId="workspace-1"
      />,
    );

    await user.type(screen.getByRole("combobox", { name: "搜索命令" }), "京");
    await waitFor(() =>
      expect(screen.getByText("输入至少 2 个字符开始搜索。")).toBeInTheDocument(),
    );
    expect(mocks.search).not.toHaveBeenCalledWith(
      "workspace-1",
      expect.objectContaining({ q: "京" }),
      true,
    );
  });
});
