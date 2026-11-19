import type { AccountStatus, PlatformRole, WorkspacePlan } from "@roamlog/contracts";
import { Badge, type BadgeProps } from "@roamlog/ui";

import {
  ACCOUNT_STATUS_LABELS,
  PLATFORM_ROLE_LABELS,
  WORKSPACE_PLAN_LABELS,
} from "../../lib/labels";

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
  return <Badge tone={accountTones[status]}>{ACCOUNT_STATUS_LABELS[status]}</Badge>;
}

export function PlatformRoleBadge({ role }: { role: PlatformRole }) {
  return <Badge tone={roleTones[role]}>{PLATFORM_ROLE_LABELS[role]}</Badge>;
}

export function PlanBadge({ plan }: { plan: WorkspacePlan }) {
  const tone = plan === "team" ? "blue" : plan === "pro" ? "orange" : "neutral";
  return <Badge tone={tone}>{WORKSPACE_PLAN_LABELS[plan]}</Badge>;
}
