import {
  Activity,
  Bot,
  Building2,
  Flag,
  HardDrive,
  Image,
  Images,
  LayoutDashboard,
  ListChecks,
  Mail,
  MapPin,
  ScrollText,
  Send,
  Settings2,
  ShieldCheck,
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
      { href: "/admin/content", label: "内容审核", icon: Flag },
      { href: "/admin/permissions", label: "权限矩阵", icon: ShieldCheck },
      { href: "/admin/audit", label: "审计日志", icon: ScrollText },
    ],
  },
  {
    label: "内容与资产",
    items: [{ href: "/admin/media", label: "媒体库", icon: Image }],
  },
  {
    label: "服务配置",
    items: [
      { href: "/admin/services/ai", label: "AI 服务", icon: Bot },
      { href: "/admin/services/storage", label: "存储服务", icon: HardDrive },
      { href: "/admin/services/places", label: "地图服务", icon: MapPin },
      { href: "/admin/services/mail", label: "发信服务", icon: Send },
      { href: "/admin/services/media", label: "媒体处理", icon: Images },
    ],
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
  const groups = ADMIN_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.disabled),
  }));
  const currentGroup = groups.find((group) =>
    group.items.some((item) => isNavItemActive(item.href, activePath)),
  );
  const current = currentGroup?.items.find((item) => isNavItemActive(item.href, activePath));

  if (!current || current.href === "/admin") {
    return [{ label: "平台", href: "/admin" }, { label: "总览" }];
  }

  // Follow the sidebar hierarchy: 平台 / 一级分组 / 当前页面. The overview group
  // is the product root, so it never adds a redundant middle crumb.
  const crumbs: AdminBreadcrumb[] = [{ label: "平台", href: "/admin" }];
  if (currentGroup && currentGroup.label !== "平台概览") {
    crumbs.push({ label: currentGroup.label });
  }
  crumbs.push({ label: current.label });
  return crumbs;
}
