import { Button, EmptyState } from "@roamlog/ui";
import { Compass } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-5 py-16">
      <div className="w-full max-w-lg">
        <p className="mb-6 text-center font-serif text-2xl tracking-[-0.03em] text-ink">Roamlog</p>
        <EmptyState
          icon={Compass}
          title="这条路径不在旅行档案里"
          description="链接可能已失效，或页面仍在后续 Wave 中实现。"
          action={
            <Button asChild variant="primary">
              <Link href="/w/roamlog-crew">返回旅行总览</Link>
            </Button>
          }
        />
      </div>
    </main>
  );
}
