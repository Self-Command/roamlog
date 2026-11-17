"use client";

import { Button, ErrorState } from "@roamlog/ui";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-5 py-16">
      <div className="w-full max-w-lg">
        <p className="mb-6 text-center font-serif text-2xl tracking-[-0.03em] text-ink">Roamlog</p>
        <ErrorState
          title="页面遇到异常"
          description={error.digest ? `请求编号：${error.digest}` : error.message}
          retryAction={
            <Button type="button" variant="primary" onClick={reset}>
              重试
            </Button>
          }
        />
      </div>
    </main>
  );
}
