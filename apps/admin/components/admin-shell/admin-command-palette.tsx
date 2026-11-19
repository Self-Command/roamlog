"use client";

import { Building2, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from "@roamlog/ui";

import { ADMIN_NAV_GROUPS } from "./admin-nav";

interface AdminCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SearchResult {
  id: string;
  label: string;
  detail: string;
  href: string;
  type: "page" | "user" | "workspace";
}

export function AdminCommandPalette({ open, onOpenChange }: AdminCommandPaletteProps) {
  const [query, setQuery] = useState("");

  const results = useMemo<SearchResult[]>(() => {
    const pages = ADMIN_NAV_GROUPS.flatMap((group) => group.items)
      .filter((item) => !item.disabled)
      .map((item) => ({
        id: `page-${item.href}`,
        label: item.label,
        detail: "前往平台页面",
        href: item.href,
        type: "page" as const,
      }));

    return pages;
  }, []);

  const filtered = results.filter((result) => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    if (!needle) {
      return result.type === "page";
    }
    return `${result.label} ${result.detail}`.toLocaleLowerCase("zh-CN").includes(needle);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setQuery("");
        }
      }}
    >
      <DialogContent className="max-w-2xl p-0">
        <DialogHeader className="border-b border-hairline px-5 py-4">
          <DialogTitle className="text-xl">全局搜索</DialogTitle>
          <DialogDescription>
            输入关键词跳转到后台页面；用户与 Workspace 实体搜索请使用对应列表页的筛选。
          </DialogDescription>
        </DialogHeader>
        <div className="border-b border-hairline px-5 py-4">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            />
            <Input
              autoFocus
              aria-label="全局搜索查询"
              placeholder="搜索后台页面…"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="max-h-[52dvh] overflow-y-auto px-2 py-2">
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              没有匹配结果。尝试用户邮箱、工作区 slug 或页面名称。
            </p>
          ) : (
            <div className="space-y-1">
              {filtered.slice(0, 12).map((result) => {
                const Icon =
                  result.type === "user" ? Users : result.type === "workspace" ? Building2 : Search;
                return (
                  <a
                    key={result.id}
                    href={result.href}
                    onClick={() => onOpenChange(false)}
                    className="flex min-h-11 items-center gap-3 rounded-control px-3 py-2 outline-none hover:bg-surface-1 focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-[5px] border border-hairline bg-surface-2 text-muted">
                      <Icon aria-hidden="true" className="size-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-ink">{result.label}</span>
                      <span className="block truncate font-mono text-[9px] text-muted">
                        {result.detail}
                      </span>
                    </span>
                    <span className="ml-auto font-mono text-[8px] uppercase tracking-[0.1em] text-stone">
                      {result.type}
                    </span>
                  </a>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-hairline px-5 py-3">
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
            页面搜索
          </span>
          <span className="font-mono text-[9px] text-stone">ESC 关闭</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
