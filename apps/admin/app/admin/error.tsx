"use client";

import { Button, ErrorState } from "@roamlog/ui";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <ErrorState
        title="后台页面加载失败"
        description={error.message || "后台数据读取失败。请重试。"}
        retryAction={
          <Button variant="ghost" onClick={reset}>
            重试
          </Button>
        }
      />
    </div>
  );
}
