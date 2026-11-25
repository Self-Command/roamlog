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
        <p className="mb-6 text-center font-display text-xl font-semibold tracking-[-0.02em] text-ink">
          Roamlog
        </p>
        <ErrorState
          title="页面暂时无法打开"
          description={
            error.digest
              ? `页面暂时无法显示。请重试；如果仍然失败，请把请求编号 ${error.digest} 发给支持人员。`
              : "页面暂时无法显示。请重试；如果仍然失败，请稍后联系支持人员。"
          }
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
