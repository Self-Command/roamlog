"use client";

import {
  Bell,
  Building2,
  LockKeyhole,
  Palette,
  TriangleAlert,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface SettingsSection {
  segment: string;
  label: string;
  hint: string;
  icon: typeof UserRound;
}

/**
 * Settings IA. Every entry is a real route under `/w/<slug>/settings/*`; the
 * component never renders a dead button or a placeholder label.
 */
const sections: SettingsSection[] = [
  {
    segment: "profile",
    label: "个人资料",
    hint: "头像、显示名称、时区与语言",
    icon: UserRound,
  },
  {
    segment: "security",
    label: "账号安全",
    hint: "密码、邮箱、两步验证与登录设备",
    icon: LockKeyhole,
  },
  {
    segment: "notifications",
    label: "通知",
    hint: "应用内提醒与邮件投递",
    icon: Bell,
  },
  {
    segment: "appearance",
    label: "外观",
    hint: "主题、字体与深色模式",
    icon: Palette,
  },
  {
    segment: "workspace",
    label: "工作区",
    hint: "名称、时区、币种与默认通知",
    icon: Building2,
  },
  {
    segment: "danger",
    label: "危险区",
    hint: "导出工作区数据、转移所有权、删除工作区",
    icon: TriangleAlert,
  },
];

const ITEM_BASE =
  "flex items-center gap-2.5 rounded-control border px-3 py-2.5 text-left transition-colors lg:items-start lg:gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";
const ITEM_ACTIVE = "border-hairline-strong bg-surface-2 text-ink";
const ITEM_IDLE =
  "border-transparent text-muted hover:border-hairline hover:bg-surface-1 hover:text-body";
const ITEM_SECONDARY =
  "flex items-center gap-2.5 rounded-control border border-transparent px-3 py-2.5 text-left text-muted transition-colors hover:border-hairline hover:bg-surface-1 hover:text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

export function SettingsNav({ workspaceSlug }: { workspaceSlug: string }) {
  const pathname = usePathname();
  const root = `/w/${workspaceSlug}/settings`;
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav aria-label="设置分区" className="min-w-0">
      <ol className="-mx-1 flex gap-1 overflow-x-auto pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:pb-0">
        {sections.map((section) => {
          const href = `${root}/${section.segment}`;
          const active = isActive(href);
          const Icon = section.icon;
          return (
            <li key={section.segment} className="shrink-0 lg:shrink">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`${ITEM_BASE} ${active ? ITEM_ACTIVE : ITEM_IDLE}`}
              >
                <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block whitespace-nowrap text-xs font-medium lg:text-sm">
                    {section.label}
                  </span>
                  <span className="hidden text-[11px] leading-5 text-muted lg:block">
                    {section.hint}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>

      <div className="mt-3 border-t border-hairline pt-3">
        <Link href={`/w/${workspaceSlug}/members`} className={ITEM_SECONDARY}>
          <Users aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">
            <span className="block whitespace-nowrap text-xs font-medium lg:text-sm">成员</span>
            <span className="hidden text-[11px] leading-5 lg:block">
              邀请成员、调整角色与移除成员
            </span>
          </span>
        </Link>
      </div>
    </nav>
  );
}
