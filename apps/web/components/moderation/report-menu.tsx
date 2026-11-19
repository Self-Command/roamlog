"use client";

import { useState } from "react";
import { Flag, MoreHorizontal } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from "@roamlog/ui";

import { ReportDialog, type ReportTarget } from "./report-dialog";

/**
 * The single "more" menu used for reporting. Any workspace member — including
 * a Viewer — can open it; no capability flag is required.
 */
export function ReportMenu({
  workspaceId,
  target,
  align = "end",
  label,
}: {
  workspaceId: string;
  target: ReportTarget;
  align?: "start" | "end";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const accessibleLabel = label ?? `更多操作：${target.label}`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton type="button" variant="ghost" size="sm" aria-label={accessibleLabel}>
            <MoreHorizontal aria-hidden="true" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="min-w-36">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setOpen(true);
            }}
          >
            <Flag aria-hidden="true" />
            举报
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ReportDialog
        open={open}
        onOpenChange={setOpen}
        workspaceId={workspaceId}
        target={target}
      />
    </>
  );
}