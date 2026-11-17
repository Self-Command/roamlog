import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { demoTrips, demoUser, demoWorkspaces } from "@roamlog/api-mocks/fixtures";
import { Button } from "@roamlog/ui";

import { AppShellView } from "./app-shell-view";

const currentWorkspace = demoWorkspaces[0];

describe("Web application shell", () => {
  if (!currentWorkspace) {
    throw new Error("The demo workspace fixture is required for the shell test.");
  }

  it("renders the primary workspace navigation and a visible primary page action", () => {
    const { container } = render(
      <AppShellView
        currentUser={demoUser}
        workspaces={demoWorkspaces}
        currentWorkspace={currentWorkspace}
        trips={demoTrips}
        pathname={`/w/${currentWorkspace.slug}`}
      >
        <main>
          <h1>旅行总览</h1>
          <Button variant="primary">新建旅行</Button>
        </main>
      </AppShellView>,
    );

    for (const label of ["总览", "旅行", "日志", "地图", "洞察", "成员", "活动", "通知"]) {
      expect(screen.getAllByRole("link", { name: label }).length).toBeGreaterThan(0);
    }

    expect(screen.getAllByText("Roamlog Crew").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "搜索或运行命令" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "快速新建" })).toBeInTheDocument();
    expect(container.querySelectorAll("button.bg-ink").length).toBeLessThanOrEqual(1);
  });

  it("renders five accessible items in the mobile bottom navigation", () => {
    render(
      <AppShellView
        currentUser={demoUser}
        workspaces={demoWorkspaces}
        currentWorkspace={currentWorkspace}
        trips={demoTrips}
        pathname={`/w/${currentWorkspace.slug}/trips`}
      >
        <main>旅行库</main>
      </AppShellView>,
    );

    const mobileNavigation = screen.getByRole("navigation", { name: "移动端主导航" });

    for (const label of ["总览", "旅行", "日志", "地图", "更多"]) {
      expect(within(mobileNavigation).getByRole("link", { name: label })).toBeInTheDocument();
    }

    expect(within(mobileNavigation).getByRole("link", { name: "旅行" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
