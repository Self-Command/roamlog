import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ProviderSecretFieldDescriptor, ProviderSecretState } from "@roamlog/contracts";

import { AdminMutationError } from "../../lib/admin-api-error";
import { ProviderSecretField } from "./provider-secret-field";

const field: ProviderSecretFieldDescriptor = {
  key: "apiKey",
  label: "API Key",
  required: true,
};

const saved: ProviderSecretState = {
  field: "apiKey",
  hasValue: true,
  last4: "1234",
  version: 3,
};

function renderField(
  overrides: {
    canReveal?: boolean;
    onReveal?: () => Promise<{ field: string; value: string; expiresAt: string | null }>;
  } = {},
) {
  const onReveal =
    overrides.onReveal ??
    vi.fn(async () => ({
      field: "apiKey",
      value: "sk-plain",
      expiresAt: new Date(Date.now() + 10_000).toISOString(),
    }));
  render(
    <ProviderSecretField
      field={field}
      saved={saved}
      value=""
      error={undefined}
      canReveal={overrides.canReveal ?? true}
      onChange={vi.fn()}
      onReveal={onReveal}
    />,
  );
  return { onReveal };
}

describe("ProviderSecretField", () => {
  it("requires explicit confirmation, reveals, and hides immediately", async () => {
    const user = userEvent.setup();
    const { onReveal } = renderField();

    expect(screen.getByText(/••••1234/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "显示明文" }));

    expect(screen.getByText("确认显示这个密钥？")).toBeInTheDocument();
    expect(onReveal).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认显示" }));
    await waitFor(() => expect(screen.getByDisplayValue("sk-plain")).toBeInTheDocument());
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/明文将在 10 秒后自动隐藏/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "立即隐藏" }));
    expect(screen.queryByDisplayValue("sk-plain")).not.toBeInTheDocument();
  });

  it("removes plaintext from the DOM when the server expiry passes", async () => {
    const user = userEvent.setup();
    renderField({
      onReveal: async () => ({
        field: "apiKey",
        value: "sk-expiring",
        expiresAt: new Date(Date.now() + 100).toISOString(),
      }),
    });

    await user.click(screen.getByRole("button", { name: "显示明文" }));
    await user.click(screen.getByRole("button", { name: "确认显示" }));
    await waitFor(() => expect(screen.getByDisplayValue("sk-expiring")).toBeInTheDocument());

    await waitFor(() => expect(screen.queryByDisplayValue("sk-expiring")).not.toBeInTheDocument(), {
      timeout: 1_000,
    });
  });

  it("keeps reveal disabled for non-super-admins", () => {
    renderField({ canReveal: false });

    expect(screen.getByRole("button", { name: "显示明文" })).toBeDisabled();
  });

  it("maps TOTP and secret-service failures to actionable copy", async () => {
    const user = userEvent.setup();
    renderField({
      onReveal: async () => {
        throw new AdminMutationError({
          code: "ADMIN_2FA_REQUIRED",
          status: 403,
          title: "需要两步验证",
          detail: "TOTP required",
          degraded: [],
        });
      },
    });

    await user.click(screen.getByRole("button", { name: "显示明文" }));
    await user.click(screen.getByRole("button", { name: "确认显示" }));

    expect(await screen.findByText(/需要完成 TOTP 两步验证/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("sk-plain")).not.toBeInTheDocument();
  });
});
