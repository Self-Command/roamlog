"use client";

import { Command, Menu, Search } from "lucide-react";

import { Avatar, Badge, IconButton } from "@roamlog/ui";

import { cn } from "./cn";
import { getBreadcrumbs } from "./admin-nav";
import { resolveAdminEnvironment } from "./admin-environment";
import { useAdminSession } from "./admin-session-provider";

interface AdminTopbarProps {
  activePath: string;
  onOpenMobileNav: () => void;
  onOpenCommandPalette: () => void;
}

export function AdminTopbar({
  activePath,
  onOpenMobileNav,
  onOpenCommandPalette,
}: AdminTopbarProps) {
  const { session } = useAdminSession();
  const breadcrumbs = getBreadcrumbs(activePath);
  const environment = resolveAdminEnvironment();

  return (
    <header className="sticky top-0 z-20 h-14 border-b border-hairline bg-black/85 backdrop-blur-xl">
      <div className="flex h-full items-center gap-2 px-3 sm:px-5 lg:px-6">
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          aria-label="打开导航"
          onClick={onOpenMobileNav}
          className="lg:hidden"
        >
          <Menu aria-hidden="true" />
        </IconButton>

        <nav aria-label="面包屑" className="flex min-w-0 items-center gap-2 text-[11px]">
          {breadcrumbs.map((breadcrumb, index) => {
            const last = index === breadcrumbs.length - 1;
            return (
              <span
                key={`${breadcrumb.href ?? "current"}-${breadcrumb.label}`}
                className="contents"
              >
                {breadcrumb.href && !last ? (
                  <a href={breadcrumb.href} className="text-muted hover:text-ink">
                    {breadcrumb.label}
                  </a>
                ) : (
                  <span
                    className={cn("truncate", last ? "text-ink" : "text-muted")}
                    aria-current={last ? "page" : undefined}
                  >
                    {breadcrumb.label}
                  </span>
                )}
                {!last ? (
                  <span aria-hidden="true" className="text-stone">
                    /
                  </span>
                ) : null}
              </span>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenCommandPalette}
            aria-label="搜索页面、用户或工作区 K"
            className="hidden h-8 w-[clamp(12rem,22vw,20rem)] items-center gap-2 rounded-control border border-hairline bg-surface-1/60 px-2.5 text-left text-[11px] text-muted outline-none transition-colors hover:border-hairline-strong hover:text-body focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas md:flex"
          >
            <Search aria-hidden="true" className="size-3.5" />
            <span className="truncate">搜索页面、用户或工作区</span>
            <kbd className="ml-auto inline-flex items-center gap-0.5 rounded border border-hairline bg-surface-2 px-1 py-0.5 font-mono text-[8px] text-stone">
              <Command aria-hidden="true" className="size-2.5" />K
            </kbd>
          </button>

          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            aria-label="打开全局搜索"
            onClick={onOpenCommandPalette}
            className="md:hidden"
          >
            <Search aria-hidden="true" />
          </IconButton>

          {environment ? (
            <Badge tone="slate" className="hidden sm:inline-flex">
              {environment}
            </Badge>
          ) : null}

          <div className="hidden h-5 w-px bg-hairline sm:block" />

          <div className="hidden items-center gap-2 sm:flex">
            <Avatar name={session.name} size={26} />
            <div className="hidden xl:block">
              <p className="text-[11px] leading-none text-ink">{session.name}</p>
              <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.08em] text-muted">
                {session.role}
              </p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
