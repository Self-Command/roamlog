import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Switch } from "@roamlog/ui";

import type { AdminResource } from "../../lib/admin-data-source";
import { AdminDataBoundary } from "./admin-data-boundary";

describe("AdminDataBoundary", () => {
  it("does not serialize Radix hidden inputs during server rendering", () => {
    const resource: AdminResource<string> = {
      mode: "fixture",
      data: "ready",
      isLoading: false,
      error: null,
      degraded: [],
      refetch: vi.fn(),
    };

    const html = renderToString(
      <AdminDataBoundary resource={resource}>
        {() => <Switch aria-label="灰度开关" defaultChecked />}
      </AdminDataBoundary>,
    );

    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("正在准备后台视图");
  });

  it("renders the 2FA enrollment gate for ADMIN_2FA_REQUIRED", () => {
    const resource: AdminResource<string> = {
      mode: "api",
      data: null,
      isLoading: false,
      error: {
        code: "ADMIN_2FA_REQUIRED",
        status: 403,
        title: "Forbidden",
        detail: "Enroll and verify TOTP before accessing the Admin API.",
        degraded: [],
      },
      degraded: [],
      refetch: vi.fn(),
    };

    render(<AdminDataBoundary resource={resource}>{() => <p>secret data</p>}</AdminDataBoundary>);

    expect(screen.getByRole("alert")).toHaveTextContent("2FA ENROLLMENT REQUIRED");
    expect(screen.getByText("ADMIN_2FA_REQUIRED")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "绑定验证器" })).toBeInTheDocument();
    expect(screen.queryByText("secret data")).not.toBeInTheDocument();
  });
});
