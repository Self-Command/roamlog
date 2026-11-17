"use client";

import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";

export interface ShellLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

export type ShellLinkComponent = React.ElementType<ShellLinkProps>;

const DefaultLink = "a" as ShellLinkComponent;

export interface SidebarNavItem {
  href: string;
  label: string;
  icon?: LucideIcon;
  active?: boolean;
  badge?: React.ReactNode;
  onSelect?: () => void;
}

export interface SidebarContentProps {
  brand?: React.ReactNode;
  brandHref?: string;
  workspace: React.ReactNode;
  primaryNav: SidebarNavItem[];
  secondaryNav?: SidebarNavItem[];
  primarySectionLabel?: string;
  secondarySectionLabel?: string;
  nextTrip?: React.ReactNode;
  nextTripLabel?: string;
  primaryAction?: React.ReactNode;
  footer?: React.ReactNode;
  linkComponent?: ShellLinkComponent;
  className?: string;
}

function NavSection({
  label,
  items,
  linkComponent: Link = DefaultLink,
}: {
  label: string;
  items: SidebarNavItem[];
  linkComponent?: ShellLinkComponent;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div>
      <p className="type-eyebrow px-3 pb-2">{label}</p>
      <div className="space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              onClick={item.onSelect}
              className={cn(
                "flex h-11 items-center gap-3 rounded-control px-3 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas md:h-9",
                item.active
                  ? "bg-surface-1 text-ink"
                  : "text-muted hover:bg-surface-1 hover:text-ink",
              )}
            >
              {Icon ? (
                <Icon
                  aria-hidden="true"
                  className={cn("size-4 shrink-0", item.active ? "text-ink" : "text-ash")}
                />
              ) : null}
              <span className="min-w-0 truncate">{item.label}</span>
              {item.badge ? <span className="ml-auto shrink-0">{item.badge}</span> : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function SidebarContent({
  brand,
  brandHref = "/",
  workspace,
  primaryNav,
  secondaryNav = [],
  primarySectionLabel = "Workspace",
  secondarySectionLabel = "Together",
  nextTrip,
  nextTripLabel = "Next journey",
  primaryAction,
  footer,
  linkComponent: Link = DefaultLink,
  className,
}: SidebarContentProps) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex h-16 shrink-0 items-center px-5">
        {brand ?? (
          <Link href={brandHref} className="inline-flex items-baseline gap-2">
            <span className="font-serif text-[23px] leading-none tracking-[-0.03em] text-ink">
              Roamlog
            </span>
            <span className="type-eyebrow translate-y-[-1px] text-[8px]">archive</span>
          </Link>
        )}
      </div>

      <div className="shrink-0 px-3">{workspace}</div>

      <nav className="mt-5 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="space-y-6">
          <NavSection label={primarySectionLabel} items={primaryNav} linkComponent={Link} />
          <NavSection label={secondarySectionLabel} items={secondaryNav} linkComponent={Link} />
        </div>

        {nextTrip ? (
          <div className="mt-7">
            <p className="type-eyebrow mb-2 px-3">{nextTripLabel}</p>
            {nextTrip}
          </div>
        ) : null}

        {primaryAction ? <div className="mt-5">{primaryAction}</div> : null}
      </nav>

      {footer ? <div className="shrink-0 border-t border-hairline p-3">{footer}</div> : null}
    </div>
  );
}

export type SidebarProps = SidebarContentProps;

export function Sidebar({
  brand,
  brandHref = "/",
  workspace,
  primaryNav,
  secondaryNav,
  primarySectionLabel,
  secondarySectionLabel,
  nextTrip,
  nextTripLabel,
  primaryAction,
  footer,
  linkComponent,
  className,
}: SidebarProps) {
  return (
    <aside
      className={cn(
        "hidden h-dvh w-60 shrink-0 flex-col border-r border-hairline bg-surface-deep lg:flex",
        className,
      )}
    >
      <SidebarContent
        brand={brand}
        brandHref={brandHref}
        workspace={workspace}
        primaryNav={primaryNav}
        secondaryNav={secondaryNav}
        primarySectionLabel={primarySectionLabel}
        secondarySectionLabel={secondarySectionLabel}
        nextTrip={nextTrip}
        nextTripLabel={nextTripLabel}
        primaryAction={primaryAction}
        footer={footer}
        linkComponent={linkComponent}
      />
    </aside>
  );
}
