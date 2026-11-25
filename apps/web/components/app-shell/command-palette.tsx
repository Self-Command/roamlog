"use client";

import type { SearchPerson, SearchResultItem, Trip } from "@roamlog/contracts";
import { ArrowUpRight, CalendarDays, Compass, Search, Sparkles, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/journal/ai/command";
import { useSearchQuery } from "@/lib/query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@roamlog/ui";

/**
 * 移植来源: shadcn-ui/ui CommandDialog + cmdk keyboard model
 *   https://github.com/shadcn-ui/ui/blob/main/apps/www/registry/default/ui/command.tsx
 *   (CommandDialog / CommandInput / CommandList / CommandGroup / CommandItem)
 * 已有本地移植副本: `apps/web/components/journal/ai/command.tsx`
 *   steven-tey/novel @ fa95098e66476c466faebb8211baa5869c101a9c
 *
 * 适配层: Dialog 使用 Roamlog 的 `@roamlog/ui`；过滤由真实
 * `/v1/workspaces/:id/search` 负责，`shouldFilter={false}` 仅关闭
 * cmdk 的本地二次过滤，键盘导航/aria 仍由 cmdk 提供。
 */

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  workspaceId?: string;
  nextTrip?: Trip;
}

interface CommandEntry {
  label: string;
  hint: string;
  href: string;
  icon: typeof Compass;
}

const SEARCH_TYPE_LABELS: Record<SearchResultItem["type"], string> = {
  trip: "旅行",
  entry: "日志",
  comment: "评论",
  person: "成员",
};

const SEARCH_DEBOUNCE_MS = 180;

function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

function searchHref(result: SearchResultItem, workspaceSlug: string): string {
  if (result.type === "trip") {
    return `/w/${workspaceSlug}/trips/${result.id}`;
  }
  if (result.type === "entry" || result.type === "comment") {
    return result.tripId
      ? `/w/${workspaceSlug}/trips/${result.tripId}`
      : `/w/${workspaceSlug}/journal`;
  }
  return `/w/${workspaceSlug}/members`;
}

function peopleHref(workspaceSlug: string): string {
  return `/w/${workspaceSlug}/members`;
}

export function CommandPalette({
  open,
  onOpenChange,
  workspaceSlug,
  workspaceId,
  nextTrip,
}: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const commands = useMemo<CommandEntry[]>(
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
        hint: "打开新建旅行表单",
        href: `/w/${workspaceSlug}/trips/new`,
        icon: Sparkles,
      },
    ],
    [nextTrip, workspaceSlug],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visibleCommands = commands.filter((command) =>
    `${command.label} ${command.hint}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery),
  );
  const canSearch = Boolean(workspaceId && debouncedQuery.length >= 2);
  const searchQuery = useSearchQuery(
    workspaceId,
    canSearch ? { q: debouncedQuery, type: "all", limit: 8 } : undefined,
    open && canSearch,
  );
  const data = canSearch ? searchQuery.data : undefined;
  const tripResults = data?.trips ?? [];
  const entryResults = data?.entries ?? [];
  const commentResults = data?.comments ?? [];
  const people = data?.people ?? [];
  const resultCount =
    tripResults.length + entryResults.length + commentResults.length + people.length;
  const showSearchHint = open && query.trim().length > 0 && query.trim().length < 2;
  const showEmpty =
    open &&
    canSearch &&
    !searchQuery.isLoading &&
    !searchQuery.isError &&
    resultCount === 0 &&
    visibleCommands.length === 0;

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  function navigate(href: string): void {
    onOpenChange(false);
    setQuery("");
    router.push(href);
  }

  function renderResult(result: SearchResultItem): ReactNode {
    return (
      <CommandItem
        key={`${result.type}-${result.id}`}
        value={`${result.type}-${result.id}-${result.title}`}
        onSelect={() => navigate(searchHref(result, workspaceSlug))}
        className="min-h-14 gap-3 px-3 py-2.5"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-pill border border-hairline bg-surface-2 text-muted">
          {result.type === "trip" ? (
            <Compass aria-hidden="true" className="size-4" />
          ) : (
            <Search aria-hidden="true" className="size-4" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{result.title}</span>
          <span className="block truncate text-xs text-muted">{result.snippet}</span>
        </span>
        <span className="shrink-0 font-mono text-[8px] uppercase tracking-[0.1em] text-stone">
          {SEARCH_TYPE_LABELS[result.type]}
        </span>
        <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-stone" />
      </CommandItem>
    );
  }

  function renderPerson(person: SearchPerson): ReactNode {
    return (
      <CommandItem
        key={`person-${person.id}`}
        value={`person-${person.id}-${person.name}`}
        onSelect={() => navigate(peopleHref(workspaceSlug))}
        className="min-h-14 gap-3 px-3 py-2.5"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-pill border border-hairline bg-surface-2 text-muted">
          <Users aria-hidden="true" className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{person.name}</span>
        <span className="shrink-0 font-mono text-[8px] uppercase tracking-[0.1em] text-stone">
          {SEARCH_TYPE_LABELS.person}
        </span>
        <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-stone" />
      </CommandItem>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 p-0">
        <DialogHeader className="border-b border-hairline px-5 py-4 pr-14">
          <DialogTitle className="font-display text-xl font-semibold">搜索与快捷命令</DialogTitle>
          <DialogDescription>
            同时搜索旅行、日志、评论与成员，或直接跳转到常用页面。
          </DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} loop label="搜索命令">
          <CommandInput
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="输入旅行、日志、评论、成员或命令…"
            aria-label="搜索命令"
          />
          <CommandList className="max-h-[58dvh]">
            {visibleCommands.length > 0 ? (
              <CommandGroup heading="快捷命令">
                {visibleCommands.map((command) => {
                  const Icon = command.icon;
                  return (
                    <CommandItem
                      key={command.href}
                      value={command.href}
                      onSelect={() => navigate(command.href)}
                      className="min-h-14 gap-3 px-3 py-2.5"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-pill border border-hairline bg-surface-2 text-muted">
                        <Icon aria-hidden="true" className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">{command.label}</span>
                        <span className="block truncate text-xs text-muted">{command.hint}</span>
                      </span>
                      <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-stone" />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}

            {visibleCommands.length > 0 && resultCount > 0 ? <CommandSeparator /> : null}

            {canSearch && searchQuery.isLoading ? (
              <div
                role="status"
                aria-live="polite"
                className="px-3 py-6 text-center text-sm text-muted"
              >
                正在搜索工作区…
              </div>
            ) : null}

            {canSearch && searchQuery.isError ? (
              <CommandGroup heading="搜索">
                <CommandItem
                  value="retry-search"
                  onSelect={() => {
                    void searchQuery.refetch();
                  }}
                  className="min-h-11 px-3"
                >
                  <span className="text-sm text-accent-red">搜索失败，点此重试</span>
                </CommandItem>
              </CommandGroup>
            ) : null}

            {tripResults.length > 0 ? (
              <CommandGroup heading="旅行">{tripResults.map(renderResult)}</CommandGroup>
            ) : null}
            {entryResults.length > 0 ? (
              <CommandGroup heading="日志">{entryResults.map(renderResult)}</CommandGroup>
            ) : null}
            {commentResults.length > 0 ? (
              <CommandGroup heading="评论">{commentResults.map(renderResult)}</CommandGroup>
            ) : null}
            {people.length > 0 ? (
              <CommandGroup heading="成员">{people.map(renderPerson)}</CommandGroup>
            ) : null}

            {showSearchHint ? (
              <div role="status" className="px-3 py-6 text-center text-sm text-muted">
                输入至少 2 个字符开始搜索。
              </div>
            ) : null}
            {showEmpty ? <CommandEmpty>没有匹配结果。</CommandEmpty> : null}
          </CommandList>
        </Command>
        <div className="flex items-center justify-between border-t border-hairline px-5 py-3">
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
            {canSearch ? `${resultCount} 条结果` : "页面与工作区搜索"}
          </span>
          <span className="font-mono text-[9px] text-stone">↑↓ 选择 · Enter 打开 · ESC 关闭</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
