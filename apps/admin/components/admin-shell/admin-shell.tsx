"use client";

import { useEffect, useState } from "react";

import { Sheet, SheetContent } from "@roamlog/ui";

import type { AdminSession } from "../../lib/fixtures";
import { AdminCommandPalette } from "./admin-command-palette";
import { AdminNotificationsSheet } from "./admin-notifications-sheet";
import { AdminSidebar } from "./admin-sidebar";
import { AdminTopbar } from "./admin-topbar";
import { MockSessionProvider } from "./mock-session-provider";
import { AdminModeBanner } from "../admin-ui/admin-mode-banner";

interface AdminShellProps {
  activePath: string;
  children: React.ReactNode;
  session?: AdminSession;
}

function AdminShellFrame({ activePath, children }: Omit<AdminShellProps, "session">) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((current) => !current);
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  return (
    <div className="min-h-dvh bg-canvas text-body">
      <a
        href="#admin-main-content"
        className="fixed left-3 top-3 z-[80] -translate-y-20 rounded-control bg-ink px-3 py-2 text-xs font-medium text-black outline-none focus:translate-y-0"
      >
        跳至主要内容
      </a>

      <div className="pointer-events-none fixed inset-x-0 top-0 h-[360px] overflow-hidden">
        <div className="admin-atmosphere absolute inset-0" />
      </div>

      <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">
        <AdminSidebar activePath={activePath} />
      </div>

      <div className="relative lg:pl-[220px]">
        <AdminTopbar
          activePath={activePath}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onOpenNotifications={() => setNotificationsOpen(true)}
        />

        <main
          id="admin-main-content"
          className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          <AdminModeBanner />
          {children}
        </main>
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[min(88vw,300px)] max-w-none p-0">
          <AdminSidebar activePath={activePath} onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <AdminCommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
      <AdminNotificationsSheet open={notificationsOpen} onOpenChange={setNotificationsOpen} />
    </div>
  );
}

export function AdminShell({ activePath, children, session }: AdminShellProps) {
  return (
    <MockSessionProvider initialSession={session}>
      <AdminShellFrame activePath={activePath}>{children}</AdminShellFrame>
    </MockSessionProvider>
  );
}
