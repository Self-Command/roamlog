"use client";

import { Compass, LogOut } from "lucide-react";
import { useState } from "react";

import { Avatar, Badge, Select } from "@roamlog/ui";

import { ADMIN_ROLE_LABELS, ADMIN_CONSOLE_ROLES } from "../../lib/fixtures";
import { adminSignOutErrorMessage } from "./admin-session-client";
import { cn } from "./cn";
import { resolveAdminEnvironment } from "./admin-environment";
import { useAdminSession } from "./mock-session-provider";
import { ADMIN_NAV_GROUPS, isNavItemActive } from "./admin-nav";

interface AdminSidebarProps {
  activePath: string;
  onNavigate?: () => void;
  className?: string;
}

export function AdminSidebar({ activePath, onNavigate, className }: AdminSidebarProps) {
  const { session, setRole, isRoleLocked, signOut } = useAdminSession();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const environment = resolveAdminEnvironment();

  async function handleSignOut() {
    setSignOutError(null);
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      setSignOutError(adminSignOutErrorMessage(error));
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-[220px] flex-col border-r border-hairline bg-surface-deep",
        className,
      )}
      aria-label="管理后台侧栏"
    >
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-hairline px-4">
        <span className="flex size-8 items-center justify-center rounded-control border border-hairline-strong bg-surface-1 text-ink">
          <Compass aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="font-serif text-[19px] leading-none tracking-[-0.03em] text-ink">Roamlog</p>
          <p className="type-eyebrow mt-1 text-[8px] text-ash">platform ops</p>
        </div>
      </div>

      {environment ? (
        <div className="border-b border-hairline px-3 py-3">
          <div className="flex items-center justify-between rounded-control border border-hairline bg-surface-1 px-2.5 py-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.11em] text-muted">
              Environment
            </span>
            <Badge tone="slate" aria-label={`环境 ${environment}`}>
              {environment}
            </Badge>
          </div>
        </div>
      ) : null}

      <nav
        aria-label="管理后台主导航"
        className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-4"
      >
        <div className="space-y-5">
          {ADMIN_NAV_GROUPS.map((group) => (
            <section key={group.label} aria-labelledby={`admin-nav-${group.label}`}>
              <h2 id={`admin-nav-${group.label}`} className="type-eyebrow px-2 pb-2">
                {group.label}
              </h2>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isNavItemActive(item.href, activePath);

                  if (item.disabled) {
                    return (
                      <div
                        key={item.href}
                        aria-disabled="true"
                        className="flex h-9 items-center gap-2.5 rounded-control px-2.5 text-[12px] text-stone"
                      >
                        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                        {item.badge ? (
                          <span className="ml-auto font-mono text-[8px] tracking-[0.09em]">
                            {item.badge}
                          </span>
                        ) : null}
                      </div>
                    );
                  }

                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={onNavigate}
                      className={cn(
                        "flex h-9 items-center gap-2.5 rounded-control px-2.5 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-deep",
                        active
                          ? "bg-surface-1 text-ink"
                          : "text-muted hover:bg-surface-1 hover:text-ink",
                      )}
                    >
                      <Icon
                        aria-hidden="true"
                        className={cn("size-3.5 shrink-0", active ? "text-ink" : "text-ash")}
                      />
                      <span className="truncate">{item.label}</span>
                      {active ? (
                        <span aria-hidden="true" className="ml-auto size-1 rounded-pill bg-ink" />
                      ) : null}
                    </a>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </nav>

      <div className="shrink-0 border-t border-hairline p-3">
        <div className="rounded-control border border-hairline bg-surface-1 p-3">
          <div className="flex items-center gap-2.5">
            <Avatar name={session.name} size={30} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium text-ink">{session.name}</p>
              <p className="truncate font-mono text-[9px] text-muted">{session.email}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{session.role}</Badge>
          </div>
          <label className="mt-3 block">
            <span className="type-eyebrow">
              {isRoleLocked ? "平台角色（后端）" : "模拟平台角色"}
            </span>
            <Select
              aria-label="模拟平台角色"
              className="mt-1.5 h-8 text-[11px]"
              value={session.role}
              disabled={isRoleLocked}
              onChange={(event) => {
                const nextRole = event.currentTarget.value;
                if (
                  nextRole === "support" ||
                  nextRole === "analyst" ||
                  nextRole === "admin" ||
                  nextRole === "super_admin"
                ) {
                  setRole(nextRole);
                }
              }}
            >
              {ADMIN_CONSOLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ADMIN_ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </label>
          <p className="mt-2 text-[9px] leading-4 text-stone">
            {isRoleLocked
              ? "API 模式下平台角色由 /v1/me 与后端 guard 决定。"
              : "角色切换仅用于本地 fixture 预览，不修改真实权限。"}
          </p>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={isSigningOut}
            className="mt-2 flex h-8 w-full items-center gap-2 rounded-control px-1 text-left text-[11px] text-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-60"
          >
            <LogOut aria-hidden="true" className="size-3.5" />
            {isSigningOut ? "正在退出…" : isRoleLocked ? "退出登录" : "退出本地预览"}
          </button>
          {signOutError ? (
            <p role="alert" className="mt-1.5 text-[10px] leading-4 text-accent-red">
              {signOutError}
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
