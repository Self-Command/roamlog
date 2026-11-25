import { Button, EmptyState } from "@roamlog/ui";
import { Compass } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-5 py-16">
      <div className="w-full max-w-lg">
        <p className="mb-6 text-center font-display text-xl font-semibold tracking-[-0.02em] text-ink">
          Roamlog
        </p>
        <EmptyState
          icon={Compass}
          title="找不到这个页面"
          description="链接可能已失效，或页面已经移动。请返回首页后重试。"
          action={
            <Button asChild variant="primary">
              <Link href="/">返回首页</Link>
            </Button>
          }
        />
      </div>
    </main>
  );
}
