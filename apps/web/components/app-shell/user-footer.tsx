"use client";

import type { User } from "@roamlog/contracts";
import { Avatar } from "@roamlog/ui";
import { Settings } from "lucide-react";

export function UserFooter({ user }: { user: User }) {
  return (
    <div className="flex items-center gap-2.5 px-1 py-1">
      <Avatar name={user.name} src={user.image ?? undefined} size={30} online />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-ink">{user.name}</span>
        <span className="block truncate text-[10px] text-muted">{user.email}</span>
      </span>
      <Settings aria-hidden="true" className="size-3.5 shrink-0 text-stone" />
    </div>
  );
}
