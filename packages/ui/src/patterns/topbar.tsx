"use client";

import { Bell, Command, Search } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";
import { IconButton } from "../primitives/icon-button";
import type { ShellLinkComponent } from "./sidebar";

const DefaultLink = "a" as ShellLinkComponent;

export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface TopbarProps extends React.HTMLAttributes<HTMLElement> {
  breadcrumbs: Breadcrumb[];
  searchPlaceholder?: string;
  searchShortcut?: string;
  searchLabel?: string;
  onSearch?: () => void;
  presence?: React.ReactNode;
  notificationCount?: number;
  onNotifications?: () => void;
  notificationsLabel?: string;
  secondaryAction?: React.ReactNode;
  primaryAction?: React.ReactNode;
  linkComponent?: ShellLinkComponent;
}

export function Topbar({
  breadcrumbs,
  searchPlaceholder = "搜索旅行、日志、成员…",
  searchShortcut = "⌘K",
  searchLabel = "搜索",
  onSearch,
  presence,
  notificationCount = 0,
  onNotifications,
  notificationsLabel = "通知",
  secondaryAction,
  primaryAction,
  linkComponent: Link = DefaultLink,
  className,
  ...props
}: TopbarProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-hairline bg-black/80 px-4 backdrop-blur-xl sm:px-6 lg:px-8",
        className,
      )}
      {...props}
    >
      <nav aria-label="面包屑" className="flex min-w-0 items-center gap-2 text-[12px]">
        {breadcrumbs.map((crumb, index) => {
          const last = index === breadcrumbs.length - 1;
          return (
            <React.Fragment key={`${crumb.href ?? "current"}-${crumb.label}`}>
              {crumb.href && !last ? (
                <Link
                  href={crumb.href}
                  className="hidden truncate text-muted hover:text-ink sm:inline"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={cn("truncate", last ? "text-ink" : "text-muted")}
                  aria-current={last ? "page" : undefined}
                >
                  {crumb.label}
                </span>
              )}
              {!last ? (
                <span aria-hidden="true" className="hidden text-stone sm:inline">
                  /
                </span>
              ) : null}
            </React.Fragment>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={onSearch}
        aria-label={searchLabel}
        className="ml-auto hidden h-9 w-full max-w-[280px] items-center gap-2 rounded-control border border-hairline bg-surface-1/70 px-3 text-left text-[12px] text-muted outline-none transition-colors hover:border-hairline-strong hover:text-body focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas md:flex"
      >
        <Search aria-hidden="true" className="size-3.5" />
        <span className="truncate">{searchPlaceholder}</span>
        <kbd className="ml-auto flex shrink-0 items-center gap-1 rounded border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] text-stone">
          {searchShortcut.includes("⌘") ? (
            <Command aria-hidden="true" className="size-2.5" />
          ) : null}
          {searchShortcut.replace("⌘", "")}
        </kbd>
      </button>

      <IconButton
        type="button"
        variant="outline"
        size="sm"
        aria-label={searchLabel}
        onClick={onSearch}
        className="ml-auto md:hidden"
      >
        <Search aria-hidden="true" />
      </IconButton>

      {presence ? <div className="hidden items-center sm:flex">{presence}</div> : null}

      {onNotifications ? (
        <div className="relative">
          <IconButton
            type="button"
            variant="outline"
            size="sm"
            aria-label={
              notificationCount > 0
                ? `${notificationsLabel}，${notificationCount} 条未读`
                : notificationsLabel
            }
            onClick={onNotifications}
          >
            <Bell aria-hidden="true" />
          </IconButton>
          {notificationCount > 0 ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-2 top-2 size-1.5 rounded-pill bg-accent-orange"
            />
          ) : null}
        </div>
      ) : null}

      {secondaryAction || primaryAction ? (
        <div className="hidden h-5 w-px bg-hairline sm:block" />
      ) : null}
      {secondaryAction ? <div className="hidden sm:block">{secondaryAction}</div> : null}
      {primaryAction ? <div className="hidden sm:block">{primaryAction}</div> : null}
    </header>
  );
}
