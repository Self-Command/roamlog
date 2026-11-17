import { Badge, PageGlow } from "@roamlog/ui";
import { CalendarDays, MapPin, Users } from "lucide-react";
import type { ReactNode } from "react";

interface AuthShellProps {
  children: ReactNode;
}

const activityRows = [
  {
    actor: "Mira",
    action: "在「首尔，晚秋与夜航」补了一篇日志",
    time: "09:42",
    icon: CalendarDays,
  },
  {
    actor: "顾南",
    action: "把广藏市场加入 11 月 17 日行程",
    time: "08:15",
    icon: MapPin,
  },
  {
    actor: "林晚",
    action: "邀请你一起维护京都红叶慢行",
    time: "昨天",
    icon: Users,
  },
];

export function AuthShell({ children }: AuthShellProps) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-canvas">
      <PageGlow accent="orange" className="opacity-70" />
      <div className="relative grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
        <section className="hidden flex-col justify-between border-r border-hairline px-10 py-8 lg:flex xl:px-16">
          <a
            href="/"
            className="inline-flex w-fit items-baseline gap-2 outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-4 focus-visible:ring-offset-canvas"
          >
            <span className="font-serif text-[28px] leading-none tracking-[-0.035em] text-ink">
              Roamlog
            </span>
            <span className="type-eyebrow translate-y-[-1px] text-[8px]">travel archive</span>
          </a>

          <div className="max-w-xl">
            <Badge tone="orange">A WORKSPACE FOR SHARED JOURNEYS</Badge>
            <h1 className="mt-6 max-w-lg font-serif text-[clamp(2.6rem,2rem+2vw,3.5rem)] leading-[1.02] tracking-[-0.04em] text-ink">
              把旅行写成
              <br />
              可以回去的地方。
            </h1>
            <p className="mt-5 max-w-md text-sm leading-7 text-muted">
              行程、日志、照片、花费和打包清单留在同一个
              Workspace。不是社交动态，是一份可以共同维护的旅行档案。
            </p>

            <div className="mt-8 rounded-card border border-hairline-strong bg-surface-1/70 p-4 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-3 border-b border-hairline pb-3">
                <p className="type-eyebrow">RECENT WORKSPACE ACTIVITY</p>
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
                  local fixture
                </span>
              </div>
              <div className="divide-y divide-divider">
                {activityRows.map((row) => {
                  const Icon = row.icon;
                  return (
                    <div key={`${row.actor}-${row.time}`} className="flex items-start gap-3 py-3">
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-pill border border-hairline bg-surface-2 text-muted">
                        <Icon aria-hidden="true" className="size-3.5" />
                      </span>
                      <p className="min-w-0 flex-1 text-xs leading-5 text-body">
                        <span className="text-ink">{row.actor}</span> {row.action}
                      </p>
                      <span className="font-mono text-[9px] text-stone">{row.time}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
            <span>Owner / Admin / Editor / Viewer</span>
            <span aria-hidden="true">·</span>
            <span>comment-first collaboration</span>
          </div>
        </section>

        <section className="flex min-h-dvh flex-col justify-center px-5 py-8 sm:px-10">
          <a
            href="/"
            className="mb-10 inline-flex w-fit items-baseline gap-2 lg:hidden"
            aria-label="Roamlog 首页"
          >
            <span className="font-serif text-[25px] leading-none tracking-[-0.03em] text-ink">
              Roamlog
            </span>
            <span className="type-eyebrow text-[8px]">archive</span>
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
      <h1 className="mt-3 font-serif text-[clamp(2rem,1.5rem+1vw,2.75rem)] leading-none tracking-[-0.035em] text-ink">
        {title}
      </h1>
      <p className="mt-4 text-sm leading-6 text-muted">{description}</p>
      <div className="mt-8">{children}</div>
      {footer ? <div className="mt-6">{footer}</div> : null}
    </AuthShell>
  );
}
