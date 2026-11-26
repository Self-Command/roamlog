import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  fetch: vi.fn(),
  save: vi.fn(),
  writeCookie: vi.fn(),
  fromDocument: vi.fn(),
}));

vi.mock("@/lib/appearance", () => ({
  ADMIN_FALLBACK_APPEARANCE: {
    mode: "dark",
    skin: "carbon",
    fontPairing: "carbon-plex",
  },
  adminAppearanceFromDocument: mocks.fromDocument,
  applyAdminAppearanceToDocument: mocks.apply,
  fetchAdminAppearance: mocks.fetch,
  saveAdminAppearance: mocks.save,
  writeAdminAppearancePreviewCookie: mocks.writeCookie,
}));

import { QuickAppearanceControl } from "./quick-appearance-control";

const resolved = {
  mode: "dark",
  skin: "carbon",
  fontPairing: "carbon-plex",
  source: "user",
  canOverride: true,
  updatedAt: null,
  defaults: { mode: "system", skin: "porcelain", fontPairing: "fluent-native" },
};

describe("Admin QuickAppearanceControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fromDocument.mockReturnValue({
      mode: "dark",
      skin: "carbon",
      fontPairing: "carbon-plex",
    });
    mocks.fetch.mockResolvedValue(resolved);
    mocks.save.mockResolvedValue({ ...resolved, mode: "light" });
  });

  it("loads appearance when opened, then saves a mode change", async () => {
    const user = userEvent.setup();
    render(<QuickAppearanceControl />);

    expect(mocks.fetch).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("quick-appearance-trigger"));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole("radio", { name: "浅色" }));

    expect(mocks.save).toHaveBeenCalledWith({ mode: "light" });
    expect(mocks.apply).toHaveBeenCalledWith({
      mode: "light",
      skin: "carbon",
      fontPairing: "carbon-plex",
    });
  });

  it("reverts when the server rejects the change", async () => {
    const user = userEvent.setup();
    mocks.save.mockRejectedValueOnce(new Error("保存失败"));
    render(<QuickAppearanceControl />);

    await user.click(screen.getByTestId("quick-appearance-trigger"));
    await user.click(await screen.findByRole("radio", { name: "浅色" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("保存失败"));
    expect(mocks.apply).toHaveBeenLastCalledWith({
      mode: "dark",
      skin: "carbon",
      fontPairing: "carbon-plex",
    });
  });
});
