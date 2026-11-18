"use client";

import type { User } from "@roamlog/contracts";
import { Avatar, Button } from "@roamlog/ui";
import { LogOut, Settings } from "lucide-react";

import { signOut } from "@/lib/api/auth";
import { useDataMode } from "@/lib/data-provider";

export function UserFooter({ user }: { user: User }) {
  const mode = useDataMode();

  return (
    <div className="flex items-center gap-2.5 px-1 py-1">
      {/* No realtime presence channel exists, so the avatar never claims to be online. */}
      <Avatar name={user.name} src={user.image ?? undefined} size={30} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-ink">{user.name}</span>
        <span className="block truncate text-[10px] text-muted">{user.email}</span>
      </span>
      {mode === "api" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="size-8 px-0"
          aria-label="退出登录"
          onClick={() => {
            void signOut().finally(() => window.location.assign("/login"));
          }}
        >
          <LogOut aria-hidden="true" className="size-3.5" />
        </Button>
      ) : (
        <Settings aria-hidden="true" className="size-3.5 shrink-0 text-stone" />
      )}
    </div>
  );
}
