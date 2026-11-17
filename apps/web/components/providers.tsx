"use client";

import { Button, TooltipProvider } from "@roamlog/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { startMockWorker } from "@/lib/msw";
import { DemoDataProvider } from "@/lib/demo-store";

const mocksEnabled = process.env.NODE_ENV !== "production";

type MockState = "starting" | "ready" | "failed";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  const [mockState, setMockState] = useState<MockState>(mocksEnabled ? "starting" : "ready");
  const [mockError, setMockError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!mocksEnabled) return;

    let active = true;
    setMockState("starting");
    setMockError(null);

    startMockWorker()
      .then(() => {
        if (active) setMockState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMockState("failed");
        setMockError(error instanceof Error ? error.message : "Unknown MSW startup error.");
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  if (mockState === "starting") {
    return (
      <div
        role="status"
        className="flex min-h-dvh items-center justify-center bg-canvas px-6 text-center"
      >
        <div>
          <p className="type-eyebrow">LOCAL DEVELOPMENT BOUNDARY</p>
          <p className="mt-3 font-serif text-2xl text-ink">正在准备本地旅行数据</p>
          <p className="mt-2 text-sm text-muted">MSW 只在 development / test 环境启动。</p>
        </div>
      </div>
    );
  }

  if (mockState === "failed") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-6">
        <div className="w-full max-w-md rounded-card border border-accent-red/20 bg-accent-red/5 p-6">
          <p className="type-eyebrow text-accent-red">MOCK BOUNDARY FAILED</p>
          <h1 className="mt-3 font-serif text-2xl text-ink">本地数据服务没有启动</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            请确认 `public/mockServiceWorker.js` 存在，然后重试。生产构建不会启用 MSW。
          </p>
          {mockError ? <p className="mt-3 font-mono text-[10px] text-stone">{mockError}</p> : null}
          <Button
            type="button"
            variant="primary"
            className="mt-5"
            onClick={() => setAttempt((current) => current + 1)}
          >
            重试
          </Button>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <DemoDataProvider>{children}</DemoDataProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
