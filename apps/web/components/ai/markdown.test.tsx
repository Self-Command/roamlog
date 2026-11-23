import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Markdown } from "./markdown";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Markdown code blocks", () => {
  it("renders the language header, line numbers and copy action for fenced code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<Markdown text={"```ts\nconst city = '京都';\nconsole.log(city);\n```"} />);

    expect(screen.getByText("ts")).toBeInTheDocument();
    expect(screen.getByText("const city = '京都';")).toBeInTheDocument();
    expect(document.querySelector('[data-streamdown="code-block"]')).toBeInTheDocument();
    expect(document.querySelector("code")?.className).toContain("[counter-increment:line_0]");

    await userEvent.click(screen.getByRole("button", { name: /copy code/i }));
    expect(writeText).toHaveBeenCalledWith("const city = '京都';\nconsole.log(city);\n");
  });
});
