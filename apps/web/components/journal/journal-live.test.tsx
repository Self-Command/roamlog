import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  JournalEditorChunkError,
  JournalEditorChunkLoading,
  JournalLive,
} from "../../app/(app)/w/[workspaceSlug]/journal/journal-live";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockJournalEditorSheet(props: { open?: boolean }) {
      return <div data-testid="lazy-editor-sheet" data-open={String(props.open)} />;
    },
}));

vi.mock("@/lib/query", () => ({
  useWorkspaceBySlug: () => ({
    workspace: { id: "workspace-1", role: "owner" },
    workspacesQuery: { isLoading: false },
  }),
  useTripsQuery: () => ({
    data: { items: [{ id: "trip-1", title: "京都" }] },
  }),
  useMembersQuery: () => ({ data: { items: [] } }),
  useMeQuery: () => ({ data: { id: "user-1" } }),
  useEntriesQuery: () => ({
    data: {
      items: [
        {
          id: "entry-1",
          tripId: "trip-1",
          title: "抵达京都",
          date: "2026-11-22",
          location: "京都",
          excerpt: "第一晚的雨声。",
          mood: "calm",
          favorite: false,
          version: 1,
        },
      ],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCommentsQuery: () => ({ data: { items: [] }, isLoading: false }),
  useFavoriteEntryMutation: () => ({ mutateAsync: vi.fn() }),
  useCreateCommentMutation: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/lib/data-provider", () => ({
  useDataAdapter: () => ({}),
}));

vi.mock("@/components/journal/journal-repository", () => ({
  createApiJournalRepository: () => ({}),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

describe("JournalLive lazy editor", () => {
  it("does not mount the editor sheet until the user opens it", async () => {
    const user = userEvent.setup();
    render(<JournalLive workspaceSlug="verify-crew" />);

    expect(screen.getByRole("heading", { name: "全部日志" })).toBeInTheDocument();
    expect(screen.queryByTestId("lazy-editor-sheet")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "写日志" }));

    expect(screen.getByTestId("lazy-editor-sheet")).toHaveAttribute("data-open", "true");
  });

  it("mounts the editor when a journal card is opened", async () => {
    const user = userEvent.setup();
    render(<JournalLive workspaceSlug="verify-crew" />);

    await user.click(screen.getByRole("button", { name: /抵达京都/ }));

    expect(screen.getByTestId("lazy-editor-sheet")).toHaveAttribute("data-open", "true");
  });

  it("renders a visible loading fallback and a reloadable error state", () => {
    const loading = render(<JournalEditorChunkLoading />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("正在准备日志编辑器…")).toBeInTheDocument();
    loading.unmount();

    render(<JournalEditorChunkError />);
    expect(screen.getByRole("alert")).toHaveTextContent("编辑器加载失败");
    expect(screen.getByRole("button", { name: "重新加载" })).toBeInTheDocument();
  });
});
