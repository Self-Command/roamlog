import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let nextAnimationFrameId = 1;
const animationFrameTimers = new Map<number, ReturnType<typeof setTimeout>>();

const requestAnimationFrameStub = (callback: FrameRequestCallback): number => {
  const id = nextAnimationFrameId++;
  const timer = setTimeout(() => {
    animationFrameTimers.delete(id);
    callback(performance.now());
  }, 16);
  animationFrameTimers.set(id, timer);
  return id;
};

const cancelAnimationFrameStub = (id: number): void => {
  const timer = animationFrameTimers.get(id);
  if (timer === undefined) {
    return;
  }
  clearTimeout(timer);
  animationFrameTimers.delete(id);
};

function installAnimationFrameStubs(target: object): void {
  // Preact snapshots `typeof requestAnimationFrame` at module load and pairs it
  // with the global `cancelAnimationFrame`. jsdom can expose one without the
  // other, which leaves Uppy's delayed Dashboard callbacks throwing after a test.
  Object.defineProperty(target, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: requestAnimationFrameStub,
  });
  Object.defineProperty(target, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: cancelAnimationFrameStub,
  });
}

installAnimationFrameStubs(globalThis);
if (typeof window !== "undefined" && window !== globalThis) {
  installAnimationFrameStubs(window);
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
  for (const timer of animationFrameTimers.values()) {
    clearTimeout(timer);
  }
  animationFrameTimers.clear();
  nextAnimationFrameId = 1;
  window.localStorage.clear();
});
