"use client";

import { useEffect, useState } from "react";

import { Sheet, SheetContent } from "@roamlog/ui";

import { AdminCommandPalette } from "./admin-command-palette";
import { AdminSidebar } from "./admin-sidebar";
import { AdminTopbar } from "./admin-topbar";
import { AdminSessionProvider } from "./admin-session-provider";

interface AdminShellProps {
  activePath: string;
  children: React.ReactNode;
}

function AdminShellFrame({ activePath, children }: AdminShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

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

      <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">
        <AdminSidebar activePath={activePath} />
      </div>

      <div className="relative lg:pl-[220px]">
        <AdminTopbar
          activePath={activePath}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        />

        <main
          id="admin-main-content"
          className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          {children}
        </main>
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[min(88vw,300px)] max-w-none p-0">
          <AdminSidebar activePath={activePath} onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <AdminCommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
    </div>
  );
}

export function AdminShell({ activePath, children }: AdminShellProps) {
  return (
    <AdminSessionProvider>
      <AdminShellFrame activePath={activePath}>{children}</AdminShellFrame>
    </AdminSessionProvider>
  );
}
