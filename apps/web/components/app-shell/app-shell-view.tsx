"use client";

import type { Trip, User, WorkspaceMemberWithUser, WorkspaceWithRole } from "@roamlog/contracts";
import {
  Button,
  IconButton,
  MobileNav,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Sidebar,
  SidebarContent,
  type ShellLinkComponent,
} from "@roamlog/ui";
import { Menu, Plus, Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { getNextTrip } from "@/lib/trip-presentation";

import { breadcrumbFor, buildShellNavigation } from "./app-shell-nav";
import { CommandPalette } from "./command-palette";
import { NextTripCard } from "./next-trip-card";
import { NotificationBell } from "./notification-bell";
import { TopbarMembers } from "./topbar-members";
import { UserFooter } from "./user-footer";
import { WorkspaceSwitcher } from "./workspace-switcher";

const DefaultLink = "a" as ShellLinkComponent;

export interface AppShellViewProps {
  currentUser: User;
  workspaces: WorkspaceWithRole[];
  currentWorkspace: WorkspaceWithRole;
  trips: Trip[];
  pathname: string;
  /** Real workspace members. Omitted or empty hides the top-bar member strip. */
  members?: WorkspaceMemberWithUser[];
  /** Real unread notification count. 0 hides the badge. */
  unreadNotificationCount?: number;
  /** True when the unread page was capped before the total was known. */
  unreadNotificationsHaveMore?: boolean;
  linkComponent?: ShellLinkComponent;
  children: ReactNode;
}

export function AppShellView({
  currentUser,
  workspaces,
  currentWorkspace,
  trips,
  pathname,
  members = [],
  unreadNotificationCount = 0,
  unreadNotificationsHaveMore = false,
  linkComponent: Link = DefaultLink,
  children,
}: AppShellViewProps) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const workspaceRoot = `/w/${currentWorkspace.slug}`;
  const nextTrip = getNextTrip(trips);
  const currentSection = breadcrumbFor(pathname, currentWorkspace, trips);
  const { primaryNav, secondaryNav, mobileNav } = buildShellNavigation(workspaceRoot, pathname);
  const mobileItems = mobileNav.map((item) =>
    item.label === "更多" ? { ...item, onSelect: () => setNavigationOpen(true) } : item,
  );

  const sidebar = (
    <SidebarContent
      workspace={
        <WorkspaceSwitcher
          currentWorkspace={currentWorkspace}
          workspaces={workspaces}
          linkComponent={Link}
        />
      }
      primaryNav={primaryNav}
      secondaryNav={secondaryNav}
      secondarySectionLabel="协作"
      nextTrip={
        nextTrip ? (
          <NextTripCard
            trip={nextTrip}
            workspaceSlug={currentWorkspace.slug}
            linkComponent={Link}
          />
        ) : null
      }
      footer={<UserFooter user={currentUser} />}
      linkComponent={Link}
    />
  );

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  return (
    <div className="flex min-h-dvh bg-canvas">
      <Sidebar
        workspace={
          <WorkspaceSwitcher
            currentWorkspace={currentWorkspace}
            workspaces={workspaces}
            linkComponent={Link}
          />
        }
        primaryNav={primaryNav}
        secondaryNav={secondaryNav}
        secondarySectionLabel="协作"
        nextTrip={
          nextTrip ? (
            <NextTripCard
              trip={nextTrip}
              workspaceSlug={currentWorkspace.slug}
              linkComponent={Link}
            />
          ) : null
        }
        footer={<UserFooter user={currentUser} />}
        linkComponent={Link}
      />

      <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}>
        <SheetContent side="left" className="w-[min(20rem,88vw)] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>工作区导航</SheetTitle>
            <SheetDescription>在总览、旅行和协作区域之间切换。</SheetDescription>
          </SheetHeader>
          {sidebar}
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-hairline bg-black/80 px-4 backdrop-blur-xl sm:gap-3 sm:px-6 lg:px-8">
          <IconButton
            type="button"
            variant="outline"
            size="sm"
            aria-label="打开导航"
            onClick={() => setNavigationOpen(true)}
            className="shrink-0 lg:hidden"
          >
            <Menu aria-hidden="true" />
          </IconButton>

          <nav aria-label="面包屑" className="flex min-w-0 items-center gap-2 text-xs">
            <span className="hidden max-w-28 truncate text-muted lg:inline">
              {currentWorkspace.name}
            </span>
            <span aria-hidden="true" className="hidden text-stone lg:inline">
              /
            </span>
            <span className="truncate text-ink" aria-current="page">
              {currentSection}
            </span>
          </nav>

          <Button
            type="button"
            variant="ghost"
            onClick={() => setCommandOpen(true)}
            aria-label="搜索或运行命令 ⌘K"
            className="ml-auto size-11 shrink-0 justify-center px-0 text-muted md:h-9 md:w-auto md:max-w-64 md:flex-1 md:justify-start md:gap-2 md:px-3"
          >
            <Search aria-hidden="true" className="size-3.5" />
            <span className="hidden truncate text-xs md:inline">搜索或运行命令</span>
            <kbd className="ml-auto hidden rounded border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] text-stone md:inline">
              ⌘K
            </kbd>
          </Button>

          {/* Visibility lives on this wrapper so the member strip keeps a single, non-conflicting display class.
              With no real members the whole slot disappears instead of leaving dead space. */}
          {members.length > 0 ? (
            <div className="hidden shrink-0 items-center md:flex">
              <TopbarMembers
                members={members}
                workspaceSlug={currentWorkspace.slug}
                linkComponent={Link}
              />
            </div>
          ) : null}

          <NotificationBell
            href={`${workspaceRoot}/notifications`}
            unreadCount={unreadNotificationCount}
            unreadHasMore={unreadNotificationsHaveMore}
            linkComponent={Link}
          />

          <Button
            asChild
            variant="outline"
            className="hidden size-11 shrink-0 px-0 sm:inline-flex md:size-9"
          >
            <Link href={`${workspaceRoot}/trips/new`} aria-label="新建旅行">
              <Plus aria-hidden="true" />
            </Link>
          </Button>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 overflow-x-clip px-4 pb-28 pt-6 sm:px-6 md:pb-10 lg:px-8 lg:pt-8">
          {children}
        </main>
      </div>

      <MobileNav
        items={mobileItems}
        linkComponent={Link}
        quickAction={
          <Button
            asChild
            variant="outline"
            size="md"
            className="size-11 rounded-pill p-0 shadow-none"
          >
            <Link href={`${workspaceRoot}/trips/new`} aria-label="新建旅行">
              <Plus aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        workspaceSlug={currentWorkspace.slug}
        workspaceId={currentWorkspace.id}
        nextTrip={nextTrip}
      />
    </div>
  );
}
