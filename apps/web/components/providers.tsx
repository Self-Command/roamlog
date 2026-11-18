"use client";

import { Button, TooltipProvider } from "@roamlog/ui";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";

import { isUnauthorized } from "@/lib/api";
import { DATA_MODE } from "@/lib/data-mode";
import { DataProvider } from "@/lib/data-provider";
import { useSessionQuery } from "@/lib/query";

/**
 * Mount gate for the demo store — depends on the data mode **only**.
 *
 * A production `next build && next start` in mock mode (local smoke test, E2E
 * against a production server, a demo deployment) still needs
 * `DemoDataProvider`, otherwise every `useDemoStore` page throws. Whether the
 * fixture code is *shipped at all* is decided separately by `isApiBuild`
 * below; the two concerns are orthogonal.
 */
const mockModeEnabled = DATA_MODE === "mock";

/**
 * MSW itself stays development/test only — same contract as the loading copy
 * rendered below. A production mock build therefore mounts the demo store
 * without the service worker.
 */
const mswEnabled = mockModeEnabled && process.env.NODE_ENV !== "production";

/**
 * Build-time guard for the fixture boundary.
 *
 * `next/dynamic` always emits its own chunk, so the import has to sit inside a
 * branch the bundler can constant-fold. `process.env.NEXT_PUBLIC_DATA_MODE` is
 * inlined at build time, which makes `isApiBuild` a literal `true`/`false`, and
 * the unused branch (plus its `import()`) is dropped from an api build.
 *
 * The comparison is kept literal on purpose — routing it through
 * `resolveDataMode()` would hide it from the bundler's constant folding.
 */
const isApiBuild = process.env.NEXT_PUBLIC_DATA_MODE === "api";

type MockRootComponent = ComponentType<{ children: ReactNode }>;

/** Lazily loaded legacy demo boundary — never part of an api-mode bundle. */
const LegacyMockRoot: MockRootComponent | undefined = isApiBuild
  ? undefined
  : dynamic(
      () => import("@/components/legacy-mock/mock-root").then((module) => module.LegacyMockRoot),
      { ssr: false, loading: () => <MockBootScreen /> },
    );

/** Starts MSW through the same lazy boundary so the mock package stays out of api builds. */
const startMockRuntime: (() => Promise<void>) | undefined = isApiBuild
  ? undefined
  : () => import("@/components/legacy-mock/mock-root").then((module) => module.startMockWorker());

type MockState = "starting" | "ready" | "failed";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => {
            if (isUnauthorized(error)) redirectToLogin();
          },
        }),
        mutationCache: new MutationCache({
          onError: (error) => {
            if (isUnauthorized(error)) redirectToLogin();
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  const [mockState, setMockState] = useState<MockState>(mswEnabled ? "starting" : "ready");
  const [mockError, setMockError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!mswEnabled || !startMockRuntime) return;

    let active = true;
    setMockState("starting");
    setMockError(null);

    startMockRuntime()
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

  if (mswEnabled && mockState === "starting") {
    return <MockBootScreen />;
  }

  if (mswEnabled && mockState === "failed") {
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
        <DataProvider>
          {DATA_MODE === "api" ? <SessionBootstrap /> : null}
          {mockModeEnabled && LegacyMockRoot ? (
            <LegacyMockRoot>{children}</LegacyMockRoot>
          ) : (
            children
          )}
        </DataProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function MockBootScreen() {
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

function SessionBootstrap() {
  useSessionQuery();
  return null;
}

function redirectToLogin() {
  if (typeof window === "undefined") return;
  const pathname = window.location.pathname;
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/verify-email") ||
    pathname.startsWith("/invite")
  ) {
    return;
  }

  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}
