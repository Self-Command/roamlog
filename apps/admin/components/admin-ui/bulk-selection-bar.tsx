import type * as React from "react";

import { Button } from "@roamlog/ui";

interface BulkSelectionBarProps {
  count: number;
  noun: string;
  onClear: () => void;
  actions?: React.ReactNode;
}

export function BulkSelectionBar({ count, noun, onClear, actions }: BulkSelectionBarProps) {
  if (count === 0) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="批量选择操作"
      className="flex flex-wrap items-center gap-3 rounded-control border border-accent-blue/20 bg-accent-blue/5 px-3 py-2 text-[12px]"
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-accent-blue">
        已选择 {count} {noun}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {actions}
        <Button variant="ghost" size="sm" onClick={onClear}>
          清除选择
        </Button>
      </div>
    </div>
  );
}
