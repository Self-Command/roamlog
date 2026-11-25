"use client";

import { Button, ErrorState } from "@roamlog/ui";

export default function AdminError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <ErrorState
        title="后台页面加载失败"
        description="后台数据加载失败，请重试；如果持续失败，请联系平台管理员。"
        retryAction={
          <Button variant="ghost" onClick={reset}>
            重试
          </Button>
        }
      />
    </div>
  );
}
