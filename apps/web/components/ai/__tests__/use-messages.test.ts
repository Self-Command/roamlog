import { describe, expect, it, vi } from "vitest";

import { latestPendingAnchor, scrollAnchorWithinContainer } from "../use-messages";

function rect(top: number): DOMRect {
  return {
    bottom: top,
    height: 0,
    left: 0,
    right: 0,
    top,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("scrollAnchorWithinContainer", () => {
  it("places a new form header near the top of the message viewport", () => {
    const container = document.createElement("div");
    const anchor = document.createElement("section");
    container.scrollTop = 500;
    container.getBoundingClientRect = () => rect(100);
    anchor.getBoundingClientRect = () => rect(720);
    const scrollTo = vi.fn();
    Object.defineProperty(container, "scrollTo", { value: scrollTo });

    scrollAnchorWithinContainer(container, anchor, 12);

    expect(scrollTo).toHaveBeenCalledWith({
      behavior: "instant",
      top: 1108,
    });
  });
});

describe("latestPendingAnchor", () => {
  it("selects the latest unanswered human form", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <section data-testid="ask-user-tool" data-pending="true">first</section>
      <section data-testid="plan-surface">historical plan</section>
      <section data-testid="confirm-brief-tool" data-pending="true">latest</section>
    `;

    expect(latestPendingAnchor(container)).toHaveTextContent("latest");
  });

  it("ignores submitted receipts and historical plans", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <section data-testid="ask-user-result">submitted</section>
      <section data-testid="plan-surface">historical plan</section>
    `;

    expect(latestPendingAnchor(container)).toBeUndefined();
  });
});
