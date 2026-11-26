import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMutate, applyAppearanceToDocument, writeAppearancePreviewCookie } = vi.hoisted(
  () => ({
    updateMutate: vi.fn(),
    applyAppearanceToDocument: vi.fn(),
    writeAppearancePreviewCookie: vi.fn(),
  }),
);

vi.mock("@/lib/query", () => ({
  useAppearanceQuery: () => ({
    data: {
      mode: "system",
      skin: "porcelain",
      fontPairing: "fluent-native",
      source: "user",
      canOverride: true,
      updatedAt: null,
      defaults: { mode: "system", skin: "porcelain", fontPairing: "fluent-native" },
    },
    error: null,
  }),
  useUpdateAppearanceMutation: () => ({
    mutateAsync: updateMutate,
    isPending: false,
  }),
}));

vi.mock("@/lib/api/appearance", () => ({
  applyAppearanceToDocument,
  writeAppearancePreviewCookie,
}));

import { QuickAppearanceControl } from "./quick-appearance-control";

describe("QuickAppearanceControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMutate.mockResolvedValue({
      mode: "dark",
      skin: "porcelain",
      fontPairing: "fluent-native",
      source: "user",
      canOverride: true,
      updatedAt: null,
      defaults: { mode: "system", skin: "porcelain", fontPairing: "fluent-native" },
    });
  });

  it("applies and saves a mode change", async () => {
    const user = userEvent.setup();
    render(<QuickAppearanceControl workspaceSlug="demo" />);

    await user.click(screen.getByTestId("quick-appearance-trigger"));
    await user.click(await screen.findByRole("radio", { name: "深色" }));

    expect(updateMutate).toHaveBeenCalledWith({ mode: "dark" });
    expect(applyAppearanceToDocument).toHaveBeenCalledWith({
      mode: "dark",
      skin: "porcelain",
      fontPairing: "fluent-native",
    });
    expect(writeAppearancePreviewCookie).toHaveBeenCalled();
  });

  it("reverts the optimistic choice when saving fails", async () => {
    const user = userEvent.setup();
    updateMutate.mockRejectedValueOnce(new Error("网络不可用"));
    render(<QuickAppearanceControl workspaceSlug="demo" />);

    await user.click(screen.getByTestId("quick-appearance-trigger"));
    await user.click(await screen.findByRole("radio", { name: /Fluent 2 原生企业/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("网络不可用"));
    expect(applyAppearanceToDocument).toHaveBeenLastCalledWith({
      mode: "system",
      skin: "porcelain",
      fontPairing: "fluent-native",
    });
  });
});
