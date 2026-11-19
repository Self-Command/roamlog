import type { AccountStatus, PlatformRole } from "@roamlog/contracts";
import { Badge, type BadgeProps } from "@roamlog/ui";

import { ADMIN_ROLE_LABELS, type AdminConsoleRole } from "../../lib/admin-types";

const accountLabels: Record<AccountStatus, string> = {
  active: "Active",
  suspended: "已暂停",
  deleted: "已删除",
};

const accountTones: Record<AccountStatus, NonNullable<BadgeProps["tone"]>> = {
  active: "green",
  suspended: "yellow",
  deleted: "red",
};

const roleTones: Record<PlatformRole, NonNullable<BadgeProps["tone"]>> = {
  user: "neutral",
  support: "blue",
  analyst: "slate",
  admin: "orange",
  super_admin: "yellow",
};

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  return <Badge tone={accountTones[status]}>{accountLabels[status]}</Badge>;
}

export function PlatformRoleBadge({ role }: { role: PlatformRole }) {
  const label = role === "user" ? "User" : (ADMIN_ROLE_LABELS[role as AdminConsoleRole] ?? role);
  return <Badge tone={roleTones[role]}>{label}</Badge>;
}

export function PlanBadge({ plan }: { plan: "free" | "pro" | "team" }) {
  const tone = plan === "team" ? "blue" : plan === "pro" ? "orange" : "neutral";
  return <Badge tone={tone}>{plan.toUpperCase()}</Badge>;
}
