import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom has no layout engine, so ProseMirror's scrollToSelection would throw on
// editor.chain().focus() calls made from the rich text toolbar.
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

const emptyRect: DOMRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  toJSON: () => emptyRect,
} as DOMRect;

/** jsdom defines these on Element only; ProseMirror also measures Text nodes and DOM ranges. */
interface MeasurablePrototype {
  getClientRects?: () => DOMRectList;
  getBoundingClientRect?: () => DOMRect;
}

for (const prototype of [
  Element.prototype,
  CharacterData.prototype,
  Range.prototype,
] as MeasurablePrototype[]) {
  if (typeof prototype.getClientRects !== "function") {
    prototype.getClientRects = () => [emptyRect] as unknown as DOMRectList;
  }
  if (typeof prototype.getBoundingClientRect !== "function") {
    prototype.getBoundingClientRect = () => emptyRect;
  }
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
