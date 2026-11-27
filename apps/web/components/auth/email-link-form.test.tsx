import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EmailLinkForm } from "./email-link-form";

describe("EmailLinkForm", () => {
  it("renders a disabled POST form before hydration", () => {
    const html = renderToStaticMarkup(
      <EmailLinkForm submitLabel="发送重置链接" successMessage="已发送" />,
    );
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(document.querySelector("form")?.getAttribute("method")).toBe("post");
    expect(document.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(true);
  });
});
