import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HydrationSafeForm, HydrationSafeSubmitButton } from "../primitives/hydration-safe-form";

function Probe({ disabled }: { disabled?: boolean }) {
  return (
    <HydrationSafeForm>
      <input name="password" type="password" />
      <HydrationSafeSubmitButton disabled={disabled}>继续</HydrationSafeSubmitButton>
    </HydrationSafeForm>
  );
}

describe("HydrationSafeForm", () => {
  it("renders a POST form with a disabled submit button before hydration", () => {
    const html = renderToStaticMarkup(<Probe />);
    const document = new DOMParser().parseFromString(html, "text/html");
    const form = document.querySelector("form");
    const submit = document.querySelector('button[type="submit"]');

    expect(form?.getAttribute("method")).toBe("post");
    expect(submit?.hasAttribute("disabled")).toBe(true);
  });

  it("enables submit after hydration and keeps caller disabled state", () => {
    const { rerender } = render(<Probe />);
    expect(screen.getByRole("button", { name: "继续" })).toBeEnabled();

    rerender(<Probe disabled />);
    expect(screen.getByRole("button", { name: "继续" })).toBeDisabled();
  });
});
