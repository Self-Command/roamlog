import {
  Activity,
  Building2,
  Image,
  LayoutDashboard,
  ListChecks,
  Mail,
  ScrollText,
  Settings2,
  ToggleLeft,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  badge?: string;
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    label: "平台概览",
    items: [{ href: "/admin", label: "总览", icon: LayoutDashboard }],
  },
  {
    label: "信任与安全",
    items: [
      { href: "/admin/users", label: "用户", icon: Users },
      { href: "/admin/workspaces", label: "工作区", icon: Building2 },
      { href: "/admin/audit", label: "审计日志", icon: ScrollText },
    ],
  },
  {
    label: "内容与资产",
    items: [{ href: "/admin/media", label: "媒体库", icon: Image }],
  },
  {
    label: "数据与运营",
    items: [
      { href: "/admin/emails", label: "邮件", icon: Mail },
      { href: "/admin/queues", label: "队列", icon: ListChecks },
      { href: "/admin/flags", label: "功能开关", icon: ToggleLeft },
      { href: "/admin/settings", label: "系统设置", icon: Settings2 },
      { href: "/admin/system", label: "系统健康", icon: Activity },
    ],
  },
];

export interface AdminBreadcrumb {
  label: string;
  href?: string;
}

export function isNavItemActive(itemHref: string, activePath: string): boolean {
  if (itemHref === "/admin") {
    return activePath === "/admin";
  }
  return activePath === itemHref || activePath.startsWith(`${itemHref}/`);
}

export function getBreadcrumbs(activePath: string): AdminBreadcrumb[] {
  const items = ADMIN_NAV_GROUPS.flatMap((group) => group.items).filter((item) => !item.disabled);
  const current = items.find((item) => isNavItemActive(item.href, activePath));

  if (!current || current.href === "/admin") {
    return [{ label: "OPS", href: "/admin" }, { label: "总览" }];
  }

  return [{ label: "OPS", href: "/admin" }, { label: current.label }];
}
