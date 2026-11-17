import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AdminResource } from "../../lib/admin-data-source";
import { AdminDataBoundary } from "./admin-data-boundary";

describe("AdminDataBoundary", () => {
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
