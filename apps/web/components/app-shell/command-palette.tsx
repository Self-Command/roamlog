"use client";

import type { Trip } from "@roamlog/contracts";
import {
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from "@roamlog/ui";
import { ArrowUpRight, CalendarDays, Compass, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  nextTrip?: Trip;
}

export function CommandPalette({
  open,
  onOpenChange,
  workspaceSlug,
  nextTrip,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const commands = useMemo(
    () => [
      {
        label: "打开旅行库",
        hint: "查看全部旅行与筛选",
        href: `/w/${workspaceSlug}/trips`,
        icon: Compass,
      },
      ...(nextTrip
        ? [
            {
              label: nextTrip.title,
              hint: `${nextTrip.origin} → ${nextTrip.destinations.join(" · ")}`,
              href: `/w/${workspaceSlug}/trips/${nextTrip.id}`,
              icon: CalendarDays,
            },
          ]
        : []),
      {
        label: "新建旅行",
        hint: "表单骨架将在本轮提供",
        href: `/w/${workspaceSlug}/trips/new`,
        icon: Sparkles,
      },
    ],
    [nextTrip, workspaceSlug],
  );
  const visibleCommands = commands.filter((command) =>
    `${command.label} ${command.hint}`.toLocaleLowerCase("zh-CN").includes(query.toLowerCase()),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0">
        <DialogHeader className="mb-0 border-b border-hairline px-5 py-4 pr-14">
          <DialogTitle className="font-serif text-2xl">搜索与快捷命令</DialogTitle>
          <DialogDescription>
            命令面板目前是本地骨架，只连接到已存在的页面与 mock 旅行数据。
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-hairline px-4 py-3">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入页面、旅行或命令…"
              className="pl-9"
              aria-label="搜索命令"
            />
          </div>
        </div>

        <div className="space-y-1 p-2">
          {visibleCommands.length > 0 ? (
            visibleCommands.map((command) => {
              const Icon = command.icon;
              return (
                <a
                  key={command.href}
                  href={command.href}
                  onClick={() => onOpenChange(false)}
                  className="flex min-h-14 items-center gap-3 rounded-control px-3 py-2.5 outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-pill border border-hairline bg-surface-2 text-muted">
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{command.label}</span>
                    <span className="block truncate text-xs text-muted">{command.hint}</span>
                  </span>
                  <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-stone" />
                </a>
              );
            })
          ) : (
            <div className="px-3 py-8 text-center">
              <p className="text-sm text-muted">没有匹配的命令</p>
              <Badge tone="slate" className="mt-3">
                COMMAND PALETTE PLACEHOLDER
              </Badge>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
