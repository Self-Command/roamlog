import type { Trip, WorkspaceWithRole } from "@roamlog/contracts";
import type { MobileNavItem, SidebarNavItem } from "@roamlog/ui";
import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  Compass,
  LayoutDashboard,
  Map,
  Menu,
  Settings,
  Users,
} from "lucide-react";

const futureLabels = {
  journal: "日志",
  map: "地图",
  insights: "洞察",
  members: "成员",
  activity: "活动",
  notifications: "通知",
  settings: "设置",
} as const;

export function breadcrumbFor(
  pathname: string,
  workspace: WorkspaceWithRole,
  trips: Trip[],
): string {
  const remainder = pathname.replace(/^\/w\/[^/]+/, "");
  if (remainder === "" || remainder === "/") return "总览";
  if (remainder === "/trips") return "旅行";
  if (remainder === "/trips/new") return "新建旅行";

  const tripMatch = remainder.match(/^\/trips\/([^/]+)/);
  if (tripMatch?.[1]) {
    return trips.find((trip) => trip.id === tripMatch[1])?.title ?? "旅行详情";
  }

  const section = remainder.slice(1).split("/")[0];
  return futureLabels[section as keyof typeof futureLabels] ?? workspace.name;
}

export function buildShellNavigation(
  workspaceRoot: string,
  pathname: string,
): {
  primaryNav: SidebarNavItem[];
  secondaryNav: SidebarNavItem[];
  mobileNav: MobileNavItem[];
} {
  const isSectionActive = (section: string) =>
    pathname === `${workspaceRoot}${section}` || pathname.startsWith(`${workspaceRoot}${section}/`);

  return {
    primaryNav: [
      {
        href: workspaceRoot,
        label: "总览",
        icon: LayoutDashboard,
        active: pathname === workspaceRoot,
      },
      {
        href: `${workspaceRoot}/trips`,
        label: "旅行",
        icon: Compass,
        active: isSectionActive("/trips"),
      },
      {
        href: `${workspaceRoot}/journal`,
        label: "日志",
        icon: BookOpen,
        active: isSectionActive("/journal"),
      },
      {
        href: `${workspaceRoot}/map`,
        label: "地图",
        icon: Map,
        active: isSectionActive("/map"),
      },
      {
        href: `${workspaceRoot}/insights`,
        label: "洞察",
        icon: BarChart3,
        active: isSectionActive("/insights"),
      },
    ],
    secondaryNav: [
      {
        href: `${workspaceRoot}/members`,
        label: "成员",
        icon: Users,
        active: isSectionActive("/members"),
      },
      {
        href: `${workspaceRoot}/activity`,
        label: "活动",
        icon: Activity,
        active: isSectionActive("/activity"),
      },
      {
        href: `${workspaceRoot}/notifications`,
        label: "通知",
        icon: Bell,
        active: isSectionActive("/notifications"),
      },
      {
        href: `${workspaceRoot}/settings`,
        label: "设置",
        icon: Settings,
        active: isSectionActive("/settings"),
      },
    ],
    mobileNav: [
      {
        href: workspaceRoot,
        label: "总览",
        icon: LayoutDashboard,
        active: pathname === workspaceRoot,
      },
      {
        href: `${workspaceRoot}/trips`,
        label: "旅行",
        icon: Compass,
        active: isSectionActive("/trips"),
      },
      {
        href: `${workspaceRoot}/journal`,
        label: "日志",
        icon: BookOpen,
        active: isSectionActive("/journal"),
      },
      {
        href: `${workspaceRoot}/map`,
        label: "地图",
        icon: Map,
        active: isSectionActive("/map"),
      },
      {
        href: `${pathname}#navigation`,
        label: "更多",
        icon: Menu,
      },
    ],
  };
}
