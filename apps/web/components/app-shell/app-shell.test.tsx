import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { demoTrips, demoUser, demoWorkspaces } from "@/test/fixtures";
import { renderWithQuery } from "@/test/query-harness";
import type { WorkspaceMemberWithUser } from "@roamlog/contracts";
import { Button } from "@roamlog/ui";

import { AppShellView } from "./app-shell-view";
import { initialsFor } from "./topbar-utils";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

const workspaceFixture = demoWorkspaces[0];

if (!workspaceFixture) {
  throw new Error("The demo workspace fixture is required for the shell test.");
}

const currentWorkspace: (typeof demoWorkspaces)[number] = workspaceFixture;

const TIMESTAMP = "2026-01-01T00:00:00.000Z";

function makeMember(
  id: string,
  name: string,
  role: WorkspaceMemberWithUser["role"] = "editor",
): WorkspaceMemberWithUser {
  return {
    id,
    workspaceId: currentWorkspace.id,
    userId: id,
    role,
    status: "active",
    joinedAt: TIMESTAMP,
    invitedById: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    user: {
      id,
      email: `${id}@roamlog.test`,
      emailVerified: true,
      name,
      image: null,
      platformRole: "user",
      status: "active",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      lastActiveAt: null,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      deletedAt: null,
    },
  };
}

function renderShell(
  overrides: {
    members?: WorkspaceMemberWithUser[];
    unreadNotificationCount?: number;
    unreadNotificationsHaveMore?: boolean;
    pathname?: string;
  } = {},
) {
  return renderWithQuery(
    <AppShellView
      currentUser={demoUser}
      workspaces={demoWorkspaces}
      currentWorkspace={currentWorkspace}
      trips={demoTrips}
      pathname={`/w/${currentWorkspace.slug}`}
      {...overrides}
    >
      <main>
        <h1>旅行总览</h1>
        <Button variant="primary">新建旅行</Button>
      </main>
    </AppShellView>,
  );
}

describe("Web application shell", () => {
  it("renders the primary workspace navigation and a visible primary page action", () => {
    const { container } = renderShell();

    for (const label of ["总览", "旅行", "日志", "地图", "洞察", "成员", "活动", "通知"]) {
      expect(screen.getAllByRole("link", { name: label }).length).toBeGreaterThan(0);
    }

    expect(screen.getAllByText("Roamlog Crew").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/所有者 · 团队版/u).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/\bOwner\b/);
    expect(container.textContent).not.toMatch(/\bWorkspace\b/);
    expect(screen.getByRole("button", { name: "搜索或运行命令 ⌘K" })).toBeInTheDocument();
    expect(container.querySelectorAll("button.bg-ink").length).toBeLessThanOrEqual(1);
  });

  it("uses the active theme canvas for the sticky top bar", () => {
    renderShell();

    const header = screen.getByRole("banner");
    expect(header.className).toContain("bg-canvas/80");
    expect(header.className).not.toContain("bg-black");
  });

  it("renders five accessible items in the mobile bottom navigation", () => {
    renderShell({ pathname: `/w/${currentWorkspace.slug}/trips` });

    const mobileNavigation = screen.getByRole("navigation", { name: "移动端主导航" });
    expect(mobileNavigation.className).toContain("bg-surface-1/95");
    expect(mobileNavigation.className).not.toContain("bg-black");

    for (const label of ["总览", "旅行", "日志", "地图", "更多"]) {
      expect(within(mobileNavigation).getByRole("link", { name: label })).toBeInTheDocument();
    }

    expect(within(mobileNavigation).getByRole("link", { name: "旅行" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks the map tab active and keeps current-page state off More", () => {
    renderShell({ pathname: `/w/${currentWorkspace.slug}/map` });
    const mobileNavigation = screen.getByRole("navigation", { name: "移动端主导航" });

    expect(within(mobileNavigation).getByRole("link", { name: "地图" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(mobileNavigation).getByRole("link", { name: "更多" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks More active on AI so the mobile navigation always has a current item", () => {
    renderShell({ pathname: `/w/${currentWorkspace.slug}/ai` });
    const mobileNavigation = screen.getByRole("navigation", { name: "移动端主导航" });

    expect(within(mobileNavigation).getByRole("link", { name: "更多" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("Web top bar truthfulness", () => {
  it("points the create action at the real new-trip route instead of the command palette", () => {
    renderShell();

    const newTripLinks = screen.getAllByRole("link", { name: "新建旅行" });
    expect(newTripLinks.length).toBeGreaterThan(0);

    for (const link of newTripLinks) {
      expect(link).toHaveAttribute("href", `/w/${currentWorkspace.slug}/trips/new`);
    }

    // The old decorative plus only opened the command palette.
    expect(screen.queryByRole("button", { name: "快速新建" })).not.toBeInTheDocument();
  });

  it("renders no placeholder people and no fake online presence", () => {
    const { container } = renderShell();

    for (const fakeName of ["同行者", "编辑者", "位协作者在线"]) {
      expect(screen.queryByText(fakeName)).not.toBeInTheDocument();
    }

    expect(screen.queryByTestId("topbar-members")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/协作者在线/);
  });

  it("hides the member strip until real workspace members are provided", () => {
    const { rerender } = renderWithQuery(
      <AppShellView
        currentUser={demoUser}
        workspaces={demoWorkspaces}
        currentWorkspace={currentWorkspace}
        trips={demoTrips}
        pathname={`/w/${currentWorkspace.slug}`}
      >
        <main>旅行库</main>
      </AppShellView>,
    );

    expect(screen.queryByTestId("topbar-members")).not.toBeInTheDocument();

    rerender(
      <AppShellView
        currentUser={demoUser}
        workspaces={demoWorkspaces}
        currentWorkspace={currentWorkspace}
        trips={demoTrips}
        pathname={`/w/${currentWorkspace.slug}`}
        members={[makeMember("member-1", "林晓", "owner")]}
      >
        <main>旅行库</main>
      </AppShellView>,
    );

    expect(screen.getByTestId("topbar-members")).toBeInTheDocument();
  });

  it("shows one glyph per CJK member name, real latin initials, and no online dot", () => {
    renderShell({
      members: [
        makeMember("member-1", "林晓", "owner"),
        makeMember("member-2", "Alex Chen", "editor"),
      ],
    });

    const strip = screen.getByTestId("topbar-members");

    expect(strip).toHaveAttribute("href", `/w/${currentWorkspace.slug}/members`);
    expect(strip.getAttribute("aria-label")).toContain("工作区成员 2 人");
    // WCAG 2.5.3 Label in Name: the visible glyphs must appear verbatim in the
    // accessible name, otherwise axe reports `label-content-name-mismatch`.
    expect(strip.getAttribute("aria-label")).toContain("林、AC");
    expect(strip.getAttribute("aria-label")).not.toContain("林晓");

    // A CJK name keeps exactly one glyph, so neighbours cannot read as one word.
    expect(within(strip).getByText("林")).toBeInTheDocument();
    expect(within(strip).getByText("林")).toHaveAttribute("aria-hidden", "true");
    expect(within(strip).queryByText("林晓")).not.toBeInTheDocument();
    expect(within(strip).getByText("AC")).toBeInTheDocument();
    expect(within(strip).getByText("AC")).toHaveAttribute("aria-hidden", "true");

    // No realtime presence channel exists, so nothing may claim to be online.
    expect(strip.innerHTML).not.toMatch(/在线/);
    expect(strip.className).not.toMatch(/-space-x-/);
  });

  it("shows an overflow marker instead of squeezing many members together", () => {
    renderShell({
      members: [
        makeMember("member-1", "林晓"),
        makeMember("member-2", "陈默"),
        makeMember("member-3", "周舟"),
        makeMember("member-4", "Alex Chen"),
      ],
    });

    const strip = screen.getByTestId("topbar-members");

    expect(strip.getAttribute("aria-label")).toContain("工作区成员 4 人");
    // The "+N" glyph is visible text too, so it must appear verbatim in the name.
    expect(strip.getAttribute("aria-label")).toContain("林、陈、周、+1");
    expect(within(strip).getByText("+1")).toBeInTheDocument();
    expect(within(strip).getByText("+1")).toHaveAttribute("aria-hidden", "true");
    expect(strip.className).toMatch(/\bgap-1\.5\b/);
  });

  it("hides the unread badge when the real unread count is zero", () => {
    renderShell({ unreadNotificationCount: 0 });

    expect(screen.queryByTestId("topbar-notifications-badge")).not.toBeInTheDocument();
    expect(screen.getByTestId("topbar-notifications").getAttribute("aria-label")).toBe(
      "通知，没有未读",
    );
  });

  it("shows and announces the real unread count", () => {
    renderShell({ unreadNotificationCount: 3 });

    expect(screen.getByTestId("topbar-notifications-badge")).toHaveTextContent("3");
    expect(screen.getByTestId("topbar-notifications").getAttribute("aria-label")).toBe(
      "通知，3 条未读",
    );
  });

  it("keeps every top-bar control focusable, labelled, and motion-independent", () => {
    renderShell({
      members: [makeMember("member-1", "林晓", "owner")],
      unreadNotificationCount: 2,
    });

    const header = screen.getByRole("banner");
    const controls = [
      ...within(header).getAllByRole("button"),
      ...within(header).getAllByRole("link"),
    ];

    expect(controls.length).toBeGreaterThan(0);

    for (const control of controls) {
      const name = control.getAttribute("aria-label") ?? control.textContent?.trim() ?? "";
      expect(name.length).toBeGreaterThan(0);
      expect(control.className).toMatch(/focus-visible:ring-2/);
    }

    // Nothing in the top bar depends on an animation.
    expect(header.innerHTML).not.toMatch(/\banimate-/);
  });
});

describe("topbar initials", () => {
  it("keeps CJK names to a single glyph", () => {
    expect(initialsFor("同行者")).toBe("同");
    expect(initialsFor("编辑者")).toBe("编");
    expect(initialsFor("林晓")).toBe("林");
    expect(initialsFor("林 晓")).toBe("林");
  });

  it("uses latin initials", () => {
    expect(initialsFor("alex")).toBe("A");
    expect(initialsFor("Ada Lovelace")).toBe("AL");
  });

  it("falls back for a blank name", () => {
    expect(initialsFor("   ")).toBe("?");
  });
});
