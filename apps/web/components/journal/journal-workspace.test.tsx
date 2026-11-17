import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithDemo } from "@/test/demo-render";

import { JournalWorkspace } from "./journal-workspace";

describe("JournalWorkspace", () => {
  it("filters entries by mood and opens the detail sheet with a working comment composer", async () => {
    const user = userEvent.setup();
    renderWithDemo(<JournalWorkspace workspaceSlug="roamlog-crew" />);

    expect(screen.getByRole("heading", { name: "全部日志" })).toBeInTheDocument();
    expect(screen.getByText("在哲学之道走到天黑")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "平静" }));
    expect(screen.queryByText("风把车门吹开")).not.toBeInTheDocument();
    expect(screen.getByText("在哲学之道走到天黑")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /在哲学之道走到天黑/ }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("heading", { name: "在哲学之道走到天黑" })).toBeInTheDocument();

    await user.type(
      within(sheet).getByPlaceholderText("写下评论，输入 @ 提及成员…"),
      "我把这家汤豆腐店加进行程了。",
    );
    await user.click(within(sheet).getByRole("button", { name: "发送评论" }));
    expect(within(sheet).getByText("我把这家汤豆腐店加进行程了。")).toBeInTheDocument();
  });

  it("keeps search and trip filters shareable in the URL", async () => {
    const user = userEvent.setup();
    renderWithDemo(<JournalWorkspace workspaceSlug="roamlog-crew" />);

    await user.type(screen.getByRole("searchbox", { name: "搜索日志" }), "哲学之道");
    expect(window.location.search).toContain("q=");
    expect(screen.getByText("在哲学之道走到天黑")).toBeInTheDocument();
  });
});
