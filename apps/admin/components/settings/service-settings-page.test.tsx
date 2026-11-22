import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../admin-shell/admin-session-provider", () => ({
  useAdminSession: () => ({ session: { role: "super_admin" } }),
}));

vi.mock("./provider-group-page", () => ({
  ProviderGroupPage: ({ group }: { group: string }) => (
    <div data-testid="provider-group-page">{group}</div>
  ),
}));

vi.mock("./settings-group-form", () => ({
  SettingsGroupForm: ({ group }: { group: string }) => (
    <section data-settings-group={group} data-testid="settings-group-form" />
  ),
}));

import { ServiceSettingsPage } from "./service-settings-page";

describe("ServiceSettingsPage", () => {
  it.each([
    ["ai", "AI 服务"],
    ["storage", "存储服务"],
    ["places", "地图服务"],
    ["mail", "发信服务"],
  ] as const)("wraps the %s service page in one settings group section", (service, title) => {
    const { container } = render(<ServiceSettingsPage service={service} />);

    const sections = container.querySelectorAll(`section[data-settings-group="${service}"]`);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toHaveAttribute("aria-label", `${title} 设置`);
    expect(screen.getByTestId("provider-group-page")).toHaveTextContent(service);
  });

  it("does not duplicate the media form's settings group section", () => {
    const { container } = render(<ServiceSettingsPage service="media" />);

    expect(container.querySelectorAll("section[data-settings-group]")).toHaveLength(1);
    expect(container.querySelector('section[data-settings-group="media"]')).toBeInTheDocument();
  });
});
