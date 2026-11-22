import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ProviderConfigField } from "@roamlog/contracts";

import { ProviderCatalogField } from "./provider-catalog-field";

const regionField: ProviderConfigField = {
  key: "regions",
  type: "multi-select",
  label: "适用区域",
  required: true,
  options: [
    { value: "cn", label: "中国" },
    { value: "global", label: "全球" },
  ],
};

describe("ProviderCatalogField multi-select", () => {
  it("exposes every option as a named checkbox and reports its value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const view = render(
      <ProviderCatalogField field={regionField} value={[]} onChange={onChange} />,
    );

    const china = screen.getByRole("checkbox", { name: "中国" });
    const global = screen.getByRole("checkbox", { name: "全球" });
    expect(china).not.toBeChecked();
    expect(global).not.toBeChecked();

    await user.click(china);
    expect(onChange).toHaveBeenLastCalledWith(["cn"]);

    view.rerender(<ProviderCatalogField field={regionField} value={["cn"]} onChange={onChange} />);
    expect(screen.getByRole("checkbox", { name: "中国" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "全球" })).not.toBeChecked();
  });
});
