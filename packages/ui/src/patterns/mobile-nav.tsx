"use client";

import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";
import type { ShellLinkComponent } from "./sidebar";

const DefaultLink = "a" as ShellLinkComponent;

export interface MobileNavItem {
  href: string;
  label: string;
  icon?: LucideIcon;
  active?: boolean;
  onSelect?: () => void;
}

export interface MobileNavProps extends React.HTMLAttributes<HTMLElement> {
  items: MobileNavItem[];
  quickAction?: React.ReactNode;
  linkComponent?: ShellLinkComponent;
  label?: string;
}

export function MobileNav({
  items,
  quickAction,
  linkComponent: Link = DefaultLink,
  label = "移动端主导航",
  className,
  ...props
}: MobileNavProps) {
  const visibleItems = items.slice(0, 5);

  return (
    <nav
      aria-label={label}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-hairline-strong bg-surface-1/95 pb-[var(--roamlog-mobile-safe-area-bottom)] backdrop-blur-xl md:hidden",
        className,
      )}
      {...props}
    >
      {quickAction ? (
        <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2">
          <div className="pointer-events-auto">{quickAction}</div>
        </div>
      ) : null}
      <div className="flex h-[var(--roamlog-mobile-nav-height)] items-center justify-around px-2">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              onClick={item.onSelect}
              className={cn(
                "flex h-14 min-w-14 flex-col items-center justify-center gap-1 rounded-control px-2 text-[10px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                item.active ? "font-medium text-ink" : "text-muted hover:text-ink",
              )}
            >
              {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
