import { TooltipProvider } from "@roamlog/ui";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { DemoDataProvider } from "@/lib/demo-store";

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <DemoDataProvider>{children}</DemoDataProvider>
    </TooltipProvider>
  );
}

export function renderWithDemo(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, { wrapper: Wrapper, ...options });
}
