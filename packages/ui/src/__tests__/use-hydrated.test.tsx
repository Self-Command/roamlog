import { renderHook } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { useHydrated } from "../lib/use-hydrated";

function Probe() {
  return <span>{useHydrated() ? "hydrated" : "server"}</span>;
}

describe("useHydrated", () => {
  it("uses the server snapshot until React hydrates", () => {
    expect(renderToStaticMarkup(<Probe />)).toContain("server");
  });

  it("returns true in an interactive client tree", () => {
    const { result } = renderHook(() => useHydrated());
    expect(result.current).toBe(true);
  });
});
