import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ResetPasswordForm } from "./reset-password-form";

describe("ResetPasswordForm", () => {
  it("renders a disabled POST form before hydration", () => {
    const html = renderToStaticMarkup(<ResetPasswordForm token="test-token" />);
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(document.querySelector("form")?.getAttribute("method")).toBe("post");
    expect(document.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(true);
  });
});
