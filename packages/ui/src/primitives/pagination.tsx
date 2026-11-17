"use client";

import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";
import { Button } from "./button";
import { IconButton } from "./icon-button";

type PaginationItem = number | "ellipsis-start" | "ellipsis-end";

function paginationItems(page: number, pageCount: number, siblingCount: number): PaginationItem[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const items: PaginationItem[] = [1];
  const start = Math.max(2, page - siblingCount);
  const end = Math.min(pageCount - 1, page + siblingCount);

  if (start > 3) {
    items.push("ellipsis-start");
  } else if (start === 3) {
    items.push(2);
  }

  for (let current = Math.max(2, start); current <= end; current += 1) {
    items.push(current);
  }

  if (end < pageCount - 2) {
    items.push("ellipsis-end");
  } else if (end === pageCount - 2) {
    items.push(pageCount - 1);
  }

  items.push(pageCount);
  return items;
}

export interface PaginationLabels {
  nav?: string;
  previous?: string;
  next?: string;
  page?: (page: number) => string;
}

export interface PaginationProps extends React.HTMLAttributes<HTMLElement> {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  siblingCount?: number;
  disabled?: boolean;
  labels?: PaginationLabels;
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  siblingCount = 1,
  disabled = false,
  labels,
  className,
  ...props
}: PaginationProps) {
  if (pageCount <= 0) {
    return null;
  }

  const currentPage = Math.min(pageCount, Math.max(1, page));
  const canGoBack = !disabled && currentPage > 1;
  const canGoForward = !disabled && currentPage < pageCount;
  const items = paginationItems(currentPage, pageCount, siblingCount);
  const pageLabel = labels?.page ?? ((value: number) => `第 ${value} 页`);

  return (
    <nav
      aria-label={labels?.nav ?? "分页"}
      className={cn("flex items-center justify-center gap-1", className)}
      {...props}
    >
      <IconButton
        size="sm"
        variant="subtle"
        aria-label={labels?.previous ?? "上一页"}
        disabled={!canGoBack}
        onClick={() => onPageChange(currentPage - 1)}
      >
        <ChevronLeft aria-hidden="true" />
      </IconButton>

      {items.map((item) =>
        typeof item === "number" ? (
          <Button
            key={item}
            type="button"
            size="sm"
            variant={item === currentPage ? "ghost" : "subtle"}
            aria-label={pageLabel(item)}
            aria-current={item === currentPage ? "page" : undefined}
            disabled={disabled}
            className={cn(
              "size-11 px-0 font-mono text-[11px] md:size-8",
              item === currentPage && "border-white/25 text-ink",
            )}
            onClick={() => onPageChange(item)}
          >
            {item}
          </Button>
        ) : (
          <span
            key={item}
            aria-hidden="true"
            className="inline-flex size-11 items-center justify-center text-stone md:size-8"
          >
            <MoreHorizontal className="size-4" />
          </span>
        ),
      )}

      <IconButton
        size="sm"
        variant="subtle"
        aria-label={labels?.next ?? "下一页"}
        disabled={!canGoForward}
        onClick={() => onPageChange(currentPage + 1)}
      >
        <ChevronRight aria-hidden="true" />
      </IconButton>
    </nav>
  );
}

export { paginationItems };
