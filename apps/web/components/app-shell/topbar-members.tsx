"use client";

import type { WorkspaceMemberWithUser } from "@roamlog/contracts";
import type { ShellLinkComponent } from "@roamlog/ui";

import { cx, initialsFor, roleLabelFor } from "./topbar-utils";

const DefaultLink = "a" as ShellLinkComponent;

export interface TopbarMembersProps {
  /** Real workspace members. Empty/undefined means "nothing to show". */
  members: readonly WorkspaceMemberWithUser[];
  workspaceSlug: string;
  max?: number;
  className?: string;
  linkComponent?: ShellLinkComponent;
}

/**
 * Real workspace members in the top bar.
 *
 * Deliberately not `AvatarGroup`: that primitive overlaps members with
 * `-space-x-2` and takes two glyphs for CJK names, which is what produced the
 * unreadable "同行编辑" run in the audit. There is also no realtime presence
 * channel in the web app, so no member is ever marked online here.
 */
export function TopbarMembers({
  members,
  workspaceSlug,
  max = 3,
  className,
  linkComponent: Link = DefaultLink,
}: TopbarMembersProps) {
  // No real data (still loading, failed, or genuinely no members): render nothing.
  // Never fall back to placeholder people.
  if (members.length === 0) {
    return null;
  }

  const visible = members.slice(0, max);
  const overflow = members.length - visible.length;

  // The avatar glyphs are the visible text of this link, so the accessible name
  // must repeat them verbatim (WCAG 2.5.3 Label in Name / axe
  // `label-content-name-mismatch`). Building the name from the same
  // `initialsFor(...)` source as the glyphs keeps a CJK name's single glyph and
  // the `+N` overflow marker word-for-word inside the name. The glyphs stay
  // `aria-hidden` because the name already carries them.
  const visibleLabels = visible.map((member) => initialsFor(member.user.name));
  const ariaLabel = `工作区成员 ${members.length} 人：${visibleLabels.join("、")}${
    overflow > 0 ? `、+${overflow}` : ""
  }，查看成员列表`;

  return (
    <Link
      href={`/w/${workspaceSlug}/members`}
      data-testid="topbar-members"
      aria-label={ariaLabel}
      className={cx(
        "group inline-flex shrink-0 items-center gap-1.5 rounded-pill px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        className,
      )}
    >
      {visible.map((member) => (
        <span
          key={member.id}
          aria-hidden="true"
          title={`${member.user.name} · ${roleLabelFor(member.role)}`}
          className="inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-pill border border-hairline-strong bg-surface-2 font-mono text-[10px] leading-none text-muted"
        >
          {member.user.image ? (
            <img src={member.user.image} alt="" loading="lazy" className="size-6 object-cover" />
          ) : (
            initialsFor(member.user.name)
          )}
        </span>
      ))}
      {overflow > 0 ? (
        <span
          aria-hidden="true"
          title={`另有 ${overflow} 位成员`}
          className="inline-flex size-6 items-center justify-center rounded-pill border border-hairline-strong bg-surface-2 font-mono text-[9px] text-muted"
        >
          +{overflow}
        </span>
      ) : null}
    </Link>
  );
}
