import { Button } from "@roamlog/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-md rounded-card border border-hairline-strong bg-surface-1 p-8 text-center">
        <p className="type-eyebrow">404 / 页面不存在</p>
        <h1 className="mt-3 font-display text-[32px] font-semibold leading-10 tracking-[-0.025em] text-ink">
          页面不存在
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted">页面不存在或链接已失效。</p>
        <Button asChild variant="ghost" className="mt-6">
          <a href="/admin">返回平台总览</a>
        </Button>
      </div>
    </main>
  );
}
