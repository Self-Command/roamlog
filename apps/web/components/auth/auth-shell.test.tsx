import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthShell } from "./auth-shell";

const IMPLEMENTATION_DETAILS = /Workspace|token|服务端|9\s*趟旅行/i;

describe("AuthShell", () => {
  it("keeps the brand column and renders the form slot", () => {
    render(
      <AuthShell>
        <p>auth form slot</p>
      </AuthShell>,
    );

    expect(screen.getByText("auth form slot")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("把旅行写成");
    expect(screen.getByText("SHARED, NOT SOCIAL")).toBeInTheDocument();
  });

  it("never invents workspace activity for anonymous visitors", () => {
    const { container } = render(
      <AuthShell>
        <p>auth form slot</p>
      </AuthShell>,
    );

    const text = container.textContent ?? "";

    // The shell used to ship hardcoded "recent activity" rows. An anonymous
    // visitor has no workspace, so there is no honest activity to show: the
    // brand column must not claim activity, a roster, or any timestamp.
    expect(text).not.toMatch(/activity|活动/i);
    expect(text).not.toMatch(/分钟前|小时前|天前|昨天|刚刚/);
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
    expect(container.querySelectorAll("time")).toHaveLength(0);
  });

  it("keeps visitor-facing copy free of implementation details", () => {
    const { container } = render(
      <AuthShell>
        <p>auth form slot</p>
      </AuthShell>,
    );

    expect(container.textContent).not.toMatch(IMPLEMENTATION_DETAILS);
    expect(screen.getByText("A HOME FOR SHARED JOURNEYS")).toBeInTheDocument();
  });
});
