"use client";

import type { ReactNode } from "react";

import { DemoDataProvider } from "@/lib/demo-store";

/**
 * Development-only boundary for the legacy demo application.
 *
 * Everything below this module is fixture/demo code. It is loaded through
 * `next/dynamic` from `components/providers.tsx` and must never be imported by
 * a production route (see `components/legacy-mock/README.md`).
 */
export function LegacyMockRoot({ children }: { children: ReactNode }) {
  return <DemoDataProvider>{children}</DemoDataProvider>;
}

/** Starts the MSW worker. Loaded only from the legacy demo boundary. */
export async function startMockWorker(): Promise<void> {
  const module = await import("@/lib/msw");
  return module.startMockWorker();
}
