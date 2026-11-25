import { Badge } from "@roamlog/ui";
import type { ReactNode } from "react";

interface AuthShellProps {
  children: ReactNode;
}

export function AuthShell({ children }: AuthShellProps) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-canvas">
      <div className="relative grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
        <section className="hidden flex-col justify-between border-r border-hairline px-10 py-8 lg:flex xl:px-16">
          <a
            href="/"
            className="inline-flex w-fit items-baseline gap-2 outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-4 focus-visible:ring-offset-canvas"
          >
            <span className="font-display text-2xl leading-none font-semibold tracking-[-0.02em] text-ink">
              Roamlog
            </span>
            <span className="type-eyebrow translate-y-[-1px] text-[8px]">旅行档案</span>
          </a>

          <div className="max-w-xl">
            <Badge tone="blue">共享旅行档案</Badge>
            <h1 className="mt-5 max-w-lg font-display text-[clamp(1.9rem,1.5rem+1vw,2.25rem)] leading-[1.12] font-semibold tracking-[-0.025em] text-ink">
              把旅行写成
              <br />
              可以回去的地方。
            </h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-muted">
              行程、日志、照片、花费和打包清单留在同一个工作区。不是社交动态，是一份可以共同维护的旅行档案。
            </p>

            <div className="mt-6 rounded-card border border-hairline bg-surface-1 p-5">
              <p className="type-eyebrow">协作优先，不做信息流</p>
              <p className="mt-3 text-sm leading-6 text-body">
                每位成员按角色阅读和评论，改动留在它发生的位置。没有公开主页，
                也没有推荐信息流；对外分享需要成员显式创建链接。
              </p>
              <p className="mt-4 border-t border-hairline pt-3 text-xs text-stone">
                默认私密 · 分享链接需显式创建
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-stone">
            <span>所有者 / 管理员 / 编辑者 / 只读成员</span>
            <span aria-hidden="true">·</span>
            <span>评论优先的协作</span>
          </div>
        </section>

        <section className="flex min-h-dvh flex-col justify-center px-5 py-8 sm:px-10">
          <a
            href="/"
            className="mb-10 inline-flex w-fit items-baseline gap-2 lg:hidden"
            aria-label="Roamlog 首页"
          >
            <span className="font-display text-xl leading-none font-semibold tracking-[-0.02em] text-ink">
              Roamlog
            </span>
            <span className="type-eyebrow text-[8px]">旅行档案</span>
          </a>
          <div className="mx-auto w-full max-w-[420px]">{children}</div>
        </section>
      </div>
    </main>
  );
}

interface AuthPageFrameProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthPageFrame({
  eyebrow,
  title,
  description,
  children,
  footer,
}: AuthPageFrameProps) {
  return (
    <AuthShell>
      <p className="type-eyebrow">{eyebrow}</p>
      <h1 className="mt-2 font-display text-[clamp(1.75rem,1.5rem+0.7vw,2.25rem)] leading-tight font-semibold tracking-[-0.02em] text-ink">
        {title}
      </h1>
      <p className="mt-4 text-sm leading-6 text-muted">{description}</p>
      <div className="mt-8">{children}</div>
      {footer ? <div className="mt-6">{footer}</div> : null}
    </AuthShell>
  );
}
