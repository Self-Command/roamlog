import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AdminContentPage from "./page";

vi.mock("../../../components/admin-shell/admin-console-role-aware", () => ({
  AdminConsoleRoleAware: ({ children }: { children: (role: string) => React.ReactNode }) =>
    children("admin"),
}));

vi.mock("../../../components/content/content-view", () => ({
  ContentView: ({ role }: { role: string }) => <div>content view for {role}</div>,
}));

describe("AdminContentPage", () => {
  it("mounts the moderation queue for the resolved console role", () => {
    render(<AdminContentPage />);
    expect(screen.getByText("content view for admin")).toBeInTheDocument();
  });
});